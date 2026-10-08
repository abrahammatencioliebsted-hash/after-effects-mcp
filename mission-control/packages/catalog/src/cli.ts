#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentSummary, MachineSummary } from '@mc/contracts';
import { loadCatalog } from './load.js';
import { matchCapabilities } from './match.js';
import { catalogSchema } from './schema.js';
import type { CatalogIssue } from './validate.js';

const USO = `Uso: mc-catalog <comando> [opciones]

Comandos:
  validate <carpeta> [--json]
      Valida el catálogo YAML. Sale con código 1 si hay errores; 0 si solo hay advertencias.
  list <carpeta> [--tipo T] [--equipo E] [--ejecutor P] [--estado S] [--json]
      Lista capacidades con filtros.
  match <carpeta> --required a,b --agents agents.json --machines machines.json [--scope S] [--json]
      Aplica la regla de asignación del hito 1 y muestra los candidatos.
  schema [--out archivo]
      Imprime (o escribe) el JSON Schema del formato YAML.

Códigos de salida: 0 correcto · 1 errores de validación · 2 uso incorrecto.`;

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(args: string[], boolFlags: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (eq !== -1) flags.set(name, a.slice(eq + 1));
      else if (boolFlags.includes(name)) flags.set(name, true);
      else {
        const next = args[i + 1];
        if (next === undefined || next.startsWith('--')) throw new UsageError(`Falta el valor de --${name}.`);
        flags.set(name, next);
        i++;
      }
    } else positional.push(a);
  }
  return { positional, flags };
}

class UsageError extends Error {}

function flag(p: Parsed, name: string): string | undefined {
  const v = p.flags.get(name);
  return typeof v === 'string' ? v : undefined;
}

function checkFlags(p: Parsed, allowed: string[]) {
  for (const k of p.flags.keys()) if (!allowed.includes(k)) throw new UsageError(`Opción desconocida: --${k}.`);
}

function printIssues(issues: CatalogIssue[]) {
  const rows = issues.map((i) => [
    i.severity === 'error' ? 'ERROR' : 'AVISO',
    i.source ?? '',
    i.capabilityId ?? '-',
    i.path || '(raíz)',
    i.message,
  ]);
  console.log(table(['Severidad', 'Origen', 'Capacidad', 'Campo', 'Mensaje'], rows));
}

async function readJsonArray<T>(file: string, key: string): Promise<T[]> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    throw new UsageError(`No se pudo leer ${file}: ${(e as Error).message}`);
  }
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)[key]))
    return (data as Record<string, T[]>)[key] as T[];
  throw new UsageError(`${file} debe ser una lista JSON (o un objeto con la clave «${key}»).`);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    console.log(USO);
    return cmd ? 0 : 2;
  }

  if (cmd === 'validate') {
    const p = parseArgs(rest, ['json']);
    checkFlags(p, ['json']);
    const dir = p.positional[0];
    if (!dir) throw new UsageError('Falta la carpeta del catálogo.');
    const { capabilities, issues } = await loadCatalog(dir);
    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.length - errors;
    if (p.flags.has('json')) console.log(JSON.stringify({ ok: errors === 0, capabilities: capabilities.length, errors, warnings, issues }, null, 2));
    else {
      if (issues.length > 0) {
        printIssues(issues as CatalogIssue[]);
        console.log('');
      }
      console.log(`${capabilities.length} capacidades válidas · ${errors} errores · ${warnings} advertencias.`);
      if (errors > 0) console.log('El catálogo NO es válido: corrige los errores indicados.');
    }
    return errors > 0 ? 1 : 0;
  }

  if (cmd === 'list') {
    const p = parseArgs(rest, ['json']);
    checkFlags(p, ['json', 'tipo', 'equipo', 'ejecutor', 'estado']);
    const dir = p.positional[0];
    if (!dir) throw new UsageError('Falta la carpeta del catálogo.');
    const { capabilities, issues } = await loadCatalog(dir);
    const tipo = flag(p, 'tipo');
    const equipo = flag(p, 'equipo');
    const ejecutor = flag(p, 'ejecutor');
    const estado = flag(p, 'estado');
    const items = capabilities.filter(
      (c) =>
        (!tipo || c.tipo === tipo) &&
        (!equipo || c.equipos.includes(equipo)) &&
        (!ejecutor || (c.ejecutores as string[]).includes(ejecutor)) &&
        (!estado || c.estado === estado),
    );
    if (p.flags.has('json')) console.log(JSON.stringify(items, null, 2));
    else {
      if (items.length === 0) console.log('Ninguna capacidad coincide con los filtros.');
      else
        console.log(
          table(
            ['Id', 'Tipo', 'Estado', 'Ejecutores', 'Equipos', 'Consumo'],
            items.map((c) => [c.id, c.tipo, c.estado, c.ejecutores.join(','), c.equipos.join(','), c.consumo]),
          ),
        );
      const errs = issues.filter((i) => i.severity === 'error').length;
      if (errs > 0) console.error(`Aviso: ${errs} error(es) de validación dejaron entradas fuera; ejecuta «validate».`);
    }
    return 0;
  }

  if (cmd === 'match') {
    const p = parseArgs(rest, ['json']);
    checkFlags(p, ['json', 'required', 'agents', 'machines', 'scope']);
    const dir = p.positional[0];
    const required = flag(p, 'required');
    const agentsFile = flag(p, 'agents');
    const machinesFile = flag(p, 'machines');
    if (!dir) throw new UsageError('Falta la carpeta del catálogo.');
    if (!required || !agentsFile || !machinesFile) throw new UsageError('Faltan --required, --agents o --machines.');
    const { capabilities } = await loadCatalog(dir);
    const agents = await readJsonArray<AgentSummary>(agentsFile, 'agents');
    const machines = await readJsonArray<MachineSummary>(machinesFile, 'machines');
    const scope = flag(p, 'scope');
    const result = matchCapabilities(required.split(',').map((s) => s.trim()).filter(Boolean), {
      capabilities,
      agents,
      machines,
      ...(scope !== undefined ? { scope } : {}),
    });
    if (p.flags.has('json')) console.log(JSON.stringify({ candidates: result }, null, 2));
    else if (result.length === 0) console.log('Ningún candidato cumple todas las capacidades requeridas.');
    else {
      const nameOf = new Map(agents.map((a) => [a.id, a.name]));
      console.log(
        table(
          ['#', 'Agente', 'Equipo', 'Puntaje', 'Razones'],
          result.map((c, i) => [String(i + 1), nameOf.get(c.agentId) ?? c.agentId, c.machineId, String(c.score), c.reasons.join(' ')]),
        ),
      );
    }
    return 0;
  }

  if (cmd === 'schema') {
    const p = parseArgs(rest, []);
    checkFlags(p, ['out']);
    const text = JSON.stringify(catalogSchema, null, 2) + '\n';
    const out = flag(p, 'out');
    if (out) {
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, text, 'utf8');
      console.log(`Esquema escrito en ${out}`);
    } else process.stdout.write(text);
    return 0;
  }

  throw new UsageError(`Comando desconocido: ${cmd}.`);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    if (e instanceof UsageError) {
      console.error(`Error de uso: ${e.message}\n\n${USO}`);
      process.exitCode = 2;
    } else {
      console.error(`Error inesperado: ${(e as Error).message}`);
      process.exitCode = 3;
    }
  },
);
