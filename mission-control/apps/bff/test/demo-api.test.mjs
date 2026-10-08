import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertKeys, demoApp, getJson, heartbeatBody, missionBody, post } from './helpers.mjs';

const SUMMARY_KEYS = ['id', 'identifier', 'title', 'status', 'priority', 'scope', 'createdAt', 'durationSec', 'tokens', 'retryCount', 'approvalPending', 'childCount', 'childDoneCount'];
const DETAIL_KEYS = [...SUMMARY_KEYS, 'objective', 'team', 'limits', 'finish', 'timeline', 'runs', 'children', 'documents', 'provenance'];

test('GET /health incluye modo, notas de procedencia y todo el contrato', async () => {
  const { app } = demoApp();
  const { status, body } = await getJson(app, '/api/mc/health');
  assert.equal(status, 200);
  assertKeys(assert, body, ['bff', 'paperclip', 'hermesGateways', 'machinesOnline', 'catalog', 'notes']);
  assert.equal(body.bff.mode, 'demo');
  assert.ok(body.notes.some((n) => n.state === 'simulado'));
  assert.ok(body.notes.some((n) => /loopback/.test(n.note)) === false, 'con token configurado no hay nota de loopback');
  assertKeys(assert, body.catalog, ['capabilities', 'errors', 'warnings']);
});

test('GET /overview tiene la forma del contrato y viene etiquetado demo', async () => {
  const { app } = demoApp();
  const { status, body } = await getJson(app, '/api/mc/overview?days=14');
  assert.equal(status, 200);
  assertKeys(assert, body, ['mode', 'generatedAt', 'missions', 'successRatePercent', 'avgMissionDurationSec', 'agents', 'machines', 'tokens', 'budget', 'pendingApprovals', 'runActivity', 'heatmap', 'modelsInUse']);
  assert.equal(body.mode, 'demo');
  assert.equal(body.missions.total, 40);
  for (const s of ['briefing', 'ongoing', 'review', 'delivered', 'blocked', 'cancelled']) assert.ok(body.missions.byStatus[s] > 0, `hay misiones ${s}`);
  assert.equal(body.heatmap.length, 7);
  assert.equal(body.heatmap[0].length, 24);
  assert.equal(body.runActivity.length, 14);
  assert.ok(body.successRatePercent > 0 && body.successRatePercent <= 100);
});

test('GET /missions: filtros, paginación y forma de resumen', async () => {
  const { app } = demoApp();
  const all = await getJson(app, '/api/mc/missions?limit=200');
  assert.equal(all.status, 200);
  assert.equal(all.body.items.length, 40);
  assertKeys(assert, all.body.items[0], SUMMARY_KEYS, 'MissionSummary');
  const page1 = await getJson(app, '/api/mc/missions?limit=15');
  assert.equal(page1.body.items.length, 15);
  assert.ok(page1.body.nextCursor);
  const page2 = await getJson(app, `/api/mc/missions?limit=15&cursor=${page1.body.nextCursor}`);
  assert.notEqual(page2.body.items[0].id, page1.body.items[0].id);
  const multi = await getJson(app, '/api/mc/missions?status=review,blocked&limit=200');
  assert.ok(multi.body.items.length > 0 && multi.body.items.every((m) => ['review', 'blocked'].includes(m.status)));
  const bad = await getJson(app, '/api/mc/missions?status=nada');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'invalid_request');
  const q = await getJson(app, '/api/mc/missions?q=ENVOLVEX');
  assert.equal(q.body.items.length, 1);
  assert.equal(q.body.items[0].ideaId, 'N01');
});

test('GET /missions/:id devuelve detalle con línea de tiempo ordenada, procedencia simulada y replay con raw', async () => {
  const { app } = demoApp();
  const list = await getJson(app, '/api/mc/missions?status=delivered&limit=1');
  const id = list.body.items[0].id;
  const { status, body } = await getJson(app, `/api/mc/missions/${id}`);
  assert.equal(status, 200);
  assertKeys(assert, body, DETAIL_KEYS, 'MissionDetail');
  assert.ok(body.provenance.every((p) => p.state === 'simulado'));
  const times = body.timeline.map((e) => Date.parse(e.at));
  assert.deepEqual([...times].sort((a, b) => a - b), times, 'línea de tiempo ordenada por at');
  const kinds = new Set(body.timeline.map((e) => e.kind));
  for (const k of ['created', 'assigned', 'run_started', 'message', 'run_finished', 'accepted']) assert.ok(kinds.has(k), `kind ${k}`);
  assert.ok(body.documents.length > 0);
  assert.ok(body.runs.length > 0 && 'tokens' in body.runs[0]);
  const rp = await getJson(app, `/api/mc/missions/${id}/replay`);
  assert.equal(rp.status, 200);
  assert.ok(rp.body.events.length === body.timeline.length && rp.body.events.every((e) => 'raw' in e));
  const nf = await getJson(app, '/api/mc/missions/no-existe');
  assert.equal(nf.status, 404);
  assert.equal(nf.body.code, 'not_found');
  const byIdent = await getJson(app, `/api/mc/missions/${body.identifier.toLowerCase()}`);
  assert.equal(byIdent.body.id, id);
});

test('GET de agentes, equipos, catálogo, ideas, docs, agenda, actividad y ajustes devuelven 200 con forma de contrato', async () => {
  const { app } = demoApp();
  const agents = await getJson(app, '/api/mc/agents');
  assert.equal(agents.status, 200);
  assert.equal(agents.body.length, 7);
  assertKeys(assert, agents.body[0], ['id', 'name', 'shortName', 'role', 'platform', 'state', 'isBoss', 'workloadShare', 'avgDurationSec', 'runsTotal', 'tokens', 'budgetMonthlyCents', 'spentMonthlyCents', 'origin']);
  assert.equal(agents.body.filter((a) => a.isBoss).length, 1);
  assert.deepEqual([...new Set(agents.body.map((a) => a.platform))].sort(), ['claude', 'codex', 'grok', 'hermes', 'mimo']);
  assert.ok(agents.body.every((a) => a.origin === 'demo'));

  const runs = await getJson(app, `/api/mc/agents/${agents.body[1].id}/runs?limit=5`);
  assert.equal(runs.status, 200);
  assert.ok(runs.body.length > 0 && runs.body.length <= 5);
  assertKeys(assert, runs.body[0], ['id', 'agentId', 'agentName', 'status', 'source', 'tokens']);

  const machines = await getJson(app, '/api/mc/machines');
  assert.equal(machines.body.length, 4);
  assertKeys(assert, machines.body[0], ['id', 'name', 'os', 'role', 'status', 'agentIds', 'capabilityIds', 'maxHeavyJobs', 'activeHeavyJobs', 'origin']);
  assert.deepEqual(machines.body.map((m) => m.id), ['win-principal', 'win-laptop-1', 'win-laptop-2', 'mac']);
  assert.ok(machines.body.every((m) => m.origin === 'demo'));

  const catalog = await getJson(app, '/api/mc/catalog');
  assert.equal(catalog.status, 200);
  assert.ok(Array.isArray(catalog.body));
  const validate = await getJson(app, '/api/mc/catalog/validate');
  assertKeys(assert, validate.body, ['ok', 'issues']);

  const ideas = await getJson(app, '/api/mc/ideas');
  assert.deepEqual(ideas.body.map((i) => i.id), ['N01', 'N02', 'N05']);
  assert.ok(ideas.body.find((i) => i.id === 'N01').missionId, 'N01 enlazada con la misión demo');

  const docs = await getJson(app, '/api/mc/docs');
  assert.ok(docs.body.length > 10);
  assertKeys(assert, docs.body[0], ['id', 'title', 'authorName', 'authorType', 'createdAt', 'excerpt', 'wordCount', 'source']);
  const doc = await getJson(app, `/api/mc/docs/${docs.body.find((d) => d.source === 'paperclip-comment').id}`);
  assert.ok(doc.body.markdown.split(/\s+/).length >= 120);
  assertKeys(assert, doc.body, ['summary', 'markdown']);

  const sched = await getJson(app, '/api/mc/schedule');
  assert.ok(sched.body.filter((r) => r.source === 'paperclip').length >= 3);
  assertKeys(assert, sched.body[0], ['id', 'title', 'schedule', 'status', 'source', 'canRunNow']);
  const runNow = await post(app, `/api/mc/schedule/${sched.body[0].id}/run-now`, {});
  assert.deepEqual(runNow.body, { ok: true });
  const cron = await post(app, '/api/mc/schedule/demo-cron-hermes-limpieza/run-now', {});
  assert.equal(cron.status, 400);

  const activity = await getJson(app, '/api/mc/activity?limit=10');
  assert.equal(activity.body.items.length, 10);
  assert.ok(activity.body.nextCursor);
  assertKeys(assert, activity.body.items[0], ['id', 'at', 'actorType', 'actorName', 'action', 'summary']);

  const settings = await getJson(app, '/api/mc/settings');
  assertKeys(assert, settings.body, ['ownerName', 'modelPrices', 'healthThresholds', 'vaultPaths']);
  assert.equal(settings.body.modelPrices[0].nota, 'ejemplo, ajustar');
  const put = await getJson(app, '/api/mc/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...settings.body, ownerName: 'Matencio', hermesSecretIds: { mac: 'sec-123' } }) });
  assert.equal(put.status, 200);
  assert.equal(put.body.ownerName, 'Matencio');
  assert.equal(put.body.hermesSecretIds.mac, 'sec-123');
  const badPut = await getJson(app, '/api/mc/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerName: '' }) });
  assert.equal(badPut.status, 400);

  const match = await getJson(app, '/api/mc/catalog/match?capabilities=no-existe');
  assert.equal(match.status, 200);
  assert.deepEqual(match.body, { candidates: [] });
  assert.equal((await getJson(app, '/api/mc/catalog/match')).status, 400);
  assert.equal((await getJson(app, '/api/mc/ruta-inexistente')).status, 404);
});

test('POST /missions crea, aparece en la lista, valida y respeta Idempotency-Key', async () => {
  const { app } = demoApp();
  const created = await post(app, '/api/mc/missions', missionBody({ title: 'Misión nueva A' }));
  assert.equal(created.status, 201);
  assertKeys(assert, created.body, DETAIL_KEYS);
  assert.equal(created.body.status, 'ongoing');
  assert.ok(created.body.provenance.every((p) => p.state === 'simulado'));
  const list = await getJson(app, '/api/mc/missions?q=Misión nueva A');
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].id, created.body.id);

  const k1 = await post(app, '/api/mc/missions', missionBody({ title: 'Con clave' }), { 'idempotency-key': 'abc-123' });
  const k2 = await post(app, '/api/mc/missions', missionBody({ title: 'Con clave' }), { 'idempotency-key': 'abc-123' });
  assert.equal(k1.status, 201);
  assert.equal(k2.status, 200);
  assert.equal(k2.body.id, k1.body.id);
  assert.equal(k2.headers.get('idempotent-replayed'), 'true');
  const k3 = await post(app, '/api/mc/missions', missionBody({ title: 'Otro cuerpo' }), { 'idempotency-key': 'abc-123' });
  assert.equal(k3.status, 409);
  const total = await getJson(app, '/api/mc/missions?q=Con clave');
  assert.equal(total.body.items.length, 1, 'no se duplicó');

  const bad = await post(app, '/api/mc/missions', { title: 'x' });
  assert.equal(bad.status, 400);
  const badAgent = await post(app, '/api/mc/missions', missionBody({ team: { mode: 'manual', agentIds: ['nadie'] } }));
  assert.equal(badAgent.status, 400);
});

test('Modo reglas: propone plan en briefing; aprobar arranca; rechazar exige nota', async () => {
  const { app } = demoApp();
  const rules = await post(app, '/api/mc/missions', missionBody({ title: 'Con plan', team: { mode: 'rules', agentIds: [] } }));
  assert.equal(rules.body.status, 'briefing');
  assert.equal(rules.body.approvalPending, true);
  assert.equal(rules.body.plan.status, 'pending');
  assert.equal(rules.body.plan.proposedBy.type, 'rules');
  const rej = await post(app, `/api/mc/missions/${rules.body.id}/plan/reject`, {});
  assert.equal(rej.status, 400);
  const ok = await post(app, `/api/mc/missions/${rules.body.id}/plan/approve`, { note: 'adelante' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'ongoing');
  assert.equal(ok.body.plan.status, 'approved');
  assert.ok(ok.body.timeline.some((e) => e.kind === 'plan_approved'));
  assert.equal((await post(app, `/api/mc/missions/${rules.body.id}/plan/approve`, {})).status, 409);

  const boss = await post(app, '/api/mc/missions', missionBody({ title: 'Con jefe', team: { mode: 'boss', agentIds: [], bossAgentId: 'demo-agent-coordinador' } }));
  const r2 = await post(app, `/api/mc/missions/${boss.body.id}/plan/reject`, { note: 'no me convence' });
  assert.equal(r2.body.plan.status, 'rejected');
  assert.equal(r2.body.status, 'briefing');
  assert.equal(r2.body.approvalPending, false);
});

test('Aceptar, pedir cambios, reintentar y detener cambian el estado', async () => {
  const { app } = demoApp();
  const review = (await getJson(app, '/api/mc/missions?status=review&limit=10')).body.items;
  assert.ok(review.length >= 3);
  const acc = await post(app, `/api/mc/missions/${review[0].id}/accept`, { note: 'ok' });
  assert.equal(acc.status, 200);
  assert.equal(acc.body.status, 'delivered');
  assert.ok(acc.body.completedAt);
  assert.equal((await post(app, `/api/mc/missions/${review[0].id}/accept`, {})).status, 409);

  assert.equal((await post(app, `/api/mc/missions/${review[1].id}/request-changes`, {})).status, 400);
  const ch = await post(app, `/api/mc/missions/${review[1].id}/request-changes`, { note: 'más breve' });
  assert.equal(ch.body.status, 'ongoing');

  const blocked = (await getJson(app, '/api/mc/missions?status=blocked&limit=1')).body.items[0];
  const rr = await post(app, `/api/mc/missions/${blocked.id}/rerun`, {});
  assert.equal(rr.body.status, 'ongoing');
  assert.equal(rr.body.retryCount, blocked.retryCount + 1);

  const st = await post(app, `/api/mc/missions/${review[2].id}/stop`, { note: 'ya no' });
  assert.equal(st.body.status, 'cancelled');
  assert.ok(st.body.runs.every((r) => r.status !== 'running'));
  assert.equal((await post(app, `/api/mc/missions/${review[2].id}/stop`, {})).status, 409);
});

test('Crear y archivar agentes; modo manual con varios agentes crea subtareas', async () => {
  const { app } = demoApp();
  const a = await post(app, '/api/mc/agents', { name: 'Traductor', role: 'general', platform: 'mimo', machineId: 'mac' });
  assert.equal(a.status, 201);
  assert.equal(a.body.platform, 'mimo');
  assert.equal(a.body.adapterType, 'hermes_gateway');
  assert.equal((await post(app, '/api/mc/agents', { name: 'x' })).status, 400);
  const del = await getJson(app, `/api/mc/agents/${a.body.id}`, { method: 'DELETE' });
  assert.deepEqual(del.body, { ok: true });
  assert.equal((await getJson(app, `/api/mc/agents/${a.body.id}`, { method: 'DELETE' })).status, 404);

  const m = await post(app, '/api/mc/missions', missionBody({ title: 'Equipo manual', team: { mode: 'manual', agentIds: ['demo-agent-datos', 'demo-agent-revision'] } }));
  assert.equal(m.body.children.length, 1);
  assert.equal(m.body.childCount, 1);
});

test('Documentos: crear nota propia y leerla', async () => {
  const { app } = demoApp();
  const created = await post(app, '/api/mc/docs', { title: 'Mi nota', markdown: '# Hola\n\nTexto.' });
  assert.equal(created.status, 201);
  assert.equal(created.body.source, 'mc-note');
  const got = await getJson(app, `/api/mc/docs/${created.body.id}`);
  assert.equal(got.body.markdown, '# Hola\n\nTexto.');
  assert.equal((await post(app, '/api/mc/docs', { title: '' })).status, 400);
  assert.equal((await getJson(app, '/api/mc/docs/nada')).status, 404);
});

test('SSE emite latido dentro del intervalo y reenvía eventos del backend', async () => {
  const { app, backend } = demoApp();
  const res = await app.request('/api/mc/events');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const readOnce = async () => {
    const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ done: true }), 1500))]);
    if (!done) buf += dec.decode(value);
    return !done;
  };
  assert.ok(await readOnce());
  assert.ok(buf.startsWith(': conectado'));
  const m = await post(app, '/api/mc/missions', missionBody({ title: 'Para SSE' }));
  for (let i = 0; i < 20 && !(buf.includes('event: heartbeat') && buf.includes('event: mission.changed')); i++) {
    if (!(await readOnce())) break;
  }
  await reader.cancel();
  assert.match(buf, /event: heartbeat\ndata: \{"type":"heartbeat","at":"/);
  assert.ok(buf.includes('event: mission.changed'), 'mission.changed reenviado');
  assert.ok(buf.includes(m.body.id));
  assert.ok(backend);
});

test('El ejecutor simulado avanza misiones en curso y emite eventos', async () => {
  const { app, backend } = demoApp();
  const events = [];
  backend.subscribe((e) => events.push(e));
  const m = await post(app, '/api/mc/missions', missionBody({ title: 'Avanza sola', finish: 'review_first' }));
  const before = m.body.timeline.length;
  for (let i = 0; i < 300; i++) {
    backend.tick();
    const cur = await getJson(app, `/api/mc/missions/${m.body.id}`);
    if (cur.body.status !== 'ongoing') break;
  }
  const done = await getJson(app, `/api/mc/missions/${m.body.id}`);
  assert.equal(done.body.status, 'review');
  assert.ok(done.body.timeline.length > before);
  assert.ok(done.body.result?.body);
  assert.ok(events.some((e) => e.type === 'mission.message'));
  assert.ok(events.some((e) => e.type === 'mission.changed' && e.status === 'review'));
});

test('La semilla es determinista entre instancias', async () => {
  const a = demoApp();
  const b = demoApp();
  const la = (await getJson(a.app, '/api/mc/missions?limit=200')).body.items.map((m) => [m.id, m.title, m.status, m.createdAt, m.tokens.input]);
  const lb = (await getJson(b.app, '/api/mc/missions?limit=200')).body.items.map((m) => [m.id, m.title, m.status, m.createdAt, m.tokens.input]);
  assert.deepEqual(la, lb);
});

test('Latidos: 401 sin token o con token incorrecto; 200 con token; el equipo pasa a online', async () => {
  const { app } = demoApp();
  const path = '/api/mc/machines/mac/heartbeat';
  assert.equal((await post(app, path, heartbeatBody('mac'))).status, 401);
  assert.equal((await post(app, path, heartbeatBody('mac'), { authorization: 'Bearer incorrecto' })).status, 401);
  const ok = await post(app, path, heartbeatBody('mac', { os: 'macos' }), { authorization: 'Bearer token-de-prueba-0123456789' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true, nextIntervalSec: 30 });
  const bad = await post(app, path, { ...heartbeatBody('mac'), health: {} }, { authorization: 'Bearer token-de-prueba-0123456789' });
  assert.equal(bad.status, 400);
  const mismatch = await post(app, path, heartbeatBody('win-principal'), { authorization: 'Bearer token-de-prueba-0123456789' });
  assert.equal(mismatch.status, 400);
});

test('Sin token en demo, los latidos solo se aceptan desde loopback y la salud lo dice', async () => {
  let addr = '203.0.113.9';
  const { app } = demoApp({ nodeAgentToken: undefined, getRemoteAddress: () => addr });
  const path = '/api/mc/machines/mac/heartbeat';
  assert.equal((await post(app, path, heartbeatBody('mac'))).status, 401);
  addr = '127.0.0.1';
  assert.equal((await post(app, path, heartbeatBody('mac'))).status, 200);
  const h = await getJson(app, '/api/mc/health');
  assert.ok(h.body.notes.some((n) => /loopback/.test(n.note)));
});

test('Comandos de equipo: demo simulado exige confirm', async () => {
  const { app } = demoApp();
  const list = await getJson(app, '/api/mc/machines/mac/commands');
  assert.equal(list.status, 200);
  assertKeys(assert, list.body[0], ['id', 'label', 'description', 'argv', 'requiresConfirmation', 'timeoutSec']);
  assert.equal((await post(app, '/api/mc/machines/mac/commands/hermes-status', {})).status, 400);
  const r = await post(app, '/api/mc/machines/mac/commands/hermes-status', { confirm: true });
  assert.equal(r.body.exitCode, 0);
  assert.match(r.body.stdout, /simulado/);
  assert.equal((await getJson(app, '/api/mc/machines/no-existe/commands')).status, 404);
});
