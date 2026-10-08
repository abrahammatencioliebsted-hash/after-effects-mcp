import type { CatalogValidationIssue } from '@mc/contracts';
import {
  CAPABILITY_STATES,
  CAPABILITY_TYPES,
  COMPATIBILITY_STATES,
  CONSUMPTION_CLASSES,
  CONTEXT_LEVELS,
  PAPERCLIP_REF_KINDS,
  PLATFORMS,
  PROVENANCE,
} from './enums.js';

/** Incidencia con el origen (archivo y posición) para mostrarla en el CLI. */
export interface CatalogIssue extends CatalogValidationIssue {
  source?: string;
}

export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const KNOWN_KEYS = new Set([
  'id',
  'nombre',
  'tipo',
  'que_hace',
  'necesita',
  'ejecutores',
  'equipos',
  'contexto',
  'permisos',
  'consumo',
  'estado',
  'compatibilidad',
  'evidencia',
  'version',
  'fuente',
  'procedencia',
  'paperclipRef',
  'hermesRef',
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isIsoDate(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const m = DATE_PATTERN.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function list(values: readonly string[]): string {
  return values.join(' | ');
}

/**
 * Valida un objeto crudo contra el tipo `Capability`. No lanza nunca.
 * Las rutas (`path`) son relativas a la capacidad (p. ej. `evidencia[0].fecha`).
 * La unicidad de ids se comprueba en `loadCatalog`/`findDuplicateIds`, porque exige ver el conjunto.
 */
export function validateCapability(raw: unknown, source?: string): CatalogValidationIssue[] {
  const issues: CatalogIssue[] = [];
  const id = isObject(raw) && typeof raw.id === 'string' ? raw.id : undefined;
  const push = (severity: 'error' | 'warning', path: string, message: string) => {
    const issue: CatalogIssue = { path, message, severity };
    if (id !== undefined) issue.capabilityId = id;
    if (source !== undefined) issue.source = source;
    issues.push(issue);
  };
  const error = (path: string, message: string) => push('error', path, message);
  const warning = (path: string, message: string) => push('warning', path, message);

  if (!isObject(raw)) {
    error('', 'La capacidad debe ser un objeto con campos (id, nombre, tipo, ...).');
    return issues;
  }

  const requireString = (key: string) => {
    const v = raw[key];
    if (v === undefined) error(key, `Falta el campo obligatorio «${key}».`);
    else if (typeof v !== 'string' || v.trim() === '') error(key, `«${key}» debe ser un texto no vacío.`);
  };
  const requireEnum = (key: string, values: readonly string[]) => {
    const v = raw[key];
    if (v === undefined) error(key, `Falta el campo obligatorio «${key}».`);
    else if (typeof v !== 'string' || !values.includes(v))
      error(key, `«${key}» tiene el valor ${JSON.stringify(v)}; los permitidos son: ${list(values)}.`);
  };
  const stringArray = (value: unknown, path: string, label: string): string[] | undefined => {
    if (value === undefined) {
      error(path, `Falta el campo obligatorio «${label}».`);
      return undefined;
    }
    if (!Array.isArray(value)) {
      error(path, `«${label}» debe ser una lista de textos.`);
      return undefined;
    }
    value.forEach((item, i) => {
      if (typeof item !== 'string' || item.trim() === '') error(`${path}[${i}]`, `«${label}» solo admite textos no vacíos.`);
    });
    return value.filter((x): x is string => typeof x === 'string');
  };

  // id
  if (raw.id === undefined) error('id', 'Falta el campo obligatorio «id».');
  else if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id))
    error('id', `«id» debe estar en kebab-case (minúsculas, números y guiones): ${JSON.stringify(raw.id)}.`);

  requireString('nombre');
  requireEnum('tipo', CAPABILITY_TYPES);
  requireString('que_hace');
  stringArray(raw.necesita, 'necesita', 'necesita');

  // ejecutores
  if (raw.ejecutores === undefined) error('ejecutores', 'Falta el campo obligatorio «ejecutores».');
  else if (!Array.isArray(raw.ejecutores)) error('ejecutores', '«ejecutores» debe ser una lista de plataformas.');
  else {
    raw.ejecutores.forEach((p, i) => {
      if (typeof p !== 'string' || !(PLATFORMS as readonly string[]).includes(p))
        error(`ejecutores[${i}]`, `Plataforma ${JSON.stringify(p)} no válida; las permitidas son: ${list(PLATFORMS)}.`);
    });
    if (raw.ejecutores.length === 0)
      warning('ejecutores', 'Lista de ejecutores vacía: la regla de asignación nunca elegirá esta capacidad.');
  }

  // equipos
  const equipos = stringArray(raw.equipos, 'equipos', 'equipos');
  if (equipos !== undefined && equipos.length === 0 && Array.isArray(raw.equipos))
    warning('equipos', 'Lista de equipos vacía: ningún equipo puede ofrecer esta capacidad.');

  // contexto
  if (raw.contexto === undefined) error('contexto', 'Falta el campo obligatorio «contexto».');
  else if (!Array.isArray(raw.contexto)) error('contexto', '«contexto» debe ser una lista con valores A, B o C.');
  else
    raw.contexto.forEach((c, i) => {
      if (typeof c !== 'string' || !(CONTEXT_LEVELS as readonly string[]).includes(c))
        error(`contexto[${i}]`, `Nivel de contexto ${JSON.stringify(c)} no válido; los permitidos son: ${list(CONTEXT_LEVELS)}.`);
    });

  // permisos
  if (raw.permisos === undefined) error('permisos', 'Falta el campo obligatorio «permisos».');
  else if (!isObject(raw.permisos)) error('permisos', '«permisos» debe ser un objeto con «lectura» y «escritura».');
  else {
    stringArray(raw.permisos.lectura, 'permisos.lectura', 'permisos.lectura');
    stringArray(raw.permisos.escritura, 'permisos.escritura', 'permisos.escritura');
    for (const k of Object.keys(raw.permisos))
      if (k !== 'lectura' && k !== 'escritura') warning(`permisos.${k}`, `Campo desconocido «${k}» en permisos.`);
  }

  requireEnum('consumo', CONSUMPTION_CLASSES);
  requireEnum('estado', CAPABILITY_STATES);
  requireEnum('procedencia', PROVENANCE);

  // evidencia
  let evidenceCount = 0;
  let onlyDocumentation = true;
  if (raw.evidencia === undefined) error('evidencia', 'Falta el campo obligatorio «evidencia» (puede ser una lista vacía).');
  else if (!Array.isArray(raw.evidencia)) error('evidencia', '«evidencia» debe ser una lista.');
  else {
    evidenceCount = raw.evidencia.length;
    raw.evidencia.forEach((ev, i) => {
      const p = `evidencia[${i}]`;
      if (!isObject(ev)) {
        error(p, 'Cada evidencia debe ser un objeto (fecha, donde, resultado).');
        onlyDocumentation = false;
        return;
      }
      if (ev.fecha === undefined) error(`${p}.fecha`, 'Falta «fecha» (formato AAAA-MM-DD).');
      else if (!isIsoDate(ev.fecha)) error(`${p}.fecha`, `«fecha» debe ser una fecha ISO AAAA-MM-DD válida: ${JSON.stringify(ev.fecha)}.`);
      if (typeof ev.donde !== 'string' || ev.donde.trim() === '')
        error(`${p}.donde`, 'Falta «donde» (id de equipo, «nube» o «documentacion»).');
      else if (ev.donde !== 'documentacion') onlyDocumentation = false;
      if (typeof ev.resultado !== 'string' || ev.resultado.trim() === '') error(`${p}.resultado`, 'Falta «resultado» (texto no vacío).');
      if (ev.referencia !== undefined && typeof ev.referencia !== 'string')
        error(`${p}.referencia`, '«referencia» debe ser un texto.');
      for (const k of Object.keys(ev))
        if (!['fecha', 'donde', 'resultado', 'referencia'].includes(k)) warning(`${p}.${k}`, `Campo desconocido «${k}» en la evidencia.`);
    });
  }

  // compatibilidad
  if (raw.compatibilidad === undefined) error('compatibilidad', 'Falta el campo obligatorio «compatibilidad» (puede ser {}).');
  else if (!isObject(raw.compatibilidad)) error('compatibilidad', '«compatibilidad» debe ser un objeto plataforma → NC|FV|VL|PF.');
  else {
    for (const [plat, val] of Object.entries(raw.compatibilidad)) {
      const p = `compatibilidad.${plat}`;
      if (!(PLATFORMS as readonly string[]).includes(plat))
        error(p, `Plataforma ${JSON.stringify(plat)} no válida; las permitidas son: ${list(PLATFORMS)}.`);
      if (typeof val !== 'string' || !(COMPATIBILITY_STATES as readonly string[]).includes(val))
        error(p, `Valor ${JSON.stringify(val)} no válido; los permitidos son: ${list(COMPATIBILITY_STATES)}.`);
      else if (val === 'PF' && evidenceCount === 0)
        warning(p, `Compatibilidad PF (probada funcionando) en «${plat}» sin evidencia fechada.`);
    }
  }

  // advertencias de honestidad
  if (raw.estado === 'probada') {
    if (evidenceCount === 0) warning('estado', 'Estado «probada» sin evidencia fechada: «probada» solo vale con evidencia.');
    else if (onlyDocumentation)
      warning('estado', 'Estado «probada» respaldado solo por documentación: leer la documentación no es probar la capacidad.');
  }

  // opcionales
  for (const k of ['version', 'fuente', 'hermesRef'] as const)
    if (raw[k] !== undefined && typeof raw[k] !== 'string') error(k, `«${k}» debe ser un texto.`);
  if (raw.paperclipRef !== undefined) {
    const r = raw.paperclipRef;
    if (!isObject(r)) error('paperclipRef', '«paperclipRef» debe ser un objeto { kind, id }.');
    else {
      if (typeof r.kind !== 'string' || !(PAPERCLIP_REF_KINDS as readonly string[]).includes(r.kind))
        error('paperclipRef.kind', `«kind» debe ser: ${list(PAPERCLIP_REF_KINDS)}.`);
      if (typeof r.id !== 'string' || r.id.trim() === '') error('paperclipRef.id', '«id» debe ser un texto no vacío.');
    }
  }

  for (const k of Object.keys(raw))
    if (!KNOWN_KEYS.has(k)) warning(k, `Campo desconocido «${k}»: posible error de escritura (se ignora).`);

  return issues;
}

/** Devuelve una incidencia de error por cada id repetido (a partir de la segunda aparición). */
export function findDuplicateIds(entries: Array<{ id: string; source?: string }>): CatalogIssue[] {
  const seen = new Map<string, string | undefined>();
  const out: CatalogIssue[] = [];
  for (const e of entries) {
    if (seen.has(e.id)) {
      const first = seen.get(e.id);
      const issue: CatalogIssue = {
        capabilityId: e.id,
        path: 'id',
        message: `Id duplicado «${e.id}»${first ? ` (ya definido en ${first})` : ''}. Los ids deben ser únicos.`,
        severity: 'error',
      };
      if (e.source !== undefined) issue.source = e.source;
      out.push(issue);
    } else seen.set(e.id, e.source);
  }
  return out;
}
