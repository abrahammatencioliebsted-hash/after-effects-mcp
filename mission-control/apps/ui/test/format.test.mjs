import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatTokens, formatPercent, formatBytes, formatCents, formatDateTime, formatTime, relativeTime, describeCron, truncate, initials, pct, localInputToIso } from '../src/lib/format.ts';

test('duraciones legibles', () => {
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(90), '1 min 30 s');
  assert.equal(formatDuration(25 * 60), '25 min');
  assert.equal(formatDuration(3600 + 12 * 60), '1 h 12 min');
  assert.equal(formatDuration(2 * 86400 + 3600), '2 d 1 h');
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(-3), '—');
});

test('tokens compactos', () => {
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(12_900), '12,9K');
  assert.equal(formatTokens(2_400_000), '2,4M');
  assert.equal(formatTokens(undefined), '—');
});

test('porcentajes, bytes y centavos', () => {
  assert.equal(formatPercent(94), '94 %');
  assert.equal(formatPercent(12.345, 1), '12,3 %');
  assert.equal(formatBytes(1024 ** 3 * 2.5), '2,5 GB');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatCents(1234), '$12.34');
  assert.equal(formatCents(null), 'sin precio');
  assert.equal(pct(1, 4), 25);
  assert.equal(pct(5, 0), 0);
});

test('fechas ISO UTC se muestran en la zona pedida con etiqueta de zona', () => {
  const iso = '2026-10-08T14:05:22Z';
  const mx = formatDateTime(iso, 'America/Mexico_City');
  assert.match(mx, /14:05|08:05/);
  assert.match(mx, /GMT-6|CST/);
  const utc = formatDateTime(iso, 'UTC');
  assert.match(utc, /14:05/);
  assert.match(utc, /UTC/);
  assert.equal(formatTime(iso, 'UTC', true), '14:05:22');
  assert.equal(formatDateTime('basura'), '—');
});

test('tiempo relativo en español', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  assert.match(relativeTime('2026-10-08T11:55:00Z', now), /hace 5 minutos/);
  assert.match(relativeTime('2026-10-08T14:00:00Z', now), /dentro de 2 horas|en 2 horas/);
});

test('cron legible y utilidades de texto', () => {
  assert.equal(describeCron('0 8 * * *'), 'Cada día a las 08:00');
  assert.equal(describeCron('0 7 * * 1-5'), 'De lunes a viernes a las 07:00');
  assert.equal(describeCron('*/30 * * * *'), 'Cada 30 min');
  assert.equal(describeCron('raro'), 'raro');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
  assert.equal(initials('Ana María López'), 'AL');
  assert.ok(localInputToIso('2026-10-08T10:00')?.endsWith('Z'));
  assert.equal(localInputToIso(''), undefined);
});
