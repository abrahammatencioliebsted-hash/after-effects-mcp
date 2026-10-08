// Endurecimiento tras la revisión independiente: CSRF/Host, tamaño del cuerpo, URL de Hermes en el latido,
// agente borrado en demo, ajustes de agentes e idempotencia determinista hacia Paperclip.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PaperclipError } from '@mc/paperclip-client';
import { PaperclipBackend, buildServices, createApp } from '../dist/index.js';
import { isAllowedHost, isPrivateOrTailnetIp, validateHermesBaseUrl } from '../dist/net.js';
import { CATALOG_DIR, demoApp, getJson, heartbeatBody, missionBody, post } from './helpers.mjs';

const TOKEN = 'token-de-prueba-0123456789';
const auth = { authorization: `Bearer ${TOKEN}` };

async function withMachine(app, id = 'win-principal') {
  const hb = await post(app, `/api/mc/machines/${id}/heartbeat`, heartbeatBody(id), auth);
  assert.equal(hb.status, 200, JSON.stringify(hb.body));
}

test('CSRF: un POST con Origin ajeno se rechaza (403) aunque el cuerpo sea válido', async () => {
  const { app } = demoApp();
  await withMachine(app);
  const r = await post(app, '/api/mc/machines/win-principal/commands/hermes-status', { confirm: true }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'forbidden_origin');
  const m = await post(app, '/api/mc/missions', missionBody(), { origin: 'https://evil.example' });
  assert.equal(m.status, 403);
  // Mismo origen que el host de la petición: pasa.
  const ok = await post(app, '/api/mc/machines/win-principal/commands/hermes-status', { confirm: true }, { origin: 'http://localhost' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  // Sec-Fetch-Site cross-site sin Origin también se rechaza.
  const sfs = await post(app, '/api/mc/machines/win-principal/commands/hermes-status', { confirm: true }, { 'sec-fetch-site': 'cross-site' });
  assert.equal(sfs.status, 403);
});

test('CSRF: una petición "simple" (text/plain) con cuerpo no se acepta como JSON (415)', async () => {
  const { app } = demoApp();
  await withMachine(app);
  const r = await getJson(app, '/api/mc/machines/win-principal/commands/hermes-status', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"confirm":true}' });
  assert.equal(r.status, 415);
  assert.equal(r.body.code, 'unsupported_media_type');
  // POST sin cuerpo (p. ej. aprobar sin nota) sigue funcionando sin Content-Type.
  const created = await post(app, '/api/mc/missions', missionBody({ team: { mode: 'rules', agentIds: [] } }));
  assert.equal(created.status, 201);
  const ap = await getJson(app, `/api/mc/missions/${created.body.id}/plan/approve`, { method: 'POST' });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
});

test('DNS rebinding: un Host desconocido se rechaza (403) incluso en GET; loopback, IPs, *.ts.net y MC_ALLOWED_HOSTS pasan', async () => {
  const { app } = demoApp({ allowedHosts: ['mc.casa.lan'] });
  const bad = await getJson(app, '/api/mc/settings', { headers: { host: 'evil.example' } });
  assert.equal(bad.status, 403);
  assert.equal(bad.body.code, 'forbidden_host');
  for (const host of ['localhost:3300', '127.0.0.1:3300', '[::1]:3300', '100.101.102.103:3300', 'win-principal.tail1234.ts.net', 'mc.casa.lan:3300']) {
    const ok = await getJson(app, '/api/mc/settings', { headers: { host } });
    assert.equal(ok.status, 200, `host ${host}`);
  }
  // El latido con token válido queda exento (viene de un proceso, no de un navegador).
  const hb = await post(app, '/api/mc/machines/mac/heartbeat', heartbeatBody('mac', { os: 'macos' }), { ...auth, host: 'evil.example' });
  assert.equal(hb.status, 200);
  assert.equal(isAllowedHost('EVIL.example', new Set(['evil.example'])), true, 'la lista del operador no distingue mayúsculas');
  assert.equal(isAllowedHost(undefined), false);
});

test('tamaño del cuerpo: más de 2 MiB responde 413 antes de validar', async () => {
  const { app } = demoApp();
  const big = JSON.stringify({ title: 'x', markdown: 'a'.repeat(2 * 1024 * 1024 + 10) });
  const r = await getJson(app, '/api/mc/docs', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(big)) }, body: big });
  assert.equal(r.status, 413);
  assert.equal(r.body.code, 'payload_too_large');
});

test('latido: hermes.apiServer.baseUrl solo admite destinos loopback/privados/tailnet sin credenciales', async () => {
  const { app } = demoApp({ allowedHosts: ['hermes.casa.lan'] });
  const rej = async (baseUrl) => {
    const r = await post(app, '/api/mc/machines/mac/heartbeat', heartbeatBody('mac', { os: 'macos', hermes: { installed: true, apiServer: { reachable: true, baseUrl } } }), auth);
    assert.equal(r.status, 400, `${baseUrl} debería rechazarse: ${JSON.stringify(r.body)}`);
  };
  await rej('http://169.254.169.254/latest/meta-data');
  await rej('https://attacker.example');
  await rej('http://user:pw@127.0.0.1:8642');
  await rej('ftp://127.0.0.1:8642');
  await rej('http://127.0.0.1:8642/?x=1');
  await rej('http://8.8.8.8:8642');
  for (const baseUrl of ['http://127.0.0.1:8642', 'https://mac.tail1234.ts.net', 'http://100.101.102.103:8642/', 'http://192.168.1.20:8642', 'https://hermes.casa.lan']) {
    const r = await post(app, '/api/mc/machines/mac/heartbeat', heartbeatBody('mac', { os: 'macos', hermes: { installed: true, apiServer: { reachable: true, baseUrl } } }), auth);
    assert.equal(r.status, 200, `${baseUrl} debería aceptarse: ${JSON.stringify(r.body)}`);
  }
  assert.equal(validateHermesBaseUrl('http://100.101.102.103:8642/'), 'http://100.101.102.103:8642');
  assert.equal(isPrivateOrTailnetIp('100.127.255.255'), true);
  assert.equal(isPrivateOrTailnetIp('100.128.0.1'), false);
  assert.equal(isPrivateOrTailnetIp('169.254.169.254'), false);
  assert.equal(isPrivateOrTailnetIp('fd7a:115c:a1e0::1'), true);
  assert.equal(isPrivateOrTailnetIp('fe80::1'), false);
});

test('demo: borrar el agente asignado deja la misión en 409 (assignee_missing) en vez de 500', async () => {
  const { app } = demoApp();
  const created = await post(app, '/api/mc/missions', missionBody({ team: { mode: 'rules', agentIds: [] } }));
  assert.equal(created.status, 201);
  const assignee = created.body.team.agentIds[0] ?? created.body.plan.steps[0].agentId;
  assert.ok(assignee, 'la misión en modo reglas tiene asignado');
  const del = await getJson(app, `/api/mc/agents/${assignee}`, { method: 'DELETE' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  const ap = await post(app, `/api/mc/missions/${created.body.id}/plan/approve`, {});
  assert.equal(ap.status, 409, JSON.stringify(ap.body));
  assert.equal(ap.body.details?.code, 'assignee_missing');
});

test('ajustes: maxConcurrentRuns y timeoutSec se guardan y se devuelven; valores inválidos conservan el anterior', async () => {
  const { app } = demoApp();
  const cur = (await getJson(app, '/api/mc/settings')).body;
  assert.deepEqual(cur.agentDefaults, { maxDailyRuns: 40, maxDailyCostCents: 500, maxConcurrentRuns: 1, timeoutSec: 300 });
  const put = await getJson(app, '/api/mc/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...cur, agentDefaults: { maxConcurrentRuns: 2, timeoutSec: 120, maxDailyRuns: 0 } }) });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(put.body.agentDefaults, { maxDailyRuns: 40, maxDailyCostCents: 500, maxConcurrentRuns: 2, timeoutSec: 120 });
  const again = (await getJson(app, '/api/mc/settings')).body;
  assert.equal(again.agentDefaults.maxConcurrentRuns, 2);
});

// ---------------------------------------------------------------- backend paperclip con cliente falso

const T0 = '2026-10-08T10:00:00.000Z';
function agent(id, name, over = {}) {
  return { id, companyId: 'c1', name, role: 'engineer', status: 'idle', reportsTo: null, adapterType: 'hermes_gateway', adapterConfig: { apiBaseUrl: 'http://127.0.0.1:8642' }, runtimeConfig: {}, budgetMonthlyCents: 500, spentMonthlyCents: 0, metadata: null, lastHeartbeatAt: null, urlKey: id, avatarUrl: null, ...over };
}
function fakeClient(state = {}) {
  const calls = [];
  const issues = new Map();
  let n = 0;
  const rec = (name, ...args) => calls.push({ name, args });
  return {
    calls,
    issues,
    state,
    listCompanies: async () => [{ id: 'c1', name: 'Co' }],
    listAgents: async () => state.agents ?? [agent('a1', 'Uno'), agent('a2', 'Dos', { spentMonthlyCents: 50 })],
    listIssues: async () => [...issues.values()],
    getIssue: async (id) => {
      const i = [...issues.values()].find((x) => x.id === id || x.identifier === id);
      if (!i) throw new PaperclipError({ status: 404, code: 'not_found', message: 'nf' });
      return i;
    },
    createIssue: async (cid, body) => {
      rec('createIssue', cid, body);
      if (state.failCreateOnce && body.parentId) {
        state.failCreateOnce = false;
        throw new PaperclipError({ status: 503, code: 'unavailable', message: 'caída transitoria' });
      }
      const existing = [...issues.values()].find((x) => x.idempotencyKey === body.idempotencyKey);
      if (existing) return existing;
      n += 1;
      const i = { id: `issue-${n}`, idempotencyKey: body.idempotencyKey, companyId: cid, identifier: `MIS-${n}`, title: body.title, description: body.description ?? null, status: body.status ?? 'todo', priority: body.priority ?? 'medium', reviewPolicy: body.reviewPolicy ?? 'anyone', workMode: 'standard', assigneeAgentId: body.assigneeAgentId ?? null, parentId: body.parentId ?? null, executionRunId: null, checkoutRunId: null, completedAt: null, createdAt: T0, updatedAt: T0 };
      issues.set(i.id, i);
      return i;
    },
    updateIssue: async (id, body) => (rec('updateIssue', id, body), Object.assign(issues.get(id), { status: body.status ?? issues.get(id).status })),
    addIssueComment: async () => ({ id: 'cm' }),
    listIssueComments: async () => [],
    listIssueActivity: async () => [],
    listCompanyActivity: async () => [],
    listHeartbeatRuns: async () => state.runs ?? [],
    listLiveRuns: async () => [],
    cancelRun: async () => ({}),
    invokeHeartbeat: async () => ({}),
    createAgent: async (cid, body) => {
      rec('createAgent', cid, body);
      const a = agent('new-1', body.name, body);
      state.agents = [...(state.agents ?? [agent('a1', 'Uno')]), a];
      return a;
    },
    pauseAgent: async () => ({}),
    costsByAgent: async (cid, params) => (rec('costsByAgent', cid, params), state.costs ?? []),
    listRoutines: async () => [],
    getDashboard: async () => ({ agents: {}, tasks: {}, costs: { monthSpendCents: 0, monthBudgetCents: 0, monthUtilizationPercent: 0 }, pendingApprovals: 0, budgets: {}, runActivity: [] }),
    health: async () => ({ status: 'ok', version: 'fake' }),
    request: async (method, path, opts) => (rec('request', method, path, opts?.body), state.issueRuns?.[path] ?? []),
  };
}
function build(client, extra = {}, env = {}) {
  const services = buildServices({ dataDir: ':memory:', catalogDir: CATALOG_DIR });
  const backend = new PaperclipBackend({ ...services, now: () => new Date(T0) }, { client, baseUrl: 'http://pc.test', companyId: 'c1', fetchImpl: async () => new Response('{}', { status: 200 }), ...extra });
  const app = createApp({ backend, services, quiet: true, nodeAgentToken: TOKEN });
  return { app, backend, services, client, env };
}
const stubMission = (over = {}) => missionBody({ team: { mode: 'manual', agentIds: ['a1'] }, ...over });

test('idempotencia: con Idempotency-Key las claves hacia Paperclip son deterministas y un fallo parcial no duplica la padre', async () => {
  const state = { failCreateOnce: true };
  const { app, client } = build(fakeClient(state));
  const headers = { 'idempotency-key': 'cliente-abc-123' };
  const first = await post(app, '/api/mc/missions', stubMission({ team: { mode: 'manual', agentIds: ['a1', 'a2'] } }), headers);
  assert.ok(first.status >= 500, `la primera llamada falla al crear la hija: ${first.status}`);
  const retry = await post(app, '/api/mc/missions', stubMission({ team: { mode: 'manual', agentIds: ['a1', 'a2'] } }), headers);
  assert.equal(retry.status, 201, JSON.stringify(retry.body));
  const creates = client.calls.filter((c) => c.name === 'createIssue').map((c) => c.args[1]);
  assert.equal(creates.length, 4, 'padre + hija (falla) + padre (replay) + hija');
  assert.equal(creates[0].idempotencyKey, creates[2].idempotencyKey, 'la padre repite la clave');
  assert.equal(creates[1].idempotencyKey, creates[3].idempotencyKey, 'la hija repite la clave');
  assert.match(creates[0].idempotencyKey, /^mc:[0-9a-f]{48}$/);
  assert.equal(creates[0].title, creates[2].title, 'título estable → el dedupe por título de Paperclip también actúa');
  assert.equal(client.issues.size, 2, 'Paperclip solo tiene una padre y una hija');
  assert.equal(retry.body.childCount, 1);
  // Tercera llamada: réplica del BFF (fila idempotency), sin tocar Paperclip.
  const replay = await post(app, '/api/mc/missions', stubMission({ team: { mode: 'manual', agentIds: ['a1', 'a2'] } }), headers);
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get('idempotent-replayed'), 'true');
  assert.equal(client.calls.filter((c) => c.name === 'createIssue').length, 4);
  // Sin cabecera, las claves siguen siendo UUID aleatorios.
  const plain = await post(app, '/api/mc/missions', stubMission());
  assert.equal(plain.status, 201);
  assert.match(client.calls.filter((c) => c.name === 'createIssue').at(-1).args[1].idempotencyKey, /^[0-9a-f-]{36}$/);
});

test('agentes: el gasto mensual sale del agente de Paperclip y los costes se piden por rango del mes (no "period")', async () => {
  const state = { costs: [{ agentId: 'a1', costCents: 350 }, { agentId: 'a2', costCents: 999 }] };
  const { app, client } = build(fakeClient(state));
  const r = await getJson(app, '/api/mc/agents');
  assert.equal(r.status, 200);
  const call = client.calls.find((c) => c.name === 'costsByAgent');
  assert.equal(call.args[1].period, undefined);
  assert.equal(call.args[1].from, '2026-10-01T00:00:00.000Z');
  assert.equal(call.args[1].to, T0);
  const a2 = r.body.find((a) => a.id === 'a2');
  assert.equal(a2.spentMonthlyCents, 50, 'el valor mensual del agente manda sobre el agregado');
});

test('detalle: las hijas muestran tokens y duración de sus propios runs', async () => {
  const run = (id, issueId, agentId) => ({ id, agentId, companyId: 'c1', status: 'succeeded', invocationSource: 'wakeup', startedAt: '2026-10-08T09:00:00.000Z', finishedAt: '2026-10-08T09:01:30.000Z', createdAt: '2026-10-08T09:00:00.000Z', usageJson: { inputTokens: 12000, outputTokens: 300, cachedInputTokens: 0 }, contextSnapshot: { issueId }, context: { issueId } });
  // El cliente falso numera las issues: la padre será issue-1 y la hija issue-2 (los runs se fijan antes para no depender de la caché de 3 s).
  const state = { runs: [run('r-child', 'issue-2', 'a2')] };
  const { app, client } = build(fakeClient(state));
  const created = await post(app, '/api/mc/missions', stubMission({ team: { mode: 'manual', agentIds: ['a1', 'a2'] } }));
  assert.equal(created.status, 201);
  const child = [...client.issues.values()].find((i) => i.parentId);
  assert.equal(child.id, 'issue-2');
  const detail = await getJson(app, `/api/mc/missions/${created.body.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.children.length, 1);
  assert.equal(detail.body.children[0].durationSec, 90);
  assert.equal(detail.body.children[0].tokens.input, 12000);
});

test('crear agente Hermes: la URL del operador manda; un loopback anunciado por un equipo remoto se rechaza (409) y nunca viaja a Paperclip', async () => {
  const envKey = 'MC_HERMES_URL_MAC';
  const prev = process.env[envKey];
  delete process.env[envKey];
  try {
    const { app, client, services } = build(fakeClient({ agents: [agent('a1', 'Uno')] }), { localMachineId: 'win-principal' });
    services.settings.setHermesSecret('mac', 'sec-mac');
    await post(app, '/api/mc/machines/mac/heartbeat', heartbeatBody('mac', { os: 'macos' }), auth); // anuncia http://127.0.0.1:8642
    const body = { name: 'Ejecutor Mac', role: 'engineer', platform: 'hermes', machineId: 'mac' };
    const r1 = await post(app, '/api/mc/agents', body);
    assert.equal(r1.status, 409, JSON.stringify(r1.body));
    assert.match(r1.body.error, /loopback/);
    assert.equal(client.calls.some((c) => c.name === 'createAgent'), false);
    // Con la variable del operador se usa esa URL aunque el latido diga otra cosa.
    process.env[envKey] = 'https://mac.tail1234.ts.net';
    const r2 = await post(app, '/api/mc/agents', body);
    assert.equal(r2.status, 201, JSON.stringify(r2.body));
    const sent = client.calls.find((c) => c.name === 'createAgent').args[1];
    assert.equal(sent.adapterConfig.apiBaseUrl, 'https://mac.tail1234.ts.net');
    assert.deepEqual(sent.adapterConfig.apiKey, { type: 'secret_ref', secretId: 'sec-mac', version: 'latest' });
    assert.equal(sent.runtimeConfig.heartbeat.maxConcurrentRuns, 1);
    // El equipo local sí puede anunciar loopback.
    delete process.env[envKey];
    services.settings.setHermesSecret('win-principal', 'sec-win');
    await post(app, '/api/mc/machines/win-principal/heartbeat', heartbeatBody('win-principal'), auth);
    const r3 = await post(app, '/api/mc/agents', { ...body, name: 'Ejecutor local', machineId: 'win-principal' });
    assert.equal(r3.status, 201, JSON.stringify(r3.body));
    assert.equal(client.calls.filter((c) => c.name === 'createAgent').at(-1).args[1].adapterConfig.apiBaseUrl, 'http://127.0.0.1:8642');
  } finally {
    if (prev === undefined) delete process.env[envKey];
    else process.env[envKey] = prev;
  }
});

// ---------------------------------------------------------------- recuperación (hallazgos F1–F4 de la revisión)

test('aprobar plan: si Paperclip falla en el PATCH, el plan sigue pendiente y se puede reintentar', async () => {
  const client = fakeClient();
  const { app } = build(client);
  const created = await post(app, '/api/mc/missions', stubMission({ team: { mode: 'rules', agentIds: [] } }));
  assert.equal(created.status, 201);
  assert.equal(created.body.approvalPending, true);
  const realUpdate = client.updateIssue;
  client.updateIssue = async () => {
    throw new PaperclipError({ status: 503, code: 'unavailable', message: 'Paperclip caído' });
  };
  const fail = await post(app, `/api/mc/missions/${created.body.id}/plan/approve`, {});
  assert.ok(fail.status >= 500, `debe propagar el fallo: ${fail.status}`);
  client.updateIssue = realUpdate;
  const again = await getJson(app, `/api/mc/missions/${created.body.id}`);
  assert.equal(again.body.plan.status, 'pending', 'el plan no quedó aprobado a medias');
  const ok = await post(app, `/api/mc/missions/${created.body.id}/plan/approve`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.plan.status, 'approved');
});

test('reintentar: si el wakeup falla, la misión vuelve a su estado anterior y el candado se libera', async () => {
  const state = {};
  const client = fakeClient(state);
  const { app } = build(client);
  const created = await post(app, '/api/mc/missions', stubMission());
  await client.updateIssue(created.body.id, { status: 'blocked' });
  state.requestError = new PaperclipError({ status: 503, code: 'unavailable', message: 'sin wakeup' });
  const origRequest = client.request;
  client.request = async (method, path, opts) => {
    if (path.endsWith('/wakeup') && state.requestError) throw state.requestError;
    return origRequest(method, path, opts);
  };
  const fail = await post(app, `/api/mc/missions/${created.body.id}/rerun`, {});
  assert.ok(fail.status >= 500, `rerun debe fallar: ${fail.status}`);
  const after = await getJson(app, `/api/mc/missions/${created.body.id}`);
  assert.equal(after.body.paperclipStatus, 'blocked', 'la issue no queda en in_progress sin run');
  assert.equal(after.body.retryCount, 0);
  state.requestError = undefined;
  const ok = await post(app, `/api/mc/missions/${created.body.id}/rerun`, {});
  assert.equal(ok.status, 200, `el candado se liberó: ${JSON.stringify(ok.body)}`);
  assert.equal(ok.body.paperclipStatus, 'in_progress');
});

test('detener: si /issues/{id}/runs falla se usan los runs de la empresa y se cancela el run activo; el plan pendiente se cierra', async () => {
  const state = { runs: [{ id: 'run-live', agentId: 'a1', status: 'running', invocationSource: 'assignment', startedAt: T0, createdAt: T0, contextSnapshot: { issueId: 'issue-1' }, usageJson: null }] };
  const client = fakeClient(state);
  const cancelled = [];
  client.cancelRun = async (id) => (cancelled.push(id), {});
  client.request = async (method, path) => {
    if (path.endsWith('/runs')) throw new PaperclipError({ status: 502, code: 'bad_gateway', message: 'runs caído' });
    return [];
  };
  const { app } = build(client);
  const created = await post(app, '/api/mc/missions', stubMission({ team: { mode: 'rules', agentIds: [] } }));
  assert.equal(created.body.approvalPending, true);
  const before = await getJson(app, '/api/mc/overview');
  assert.equal(before.body.pendingApprovals, 1);
  const stop = await post(app, `/api/mc/missions/${created.body.id}/stop`, { note: 'basta' });
  assert.equal(stop.status, 200, JSON.stringify(stop.body));
  assert.deepEqual(cancelled, ['run-live'], 'el run activo se canceló aunque /issues/{id}/runs fallara');
  assert.equal(stop.body.status, 'cancelled');
  assert.equal(stop.body.approvalPending, false, 'una misión detenida no espera aprobación');
  const after = await getJson(app, '/api/mc/overview');
  assert.equal(after.body.pendingApprovals, 0);
});

test('detener: si también falla la lista de runs de la empresa, no se marca cancelled a ciegas (503)', async () => {
  const client = fakeClient();
  client.request = async (method, path) => {
    if (path.endsWith('/runs')) throw new PaperclipError({ status: 502, code: 'bad_gateway', message: 'runs caído' });
    return [];
  };
  const { app } = build(client);
  const created = await post(app, '/api/mc/missions', stubMission());
  client.listHeartbeatRuns = async () => {
    throw new PaperclipError({ status: 503, code: 'unavailable', message: 'empresa caída' });
  };
  // La caché de runs (3 s) puede tener la lista vacía de la creación: se fuerza una nueva misión tras cambiar el cliente.
  const fresh = await post(app, '/api/mc/missions', stubMission());
  const stop = await post(app, `/api/mc/missions/${fresh.body.id ?? created.body.id}/stop`, {});
  assert.ok(stop.status >= 500, `no debe responder 200: ${stop.status} ${JSON.stringify(stop.body)}`);
  const upd = client.calls.filter((c) => c.name === 'updateIssue' && c.args[1].status === 'cancelled');
  assert.equal(upd.length, 0, 'la issue no se canceló');
});
