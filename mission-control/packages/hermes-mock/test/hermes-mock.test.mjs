import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startHermesMock } from '../dist/index.js';

const KEY = 'mc-test-key-0123456789';
const AUTH = { Authorization: `Bearer ${KEY}` };
const JSON_HEADERS = { ...AUTH, 'Content-Type': 'application/json' };

const started = [];
async function start(opts = {}) {
  const mock = await startHermesMock({ apiKey: KEY, completeDelayMs: 60, ...opts });
  started.push(mock);
  return mock;
}
afterEach(async () => {
  while (started.length) await started.pop().close();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createRun(mock, { input = 'hola mundo', headers = {}, body } = {}) {
  const res = await fetch(`${mock.url}/v1/runs`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body ?? { input }),
  });
  const json = await res.json();
  return { res, json };
}

async function getRun(mock, runId) {
  const res = await fetch(`${mock.url}/v1/runs/${runId}`, { headers: AUTH });
  return { res, json: await res.json() };
}

async function waitStatus(mock, runId, wanted, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { json } = await getRun(mock, runId);
    if (wanted.includes(json.status)) return json;
    if (Date.now() > deadline) throw new Error(`timeout esperando ${wanted} (ultimo: ${json.status})`);
    await sleep(15);
  }
}

/** Lee un SSE hasta que el servidor cierra (o corta el socket). */
async function readSse(mock, runId, headers = {}) {
  const res = await fetch(`${mock.url}/v1/runs/${runId}/events`, {
    headers: { ...AUTH, Accept: 'text/event-stream', ...headers },
  });
  assert.equal(res.status, 200);
  const decoder = new TextDecoder();
  let raw = '';
  let ended = 'closed';
  try {
    for await (const chunk of res.body) raw += decoder.decode(chunk, { stream: true });
  } catch {
    ended = 'error';
  }
  const frames = raw.split('\n\n').filter((f) => f.length > 0);
  const events = [];
  const comments = [];
  for (const f of frames) {
    if (f.startsWith(':')) {
      comments.push(f);
      continue;
    }
    const id = /^id: (\d+)$/m.exec(f)?.[1];
    const data = /^data: (.*)$/m.exec(f)?.[1];
    events.push({ id: Number(id), data: JSON.parse(data) });
  }
  return { raw, events, comments, ended, status: res.status };
}

describe('autenticacion y descubrimiento', () => {
  it('GET /health no exige clave y devuelve la forma de Hermes', async () => {
    const mock = await start();
    const res = await fetch(`${mock.url}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', platform: 'hermes-agent', version: 'mock' });
  });

  it('401 sin clave y con clave equivocada (forma gateway_auth_error)', async () => {
    const mock = await start();
    for (const headers of [{}, { Authorization: 'Bearer otra-clave' }, { Authorization: KEY }]) {
      const res = await fetch(`${mock.url}/v1/capabilities`, { headers });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, 'gateway_auth_failed');
      assert.equal(body.error.type, 'gateway_auth_error');
      assert.equal(typeof body.error.message, 'string');
    }
    const post = await fetch(`${mock.url}/v1/runs`, { method: 'POST', body: '{"input":"x"}' });
    assert.equal(post.status, 401);
  });

  it('GET /v1/capabilities tiene la forma del Hermes real', async () => {
    const mock = await start();
    const res = await fetch(`${mock.url}/v1/capabilities`, { headers: AUTH });
    assert.equal(res.status, 200);
    const caps = await res.json();
    assert.equal(caps.object, 'hermes.api_server.capabilities');
    assert.equal(caps.platform, 'hermes-agent');
    assert.deepEqual(caps.auth, { type: 'bearer', required: true });
    assert.equal(caps.features.run_submission, true);
    assert.equal(caps.features.run_events_sse, true);
    assert.equal(caps.features.run_stop, true);
    assert.equal(caps.features.run_status, true);
    assert.equal(caps.features.session_key_header, 'X-Hermes-Session-Key');
    assert.equal(caps.features.runs_idempotency.supported, true);
    assert.deepEqual(caps.endpoints.runs, { method: 'POST', path: '/v1/runs' });
    assert.deepEqual(caps.endpoints.run_stop, { method: 'POST', path: '/v1/runs/{run_id}/stop' });
  });

  it('404 para run desconocido, 405 para GET /v1/runs, 404 de ruta desconocida', async () => {
    const mock = await start();
    for (const path of ['/v1/runs/run_nope', '/v1/runs/run_nope/events']) {
      const res = await fetch(`${mock.url}${path}`, { headers: AUTH });
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error.code, 'run_not_found');
    }
    const stop = await fetch(`${mock.url}/v1/runs/run_nope/stop`, { method: 'POST', headers: AUTH });
    assert.equal(stop.status, 404);
    const list = await fetch(`${mock.url}/v1/runs`, { headers: AUTH });
    assert.equal(list.status, 405);
    assert.match(list.headers.get('allow') ?? '', /POST/);
    const nada = await fetch(`${mock.url}/v1/nada`, { headers: AUTH });
    assert.equal(nada.status, 404);
  });
});

describe('runs', () => {
  it('crear run -> 202 started y termina completed con MC-MOCK-OK, usage y runtime', async () => {
    const mock = await start();
    const input = 'a'.repeat(40);
    const { res, json } = await createRun(mock, {
      input,
      headers: { 'Idempotency-Key': 'k-1', 'X-Hermes-Session-Key': 'sess-A' },
    });
    assert.equal(res.status, 202);
    assert.match(json.run_id, /^run_[0-9a-f]{32}$/);
    assert.equal(json.status, 'started');
    assert.equal(json.replayed, false);
    assert.equal(res.headers.get('x-hermes-session-key'), 'sess-A');

    const done = await waitStatus(mock, json.run_id, ['completed']);
    assert.equal(done.object, 'hermes.run');
    assert.equal(done.run_id, json.run_id);
    assert.match(done.output, /MC-MOCK-OK/);
    assert.match(done.output, /input_chars=40/);
    assert.deepEqual(done.runtime, { provider: 'mock', model: 'mock-model' });
    assert.equal(done.usage.input_tokens, 10);
    assert.equal(done.usage.total_tokens, done.usage.input_tokens + done.usage.output_tokens);
    assert.equal(done.usage.cache_read_tokens, 0);
    assert.equal(done.usage.cache_write_tokens, 0);
    assert.equal(done.completed, true);
    assert.equal(done.partial, false);
    assert.equal(done.interrupted, false);
    assert.equal(done.last_event, 'run.completed');
    assert.equal(mock.runs.get(json.run_id)?.sessionKey, 'sess-A');
  });

  it('valida el cuerpo: JSON invalido, sin input y Idempotency-Key invalida', async () => {
    const mock = await start();
    const bad = await fetch(`${mock.url}/v1/runs`, { method: 'POST', headers: JSON_HEADERS, body: '{no' });
    assert.equal(bad.status, 400);
    const sinInput = await createRun(mock, { body: { instructions: 'x' } });
    assert.equal(sinInput.res.status, 400);
    const largo = await createRun(mock, { input: 'x', headers: { 'Idempotency-Key': 'k'.repeat(256) } });
    assert.equal(largo.res.status, 400);
    assert.equal(largo.json.error.code, 'invalid_idempotency_key');
  });

  it('SSE: : open, message.delta..., run.completed y : stream closed', async () => {
    const mock = await start();
    const { json } = await createRun(mock, { input: 'secuencia' });
    const sse = await readSse(mock, json.run_id);
    assert.equal(sse.ended, 'closed');
    assert.equal(sse.comments[0], ': open');
    assert.equal(sse.comments.at(-1), ': stream closed');
    assert.ok(sse.raw.trimEnd().endsWith(': stream closed'));
    const names = sse.events.map((e) => e.data.event);
    assert.ok(names.includes('message.delta'));
    assert.equal(names.at(-1), 'run.completed');
    assert.deepEqual(
      sse.events.map((e) => e.id),
      sse.events.map((_, i) => i),
    );
    for (const e of sse.events) {
      assert.equal(e.data.run_id, json.run_id);
      assert.equal(e.data.seq, e.id);
      assert.equal(typeof e.data.timestamp, 'number');
    }
    const text = sse.events
      .filter((e) => e.data.event === 'message.delta')
      .map((e) => e.data.delta)
      .join('');
    const last = sse.events.at(-1).data;
    assert.equal(text, last.output);
    assert.match(last.output, /MC-MOCK-OK/);
    assert.equal(last.completed, true);
    assert.equal(last.runtime.provider, 'mock');
  });

  it('SSE de un run ya terminado reproduce todo y cierra; Last-Event-ID salta lo ya visto', async () => {
    const mock = await start();
    const { json } = await createRun(mock);
    await waitStatus(mock, json.run_id, ['completed']);
    const full = await readSse(mock, json.run_id);
    const resumed = await readSse(mock, json.run_id, { 'Last-Event-ID': '1' });
    assert.deepEqual(
      resumed.events.map((e) => e.id),
      full.events.slice(2).map((e) => e.id),
    );
    assert.equal(resumed.comments.at(-1), ': stream closed');
  });

  it('idempotencia: misma clave y mismo contenido -> mismo run_id con replayed:true', async () => {
    const mock = await start({ completeDelayMs: 200 });
    const headers = { 'Idempotency-Key': 'dup-1', 'X-Hermes-Session-Key': 'sess-1' };
    const a = await createRun(mock, { input: 'mismo', headers });
    const b = await createRun(mock, { input: 'mismo', headers });
    assert.equal(b.res.status, 202);
    assert.equal(b.json.run_id, a.json.run_id);
    assert.equal(b.json.replayed, true);
    assert.equal(b.res.headers.get('idempotency-replayed'), 'true');
    assert.equal(mock.runs.size, 1);
    // tambien tras terminar
    await waitStatus(mock, a.json.run_id, ['completed']);
    const c = await createRun(mock, { input: 'mismo', headers });
    assert.equal(c.json.run_id, a.json.run_id);
    assert.equal(c.json.status, 'completed');
    assert.equal(c.json.replayed, true);
  });

  it('idempotencia: misma clave y distinto contenido -> 409 idempotency_key_conflict', async () => {
    const mock = await start();
    const headers = { 'Idempotency-Key': 'dup-2' };
    await createRun(mock, { input: 'uno', headers });
    const b = await createRun(mock, { input: 'dos', headers });
    assert.equal(b.res.status, 409);
    assert.equal(b.json.error.code, 'idempotency_key_conflict');
    // distinto X-Hermes-Session-Key tambien cuenta como distinto contenido
    const c = await createRun(mock, { input: 'uno', headers: { ...headers, 'X-Hermes-Session-Key': 'otra' } });
    assert.equal(c.res.status, 409);
    assert.equal(mock.runs.size, 1);
  });

  it('stop: un run colgado pasa a stopping y luego cancelled; stop de uno terminado devuelve su estado', async () => {
    const mock = await start({ faults: { hangNextRun: true } });
    const { json } = await createRun(mock);
    await sleep(120);
    assert.equal((await getRun(mock, json.run_id)).json.status, 'running');
    const stop = await fetch(`${mock.url}/v1/runs/${json.run_id}/stop`, { method: 'POST', headers: AUTH });
    assert.equal(stop.status, 200);
    assert.deepEqual(await stop.json(), { run_id: json.run_id, status: 'stopping' });
    const final = await waitStatus(mock, json.run_id, ['cancelled']);
    assert.equal(final.interrupted, true);
    assert.equal(final.completed, false);
    const sse = await readSse(mock, json.run_id);
    assert.equal(sse.events.at(-1).data.event, 'run.cancelled');
    assert.equal(sse.comments.at(-1), ': stream closed');
    const again = await fetch(`${mock.url}/v1/runs/${json.run_id}/stop`, { method: 'POST', headers: AUTH });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).status, 'cancelled');
  });

  it('429 con Retry-After cuando se supera maxConcurrentRuns; un replay sigue resolviendo', async () => {
    const mock = await start({ maxConcurrentRuns: 1, completeDelayMs: 400 });
    const a = await createRun(mock, { input: 'a', headers: { 'Idempotency-Key': 'c-1' } });
    assert.equal(a.res.status, 202);
    const b = await createRun(mock, { input: 'b' });
    assert.equal(b.res.status, 429);
    assert.equal(b.res.headers.get('retry-after'), '1');
    assert.equal(b.json.error.code, 'rate_limit_exceeded');
    assert.equal(b.json.error.type, 'rate_limit_error');
    const replay = await createRun(mock, { input: 'a', headers: { 'Idempotency-Key': 'c-1' } });
    assert.equal(replay.res.status, 202);
    assert.equal(replay.json.replayed, true);
    await waitStatus(mock, a.json.run_id, ['completed']);
    const c = await createRun(mock, { input: 'c' });
    assert.equal(c.res.status, 202);
  });

  it('steer: 409 si el run no esta running; acepta y emite run.steered si lo esta', async () => {
    const mock = await start({ faults: { hangNextRun: true } });
    const { json } = await createRun(mock);
    await sleep(100);
    const ok = await fetch(`${mock.url}/v1/runs/${json.run_id}/steer`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ input: 'ojo' }),
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { object: 'hermes.run.steer', run_id: json.run_id, accepted: true });
    await fetch(`${mock.url}/v1/runs/${json.run_id}/stop`, { method: 'POST', headers: AUTH });
    await waitStatus(mock, json.run_id, ['cancelled']);
    const late = await fetch(`${mock.url}/v1/runs/${json.run_id}/steer`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ input: 'tarde' }),
    });
    assert.equal(late.status, 409);
    assert.equal((await late.json()).error.code, 'run_not_accepting_steer');
  });
});

describe('inyeccion de fallos', () => {
  it('failNextRun: el run acaba failed con error, run.failed por SSE, y solo afecta a uno', async () => {
    const mock = await start();
    mock.setFaults({ failNextRun: true });
    const a = await createRun(mock);
    const failed = await waitStatus(mock, a.json.run_id, ['failed']);
    assert.equal(typeof failed.error, 'string');
    assert.ok(failed.error.length > 0);
    assert.equal(failed.completed, false);
    assert.equal(failed.output, undefined);
    const sse = await readSse(mock, a.json.run_id);
    assert.equal(sse.events.at(-1).data.event, 'run.failed');
    assert.equal(sse.events.at(-1).data.error, failed.error);
    assert.equal(mock.getFaults().failNextRun, undefined);
    const b = await createRun(mock);
    await waitStatus(mock, b.json.run_id, ['completed']);
  });

  it('hangNextRun: no termina hasta recibir stop', async () => {
    const mock = await start({ completeDelayMs: 30 });
    mock.setFaults({ hangNextRun: true });
    const a = await createRun(mock);
    await sleep(250);
    const s = await getRun(mock, a.json.run_id);
    assert.equal(s.json.status, 'running');
    await fetch(`${mock.url}/v1/runs/${a.json.run_id}/stop`, { method: 'POST', headers: AUTH });
    await waitStatus(mock, a.json.run_id, ['cancelled']);
    const b = await createRun(mock);
    await waitStatus(mock, b.json.run_id, ['completed']);
  });

  it('unauthorizedNext: la siguiente peticion autenticada da 401 aunque la clave sea buena (una vez)', async () => {
    const mock = await start();
    mock.setFaults({ unauthorizedNext: true });
    const health = await fetch(`${mock.url}/health`);
    assert.equal(health.status, 200); // /health no consume el fallo
    const r1 = await fetch(`${mock.url}/v1/capabilities`, { headers: AUTH });
    assert.equal(r1.status, 401);
    const r2 = await fetch(`${mock.url}/v1/capabilities`, { headers: AUTH });
    assert.equal(r2.status, 200);
  });

  it('rateLimitNext: el siguiente POST /v1/runs da 429 + Retry-After (una vez)', async () => {
    const mock = await start();
    mock.setFaults({ rateLimitNext: true });
    const a = await createRun(mock);
    assert.equal(a.res.status, 429);
    assert.equal(a.res.headers.get('retry-after'), '1');
    const b = await createRun(mock);
    assert.equal(b.res.status, 202);
    assert.equal(mock.runs.size, 1);
  });

  it('latencyMs: anade retardo a cada respuesta', async () => {
    const mock = await start();
    const t0 = Date.now();
    await fetch(`${mock.url}/health`);
    const base = Date.now() - t0;
    mock.setFaults({ latencyMs: 200 });
    const t1 = Date.now();
    await fetch(`${mock.url}/health`);
    const slow = Date.now() - t1;
    assert.ok(slow >= 190, `esperaba >=190ms, fue ${slow}ms (base ${base}ms)`);
    mock.setFaults({ latencyMs: undefined });
    assert.equal(mock.getFaults().latencyMs, undefined);
  });

  it('duplicateReplayAsNew: ignora la idempotencia y crea un run nuevo cada vez', async () => {
    const mock = await start({ faults: { duplicateReplayAsNew: true } });
    const headers = { 'Idempotency-Key': 'dup-x' };
    const a = await createRun(mock, { input: 'igual', headers });
    const b = await createRun(mock, { input: 'igual', headers });
    assert.notEqual(a.json.run_id, b.json.run_id);
    assert.equal(b.json.replayed, false);
    // incluso con contenido distinto no hay 409
    const c = await createRun(mock, { input: 'distinto', headers });
    assert.equal(c.res.status, 202);
    assert.equal(mock.runs.size, 3);
    // al apagarlo vuelve el comportamiento correcto (la clave no se guardo)
    mock.setFaults({ duplicateReplayAsNew: false });
    const d = await createRun(mock, { input: 'igual', headers });
    assert.equal(d.json.replayed, false);
    const e = await createRun(mock, { input: 'igual', headers });
    assert.equal(e.json.run_id, d.json.run_id);
    assert.equal(e.json.replayed, true);
  });

  it('dropSseAfterEvents: corta el socket una vez y Last-Event-ID reanuda sin perder ni repetir', async () => {
    const mock = await start({ completeDelayMs: 150 });
    mock.setFaults({ dropSseAfterEvents: 2 });
    const { json } = await createRun(mock);
    const first = await readSse(mock, json.run_id);
    assert.equal(first.ended, 'error');
    assert.equal(first.events.length, 2);
    assert.ok(!first.raw.includes('stream closed'));
    assert.equal(mock.getFaults().dropSseAfterEvents, undefined);

    const lastId = first.events.at(-1).id;
    const second = await readSse(mock, json.run_id, { 'Last-Event-ID': String(lastId) });
    assert.equal(second.ended, 'closed');
    assert.equal(second.events[0].id, lastId + 1);
    assert.equal(second.events.at(-1).data.event, 'run.completed');
    assert.equal(second.comments.at(-1), ': stream closed');
    const all = [...first.events, ...second.events].map((e) => e.id);
    assert.deepEqual(all, all.map((_, i) => i));
  });

  it('dropSseAfterEvents: reconectar sin Last-Event-ID (como el adaptador de Paperclip) repite desde 0 y termina', async () => {
    const mock = await start({ completeDelayMs: 100 });
    mock.setFaults({ dropSseAfterEvents: 1 });
    const { json } = await createRun(mock);
    const first = await readSse(mock, json.run_id);
    assert.equal(first.ended, 'error');
    const second = await readSse(mock, json.run_id);
    assert.equal(second.events[0].id, 0);
    assert.equal(second.events.at(-1).data.event, 'run.completed');
  });
});

describe('control en runtime y registro', () => {
  it('POST /__mock/faults, GET /__mock/state y POST /__mock/reset (con clave)', async () => {
    const mock = await start();
    const noAuth = await fetch(`${mock.url}/__mock/state`);
    assert.equal(noAuth.status, 401);

    const set = await fetch(`${mock.url}/__mock/faults`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ rateLimitNext: true, latencyMs: 5 }),
    });
    assert.equal(set.status, 200);
    assert.deepEqual((await set.json()).faults, { rateLimitNext: true, latencyMs: 5 });
    assert.deepEqual(mock.getFaults(), { rateLimitNext: true, latencyMs: 5 });

    const invalid = await fetch(`${mock.url}/__mock/faults`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ inventado: true }),
    });
    assert.equal(invalid.status, 400);
    const badType = await fetch(`${mock.url}/__mock/faults`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ latencyMs: 'mucho' }),
    });
    assert.equal(badType.status, 400);

    const limited = await createRun(mock);
    assert.equal(limited.res.status, 429);
    const ok = await createRun(mock);
    assert.equal(ok.res.status, 202);

    const state = await (await fetch(`${mock.url}/__mock/state`, { headers: AUTH })).json();
    assert.equal(state.runs.length, 1);
    assert.equal(state.runs[0].runId, ok.json.run_id);
    assert.ok(state.requests.length >= 2);
    assert.ok(state.requests.every((r) => !r.path.startsWith('/__mock/')));

    const reset = await fetch(`${mock.url}/__mock/reset`, { method: 'POST', headers: AUTH });
    assert.equal(reset.status, 200);
    assert.equal(mock.runs.size, 0);
    assert.equal(mock.requests.length, 0);
    assert.deepEqual(mock.getFaults(), {});
  });

  it('reset restaura los fallos iniciales de opts.faults y limpia runs/peticiones', async () => {
    const mock = await start({ faults: { latencyMs: 1, duplicateReplayAsNew: true } });
    mock.setFaults({ rateLimitNext: true, latencyMs: 5 });
    await createRun(mock);
    const reset = await fetch(`${mock.url}/__mock/reset`, { method: 'POST', headers: AUTH });
    assert.equal(reset.status, 200);
    assert.deepEqual(mock.getFaults(), { latencyMs: 1, duplicateReplayAsNew: true });
    assert.equal(mock.runs.size, 0);
    assert.equal(mock.requests.length, 0);
  });

  it('requests registra metodo, ruta, cabeceras (clave enmascarada), cuerpo y estado', async () => {
    const mock = await start();
    await createRun(mock, {
      input: 'registro',
      headers: { 'Idempotency-Key': 'rq-1', 'X-Hermes-Session-Key': 'sk' },
    });
    const rec = mock.requests.find((r) => r.method === 'POST' && r.path === '/v1/runs');
    assert.ok(rec);
    assert.equal(rec.headers['idempotency-key'], 'rq-1');
    assert.equal(rec.headers['x-hermes-session-key'], 'sk');
    assert.equal(rec.headers['authorization'], 'Bearer ***');
    assert.deepEqual(rec.body, { input: 'registro' });
    assert.match(rec.at, /^\d{4}-\d\d-\d\dT/);
    assert.equal(rec.status, 202);
  });

  it('outputText personalizado y apiKey obligatoria; solo loopback', async () => {
    const mock = await start({ outputText: 'MC-MOCK-OK custom len={inputChars}' });
    const { json } = await createRun(mock, { input: 'abcde' });
    const done = await waitStatus(mock, json.run_id, ['completed']);
    assert.equal(done.output, 'MC-MOCK-OK custom len=5');
    await assert.rejects(() => startHermesMock({ apiKey: '' }), /apiKey/);
    await assert.rejects(() => startHermesMock({ apiKey: KEY, host: '0.0.0.0' }), /loopback/);
  });

  it('CLI: arranca, imprime la URL, responde y se cierra con SIGINT', async () => {
    const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
    const child = spawn(process.execPath, [cli, '--port', '0', '--key', KEY, '--complete-delay-ms', '30'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const url = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`CLI sin URL: ${out}`)), 5000);
      child.stdout.on('data', (d) => {
        out += d;
        const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(out);
        if (m) {
          clearTimeout(t);
          resolve(m[1]);
        }
      });
      child.once('error', reject);
    });
    try {
      const res = await fetch(`${url}/health`);
      assert.equal((await res.json()).version, 'mock');
    } finally {
      child.kill('SIGINT');
    }
    const code = await new Promise((resolve) => child.once('exit', (c) => resolve(c)));
    assert.equal(code, 0);
  });
});
