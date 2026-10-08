import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLocalSettings, DEFAULT_SETTINGS, loadLocalSettings, saveLocalSettings, themeAttributes, isDarkScheme, contrastRatio, readableOn, checkCustomTheme, resolveScheme, exportLocalSettings, importLocalSettings, STORAGE_KEY } from '../src/lib/theme.ts';

test('valores por defecto: ámbar oscuro, riel completo, tipografía del sistema', () => {
  assert.equal(DEFAULT_SETTINGS.theme, 'ambar');
  assert.equal(DEFAULT_SETTINGS.scheme, 'dark');
  assert.equal(DEFAULT_SETTINGS.layout, 'rail-full');
  assert.equal(DEFAULT_SETTINGS.typography, 'sistema');
});

test('sanitizeLocalSettings descarta valores inválidos y completa los que faltan', () => {
  const s = sanitizeLocalSettings({ theme: 'rosa', layout: 'top', custom: { accent: 'rojo', bg: '#101010' }, typography: 5 });
  assert.equal(s.theme, 'ambar');
  assert.equal(s.layout, 'top');
  assert.equal(s.custom.accent, '#8b5cf6');
  assert.equal(s.custom.bg, '#101010');
  assert.equal(s.typography, 'sistema');
  assert.deepEqual(sanitizeLocalSettings(null), DEFAULT_SETTINGS);
});

test('localStorage con fallos no rompe: load devuelve defaults y save devuelve false', () => {
  const broken = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  assert.deepEqual(loadLocalSettings(broken), DEFAULT_SETTINGS);
  assert.equal(saveLocalSettings(DEFAULT_SETTINGS, broken), false);
});

test('guardar y cargar ida y vuelta', () => {
  const mem = new Map();
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const next = { ...DEFAULT_SETTINGS, theme: 'azul', layout: 'bottom-deck' };
  assert.equal(saveLocalSettings(next, st), true);
  assert.ok(mem.has(STORAGE_KEY));
  assert.equal(loadLocalSettings(st).theme, 'azul');
  assert.equal(loadLocalSettings(st).layout, 'bottom-deck');
});

test('modo automático sigue la preferencia del sistema; el tema propio deduce el modo del fondo', () => {
  assert.equal(resolveScheme('auto', true), 'light');
  assert.equal(resolveScheme('auto', false), 'dark');
  assert.equal(resolveScheme('dark', true), 'dark');
  const claro = themeAttributes({ ...DEFAULT_SETTINGS, theme: 'propio', custom: { accent: '#0057ff', bg: '#fafafa', ink: '#111111' } }, false);
  assert.equal(claro.attrs['data-scheme'], 'light');
  const oscuro = themeAttributes({ ...DEFAULT_SETTINGS, theme: 'propio' }, true);
  assert.equal(oscuro.attrs['data-scheme'], 'dark');
  assert.equal(oscuro.vars['--c-accent'], '#8b5cf6');
});

test('contraste WCAG y tinta legible', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
  assert.equal(readableOn('#ffb020'), '#111111');
  assert.equal(readableOn('#101010'), '#ffffff');
  assert.equal(checkCustomTheme({ accent: '#ffb020', bg: '#0c0a07', ink: '#f5efe4' }).ok, true);
  const mala = checkCustomTheme({ accent: '#222222', bg: '#202020', ink: '#303030' });
  assert.equal(mala.ok, false);
  assert.equal(mala.messages.length, 2);
});

test('exportar e importar ajustes locales', () => {
  const txt = exportLocalSettings({ ...DEFAULT_SETTINGS, theme: 'propio' });
  assert.equal(importLocalSettings(txt).theme, 'propio');
  assert.equal(importLocalSettings(JSON.stringify({ theme: 'azul' })).theme, 'azul');
  assert.throws(() => importLocalSettings('no es json'));
});

test('isDarkScheme deriva del estado y de la preferencia del sistema, no del DOM', () => {
  assert.equal(isDarkScheme({ ...DEFAULT_SETTINGS, scheme: 'dark' }, true), true);
  assert.equal(isDarkScheme({ ...DEFAULT_SETTINGS, scheme: 'light' }, false), false);
  assert.equal(isDarkScheme({ ...DEFAULT_SETTINGS, scheme: 'auto' }, true), false);
  assert.equal(isDarkScheme({ ...DEFAULT_SETTINGS, scheme: 'auto' }, false), true);
});
