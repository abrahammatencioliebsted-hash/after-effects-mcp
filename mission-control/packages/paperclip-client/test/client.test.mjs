// Pruebas unitarias contra un servidor falso en proceso (node:http). Sin red externa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPaperclipClient, PaperclipError } from '../dist/index.js';

/** @type {http.Server} */
let server;
let baseUrl;
/** Peticiones recibidas: { method, url, headers, body } */
let seen = [];

const C = 'b0d4c18c-7069-499f-8879-26cdc29738dc';

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
      const send = (status, obj, type = 'application/json') => {
        res.writeHead(status, { 'content-type': type });
        res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
      };
      const u = new URL(req.url, 'http://x');
      const p = u.pathname;
      if (p === '/api/health') return send(200, { status: 'ok', version: '2026.1005.0' });
      if (p === '/api/slow') return; // nunca responde
      if (p === '/api/issues/MIS-1') return send(200, { id: 'i1', identifier: 'MIS-1', status: 'done' });
      if (p === '/api/issues/missing') return send(404, { error: 'Issue not found' });
      if (p === '/api/issues/i1' && req.method === 'PATCH') return send(409, { error: 'status conflict', echo: 'token-abc-123' });
      if (p === '/api/agents/forbidden') return send(403, { error: 'Forbidden' });
      if (p === '/api/heartbeat-runs/bad') return send(400, { error: 'Invalid heartbeat run ID' });
      if (p === '/api/boom') return send(500, 'kaboom token-abc-123');
      if (p === '/api/html') return send(200, '<html>proxy</html>', 'text/html');
      if (p === '/api/empty') { res.writeHead(204); return res.end(); }
      if (p === `/api/companies/${C}/issues`) return send(200, [{ id: 'i1' }]);
      if (p === `/api/companies/${C}/heartbeat-runs`) return send(200, []);
      if (p === `/api/companies/${C}/costs/by-agent`) return send(200, []);
      if (p === `/api/companies/${C}/agents` && req.method === 'POST') return send(201, { id: 'a1', ...JSON.parse(raw) });
      if (p === '/api/approvals/ap1/approve') return send(200, { id: 'ap1', status: 'approved' });
      if (p === '/api/routines/r1/run') return send(200, { ok: true });
      send(404, { error: 'API route not found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});

const last = () => seen[seen.length - 1];

test('success: health() devuelve JSON y no envía Authorization sin token', async () => {
  seen = [];
  const c = createPaperclipClient({ baseUrl });
  const h = await c.health();
  assert.equal(h.status, 'ok');
  assert.equal(last().method, 'GET');
  assert.equal(last().url, '/api/health');
  assert.equal(last().headers.authorization, undefined);
  assert.match(last().headers['user-agent'], /paperclip-client/);
});

test('baseUrl con barra final o sufijo /api se normaliza', async () => {
  for (const b of [`${baseUrl}/`, `${baseUrl}/api`, `${baseUrl}/api/`]) {
    const c = createPaperclipClient({ baseUrl: b });
    assert.equal((await c.health()).status, 'ok');
    assert.equal(last().url, '/api/health');
  }
});

test('bearer: se envía Authorization solo cuando hay token', async () => {
  const c = createPaperclipClient({ baseUrl, token: 'token-abc-123' });
  await c.health();
  assert.equal(last().headers.authorization, 'Bearer token-abc-123');
});

test('getIssue acepta identificador legible', async () => {
  const c = createPaperclipClient({ baseUrl });
  const i = await c.getIssue('MIS-1');
  assert.equal(i.identifier, 'MIS-1');
});

test('404 -> PaperclipError code not_found con status, body y url', async () => {
  const c = createPaperclipClient({ baseUrl });
  await assert.rejects(c.getIssue('missing'), (e) => {
    assert.ok(e instanceof PaperclipError);
    assert.equal(e.status, 404);
    assert.equal(e.code, 'not_found');
    assert.deepEqual(e.body, { error: 'Issue not found' });
    assert.ok(e.url.endsWith('/api/issues/missing'));
    assert.match(e.message, /Issue not found/);
    return true;
  });
});

test('409 -> conflict, y el token se redacta en mensaje, cuerpo y url', async () => {
  const c = createPaperclipClient({ baseUrl, token: 'token-abc-123' });
  await assert.rejects(c.updateIssue('i1', { status: 'done' }), (e) => {
    assert.equal(e.code, 'conflict');
    assert.equal(e.status, 409);
    assert.doesNotMatch(JSON.stringify(e.body), /token-abc-123/);
    assert.doesNotMatch(e.message, /token-abc-123/);
    assert.equal(e.body.echo, '[redacted]');
    return true;
  });
  assert.deepEqual(seen.at(-1).body, { status: 'done' });
});

test('403 -> unauthorized; 400 -> invalid; 500 -> server (texto plano redactado)', async () => {
  const c = createPaperclipClient({ baseUrl, token: 'token-abc-123' });
  await assert.rejects(c.getAgent('forbidden'), (e) => e.code === 'unauthorized' && e.status === 403);
  await assert.rejects(c.getRun('bad'), (e) => e.code === 'invalid' && e.status === 400);
  await assert.rejects(c.request('GET', '/boom'), (e) => {
    assert.equal(e.code, 'server');
    assert.equal(e.body, 'kaboom [redacted]');
    return true;
  });
});

test('2xx que no es JSON -> server; 204 -> undefined', async () => {
  const c = createPaperclipClient({ baseUrl });
  await assert.rejects(c.request('GET', '/html'), (e) => e.code === 'server' && e.status === 200);
  assert.equal(await c.request('GET', '/empty'), undefined);
});

test('timeout -> code timeout', async () => {
  const c = createPaperclipClient({ baseUrl, timeoutMs: 150 });
  const t0 = Date.now();
  await assert.rejects(c.request('GET', '/slow'), (e) => {
    assert.ok(e instanceof PaperclipError);
    assert.equal(e.code, 'timeout');
    assert.equal(e.status, 0);
    return true;
  });
  assert.ok(Date.now() - t0 < 3000);
});

test('timeout se respeta aunque fetchImpl ignore la señal', async () => {
  const c = createPaperclipClient({ baseUrl, timeoutMs: 100, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(c.health(), (e) => e.code === 'timeout');
});

test('servidor caído -> code unreachable', async () => {
  const dead = http.createServer();
  await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  const port = dead.address().port;
  await new Promise((r) => dead.close(r));
  const c = createPaperclipClient({ baseUrl: `http://127.0.0.1:${port}`, token: 'token-abc-123' });
  await assert.rejects(c.health(), (e) => e.code === 'unreachable' && e.status === 0 && !/token-abc-123/.test(e.message));
});

test('listIssues mapea filtros a query: status múltiple por coma, cursor -> offset, undefined omitido', async () => {
  const c = createPaperclipClient({ baseUrl });
  await c.listIssues(C, { status: ['todo', 'in_progress'], assigneeAgentId: 'a1', q: 'hola mundo', limit: 20, cursor: '40', parentId: undefined });
  const u = new URL(last().url, 'http://x');
  assert.equal(u.pathname, `/api/companies/${C}/issues`);
  assert.equal(u.searchParams.get('status'), 'todo,in_progress');
  assert.equal(u.searchParams.get('assigneeAgentId'), 'a1');
  assert.equal(u.searchParams.get('q'), 'hola mundo');
  assert.equal(u.searchParams.get('limit'), '20');
  assert.equal(u.searchParams.get('offset'), '40');
  assert.equal(u.searchParams.has('cursor'), false);
  assert.equal(u.searchParams.has('parentId'), false);
});

test('listHeartbeatRuns y costsByAgent pasan parámetros', async () => {
  const c = createPaperclipClient({ baseUrl });
  await c.listHeartbeatRuns(C, { agentId: 'a1', limit: 5, summary: true });
  assert.equal(last().url, `/api/companies/${C}/heartbeat-runs?agentId=a1&limit=5&summary=true`);
  await c.costsByAgent(C, { from: '2026-10-01T00:00:00.000Z' });
  assert.equal(last().url, `/api/companies/${C}/costs/by-agent?from=2026-10-01T00%3A00%3A00.000Z`);
});

test('createAgent envía JSON y content-type; approve usa cuerpo vacío por defecto; runRoutine', async () => {
  const c = createPaperclipClient({ baseUrl });
  const a = await c.createAgent(C, { name: 'X', adapterType: 'hermes_gateway', adapterConfig: { apiKey: { type: 'secret_ref', secretId: 's', version: 'latest' } } });
  assert.equal(a.name, 'X');
  assert.equal(last().method, 'POST');
  assert.equal(last().headers['content-type'], 'application/json');
  const ap = await c.approve('ap1');
  assert.equal(ap.status, 'approved');
  assert.deepEqual(last().body, {});
  assert.deepEqual(await c.runRoutine('r1'), { ok: true });
});

test('request(): escape hatch con query y prefijo /api opcional', async () => {
  const c = createPaperclipClient({ baseUrl });
  await c.request('GET', `/companies/${C}/issues`, { query: { limit: 1, status: ['done'] } });
  assert.equal(last().url, `/api/companies/${C}/issues?limit=1&status=done`);
  await c.request('GET', '/api/health');
  assert.equal(last().url, '/api/health');
});

test('baseUrl vacío lanza TypeError', () => {
  assert.throws(() => createPaperclipClient({ baseUrl: '' }), TypeError);
});
