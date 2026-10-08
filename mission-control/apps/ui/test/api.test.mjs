import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, ApiRequestError, isMockEnabled, API_BASE } from '../src/lib/api.ts';

test('buildUrl: ruta base y normalización', () => {
  assert.equal(API_BASE, '/api/mc');
  assert.equal(buildUrl('/health'), '/api/mc/health');
  assert.equal(buildUrl('overview', { days: 14 }), '/api/mc/overview?days=14');
});

test('buildUrl: omite vacíos, une arreglos con comas y codifica', () => {
  assert.equal(buildUrl('/missions', { status: ['briefing', 'review'], q: '', scope: undefined, limit: 50 }), '/api/mc/missions?status=briefing%2Creview&limit=50');
  assert.equal(buildUrl('/docs', { q: 'año ñandú' }), '/api/mc/docs?q=a%C3%B1o+%C3%B1and%C3%BA');
  assert.equal(buildUrl('/catalog/match', { capabilities: [] }), '/api/mc/catalog/match');
});

test('ApiRequestError expone la URL base de Paperclip cuando está inaccesible', () => {
  const e = new ApiRequestError('no', 503, 'paperclip_unreachable', { baseUrl: 'http://127.0.0.1:3100' });
  assert.equal(e.paperclipBaseUrl, 'http://127.0.0.1:3100');
  assert.equal(e.status, 503);
  const n = new ApiRequestError('red', 0, 'network');
  assert.equal(n.paperclipBaseUrl, undefined);
});

test('isMockEnabled lee ?mock=1', () => {
  assert.equal(isMockEnabled('?mock=1'), true);
  assert.equal(isMockEnabled('?a=1&mock=1'), true);
  assert.equal(isMockEnabled('?mock=0'), false);
  assert.equal(isMockEnabled(''), false);
});

test('request: 502 de un proxy sin BFF se trata como "sin conexión"; ApiError JSON conserva su código', async () => {
  const { api } = await import('../src/lib/api.ts');
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', { status: 502 });
    await assert.rejects(api.health(), (e) => e instanceof ApiRequestError && e.code === 'network');
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Paperclip caído', code: 'paperclip_unreachable', details: { baseUrl: 'http://127.0.0.1:3100' } }), { status: 503 });
    await assert.rejects(api.overview(7), (e) => e.code === 'paperclip_unreachable' && e.paperclipBaseUrl === 'http://127.0.0.1:3100');
    let seen;
    globalThis.fetch = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ identifier: 'X-1' }), { status: 200 }); };
    await api.createMission({ title: 't' }, 'key-1');
    assert.equal(seen.url, '/api/mc/missions');
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers['Idempotency-Key'], 'key-1');
  } finally {
    globalThis.fetch = real;
  }
});
