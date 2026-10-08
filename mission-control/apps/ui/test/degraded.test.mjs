import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../src/lib/api.ts';
import { isBffDownError, computeDegraded, recovered, resyncAfterStream } from '../src/lib/degraded.ts';
import { HEARTBEAT_TIMEOUT_MS } from '../src/lib/sse.ts';

const report = (reachable) => ({ paperclip: { reachable, baseUrl: 'http://127.0.0.1:3100' } });

test('isBffDownError: red, status 0 y 5xx propios; no los fallos aguas abajo ni los 4xx', () => {
  assert.equal(isBffDownError(new ApiRequestError('x', 0, 'network')), true);
  assert.equal(isBffDownError(new ApiRequestError('x', 502, 'network')), true);
  assert.equal(isBffDownError(new ApiRequestError('x', 500, 'internal')), true);
  assert.equal(isBffDownError(new ApiRequestError('x', 503, 'paperclip_unreachable', { baseUrl: 'u' })), false);
  assert.equal(isBffDownError(new ApiRequestError('x', 404, 'not_found')), false);
  assert.equal(isBffDownError(new Error('otro')), false);
  assert.equal(isBffDownError(undefined), false);
});

test('computeDegraded: el último error cuenta aunque haya datos previos (UI-02)', () => {
  const err = new ApiRequestError('x', 0, 'network');
  const d = computeDegraded({ data: report(true), error: err, staleSince: 1000 });
  assert.equal(d.bff, true);
  assert.equal(d.staleSince, 1000);
  assert.equal(computeDegraded({ data: report(true) }).bff, false);
});

test('computeDegraded: con el BFF caído el último informe no se lee como Paperclip vivo/caído', () => {
  const err = new ApiRequestError('x', 0, 'network');
  assert.equal(computeDegraded({ data: report(false), error: err }).paperclipBaseUrl, undefined);
  assert.equal(computeDegraded({ data: report(false) }).paperclipBaseUrl, 'http://127.0.0.1:3100');
  assert.equal(computeDegraded({ data: report(true) }).paperclipBaseUrl, undefined);
});

test('recuperación y re-sincronización', () => {
  assert.equal(recovered(true, false), true);
  assert.equal(recovered(false, false), false);
  assert.equal(recovered(true, true), false);
  assert.equal(resyncAfterStream('reconnecting', 'open'), true);
  assert.equal(resyncAfterStream('connecting', 'open'), false);
  assert.equal(resyncAfterStream('open', 'reconnecting'), false);
});

test('vigilancia del latido: el BFF lo envía cada 25 s, el límite es de 3 periodos', () => {
  assert.equal(HEARTBEAT_TIMEOUT_MS, 75_000);
});
