import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  loadCatalog,
  validateCapability,
  matchCapabilities,
  catalogSchema,
  CATALOG_SCHEMA_VERSION,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = join(here, '..', 'catalog');
const fx = (name) => join(here, 'fixtures', name);
const cli = join(here, '..', 'dist', 'cli.js');
const runCli = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

const errorsOf = (issues) => issues.filter((i) => i.severity === 'error');
const warningsOf = (issues) => issues.filter((i) => i.severity === 'warning');

// ---------------------------------------------------------------------------
// Semilla
// ---------------------------------------------------------------------------

test('la semilla carga sin errores ni advertencias', async () => {
  const { capabilities, issues } = await loadCatalog(seedDir);
  assert.deepEqual(issues, []);
  assert.equal(capabilities.length, 23);
  const ids = new Set(capabilities.map((c) => c.id));
  assert.equal(ids.size, capabilities.length, 'ids únicos');
  for (const id of ['retomar-proyecto', 'paquete-de-delegacion', 'cerrar-sesion', 'verificar-fuentes', 'ficha-de-proyecto', 'roles',
    'hermes-api-server', 'hermes-api-server-equipos', 'paperclip-hermes-gateway', 'claude-code-local', 'codex-local', 'grok-local',
    'mimo-token-plan-via-hermes', 'modelo-simulado-stub', 'obsidian-lectura', 'drive-lectura', 'calendar-lectura', 'notion-lectura',
    'slack-entrada', 'registro-de-elecciones-lectura', 'paperclip-mcp-server', 'nvidia-gpu-local'])
    assert.ok(ids.has(id), `falta ${id}`);
});

test('la semilla es honesta: «probada» solo con evidencia fechada y solo 3 capacidades', async () => {
  const { capabilities } = await loadCatalog(seedDir);
  const probadas = capabilities.filter((c) => c.estado === 'probada');
  assert.deepEqual(probadas.map((c) => c.id).sort(), ['hermes-api-server', 'modelo-simulado-stub', 'paperclip-hermes-gateway']);
  for (const c of probadas) {
    assert.ok(c.evidencia.length > 0);
    assert.ok(c.evidencia.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.fecha)));
    assert.deepEqual(c.equipos, ['nube']);
  }
  const procs = capabilities.filter((c) => c.tipo === 'skill');
  assert.equal(procs.length, 6);
  for (const p of procs) {
    assert.equal(p.estado, 'descubierta');
    assert.equal(p.procedencia, 'P');
    assert.deepEqual(p.compatibilidad, { hermes: 'FV', claude: 'FV', codex: 'FV', grok: 'NC' });
    assert.deepEqual(p.equipos, ['mac', 'win-principal']);
  }
  const eq = capabilities.find((c) => c.id === 'hermes-api-server-equipos');
  assert.equal(eq.estado, 'pendiente');
  assert.deepEqual(eq.equipos, ['win-principal', 'win-laptop-1', 'win-laptop-2', 'mac']);
  for (const id of ['notion-lectura', 'drive-lectura', 'calendar-lectura', 'claude-code-local', 'codex-local', 'grok-local'])
    assert.equal(capabilities.find((c) => c.id === id).estado, 'pendiente');
});

test('el JSON Schema escrito en schema/ coincide con catalogSchema', () => {
  const onDisk = JSON.parse(readFileSync(join(here, '..', 'schema', 'capability.schema.json'), 'utf8'));
  assert.deepEqual(onDisk, JSON.parse(JSON.stringify(catalogSchema)));
  assert.match(CATALOG_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
});

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

test('fixture con 6 clases de entradas inválidas produce las rutas esperadas', async () => {
  const { capabilities, issues } = await loadCatalog(fx('invalid'));
  const errs = errorsOf(issues);
  const has = (id, path, rx) =>
    assert.ok(
      errs.some((i) => i.capabilityId === id && i.path === path && rx.test(i.message)),
      `esperaba error ${id}:${path} ~ ${rx}; hay ${JSON.stringify(errs.map((e) => [e.capabilityId, e.path]))}`,
    );
  has('BadCaseId', 'id', /kebab-case/);
  has('tipo-malo', 'tipo', /permitidos/);
  has('sin-que-hace', 'que_hace', /obligatorio/);
  has('fecha-mala', 'evidencia[0].fecha', /AAAA-MM-DD/);
  has('compat-mala', 'compatibilidad.hermes', /NC \| FV \| VL \| PF/);
  has('compat-mala', 'compatibilidad.zzz', /no válida/);
  has('repetido', 'id', /duplicado/);
  // Solo sobreviven la válida y la primera de las repetidas
  assert.deepEqual(capabilities.map((c) => c.id).sort(), ['repetido', 'valida-al-lado']);
  // Las incidencias llevan el origen
  assert.ok(errs.every((e) => typeof e.source === 'string' && e.source.startsWith('malas.yaml')));
});

test('advertencias: probada sin evidencia, PF sin evidencia, equipos vacío (no excluyen)', async () => {
  const { capabilities, issues } = await loadCatalog(fx('warnings'));
  assert.deepEqual(errorsOf(issues), []);
  assert.equal(capabilities.length, 3);
  const w = warningsOf(issues);
  const find = (id, path) => w.find((i) => i.capabilityId === id && i.path === path);
  assert.ok(find('probada-sin-evidencia', 'estado'));
  assert.ok(find('pf-sin-evidencia', 'compatibilidad.hermes'));
  assert.ok(find('sin-equipos', 'equipos'));
  assert.equal(w.length, 3);
});

test('una capacidad suelta (no lista) también se carga', async () => {
  const { capabilities, issues } = await loadCatalog(fx('valid'));
  assert.deepEqual(issues, []);
  assert.deepEqual(capabilities.map((c) => c.id), ['una-sola']);
});

test('YAML roto y carpeta inexistente producen errores sin lanzar', async () => {
  const a = await loadCatalog(fx('roto'));
  assert.equal(a.capabilities.length, 0);
  assert.equal(errorsOf(a.issues).length, 1);
  assert.match(a.issues[0].message, /YAML inválido/);
  const b = await loadCatalog(fx('no-existe'));
  assert.equal(errorsOf(b.issues).length, 1);
});

test('validateCapability no lanza con basura y valida fechas de calendario', () => {
  for (const raw of [null, undefined, 42, 'x', [], {}]) {
    const issues = validateCapability(raw);
    assert.ok(errorsOf(issues).length >= 1);
  }
  const base = {
    id: 'x', nombre: 'X', tipo: 'skill', que_hace: 'y', necesita: [], ejecutores: ['hermes'], equipos: ['mac'],
    contexto: ['A'], permisos: { lectura: [], escritura: [] }, consumo: 'local', estado: 'pendiente',
    compatibilidad: {}, evidencia: [{ fecha: '2026-02-30', donde: 'nube', resultado: 'r' }], procedencia: 'Pr',
  };
  assert.ok(validateCapability(base).some((i) => i.path === 'evidencia[0].fecha'));
  base.evidencia[0].fecha = '2026-02-28';
  assert.deepEqual(validateCapability(base, 'a.yaml'), []);
  assert.ok(validateCapability({ ...base, extra: 1 }).some((i) => i.severity === 'warning' && i.path === 'extra'));
});

// ---------------------------------------------------------------------------
// Asignación
// ---------------------------------------------------------------------------

const cap = (id, estado, ejecutores, equipos) => ({
  id, nombre: id, tipo: 'skill', que_hace: '', necesita: [], ejecutores, equipos, contexto: ['A'],
  permisos: { lectura: [], escritura: [] }, consumo: 'local', estado, compatibilidad: {}, evidencia: [], procedencia: 'Pr',
});
const machine = (id, status, activeHeavyJobs) => ({
  id, name: id, os: 'linux', role: '', status, agentIds: [], capabilityIds: [], maxHeavyJobs: 2, activeHeavyJobs, origin: 'demo',
});
const agent = (id, name, platform, state, machineId) => ({
  id, name, shortName: name, role: 'r', platform, state, isBoss: false, ...(machineId ? { machineId } : {}),
});

test('match: elige el equipo en línea con menos trabajos pesados', () => {
  const ctx = {
    capabilities: [cap('c1', 'probada', ['hermes'], ['win-principal', 'mac', 'win-laptop-1'])],
    machines: [machine('win-principal', 'online', 2), machine('mac', 'online', 0), machine('win-laptop-1', 'offline', 0)],
    agents: [agent('a1', 'Alfa', 'hermes', 'available')],
  };
  const r = matchCapabilities(['c1'], ctx);
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((c) => c.machineId), ['mac', 'win-principal', 'win-laptop-1']);
  assert.equal(r[0].score, 3 + 1); // probada + available
  assert.equal(r[1].score, 3 - 2 + 1); // 2 trabajos pesados
  assert.equal(r[2].score, 3 - 3 + 1); // offline
  assert.ok(r[0].reasons.length >= 2 && r[0].reasons.every((x) => typeof x === 'string' && x.length > 0));
  assert.ok(r[2].reasons.some((x) => /no está en línea/.test(x)));
});

test('match: excluye agentes paused|error|offline y requeridas incompatibles', () => {
  const ctx = {
    capabilities: [cap('c1', 'probada', ['hermes'], ['mac']), cap('c2', 'incompatible', ['hermes'], ['mac'])],
    machines: [machine('mac', 'online', 0)],
    agents: [
      agent('p', 'Aaa pausado', 'hermes', 'paused'),
      agent('e', 'Bbb error', 'hermes', 'error', 'mac'),
      agent('o', 'Ccc offline', 'hermes', 'offline'),
      agent('d', 'Zzz disponible', 'hermes', 'available'),
    ],
  };
  const r = matchCapabilities(['c1'], ctx);
  assert.deepEqual(r.map((c) => c.agentId), ['d']);
  assert.deepEqual(matchCapabilities(['c1', 'c2'], ctx), []);
});

test('match: exige TODAS las capacidades y respeta plataforma, equipo y machineId del agente', () => {
  const ctx = {
    capabilities: [
      cap('c1', 'probada', ['hermes', 'claude'], ['mac', 'win-principal']),
      cap('c2', 'configurada', ['hermes'], ['mac']),
      cap('c3', 'descubierta', ['claude'], ['mac']),
    ],
    machines: [machine('mac', 'online', 0), machine('win-principal', 'online', 0)],
    agents: [
      agent('h-any', 'Hermes libre', 'hermes', 'available'),
      agent('h-win', 'Hermes fijo en win', 'hermes', 'available', 'win-principal'),
      agent('cl', 'Claude', 'claude', 'available'),
    ],
  };
  // c1+c2: solo hermes en mac (win-principal no está en c2.equipos)
  const r = matchCapabilities(['c1', 'c2'], ctx);
  assert.deepEqual(r.map((c) => [c.agentId, c.machineId]), [['h-any', 'mac']]);
  assert.equal(r[0].score, 3 + 2 + 1);
  // c1 solo: hermes libre en 2 equipos + hermes fijo en win + claude en 2 equipos
  assert.equal(matchCapabilities(['c1'], ctx).length, 2 + 1 + 2);
  // c2+c3: ningún ejecutor cumple ambas
  assert.deepEqual(matchCapabilities(['c2', 'c3'], ctx), []);
  // un requisito repetido cuenta una vez
  assert.equal(matchCapabilities(['c2', 'c2'], ctx).length, 1);
  assert.equal(matchCapabilities(['c2', 'c2'], ctx)[0].score, 2 + 1);
});

test('match: [] sin lanzar con requisitos vacíos, ids desconocidos o contexto vacío', () => {
  const ctx = { capabilities: [cap('c1', 'probada', ['hermes'], ['mac'])], machines: [], agents: [] };
  assert.deepEqual(matchCapabilities([], ctx), []);
  assert.deepEqual(matchCapabilities(['c1'], ctx), []);
  assert.deepEqual(matchCapabilities(['no-existe'], ctx), []);
  assert.deepEqual(matchCapabilities(['c1'], { capabilities: [], machines: [], agents: [] }), []);
  assert.deepEqual(matchCapabilities(['c1'], { capabilities: [] }), []);
});

test('match: desempata por trabajos pesados y luego por nombre', () => {
  // 'stale' (-3) con 0 trabajos y 'online' con 3 trabajos empatan en puntaje; gana el de menos trabajos pesados
  const ctx = {
    capabilities: [cap('c1', 'probada', ['hermes'], ['m-stale', 'm-busy'])],
    machines: [machine('m-stale', 'stale', 0), machine('m-busy', 'online', 3)],
    agents: [agent('b', 'Beta', 'hermes', 'working'), agent('a', 'Alfa', 'hermes', 'working')],
  };
  const r = matchCapabilities(['c1'], ctx);
  assert.deepEqual(r.map((c) => c.score), [0, 0, 0, 0]);
  assert.deepEqual(r.map((c) => [c.agentId, c.machineId]), [['a', 'm-stale'], ['b', 'm-stale'], ['a', 'm-busy'], ['b', 'm-busy']]);
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test('cli validate: 0 con la semilla, 0 con solo advertencias, 1 con errores, 2 con mal uso', () => {
  const ok = runCli('validate', seedDir);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /23 capacidades válidas · 0 errores/);
  const warn = runCli('validate', fx('warnings'));
  assert.equal(warn.status, 0);
  assert.match(warn.stdout, /AVISO/);
  const bad = runCli('validate', fx('invalid'));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /ERROR/);
  assert.match(bad.stdout, /evidencia\[0\]\.fecha/);
  assert.equal(runCli('validate', fx('no-existe')).status, 1);
  assert.equal(runCli('validate').status, 2);
  assert.equal(runCli('nada').status, 2);
  const json = JSON.parse(runCli('validate', fx('invalid'), '--json').stdout);
  assert.equal(json.ok, false);
});

test('cli list: filtra por tipo, equipo, ejecutor y estado', () => {
  const r = runCli('list', seedDir, '--tipo', 'skill', '--ejecutor', 'grok', '--estado', 'descubierta', '--equipo', 'mac', '--json');
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).length, 6);
  const inc = JSON.parse(runCli('list', seedDir, '--estado', 'incompatible', '--json').stdout);
  assert.deepEqual(inc.map((c) => c.id), ['grok-bot-manual']);
  assert.match(runCli('list', seedDir, '--tipo', 'plugin').stdout, /Ninguna capacidad/);
  const gpu = JSON.parse(runCli('list', seedDir, '--equipo', 'win-laptop-2', '--json').stdout);
  assert.deepEqual(gpu.map((c) => c.id).sort(), ['hermes-api-server-equipos', 'mimo-token-plan-via-hermes']);
});

test('cli match: lee agents.json y machines.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-catalog-'));
  const agents = join(dir, 'agents.json');
  const machines = join(dir, 'machines.json');
  writeFileSync(agents, JSON.stringify([agent('a1', 'Alfa', 'hermes', 'available'), agent('a2', 'Beta', 'claude', 'available')]));
  writeFileSync(machines, JSON.stringify([machine('mac', 'online', 1), machine('win-principal', 'online', 0)]));
  const r = runCli('match', seedDir, '--required', 'retomar-proyecto,cerrar-sesion', '--agents', agents, '--machines', machines, '--json');
  assert.equal(r.status, 0, r.stderr);
  const { candidates } = JSON.parse(r.stdout);
  // dos capacidades «descubierta» (+1 +1) + available (+1) = 3; win-principal sin trabajos pesados gana
  assert.equal(candidates[0].machineId, 'win-principal');
  assert.equal(candidates[0].score, 3);
  assert.equal(candidates.length, 4);
  const none = runCli('match', seedDir, '--required', 'nvidia-gpu-local,claude-code-local', '--agents', agents, '--machines', machines);
  assert.equal(none.status, 0);
  assert.match(none.stdout, /Ningún candidato/);
  assert.equal(runCli('match', seedDir, '--required', 'x').status, 2);
});
