import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTable, renderScenario, renderReport } from '../lib/report.mjs';

const row = {
  id: 1, titulo: 'Camino feliz', configuracion: 'a | b', resultado: 'succeeded\nlínea', veredicto: 'cubre',
  significado: 'ok', inicioUtc: '2026-10-08T00:00:00.000Z', finUtc: '2026-10-08T00:00:05.000Z', segundos: 5,
  raw: { a: 1 }, notas: ['n1'],
};

test('renderTable escapa tuberías y saltos de línea', () => {
  const t = renderTable([row]);
  assert.match(t, /a \\\| b/);
  assert.ok(!t.split('\n')[2].includes('\nlínea'));
  assert.equal(t.split('\n').length, 3);
});

test('renderScenario pliega el JSON bruto y trunca', () => {
  const md = renderScenario({ ...row, raw: { x: 'y'.repeat(100) } }, { truncate: 20 });
  assert.match(md, /<details>/);
  assert.match(md, /caracteres omitidos/);
});

test('renderReport incluye entorno, tabla y la sección "Qué NO demuestra"', () => {
  const md = renderReport({ env: { Paperclip: '2026.1005.0' }, rows: [row], generatedUtc: 'T', noDemuestra: ['mock != Hermes real'] });
  assert.match(md, /## Entorno/);
  assert.match(md, /Paperclip: 2026\.1005\.0/);
  assert.match(md, /## Qué NO demuestra/);
  assert.match(md, /mock != Hermes real/);
});
