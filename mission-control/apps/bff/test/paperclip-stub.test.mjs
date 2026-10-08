// BFF con backend paperclip contra un cliente falso: comprueba lo que MC ENVÍA a Paperclip y el mapeo de lo que recibe.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PaperclipError } from '@mc/paperclip-client';
import { PaperclipBackend, buildServices, createApp } from '../dist/index.js';
import { CATALOG_DIR, getJson, heartbeatBody, missionBody as baseMission, post } from './helpers.mjs';

const missionBody = (over = {}) => baseMission({ team: { mode: 'manual', agentIds: ['a1'] }, ...over });

const T0 = '2026-10-08T10:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function agent(id, name, over = {}) {
  return { id, companyId: 'c1', name, role: 'engineer', status: 'idle', reportsTo: null, adapterType: 'hermes_gateway', adapterConfig: { apiBaseUrl: 'http://127.0.0.1:8642' }, runtimeConfig: {}, budgetMonthlyCents: 500, spentMonthlyCents: 0, metadata: null, lastHeartbeatAt: null, urlKey: id, avatarUrl: null, ...over };
}

function fakeClient(state = {}) {
  const calls = [];
  const issues = new Map();
  let n = 0;
  const rec = (name, ...args) => calls.push({ name, args });
  const client = {
    calls,
    issues,
    state,
    listCompanies: async () => [{ id: 'c1', name: 'Co' }],
    listAgents: async () => state.agents ?? [agent('a1', 'Uno'), agent('a2', 'Dos', { adapterType: 'claude_local', adapterConfig: {} })],
    listIssues: async () => [...issues.values()],
    getIssue: async (id) => {
      const i = [...issues.values()].find((x) => x.id === id || x.identifier === id);
      if (!i) throw new PaperclipError({ status: 404, code: 'not_found', message: 'nf' });
      return i;
    },
    createIssue: async (cid, body) => {
      rec('createIssue', cid, body);
      n += 1;
      const i = { id: `issue-${n}`, companyId: cid, identifier: `MIS-${n}`, title: body.title, description: body.description ?? null, status: body.status ?? 'todo', priority: body.priority ?? 'medium', reviewPolicy: body.reviewPolicy ?? 'anyone', workMode: 'standard', assigneeAgentId: body.assigneeAgentId ?? null, parentId: body.parentId ?? null, executionRunId: null, checkoutRunId: null, completedAt: null, createdAt: T0, updatedAt: T0 };
      issues.set(i.id, i);
      return i;
    },
    updateIssue: async (id, body) => {
      rec('updateIssue', id, body);
      const i = issues.get(id);
      Object.assign(i, { status: body.status ?? i.status, assigneeAgentId: body.assigneeAgentId ?? i.assigneeAgentId });
      return i;
    },
    addIssueComment: async (id, body) => (rec('addIssueComment', id, body), { id: 'cm' }),
    listIssueComments: async () => state.comments ?? [],
    listIssueActivity: async () => [],
    listCompanyActivity: async () => [],
    listHeartbeatRuns: async () => state.runs ?? [],
    listLiveRuns: async () => state.live ?? [],
    cancelRun: async (id) => (rec('cancelRun', id), {}),
    invokeHeartbeat: async (id, body) => (rec('invokeHeartbeat', id, body), {}),
    createAgent: async (cid, body) => {
      rec('createAgent', cid, body);
      const a = agent('new-1', body.name, body);
      state.agents = [...(state.agents ?? [agent('a1', 'Uno')]), a];
      return a;
    },
    pauseAgent: async (id) => (rec('pauseAgent', id), {}),
    costsByAgent: async () => [],
    listRoutines: async () => [],
    getDashboard: async () => ({ agents: {}, tasks: {}, costs: { monthSpendCents: 0, monthBudgetCents: 0, monthUtilizationPercent: 0 }, pendingApprovals: 0, budgets: {}, runActivity: [] }),
    health: async () => ({ status: 'ok', version: 'fake' }),
    request: async (method, path, opts) => {
      rec('request', method, path, opts?.body);
      if (state.requestError && path.endsWith('/wakeup')) throw state.requestError;
      return state.issueRuns?.[path] ?? [];
    },
  };
  return client;
}

function build(client, extra = {}) {
  const services = buildServices({ dataDir: ':memory:', catalogDir: CATALOG_DIR });
  const backend = new PaperclipBackend({ ...services, now: () => new Date(T0) }, { client, baseUrl: 'http://pc.test', companyId: 'c1', fetchImpl: async () => new Response('{}', { status: 200 }), ...extra });
  const app = createApp({ backend, services, quiet: true, nodeAgentToken: 'x'.repeat(24) });
  return { app, backend, services, client };
}

test('crear misión manual: idempotencyKey, título único, reviewPolicy, hijas con parentId y metadatos en SQLite', async () => {
  const { app, services, client } = build(fakeClient());
  const r = await post(app, '/api/mc/missions', missionBody({ title: 'Revisar contrato', finish: 'review_first', ideaId: 'N05', team: { mode: 'manual', agentIds: ['a1', 'a2'] } }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const creates = client.calls.filter((c) => c.name === 'createIssue');
  assert.equal(creates.length, 2);
  const [parent, child] = creates.map((c) => c.args[1]);
  assert.match(parent.idempotencyKey, UUID);
  assert.match(parent.title, /^Revisar contrato · [0-9a-f]{6}$/);
  assert.equal(parent.reviewPolicy, 'human_only');
  assert.equal(parent.assigneeAgentId, 'a1');
  assert.equal(parent.status, 'todo');
  assert.match(parent.description, /Parámetros de Mission Control/);
  assert.match(parent.description, /Idea de origen: N05/);
  assert.equal(parent.allowDuplicate, undefined);
  assert.equal(child.parentId, 'issue-1');
  assert.equal(child.assigneeAgentId, 'a2');
  assert.notEqual(child.idempotencyKey, parent.idempotencyKey);
  assert.equal(r.body.title, 'Revisar contrato', 'el sufijo no se muestra');
  assert.equal(r.body.ideaId, 'N05');
  assert.equal(r.body.scope, 'proyectos');
  assert.equal(r.body.childCount, 1);
  const row = services.db.prepare('SELECT * FROM missions_meta WHERE issue_id = ?').get('issue-1');
  assert.equal(row.idea_id, 'N05');
  assert.equal(row.finish, 'review_first');
  assert.equal(JSON.parse(row.team_json).mode, 'manual');
});

test('crear misión sin review_first no fuerza reviewPolicy; jefe asigna al coordinador', async () => {
  const { app, client } = build(fakeClient());
  const r = await post(app, '/api/mc/missions', missionBody({ team: { mode: 'boss', agentIds: [], bossAgentId: 'a2' } }));
  assert.equal(r.status, 201);
  const body = client.calls.find((c) => c.name === 'createIssue').args[1];
  assert.equal(body.reviewPolicy, undefined);
  assert.equal(body.assigneeAgentId, 'a2');
  const bad = await post(app, '/api/mc/missions', missionBody({ team: { mode: 'boss', agentIds: [], bossAgentId: 'nadie' } }));
  assert.equal(bad.status, 400);
});

test('modo reglas: issue en backlog con plan pendiente en SQLite; aprobar pasa a todo y despierta si hace falta', async () => {
  const { app, services, client } = build(fakeClient());
  const r = await post(app, '/api/mc/missions', missionBody({ team: { mode: 'rules', agentIds: [] }, requiredCapabilities: ['no-existe'] }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'briefing');
  assert.equal(r.body.approvalPending, true);
  assert.equal(r.body.plan.status, 'pending');
  assert.equal(r.body.plan.proposedBy.type, 'rules');
  assert.match(r.body.plan.rationale, /primer agente disponible/);
  assert.equal(client.calls.find((c) => c.name === 'createIssue').args[1].status, 'backlog');
  assert.equal(services.db.prepare("SELECT COUNT(*) AS n FROM plans WHERE status='pending'").get().n, 1);
  const ap = await post(app, `/api/mc/missions/${r.body.id}/plan/approve`, { note: 'va' });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const upd = client.calls.find((c) => c.name === 'updateIssue');
  assert.equal(upd.args[1].status, 'todo');
  assert.ok(client.calls.some((c) => c.name === 'invokeHeartbeat'), 'sin run reciente se invoca el heartbeat');
  assert.equal(ap.body.plan.status, 'approved');
  assert.ok(ap.body.timeline.some((e) => e.kind === 'plan_approved'));
  assert.equal((await post(app, `/api/mc/missions/${r.body.id}/plan/approve`, {})).status, 409);
});

test('rechazar plan lo deja en briefing; aceptar, pedir cambios y detener usan updateIssue/cancelRun', async () => {
  const state = {};
  const { app, client } = build(fakeClient(state));
  const rules = await post(app, '/api/mc/missions', missionBody({ team: { mode: 'rules', agentIds: [] } }));
  assert.equal((await post(app, `/api/mc/missions/${rules.body.id}/plan/reject`, {})).status, 400);
  const rj = await post(app, `/api/mc/missions/${rules.body.id}/plan/reject`, { note: 'no' });
  assert.equal(rj.body.plan.status, 'rejected');
  assert.equal(rj.body.status, 'briefing');

  const m = await post(app, '/api/mc/missions', missionBody({ title: 'Otra' }));
  client.issues.get(m.body.id).status = 'in_review';
  const acc = await post(app, `/api/mc/missions/${m.body.id}/accept`, { note: 'bien' });
  assert.equal(acc.status, 200);
  const last = client.calls.filter((c) => c.name === 'updateIssue').pop();
  assert.equal(last.args[1].status, 'done');
  assert.match(last.args[1].comment, /^\[Operador humano\] bien/);
  assert.equal((await post(app, `/api/mc/missions/${m.body.id}/accept`, {})).status, 409);
  const ch = await post(app, `/api/mc/missions/${m.body.id}/request-changes`, { note: 'más corto' });
  assert.equal(ch.status, 200);
  const last2 = client.calls.filter((c) => c.name === 'updateIssue').pop();
  assert.equal(last2.args[1].status, 'in_progress');
  assert.equal(last2.args[1].reopen, true);
  assert.match(last2.args[1].comment, /más corto/);

  client.issues.get(m.body.id).status = 'in_progress';
  state.issueRuns = { [`/issues/${m.body.id}/runs`]: [{ runId: 'run-live', status: 'running', agentId: 'a1', createdAt: T0 }, { runId: 'run-old', status: 'succeeded', agentId: 'a1', createdAt: T0 }] };
  const stop = await post(app, `/api/mc/missions/${m.body.id}/stop`, { note: 'basta' });
  assert.equal(stop.status, 200);
  assert.deepEqual(client.calls.filter((c) => c.name === 'cancelRun').map((c) => c.args[0]), ['run-live']);
  assert.equal(client.calls.filter((c) => c.name === 'updateIssue').pop().args[1].status, 'cancelled');
  const rerun = await post(app, `/api/mc/missions/${m.body.id}/rerun`, {});
  assert.equal(rerun.status, 200, 'una misión cancelada puede reintentarse');
});

test('rerun: wakeup con idempotencyKey e issueId, suma al contador y candado de 60 s', async () => {
  const { app, client, services } = build(fakeClient());
  const m = await post(app, '/api/mc/missions', missionBody({ title: 'Reintentar' }));
  client.issues.get(m.body.id).status = 'blocked';
  const rr = await post(app, `/api/mc/missions/${m.body.id}/rerun`, { note: 'otra vez' });
  assert.equal(rr.status, 200, JSON.stringify(rr.body));
  const wake = client.calls.find((c) => c.name === 'request' && c.args[1] === '/agents/a1/wakeup');
  assert.ok(wake, 'usa la ruta wakeup');
  assert.equal(wake.args[0], 'POST');
  assert.equal(wake.args[2].idempotencyKey, `mc:rerun:${m.body.id}:1`);
  assert.equal(wake.args[2].payload.issueId, m.body.id);
  assert.equal(wake.args[2].issueId, m.body.id);
  assert.equal(wake.args[2].source, 'on_demand');
  assert.equal(wake.args[2].forceFreshSession, false);
  assert.ok(!client.calls.some((c) => c.name === 'invokeHeartbeat'));
  assert.equal(services.db.prepare('SELECT retry_count FROM missions_meta WHERE issue_id = ?').get(m.body.id).retry_count, 1);
  assert.ok(rr.body.retryCount >= 1);
  // dos clics seguidos: el segundo no crea otro run
  client.issues.get(m.body.id).status = 'blocked';
  const again = await post(app, `/api/mc/missions/${m.body.id}/rerun`, {});
  assert.equal(again.status, 409);
  assert.equal(again.body.details.code, 'rerun_locked');
  assert.equal(client.calls.filter((c) => c.name === 'request' && c.args[1].endsWith('/wakeup')).length, 1);
});

test('rerun: si el build no tiene wakeup (404) cae a heartbeat/invoke; un fallo libera el candado', async () => {
  const state = { requestError: new PaperclipError({ status: 404, code: 'not_found', message: 'no hay ruta' }) };
  const { app, client } = build(fakeClient(state));
  const m = await post(app, '/api/mc/missions', missionBody({ title: 'Sin wakeup' }));
  client.issues.get(m.body.id).status = 'blocked';
  const rr = await post(app, `/api/mc/missions/${m.body.id}/rerun`, {});
  assert.equal(rr.status, 200, JSON.stringify(rr.body));
  const inv = client.calls.find((c) => c.name === 'invokeHeartbeat');
  assert.equal(inv.args[0], 'a1');
  assert.equal(inv.args[1].issueId, m.body.id);
  assert.equal(inv.args[1].idempotencyKey, `mc:rerun:${m.body.id}:1`);

  state.requestError = new PaperclipError({ status: 0, code: 'unreachable', message: 'caído' });
  client.issues.get(m.body.id).status = 'blocked';
  assert.equal((await post(app, `/api/mc/missions/${m.body.id}/rerun`, {})).status, 409, 'candado vigente por el reintento anterior');
});

test('resultado: solo de un run exitoso; el comentario de un run fallido queda como mensaje "run fallido"', async () => {
  const mk = (id, status) => ({ id, agentId: 'a1', status, invocationSource: 'assignment', startedAt: '2026-10-08T10:00:00.000Z', finishedAt: '2026-10-08T10:00:05.000Z', error: null, errorCode: null, usageJson: null, retryOfRunId: null, scheduledRetryAt: null, processLossRetryCount: 0, contextSnapshot: {} });
  const state = {
    runs: [mk('ok-run', 'succeeded'), mk('bad-run', 'failed')],
    comments: [
      { id: 'c-ok', body: 'Resultado bueno', authorType: 'agent', authorAgentId: 'a1', createdByRunId: 'ok-run', createdAt: '2026-10-08T10:00:06.000Z' },
      { id: 'c-bad', body: 'Texto parcial truncado', authorType: 'agent', authorAgentId: 'a1', createdByRunId: 'bad-run', createdAt: '2026-10-08T10:01:00.000Z' },
    ],
  };
  const client = fakeClient(state);
  const { app } = build(client);
  const m = await post(app, '/api/mc/missions', missionBody({ title: 'Con fallo' }));
  state.issueRuns = { [`/issues/${m.body.id}/runs`]: [{ runId: 'ok-run' }, { runId: 'bad-run' }] };
  client.issues.get(m.body.id).status = 'blocked';
  const d = (await getJson(app, `/api/mc/missions/${m.body.id}`)).body;
  assert.equal(d.result.body, 'Resultado bueno');
  const bad = d.timeline.find((e) => e.id === 'cmt-c-bad');
  assert.equal(bad.kind, 'message');
  assert.match(bad.summary, /^\[run fallido\]/);
  assert.match(bad.body, /run fallido/);
  // si el único comentario es de un run fallido no hay resultado
  state.comments = [state.comments[1]];
  const d2 = (await getJson(app, `/api/mc/missions/${m.body.id}`)).body;
  assert.equal(d2.result, undefined);
});

test('crear agente: permisos mínimos, topes diarios y metadatos; hermes exige URL y secreto', async () => {
  const { app, client, services } = build(fakeClient());
  const claude = await post(app, '/api/mc/agents', { name: 'Escritor', role: 'engineer', platform: 'claude', machineId: 'win-principal', modelLabel: 'sonnet', effort: 'high', instructions: 'Sé breve' });
  assert.equal(claude.status, 201, JSON.stringify(claude.body));
  const body = client.calls.find((c) => c.name === 'createAgent').args[1];
  assert.equal(body.adapterType, 'claude_local');
  assert.deepEqual(body.permissions, { canCreateAgents: false, canCreateSkills: false });
  assert.deepEqual(body.runtimeConfig, { heartbeat: { enabled: false, maxConcurrentRuns: 1, maxDailyRuns: 40, maxDailyCostCents: 500 } });
  assert.equal(services.settings.get().agentDefaults.timeoutSec, 300);
  assert.equal(body.metadata.machineId, 'win-principal');
  assert.equal(body.metadata.platform, 'claude');
  assert.equal(claude.body.platform, 'claude');
  assert.equal(claude.body.effort, 'high');

  // hermes sin URL registrada
  const noUrl = await post(app, '/api/mc/agents', { name: 'H', role: 'engineer', platform: 'hermes', machineId: 'win-laptop-1' });
  assert.equal(noUrl.status, 409);
  assert.match(noUrl.body.error, /URL del API server/);
  // con URL (latido) pero sin secreto
  services.machines.heartbeat('win-laptop-1', heartbeatBody('win-laptop-1', { hermes: { installed: true, apiServer: { reachable: true, baseUrl: 'https://win-laptop-1.tailnet.ts.net' } } }));
  const noSecret = await post(app, '/api/mc/agents', { name: 'H', role: 'engineer', platform: 'hermes', machineId: 'win-laptop-1' });
  assert.equal(noSecret.status, 409);
  assert.match(noSecret.body.error, /secreto/);
  services.settings.setHermesSecret('win-laptop-1', 'sec-uuid');
  const ok = await post(app, '/api/mc/agents', { name: 'MiMo Uno', role: 'researcher', platform: 'mimo', machineId: 'win-laptop-1', modelLabel: 'mimo-v2.6-pro' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const hb = client.calls.filter((c) => c.name === 'createAgent').pop().args[1];
  assert.equal(hb.adapterType, 'hermes_gateway');
  assert.equal(hb.adapterConfig.apiBaseUrl, 'https://win-laptop-1.tailnet.ts.net');
  assert.equal(hb.adapterConfig.timeoutSec, 300, 'por defecto 300 s, no los 600 s del adaptador');
  services.settings.put({ ...services.settings.get(), agentDefaults: { timeoutSec: 120 } });
  assert.equal(services.settings.get().agentDefaults.timeoutSec, 120);
  assert.equal(services.settings.get().agentDefaults.maxDailyRuns, 40);
  await post(app, '/api/mc/agents', { name: 'H2', role: 'engineer', platform: 'hermes', machineId: 'win-laptop-1' });
  assert.equal(client.calls.filter((c) => c.name === 'createAgent').pop().args[1].adapterConfig.timeoutSec, 120);
  assert.deepEqual(hb.adapterConfig.apiKey, { type: 'secret_ref', secretId: 'sec-uuid', version: 'latest' });
  assert.match(hb.adapterConfig.instructions, /mimo/);
  assert.ok(!JSON.stringify(hb).includes('apiKey":"'), 'nunca una clave literal');
  assert.equal(ok.body.platform, 'mimo');
  assert.equal(ok.body.modelLabel, 'mimo-v2.6-pro');
});

test('borrar agente = pausar y archivar (no terminate)', async () => {
  const { app, client } = build(fakeClient());
  const d = await getJson(app, '/api/mc/agents/a1', { method: 'DELETE' });
  assert.deepEqual(d.body, { ok: true });
  assert.ok(client.calls.some((c) => c.name === 'pauseAgent' && c.args[0] === 'a1'));
  const agents = await getJson(app, '/api/mc/agents');
  assert.ok(!agents.body.some((a) => a.id === 'a1'));
  assert.equal((await getJson(app, '/api/mc/agents/a1', { method: 'DELETE' })).status, 404);
});

test('runs: estados reales de Paperclip mapeados; coste estimado solo con modelo conocido', async () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 5, model: 'unknown', costStatus: 'unpriced' };
  const state = {
    agents: [agent('a1', 'Hermes'), agent('a2', 'MiMo', { metadata: { platform: 'mimo', modelLabel: 'mimo-v2.6-pro', machineId: 'mac' } })],
    runs: [
      { id: 'r1', agentId: 'a1', status: 'scheduled_retry', invocationSource: 'automation', startedAt: null, finishedAt: null, error: null, errorCode: null, usageJson: null, retryOfRunId: 'r0', scheduledRetryAt: null, scheduledRetryAttempt: 1, processLossRetryCount: 0 },
      { id: 'r2', agentId: 'a1', status: 'interrupted', invocationSource: 'timer', startedAt: '2026-10-08T09:00:00.000Z', finishedAt: '2026-10-08T09:00:10.000Z', error: 'corte', errorCode: null, usageJson: usage, retryOfRunId: null, scheduledRetryAt: null, processLossRetryCount: 1 },
      { id: 'r3', agentId: 'a2', status: 'succeeded', invocationSource: 'on_demand', startedAt: '2026-10-08T09:00:00.000Z', finishedAt: '2026-10-08T09:00:30.000Z', error: null, errorCode: null, usageJson: usage, retryOfRunId: null, scheduledRetryAt: null, processLossRetryCount: 0 },
      { id: 'r4', agentId: 'a1', status: 'timed_out', invocationSource: 'assignment', startedAt: '2026-10-08T09:05:00.000Z', finishedAt: '2026-10-08T09:06:00.000Z', error: 't', errorCode: 'timeout', usageJson: null, retryOfRunId: null, scheduledRetryAt: null, processLossRetryCount: 0 },
    ],
  };
  const { app } = build(fakeClient(state));
  const hermes = (await getJson(app, '/api/mc/agents/a1/runs')).body;
  const byId = Object.fromEntries(hermes.map((r) => [r.id, r]));
  assert.equal(byId.r1.status, 'queued');
  assert.equal(byId.r2.status, 'failed');
  assert.equal(byId.r2.errorCode, 'interrupted');
  assert.equal(byId.r2.source, 'timer');
  assert.equal(byId.r2.durationSec, 10);
  assert.equal(byId.r2.tokens.costStatus, 'unpriced');
  assert.equal(byId.r2.tokens.estimatedCents, null);
  assert.equal(byId.r4.status, 'timed_out');
  const mimo = (await getJson(app, '/api/mc/agents/a2/runs')).body[0];
  assert.equal(mimo.tokens.costStatus, 'estimated');
  assert.equal(mimo.tokens.estimatedCents, 150);
  assert.equal(mimo.modelLabel, 'mimo-v2.6-pro');
  const agents = (await getJson(app, '/api/mc/agents?days=30')).body;
  const a2 = agents.find((a) => a.id === 'a2');
  assert.equal(a2.platform, 'mimo');
  assert.equal(a2.machineId, 'mac');
  assert.equal(agents.find((a) => a.id === 'a1').runsFailed, 2);
});

test('si Paperclip no responde: 503 paperclip_unreachable con details.baseUrl', async () => {
  const client = fakeClient();
  client.listIssues = async () => {
    throw new PaperclipError({ status: 0, code: 'unreachable', message: 'ECONNREFUSED' });
  };
  const { app } = build(client);
  const r = await getJson(app, '/api/mc/missions');
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'paperclip_unreachable');
  assert.equal(r.body.details.baseUrl, 'http://pc.test');
  const nf = await getJson(app, '/api/mc/missions/no-existe');
  assert.equal(nf.status, 404);
});

test('salud en modo paperclip: avisos de presupuesto y modo estricto de secretos siempre presentes', async () => {
  const { app } = build(fakeClient());
  const h = await getJson(app, '/api/mc/health');
  assert.equal(h.body.paperclip.reachable, true);
  const text = h.body.notes.map((n) => n.note).join('\n');
  assert.match(text, /Presupuesto en centavos no detecta consumo de hermes_gateway \(unpriced\); se usan topes diarios de runs/);
  assert.match(text, /Recomendado PAPERCLIP_SECRETS_STRICT_MODE=true en la instancia/);
  assert.match(text, /aprobaciones del plan viven en el BFF/);
  // sin token de node-agent, los latidos están desactivados en modo paperclip
  const services = buildServices({ dataDir: ':memory:', catalogDir: CATALOG_DIR });
  const backend = new PaperclipBackend(services, { client: fakeClient(), baseUrl: 'http://pc.test', companyId: 'c1' });
  const app2 = createApp({ backend, services, quiet: true, getRemoteAddress: () => '127.0.0.1' });
  assert.equal((await post(app2, '/api/mc/machines/mac/heartbeat', heartbeatBody('mac'))).status, 401);
});

test('documentos: comentarios de agente con >=120 palabras se listan; notas propias se guardan', async () => {
  const long = `# Informe de prueba\n\n${'palabra '.repeat(130)}`;
  const state = { comments: [{ id: 'k1', body: long, authorType: 'agent', authorAgentId: 'a1', createdAt: T0 }, { id: 'k2', body: 'corto', authorType: 'agent', authorAgentId: 'a1', createdAt: T0 }] };
  const { app } = build(fakeClient(state));
  const m = await post(app, '/api/mc/missions', missionBody());
  const docs = await getJson(app, `/api/mc/docs?missionId=${m.body.id}`);
  assert.equal(docs.body.length, 1);
  assert.equal(docs.body[0].title, 'Informe de prueba');
  assert.equal(docs.body[0].source, 'paperclip-comment');
  assert.ok(docs.body[0].wordCount >= 120);
  const one = await getJson(app, `/api/mc/docs/${encodeURIComponent(docs.body[0].id)}`);
  assert.equal(one.body.markdown, long);
  const note = await post(app, '/api/mc/docs', { title: 'Nota', markdown: 'hola', missionId: m.body.id });
  assert.equal(note.status, 201);
  const again = await getJson(app, `/api/mc/docs?missionId=${m.body.id}`);
  assert.equal(again.body.length, 2);
  assert.equal((await getJson(app, `/api/mc/missions/${m.body.id}`)).body.documents.length, 2);
});

test('sondeo: emite mission.changed y mission.message cuando cambia una issue', async () => {
  const state = { comments: [] };
  const client = fakeClient(state);
  const { app, backend } = build(client, { pollMs: 50 });
  const events = [];
  backend.subscribe((e) => events.push(e));
  const m = await post(app, '/api/mc/missions', missionBody());
  await backend.poll(); // línea base
  const issue = client.issues.get(m.body.id);
  issue.status = 'in_review';
  issue.updatedAt = new Date(Date.now()).toISOString();
  state.comments = [{ id: 'z', body: 'listo', authorType: 'agent', authorAgentId: 'a1', createdAt: '2026-10-08T10:00:05.000Z' }];
  await backend.poll();
  assert.ok(events.some((e) => e.type === 'mission.changed' && e.status === 'review' && e.missionId === m.body.id));
  assert.ok(events.some((e) => e.type === 'mission.message' && e.event.body === 'listo'));
});
