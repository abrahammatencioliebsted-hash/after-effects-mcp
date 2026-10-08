// Formateadores en español. Lógica pura.
import type { TokenUsage } from '@mc/contracts';

const LOCALE = 'es';

export function formatDuration(totalSec: number | null | undefined): string {
  if (totalSec == null || !Number.isFinite(totalSec) || totalSec < 0) return '—';
  const s = Math.round(totalSec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rest = s % 60;
    return m < 10 && rest > 0 ? `${m} min ${rest} s` : `${m} min`;
  }
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm > 0 ? `${h} h ${rm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d} d ${rh} h` : `${d} d`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1_000_000) return `${trim1(n / 1000)}K`;
  if (abs < 1_000_000_000) return `${trim1(n / 1_000_000)}M`;
  return `${trim1(n / 1_000_000_000)}B`;
}

function trim1(x: number): string {
  const v = Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
  return String(v).replace('.', ',');
}

export function totalTokens(t: TokenUsage | undefined): number {
  return t ? t.input + t.output : 0;
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const f = 10 ** digits;
  return `${String(Math.round(value * f) / f).replace('.', ',')} %`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? Math.round(v) : (Math.round(v * 10) / 10).toString().replace('.', ',')} ${units[i]}`;
}

/** Centavos de USD -> "$1.23"; null => "sin precio". */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return 'sin precio';
  return `$${(cents / 100).toFixed(2)}`;
}

export function costStatusLabel(s: TokenUsage['costStatus']): string {
  return s === 'reported' ? 'informado' : s === 'estimated' ? 'estimado' : 'sin precio';
}

export function pct(part: number, total: number): number {
  if (!total || !Number.isFinite(total)) return 0;
  return Math.max(0, Math.min(100, (part / total) * 100));
}

export function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Etiqueta corta de zona horaria ("GMT-6", "UTC"). `timeZone` es opcional (para pruebas). */
export function timeZoneLabel(date: Date, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat(LOCALE, { timeZone, timeZoneName: 'short' }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

/** ISO (UTC) -> "8 oct 2026, 14:05 GMT-6" en la zona del navegador. */
export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  const d = parseIso(iso);
  if (!d) return '—';
  try {
    const main = new Intl.DateTimeFormat(LOCALE, {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
    return `${main} ${timeZoneLabel(d, timeZone)}`;
  } catch {
    return d.toISOString();
  }
}

export function formatTime(iso: string | null | undefined, timeZone?: string, withSeconds = true): string {
  const d = parseIso(iso);
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat(LOCALE, {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: withSeconds ? '2-digit' : undefined,
      hour12: false,
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function formatDate(iso: string | null | undefined, timeZone?: string): string {
  const d = parseIso(iso);
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat(LOCALE, { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** "hace 5 min" / "en 2 h". */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  const d = parseIso(iso);
  if (!d) return '—';
  const diff = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  if (abs < 45) return rtf.format(Math.round(diff), 'second');
  if (abs < 45 * 60) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 22 * 3600) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 26 * 86400) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(iso);
}

/** <input type="datetime-local"> (hora local) -> ISO 8601 con zona. */
export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function formatUptime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  return formatDuration(sec);
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Descripción corta de una expresión cron simple (5 campos). Si no la entiende, la devuelve tal cual. */
export function describeCron(expr: string): string {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = f as [string, string, string, string, string];
  const num = (s: string) => /^\d+$/.test(s);
  const hh = (h: string, m: string) => `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  if (num(min) && num(hour) && dom === '*' && mon === '*' && dow === '*') return `Cada día a las ${hh(hour, min)}`;
  if (num(min) && num(hour) && dom === '*' && mon === '*' && dow === '1-5') return `De lunes a viernes a las ${hh(hour, min)}`;
  if (num(min) && num(hour) && dom === '*' && mon === '*' && num(dow)) {
    const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return `Cada ${days[Number(dow) % 7]} a las ${hh(hour, min)}`;
  }
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Cada ${min.slice(2)} min`;
  if (num(min) && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') return `Cada ${hour.slice(2)} h`;
  if (num(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Cada hora en el minuto ${min}`;
  return expr;
}
