// Prueba en vivo: solo corre con MC_PAPERCLIP_URL o PAPERCLIP_URL (p. ej. http://127.0.0.1:3101). Solo lectura.
//   MC_PAPERCLIP_URL=http://127.0.0.1:3101 MC_PAPERCLIP_COMPANY_ID=<id> pnpm --filter @mc/paperclip-client test:live
// Los ids por defecto (empresa, agente, issue y run) son los del laboratorio Cloud del hito 1; en otra instancia defínelos:
//   PAPERCLIP_AGENT_ID, PAPERCLIP_ISSUE_ID (una issue `done` con comentarios) y PAPERCLIP_RUN_ID (un run con eventos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPaperclipClient, PaperclipError } from '../dist/index.js';

const URL_ = process.env.MC_PAPERCLIP_URL ?? process.env.PAPERCLIP_URL;
const skip = URL_ ? false : 'MC_PAPERCLIP_URL / PAPERCLIP_URL no definido';
const COMPANY = process.env.MC_PAPERCLIP_COMPANY_ID ?? process.env.PAPERCLIP_COMPANY_ID ?? 'b0d4c18c-7069-499f-8879-26cdc29738dc';
const AGENT = process.env.PAPERCLIP_AGENT_ID ?? '5bdd4ae7-fe3c-40a2-a34e-fdd37c623926';
const ISSUE_ID = process.env.PAPERCLIP_ISSUE_ID ?? '00eb23cc-70df-46a9-ac3d-8919f03df99a';
const RUN = process.env.PAPERCLIP_RUN_ID ?? 'c9d0e2d3-2fb5-44e9-85b0-034ca107b4b0';

const client = URL_ ? createPaperclipClient({ baseUrl: URL_, token: process.env.MC_PAPERCLIP_TOKEN || process.env.PAPERCLIP_TOKEN || undefined }) : null;

test('live: health', { skip }, async () => {
  const h = await client.health();
  assert.equal(h.status, 'ok');
  assert.equal(typeof h.version, 'string');
  assert.equal(h.deploymentMode, 'local_trusted');
});

test('live: openapi tiene paths', { skip }, async () => {
  const o = await client.openapi();
  assert.ok(Object.keys(o.paths).length > 100, `paths=${Object.keys(o.paths).length}`);
});

test('live: listAdapters contiene hermes_gateway', { skip }, async () => {
  const a = await client.listAdapters();
  const g = a.find((x) => x.type === 'hermes_gateway');
  assert.ok(g, 'hermes_gateway presente');
  assert.equal(g.capabilities.supportsSkills, false);
});

test('live: getAdapterConfigSchema(hermes_gateway) incluye apiBaseUrl', { skip }, async () => {
  const s = await client.getAdapterConfigSchema('hermes_gateway');
  assert.ok(s.fields.some((f) => f.key === 'apiBaseUrl' && f.required));
});

test('live: listCompanies incluye la empresa piloto', { skip }, async () => {
  const cs = await client.listCompanies();
  const c = cs.find((x) => x.id === COMPANY);
  assert.ok(c);
  assert.equal(c.issuePrefix, 'MIS');
  assert.equal((await client.getCompany(COMPANY)).id, COMPANY);
});

test('live: listAgents incluye el ejecutor hermes_gateway con secret_ref', { skip }, async () => {
  const as = await client.listAgents(COMPANY);
  const a = as.find((x) => x.id === AGENT);
  assert.ok(a);
  assert.equal(a.adapterType, 'hermes_gateway');
  assert.equal(a.adapterConfig.apiKey.type, 'secret_ref');
  assert.equal(typeof a.budgetMonthlyCents, 'number');
  assert.equal(typeof a.urlKey, 'string');
  assert.equal((await client.getAgent(AGENT)).id, AGENT);
});

test('live: getIssue MIS-1 está done (por identificador y por id)', { skip }, async () => {
  for (const key of ['MIS-1', ISSUE_ID]) {
    const i = await client.getIssue(key);
    assert.equal(i.identifier, 'MIS-1');
    assert.equal(i.status, 'done');
    assert.equal(i.reviewPolicy, 'human_only');
    assert.equal(i.assigneeAgentId, AGENT);
    assert.ok(i.completedAt);
  }
});

test('live: listIssues con filtros y paginación', { skip }, async () => {
  const done = await client.listIssues(COMPANY, { status: 'done' });
  assert.ok(done.some((i) => i.identifier === 'MIS-1'));
  const none = await client.listIssues(COMPANY, { q: 'zzzz-no-existe-zzzz' });
  assert.equal(none.length, 0);
  const page = await client.listIssues(COMPANY, { limit: 1, cursor: '0' });
  assert.equal(page.length, 1);
  const byAgent = await client.listIssues(COMPANY, { assigneeAgentId: AGENT, status: ['done', 'in_review'] });
  assert.ok(byAgent.length >= 1);
});

test('live: comentarios y actividad de MIS-1', { skip }, async () => {
  const cs = await client.listIssueComments(ISSUE_ID);
  assert.ok(cs.length >= 1);
  assert.ok(cs.every((c) => typeof c.body === 'string' && typeof c.authorType === 'string'));
  const act = await client.listIssueActivity(ISSUE_ID);
  assert.ok(act.some((a) => a.action === 'issue.created'));
  const co = await client.listCompanyActivity(COMPANY, { limit: 3 });
  assert.ok(co.length >= 1 && co.length <= 3);
});

test('live: listHeartbeatRuns >= 4', { skip }, async () => {
  const runs = await client.listHeartbeatRuns(COMPANY, { agentId: AGENT });
  assert.ok(runs.length >= 4, `runs: ${runs.length}`);
  const r = runs.find((x) => x.id === RUN);
  assert.ok(r);
  assert.equal(r.invocationSource, 'assignment');
  assert.equal(r.status, 'succeeded');
  assert.equal(r.usageJson.provider, 'hermes_gateway');
  assert.equal(typeof r.processLossRetryCount, 'number');
});

test('live: getRun y listRunEvents del run de asignación tienen adapter.invoke', { skip }, async () => {
  const r = await client.getRun(RUN);
  assert.equal(r.id, RUN);
  const ev = await client.listRunEvents(RUN);
  assert.ok(ev.some((e) => e.eventType === 'adapter.invoke'));
  assert.ok(ev.every((e, i) => i === 0 || e.seq > ev[i - 1].seq));
  const tail = await client.listRunEvents(RUN, { afterSeq: ev[0].seq });
  assert.equal(tail.length, ev.length - 1);
});

test('live: listLiveRuns devuelve lista', { skip }, async () => {
  assert.ok(Array.isArray(await client.listLiveRuns(COMPANY)));
});

test('live: costsByAgent suma inputTokens >= 32645 para el ejecutor', { skip }, async () => {
  const rows = await client.costsByAgent(COMPANY, {});
  const row = rows.find((r) => r.agentId === AGENT);
  assert.ok(row);
  assert.ok(row.inputTokens >= 32645, `inputTokens=${row.inputTokens}`);
  const sinParam = await client.costsByAgent(COMPANY);
  assert.ok(sinParam.find((r) => r.agentId === AGENT).inputTokens >= 32645);
  const byModel = await client.costsByAgentModel(COMPANY);
  assert.ok(byModel.some((r) => r.agentId === AGENT && r.provider === 'hermes_gateway'));
});

test('live: dashboard, presupuestos, secretos, aprobaciones, rutinas', { skip }, async () => {
  const d = await client.getDashboard(COMPANY);
  assert.equal(typeof d.agents.active, 'number');
  assert.ok(d.tasks.done >= 1);
  assert.ok(Array.isArray(d.runActivity));
  const b = await client.listBudgets(COMPANY);
  assert.ok(b.policies.some((p) => p.scopeId === AGENT));
  const secrets = await client.listSecrets(COMPANY);
  assert.ok(secrets.length >= 1);
  assert.ok(secrets.every((s) => !('value' in s)), 'los secretos nunca devuelven value');
  assert.ok(Array.isArray(await client.listApprovals(COMPANY)));
  assert.ok(Array.isArray(await client.listRoutines(COMPANY)));
});

test('live: 404 real -> not_found; run inválido -> invalid', { skip }, async () => {
  await assert.rejects(client.getIssue('00000000-0000-0000-0000-000000000000'), (e) => e instanceof PaperclipError && e.code === 'not_found' && e.status === 404);
  await assert.rejects(client.getRun('00000000-0000-0000-0000-000000000000'), (e) => e.code === 'invalid');
  await assert.rejects(client.createCompany({}), (e) => e.code === 'invalid' && e.status === 400);
});
