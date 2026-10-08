import { randomUUID } from 'node:crypto';
import { badRequest } from './errors.js';

export const newId = (): string => randomUUID();

export const iso = (d: Date | number): string => new Date(d).toISOString();

/** Cursor opaco: desplazamiento codificado en base64url. */
export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined | null): number {
  if (!cursor) return 0;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof v.o === 'number' && Number.isInteger(v.o) && v.o >= 0) return v.o;
  } catch {
    /* cae al error de abajo */
  }
  throw badRequest('cursor inválido');
}

export function clampLimit(raw: string | number | undefined | null, def = 50, max = 200): number {
  if (raw === undefined || raw === null || raw === '') return def;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) throw badRequest('limit debe ser un entero positivo');
  return Math.min(Math.floor(n), max);
}

export function paginate<T>(items: T[], limit: number, cursor?: string | null): { items: T[]; nextCursor?: string } {
  const offset = decodeCursor(cursor);
  const page = items.slice(offset, offset + limit);
  const next = offset + limit;
  return next < items.length ? { items: page, nextCursor: encodeCursor(next) } : { items: page };
}

export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export function excerpt(text: string, max = 220): string {
  const flat = text.replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function envKeyForMachine(machineId: string): string {
  return machineId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
