import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBJECT_PREFIX, withPrefix, generateMockKey, redactSecret, secondsBetween, createPaperclip } from '../lib/paperclip.mjs';
import { postRuns, eventGets, stops, summarizeRequests, histogram, loadMock } from '../lib/mock.mjs';

test('withPrefix añade el prefijo una sola vez', () => {
  assert.equal(withPrefix('x'), `${OBJECT_PREFIX} x`);
  assert.equal(withPrefix(withPrefix('x')), `${OBJECT_PREFIX} x`);
});

test('la clave del mock es aleatoria y no se cuela en los textos redactados', () => {
  const a = generateMockKey();
  const b = generateMockKey();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
  assert.equal(redactSecret(`Bearer ${a} fin`, a), 'Bearer *** fin');
  assert.equal(redactSecret('sin secreto', ''), 'sin secreto');
});

test('secondsBetween redondea a una décima y tolera valores inválidos', () => {
  assert.equal(secondsBetween('2026-10-08T00:00:00.000Z', '2026-10-08T00:00:15.040Z'), 15);
  assert.equal(secondsBetween('x', 'y'), null);
});

test('clasificadores del registro del mock', () => {
  const reqs = [
    { at: 't', method: 'POST', path: '/v1/runs', headers: { 'idempotency-key': 'k', 'x-hermes-session-key': 's' }, status: 202 },
    { at: 't', method: 'GET', path: '/v1/runs/run_ab/events', headers: {}, status: 200 },
    { at: 't', method: 'GET', path: '/v1/runs/run_ab/events', headers: { 'last-event-id': '3' }, status: 200 },
    { at: 't', method: 'GET', path: '/v1/runs/run_ab', headers: {}, status: 200 },
    { at: 't', method: 'POST', path: '/v1/runs/run_ab/stop', headers: {}, status: 200 },
  ];
  assert.equal(postRuns(reqs).length, 1);
  assert.equal(eventGets(reqs).length, 2);
  assert.equal(stops(reqs).length, 1);
  assert.equal(summarizeRequests(reqs)[0].idempotencyKey, 'k');
  assert.equal(summarizeRequests(reqs)[2].lastEventId, '3');
  assert.equal(histogram(reqs)['GET /v1/runs/:runId/events → 200'], 2);
});

test('el cliente arma las rutas esperadas sin red (fetch simulado)', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push([init?.method, String(url), init?.body]);
    return new Response(JSON.stringify({ id: 'abc', status: 'idle' }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  try {
    const pc = createPaperclip({ baseUrl: 'http://x:1/', companyId: 'C' });
    await pc.createSecret('clave', 'valor-secreto');
    await pc.createAgent({ name: 'a', apiBaseUrl: 'http://127.0.0.1:18642', secretId: 'S', timeoutSec: 15 });
    await pc.createIssue({ title: 't', description: 'd', agentId: 'A' });
    await pc.pauseAgent('A');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls[0][1], 'http://x:1/api/companies/C/secrets');
  assert.match(calls[1][2], /"timeoutSec":15/);
  assert.match(calls[1][2], /secret_ref/);
  assert.ok(!calls[1][2].includes('valor-secreto'), 'el agente referencia el secreto, no lleva la clave');
  for (const c of calls.slice(0, 3)) assert.ok(JSON.parse(c[2]).name?.startsWith(OBJECT_PREFIX) || JSON.parse(c[2]).title?.startsWith(OBJECT_PREFIX));
  assert.deepEqual([calls[3][0], calls[3][1], calls[3][2]], ['PATCH', 'http://x:1/api/agents/A', '{"status":"paused"}']);
});

test('el mock arranca en un puerto efímero y registra Idempotency-Key (sin lab)', async () => {
  const { startHermesMock } = await loadMock();
  const key = generateMockKey();
  const mock = await startHermesMock({ apiKey: key, port: 0, completeDelayMs: 20 });
  try {
    const h = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'k-1', 'X-Hermes-Session-Key': 'issue-1' };
    const r = await fetch(`${mock.url}/v1/runs`, { method: 'POST', headers: h, body: JSON.stringify({ input: 'hola' }) });
    assert.equal(r.status, 202);
    const first = await r.json();
    const again = await (await fetch(`${mock.url}/v1/runs`, { method: 'POST', headers: h, body: JSON.stringify({ input: 'hola' }) })).json();
    assert.equal(again.run_id, first.run_id);
    assert.equal(again.replayed, true);
    assert.equal(postRuns(mock.requests).length, 2);
    assert.equal(mock.requests[0].headers.authorization, 'Bearer ***');
  } finally {
    await mock.close();
  }
});
