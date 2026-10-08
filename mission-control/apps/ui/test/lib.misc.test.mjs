import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash } from '../src/lib/router.ts';
import { rankSearch, scoreMatch } from '../src/lib/search.ts';
import { parseMarkdown, parseInline, safeHref } from '../src/lib/markdown.ts';
import { niceMax, heatLevel, litSegments, gaugeEnd, normalizeHeatmap, sumByDay, sumByHour, mondayFirst, DAY_LABELS, cityLayout, isoProject, arcPath, sparkPoints } from '../src/lib/chart.ts';
import { validateStep, BLANK, resolveIdempotencyKey, isIdempotencyConflict } from '../src/lib/wizard.ts';
import { machineMetrics, worstSeverity } from '../src/lib/metrics.ts';
import { ApiRequestError } from '../src/lib/api.ts';
import { parseEvent, backoffMs } from '../src/lib/sse.ts';
import { AGENT_LIMITS, clampLimit, limitWarning, limitsInvalid, completeLimits } from '../src/lib/limits.ts';

test('router hash: vista, id y query', () => {
  assert.deepEqual(parseHash('#/misiones/mis-1?tab=replay'), { view: 'misiones', id: 'mis-1', query: { tab: 'replay' } });
  assert.deepEqual(parseHash(''), { view: 'cockpit', query: {} });
  assert.equal(parseHash('#/inexistente').view, 'cockpit');
  assert.equal(buildHash('docs', 'a b', { x: undefined, y: '1' }), '#/docs/a%20b?y=1');
  assert.equal(parseHash(buildHash('agentes', 'ag/1')).id, 'ag/1');
});

test('búsqueda global: prefijo antes que subcadena, sin acentos', () => {
  const items = [
    { kind: 'agente', id: '1', title: 'Research', subtitle: 'Investigación' },
    { kind: 'mision', id: '2', title: 'Informe de research profundo' },
    { kind: 'vista', id: 'salud', title: 'Salud' },
  ];
  assert.deepEqual(rankSearch('resea', items).map((i) => i.id), ['1', '2']);
  assert.equal(scoreMatch('investigacion', items[0]) > 0, true);
  assert.deepEqual(rankSearch('zzz', items), []);
  assert.deepEqual(rankSearch('', items), []);
});

test('markdown: bloques e inline, y enlaces peligrosos descartados', () => {
  const b = parseMarkdown('# Título\n\nHola **mundo** y `x`.\n\n- a\n- b\n\n> cita\n\n```js\nlet a\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |');
  assert.deepEqual(b.map((x) => x.t), ['h', 'p', 'ul', 'quote', 'code', 'table']);
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('https://x.org'), 'https://x.org');
  const inl = parseInline('[mal](javascript:alert(1)) y [bien](https://a.b)');
  assert.equal(inl.filter((n) => n.t === 'link').length, 1);
});

test('gráficas: escalas, niveles y matrices', () => {
  assert.equal(niceMax(13), 20);
  assert.equal(niceMax(4), 5);
  assert.equal(niceMax(0), 1);
  assert.equal(heatLevel(0, 10), 0);
  assert.equal(heatLevel(10, 10), 4);
  assert.equal(heatLevel(1, 10), 1);
  assert.equal(litSegments(0, 24), 0);
  assert.equal(litSegments(100, 24), 24);
  assert.equal(litSegments(50, 24), 12);
  assert.equal(gaugeEnd(0), 150);
  assert.equal(gaugeEnd(100), 390);
  const m = normalizeHeatmap([[1, 2], [3]]);
  assert.equal(m.length, 7);
  assert.equal(m[0].length, 24);
  assert.equal(sumByDay(m)[0], 3);
  assert.equal(sumByHour(m)[0], 4);
  assert.match(arcPath(100, 100, 50, 150, 390), /^M .* A 50 50 0 1 1 /);
  assert.equal(sparkPoints([1, 2, 3], 100, 20).length, 3);
});

test('mapa de calor: fila 0 del BFF = domingo, se pinta lunes-primero en horas UTC', () => {
  const bff = Array.from({ length: 7 }, () => new Array(24).fill(0));
  bff[4][9] = 5; // getUTCDay() = 4 (jueves), getUTCHours() = 9
  const painted = mondayFirst(normalizeHeatmap(bff));
  const row = painted.findIndex((r) => r.some((v) => v > 0));
  assert.equal(DAY_LABELS[row], 'Jue');
  assert.equal(painted[row][9], 5);
  // domingo (fila 0 del BFF) acaba en la última fila, «Dom»
  const sun = Array.from({ length: 7 }, () => new Array(24).fill(0));
  sun[0][0] = 2;
  assert.equal(DAY_LABELS[mondayFirst(sun).findIndex((r) => r[0] > 0)], 'Dom');
  // la vista «7 días» usa la misma rotación
  assert.deepEqual(sumByDay(mondayFirst(bff)), [0, 0, 0, 5, 0, 0, 0]);
});

test('ciudad isométrica: layout y proyección', () => {
  assert.deepEqual(cityLayout(5).length, 5);
  assert.deepEqual(cityLayout(4), [[0, 0], [1, 0], [0, 1], [1, 1]]);
  assert.deepEqual(isoProject(1, 0, 200, 100), { x: 100, y: 50 });
  assert.deepEqual(isoProject(0, 1, 200, 100), { x: -100, y: 50 });
});

test('asistente de misiones: validación por paso', () => {
  assert.deepEqual(Object.keys(validateStep(0, BLANK)).sort(), ['objective', 'title']);
  assert.deepEqual(validateStep(0, { ...BLANK, title: 'Algo', objective: 'x' }), {});
  assert.ok(validateStep(1, { ...BLANK, teamMode: 'manual' }).team);
  assert.ok(validateStep(1, { ...BLANK, teamMode: 'boss', bossAgentId: '' }).team);
  assert.deepEqual(validateStep(1, { ...BLANK, teamMode: 'boss', bossAgentId: 'x' }), {});
  assert.ok(validateStep(2, { ...BLANK, maxMinutes: 1 }).maxMinutes);
});

test('métricas de máquina y severidad', () => {
  const GB = 1024 ** 3;
  const m = { id: 'a', name: 'A', os: 'linux', role: '', status: 'online', agentIds: [], capabilityIds: [], maxHeavyJobs: 1, activeHeavyJobs: 0, origin: 'demo',
    health: { at: '', cpuPercent: 90, memUsedBytes: 8 * GB, memTotalBytes: 16 * GB, diskUsedBytes: 95 * GB, diskTotalBytes: 100 * GB, uptimeSec: 1, gpu: { name: 'g', memUsedBytes: GB, memTotalBytes: 4 * GB, utilPercent: 20 } } };
  const x = machineMetrics(m);
  assert.deepEqual(x.map((y) => y.key), ['cpu', 'mem', 'disk', 'gpu']);
  assert.equal(x[0].severity, 'crit');
  assert.equal(x[1].severity, 'ok');
  assert.equal(worstSeverity(x), 'crit');
  const sin = machineMetrics({ ...m, health: undefined });
  assert.equal(sin[0].percent, null);
});

test('SSE: parseo de eventos y backoff con tope', () => {
  const e = parseEvent('heartbeat', '{"at":"2026-10-08T00:00:00Z"}');
  assert.equal(e.type, 'heartbeat');
  assert.equal(parseEvent('activity', 'no json'), null);
  assert.deepEqual([0, 1, 2, 10].map(backoffMs), [1000, 2000, 4000, 20000]);
});

test('topes por agente: mínimos reales del BFF, aviso y cuatro campos completos', () => {
  const [runs, cost, conc, timeout] = AGENT_LIMITS;
  assert.deepEqual(AGENT_LIMITS.map((l) => [l.key, l.min]), [['maxDailyRuns', 1], ['maxDailyCostCents', 0], ['maxConcurrentRuns', 1], ['timeoutSec', 10]]);
  assert.equal(conc.max, 8);
  assert.equal(clampLimit(runs, 0), 1);
  assert.equal(clampLimit(cost, -3), 0);
  assert.equal(clampLimit(conc, 20), 8);
  assert.equal(clampLimit(timeout, 5), 10);
  assert.match(limitWarning(timeout, 5), /mínimo es 10/);
  assert.match(limitWarning(runs, 0), /mínimo es 1/);
  assert.equal(limitWarning(cost, 0), undefined);
  assert.equal(limitWarning(timeout, 10), undefined);
  assert.equal(limitsInvalid({ maxDailyRuns: 0 }), true);
  assert.equal(limitsInvalid({ maxDailyRuns: 5, maxDailyCostCents: 0, maxConcurrentRuns: 2, timeoutSec: 600 }), false);
  assert.deepEqual(completeLimits({ maxDailyRuns: 7 }), { maxDailyRuns: 7, maxDailyCostCents: 0, maxConcurrentRuns: 1, timeoutSec: 10 });
});

test('asistente: el modo reglas exige catálogo cargado', () => {
  const rules = { ...BLANK, teamMode: 'rules' };
  assert.ok(validateStep(1, rules, { catalogReady: false }).team);
  assert.deepEqual(validateStep(1, rules, { catalogReady: true }), {});
  assert.deepEqual(validateStep(1, rules), {});
  // en otros modos el catálogo no importa
  assert.deepEqual(validateStep(1, { ...BLANK, teamMode: 'boss', bossAgentId: 'x' }, { catalogReady: false }), {});
});

test('Idempotency-Key: misma clave si el cuerpo no cambia, nueva si cambia (UI-09)', () => {
  let n = 0;
  const make = () => `k${++n}`;
  const a = resolveIdempotencyKey(null, '{"t":1}', make);
  assert.equal(a.key, 'k1');
  assert.equal(resolveIdempotencyKey(a, '{"t":1}', make).key, 'k1'); // reintento idéntico: idempotente
  assert.equal(resolveIdempotencyKey(a, '{"t":2}', make).key, 'k2'); // borrador corregido: clave nueva
  assert.equal(n, 2);
});

test('409 idempotency_key_conflict: forma real del BFF (details.code) y forma plana', () => {
  assert.equal(isIdempotencyConflict(new ApiRequestError('x', 409, 'conflict', { code: 'idempotency_key_conflict' })), true);
  assert.equal(isIdempotencyConflict({ status: 409, code: 'idempotency_key_conflict' }), true);
  assert.equal(isIdempotencyConflict(new ApiRequestError('x', 409, 'conflict')), false);
  assert.equal(isIdempotencyConflict(new ApiRequestError('x', 0, 'network')), false);
  assert.equal(isIdempotencyConflict(null), false);
});
