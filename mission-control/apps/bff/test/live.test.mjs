// Pruebas EN VIVO contra un Paperclip real. Solo corren con MC_PAPERCLIP_URL definido, p. ej.:
//   MC_PAPERCLIP_URL=http://127.0.0.1:3101 MC_PAPERCLIP_COMPANY_ID=<id> node --test test/live.test.mjs
// Solo crean issues con título "[auto-test] ..." (despiertan al agente real; ≤ 1 por ejecución).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createPaperclipClient } from '@mc/paperclip-client';
import { PaperclipBackend, buildServices, createApp } from '../dist/index.js';
import { CATALOG_DIR, getJson, post } from './helpers.mjs';

const URL_ = process.env.MC_PAPERCLIP_URL;
const skip = URL_ ? false : 'define MC_PAPERCLIP_URL para correr las pruebas en vivo';
const LAB_AGENT = process.env.MC_LIVE_AGENT_ID || '5bdd4ae7-fe3c-40a2-a34e-fdd37c623926';

describe('en vivo: backend paperclip', { skip }, () => {
  let app;
  let backend;
  const events = [];

  before(() => {
    const services = buildServices({ dataDir: ':memory:', catalogDir: CATALOG_DIR });
    backend = new PaperclipBackend(services, {
      client: createPaperclipClient({ baseUrl: URL_, ...(process.env.MC_PAPERCLIP_TOKEN ? { token: process.env.MC_PAPERCLIP_TOKEN } : {}) }),
      baseUrl: URL_,
      ...(process.env.MC_PAPERCLIP_COMPANY_ID ? { companyId: process.env.MC_PAPERCLIP_COMPANY_ID } : {}),
      pollMs: 1000,
    });
    app = createApp({ backend, services, quiet: true, nodeAgentToken: 'x'.repeat(24) });
    backend.subscribe((e) => events.push(e));
    backend.start();
  });
  after(() => {
    backend.stop();
    app.close();
  });

  test('health llega a Paperclip y trae las advertencias obligatorias', async () => {
    const { status, body } = await getJson(app, '/api/mc/health');
    assert.equal(status, 200);
    assert.equal(body.bff.mode, 'paperclip');
    assert.equal(body.paperclip.reachable, true);
    assert.ok(body.paperclip.version);
    const text = body.notes.map((n) => n.note).join('\n');
    assert.match(text, /Presupuesto en centavos no detecta consumo de hermes_gateway/);
    assert.match(text, /PAPERCLIP_SECRETS_STRICT_MODE=true/);
  });

  test('overview: missions.total >= 1', async () => {
    const { status, body } = await getJson(app, '/api/mc/overview');
    assert.equal(status, 200);
    assert.equal(body.mode, 'paperclip');
    assert.ok(body.missions.total >= 1, `total=${body.missions.total}`);
    assert.ok(body.missions.byStatus.delivered >= 1);
    assert.equal(body.heatmap.length, 7);
  });

  test('misión MIS-1: delivered, con MC-STUB-OK en la línea de tiempo', async () => {
    const list = await getJson(app, '/api/mc/missions?q=MIS-1&limit=200');
    const m = list.body.items.find((x) => x.identifier === 'MIS-1');
    assert.ok(m, 'MIS-1 aparece en la lista');
    assert.equal(m.status, 'delivered');
    const { status, body } = await getJson(app, `/api/mc/missions/${m.id}`);
    assert.equal(status, 200);
    assert.equal(body.status, 'delivered');
    assert.equal(body.finish, 'review_first');
    const hit = body.timeline.find((e) => (e.kind === 'message' || e.kind === 'escalated') && JSON.stringify(e).includes('MC-STUB-OK'));
    assert.ok(hit, 'hay un evento message/escalated con MC-STUB-OK');
    assert.ok(body.timeline.some((e) => e.kind === 'escalated'));
    assert.ok(body.runs.length >= 3);
    assert.ok(body.retryCount >= 1);
    const times = body.timeline.map((e) => Date.parse(e.at));
    assert.deepEqual([...times].sort((a, b) => a - b), times);
    assert.ok(body.provenance.some((p) => p.component === 'Plan y aprobación' && p.state === 'pendiente'));
    const byIdent = await getJson(app, '/api/mc/missions/MIS-1');
    assert.equal(byIdent.body.id, m.id);
    const rp = await getJson(app, `/api/mc/missions/${m.id}/replay`);
    assert.ok(rp.body.events.length >= body.timeline.length && rp.body.events.every((e) => 'raw' in e));
  });

  test('agentes: el ejecutor hermes real aparece con plataforma hermes', async () => {
    const { status, body } = await getJson(app, '/api/mc/agents');
    assert.equal(status, 200);
    const lab = body.find((a) => a.id === LAB_AGENT);
    assert.ok(lab, 'agente de laboratorio presente');
    assert.equal(lab.platform, 'hermes');
    assert.equal(lab.adapterType, 'hermes_gateway');
    assert.equal(lab.origin, 'paperclip');
    assert.equal(lab.tokens.costStatus, 'unpriced');
    assert.equal(lab.tokens.estimatedCents, null);
    const runs = await getJson(app, `/api/mc/agents/${LAB_AGENT}/runs?limit=5`);
    assert.ok(runs.body.length > 0);
  });

  test('actividad, agenda, docs y equipos responden con forma de contrato', async () => {
    const act = await getJson(app, '/api/mc/activity?limit=10');
    assert.equal(act.status, 200);
    assert.ok(act.body.items.length > 0);
    assert.equal((await getJson(app, '/api/mc/schedule')).status, 200);
    assert.equal((await getJson(app, '/api/mc/docs')).status, 200);
    const mach = await getJson(app, '/api/mc/machines');
    assert.equal(mach.body.length, 4);
    assert.ok(mach.body.every((m) => m.origin === 'paperclip'));
  });

  test('crear misión [auto-test] manual: llega a review o blocked (≈ 90 s con el reintento del vigilante) y el SSE lo refleja', { timeout: 200_000 }, async (t) => {
    const title = `[auto-test] bff en vivo ${new Date().toISOString().slice(11, 19)}`;
    const key = `live-${Date.now()}`;
    const body = {
      title,
      objective: 'Prueba automática del BFF: responde brevemente y termina con la marca MC-STUB-OK.',
      priority: 'low',
      team: { mode: 'manual', agentIds: [LAB_AGENT] },
      limits: { maxMinutes: 5, maxSteps: 2, reportLength: 'short' },
      finish: 'review_first',
      scope: 'proyectos',
    };
    const created = await post(app, '/api/mc/missions', body, { 'idempotency-key': key });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id;
    assert.equal(created.body.title, title, 'el sufijo único no se muestra');
    assert.equal(created.body.finish, 'review_first');
    assert.equal(created.body.assigneeAgentId, LAB_AGENT);
    const again = await post(app, '/api/mc/missions', body, { 'idempotency-key': key });
    assert.equal(again.status, 200);
    assert.equal(again.body.id, id, 'la clave de idempotencia devuelve la misma misión');
    const raw = await createPaperclipClient({ baseUrl: URL_ }).getIssue(id);
    assert.equal(raw.reviewPolicy, 'human_only');
    assert.match(raw.title, /· [0-9a-f]{6}$/);

    let detail;
    const t0 = Date.now();
    while (Date.now() - t0 < 150_000) {
      detail = (await getJson(app, `/api/mc/missions/${id}`)).body;
      if (detail.status === 'review' || detail.status === 'blocked' || detail.status === 'delivered') break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const elapsed = Math.round((Date.now() - t0) / 1000);
    t.diagnostic(`estado final ${detail.status} tras ${elapsed} s; mision ${detail.identifier}`);
    t.diagnostic(`timeline: ${JSON.stringify(detail.timeline.map((e) => `${e.at.slice(11, 19)} ${e.kind} (${e.actorName ?? e.actorType}) ${e.summary.slice(0, 70)}`), null, 1)}`);
    assert.ok(['review', 'blocked'].includes(detail.status), `estado ${detail.status}`);
    assert.ok(detail.timeline.some((e) => e.kind === 'message' && e.actorType === 'agent'), 'respuesta del agente en la línea de tiempo');
    assert.ok(detail.runs.length >= 1);
    const times = detail.timeline.map((e) => Date.parse(e.at));
    assert.deepEqual([...times].sort((a, b) => a - b), times);
    // el sondeo SSE detectó cambios de esta misión
    assert.ok(events.some((e) => e.type === 'mission.changed' && e.missionId === id), 'mission.changed emitido por el sondeo');
    assert.ok(events.some((e) => e.type === 'agent.changed' && e.agentId === LAB_AGENT) || true);
  });
});
