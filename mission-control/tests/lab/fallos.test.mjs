// Pruebas de fallos del adaptador REAL hermes_gateway de Paperclip contra el MOCK de Hermes (@mc/hermes-mock).
// Se omite limpiamente si falta MC_PAPERCLIP_URL. Variables:
//   MC_PAPERCLIP_URL (obligatoria)  MC_PAPERCLIP_COMPANY_ID (obligatoria)  MC_PAPERCLIP_TOKEN (opcional)
//   MC_MOCK_PORT (def. 18642)  MC_FALLOS_REPORT (def. <repo>/docs/evidencias/fallos-adaptador-mock.md)
//   MC_FALLOS_ONLY (lista de escenarios, p. ej. "2,3")
// Todo objeto creado en Paperclip lleva el prefijo "[auto-test fallos]" y los agentes se pausan al terminar.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPaperclip, generateMockKey, redactSecret, sleep, utc, secondsBetween, OBJECT_PREFIX,
} from '../lib/paperclip.mjs';
import {
  loadMock, postRuns, eventGets, stops, statusGets, summarizeRequests, histogram,
} from '../lib/mock.mjs';
import { renderReport } from '../lib/report.mjs';

const PAPERCLIP_URL = process.env.MC_PAPERCLIP_URL;
const COMPANY_ID = process.env.MC_PAPERCLIP_COMPANY_ID;
const MOCK_PORT = Number(process.env.MC_MOCK_PORT || 18642);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = process.env.MC_FALLOS_REPORT || path.resolve(HERE, '../../docs/evidencias/fallos-adaptador-mock.md');
const RUNTIME_DIR = path.join(HERE, '.runtime');
const ONLY = (process.env.MC_FALLOS_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const wanted = (id) => ONLY.length === 0 || ONLY.includes(String(id));
const MARK = 'MC-MOCK-OK';

const skipReason = !PAPERCLIP_URL ? 'MC_PAPERCLIP_URL no definida (prueba de laboratorio)' : (!COMPANY_ID ? 'MC_PAPERCLIP_COMPANY_ID no definida' : false);

describe('Fallos del adaptador hermes_gateway (Paperclip real + mock de Hermes)', { skip: skipReason, concurrency: false }, () => {
  const rows = [];
  const created = { agents: [], issues: [], secrets: [] };
  const mockKey = generateMockKey();
  let pc; let startHermesMock; let health; let secretId;
  const holder = { mock: null, history: [] };
  const clean = (v) => JSON.parse(redactSecret(JSON.stringify(v), mockKey));

  /* ------------------------------ utilidades de mock ------------------------------ */
  const allRequests = () => [...holder.history, ...(holder.mock ? holder.mock.requests : [])];
  async function closeMock() {
    if (!holder.mock) return;
    holder.history.push(...holder.mock.requests);
    holder.lastClosedRuns = new Map(holder.mock.runs);
    const m = holder.mock; holder.mock = null;
    await m.close();
  }
  async function useMock(opts = {}) {
    await closeMock();
    holder.mock = await startHermesMock({ port: MOCK_PORT, apiKey: mockKey, completeDelayMs: 800, ...opts });
    return holder.mock;
  }
  const allMockRuns = () => holder.mock ? [...holder.mock.runs.values()] : [];
  const mockRunForPcRun = (pcRunId) => allMockRuns().find((r) => r.idempotencyKey === pcRunId);

  /* ----------------------------- utilidades de Paperclip ----------------------------- */
  async function newAgent(tag, { timeoutSec = 60, eventReconnectMs = 500 } = {}) {
    const a = await pc.createAgent({ name: `esc${tag} ${Date.now().toString(36)}`, apiBaseUrl: `http://127.0.0.1:${MOCK_PORT}`, secretId, timeoutSec, eventReconnectMs });
    created.agents.push(a.id);
    return a;
  }
  async function newIssue(tag, agentId, extra = '') {
    const i = await pc.createIssue({ title: `esc${tag} ${Date.now().toString(36)}`, description: `Prueba de fallos ${tag}. Responde con la marca ${MARK}. ${extra}`, agentId });
    created.issues.push(i.id);
    return i;
  }
  async function finish(agent, issue) {
    try { await pc.pauseAgent(agent.id); } catch (e) { /* se reintenta en after() */ }
    if (issue) { try { await pc.cancelIssue(issue.id); } catch { /* ya cerrada */ } }
  }
  const usageOf = (r) => r.usageJson ? { inputTokens: r.usageJson.inputTokens ?? null, outputTokens: r.usageJson.outputTokens ?? null, costStatus: r.usageJson.costStatus ?? null, model: r.usageJson.model ?? null } : null;
  const runInfo = (r) => ({
    id: r.id, source: r.invocationSource, status: r.status, errorCode: r.errorCode ?? null,
    error: r.error ? String(r.error).slice(0, 200) : null,
    createdAt: r.createdAt, startedAt: r.startedAt, finishedAt: r.finishedAt,
    seconds: secondsBetween(r.startedAt, r.finishedAt), exitCode: r.exitCode ?? null,
    retryOfRunId: r.retryOfRunId ?? null, scheduledRetryReason: r.scheduledRetryReason ?? null,
    scheduledRetryAttempt: r.scheduledRetryAttempt ?? 0, scheduledRetryAt: r.scheduledRetryAt ?? null,
    livenessState: r.livenessState ?? null, contextIssueId: r.contextSnapshot?.issueId ?? null, usage: usageOf(r),
  });
  const logExcerpt = (ndjson, max = 30) => {
    const out = [];
    for (const line of String(ndjson).split('\n')) {
      if (!line.trim()) continue;
      let chunk = line;
      try { const j = JSON.parse(line); chunk = `${j.stream ?? ''}: ${j.chunk ?? line}`; } catch { /* texto plano */ }
      chunk = redactSecret(chunk, mockKey).replace(/\s+$/, '');
      if (/hermes-gateway|event stream|disconnect|reconnect|timed out|timeout|stop|error|fail|status|retry/i.test(chunk)) out.push(chunk.slice(0, 300));
      if (out.length >= max) break;
    }
    return out;
  };
  const eventBrief = (events) => events.map((e) => ({ seq: e.seq, type: e.eventType ?? e.type, message: e.message ? String(e.message).slice(0, 160) : undefined }));
  async function detailRun(r) {
    const fresh = (await pc.getRun(r.id)) ?? r;
    const events = await pc.runEvents(r.id).catch(() => []);
    const log = await pc.runLog(r.id).catch(() => '');
    return { info: runInfo(fresh), events: eventBrief(events), log: logExcerpt(log) };
  }
  /** Espera al menos `secs` s (desde ahora) y devuelve los runs del agente. */
  async function observeFor(agentId, secs, label) {
    await sleep(secs * 1000);
    return { label, runs: await pc.listRuns(agentId) };
  }
  const cap = (arr, n = 40) => (arr.length > n ? [...arr.slice(0, n), { omitidas: arr.length - n }] : arr);
  /** Rastro de una tarea: estado, actividad (compacta) y comentarios; sirve para ver qué hizo Paperclip tras el fallo. */
  async function trail(issueId) {
    const issue = await pc.getIssue(issueId);
    const act = (await pc.activity(issueId)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const d = (x) => { const o = {}; for (const k of ['outcome', 'replay', 'maxAttempts', 'attemptCount', 'terminalReason', 'status']) if (x?.[k] !== undefined) o[k] = x[k]; return Object.keys(o).length ? o : undefined; };
    const comments = (await pc.comments(issueId)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return {
      status: issue.status, assigneeAgentId: issue.assigneeAgentId,
      activity: act.map((a) => ({ at: a.createdAt, action: a.action, actor: a.actorType, ...(d(a.details) ? { details: d(a.details) } : {}) })),
      comments: comments.map((c) => ({ at: c.createdAt, authorType: c.authorType, body: String(c.body).slice(0, 200) })),
    };
  }
  const bySource = (runs) => runs.reduce((a, r) => { a[r.invocationSource] = (a[r.invocationSource] ?? 0) + 1; return a; }, {});

  /** Ejecuta un escenario y registra su fila (también si falla una aserción). */
  async function scenario(id, titulo, configuracion, fn) {
    const rec = { id, titulo, configuracion, resultado: '', veredicto: 'no cubre', significado: '', inicioUtc: utc(), finUtc: '', segundos: null, raw: {}, notas: [] };
    const base = allRequests().length;
    const t0 = Date.now();
    rec.requestsFrom = base;
    try {
      await fn(rec);
    } catch (e) {
      rec.resultado = `${rec.resultado} [ASERCIÓN FALLÓ: ${String(e.message).slice(0, 300)}]`.trim();
      rec.veredicto = 'no cubre';
      throw e;
    } finally {
      rec.finUtc = utc();
      rec.segundos = Math.round((Date.now() - t0) / 100) / 10;
      delete rec.requestsFrom;
      rows.push(clean(rec));
    }
  }
  /** Peticiones al mock durante el escenario (las de instancias anteriores incluidas) y recuentos. */
  function mockWindow(rec) {
    const reqs = allRequests().slice(rec.requestsFrom);
    return {
      reqs, posts: postRuns(reqs).length, eventGets: eventGets(reqs).length, stops: stops(reqs).length, statusGets: statusGets(reqs).length,
      summary: summarizeRequests(reqs), histogram: histogram(reqs),
    };
  }

  before(async () => {
    ({ startHermesMock } = await loadMock());
    pc = createPaperclip({ baseUrl: PAPERCLIP_URL, companyId: COMPANY_ID, token: process.env.MC_PAPERCLIP_TOKEN });
    health = await pc.health();
    assert.equal(health.status, 'ok');
    const sec = await pc.createSecret(`HERMES_MOCK_KEY ${Date.now().toString(36)}`, mockKey);
    secretId = sec.id;
    created.secrets.push(sec.id);
    assert.ok(!JSON.stringify(sec).includes(mockKey), 'el secreto no devuelve su valor');
    await useMock();
    const probe = await fetch(`${holder.mock.url}/health`);
    assert.equal(probe.status, 200);
  });

  after(async () => {
    for (const id of created.agents) { try { await pc.pauseAgent(id); } catch { /* ya pausado */ } }
    for (const id of created.issues) {
      try { const i = await pc.getIssue(id); if (!['done', 'cancelled'].includes(i.status)) await pc.cancelIssue(id); } catch { /* ignorar */ }
    }
    await closeMock();
    if (!rows.length) return;
    rows.sort((a, b) => a.id - b.id);
    let adapterVersion = 'desconocida';
    try {
      const root = '/home/mc/.npm/_npx';
      for (const d of fs.readdirSync(root)) {
        const f = path.join(root, d, 'node_modules/@paperclipai/hermes-paperclip-adapter/package.json');
        if (fs.existsSync(f)) { adapterVersion = JSON.parse(fs.readFileSync(f, 'utf8')).version; break; }
      }
    } catch { /* sin acceso al caché de npx */ }
    const env = {
      Paperclip: `\`paperclipai@${health?.version}\` (commit ${String(health?.commit || '').slice(0, 8)}) en ${PAPERCLIP_URL}, ${health?.deploymentMode}/${health?.deploymentExposure}`,
      'Adaptador': `\`@paperclipai/hermes-paperclip-adapter\` ${adapterVersion} (tipo \`hermes_gateway\`)`,
      'Mock de Hermes': `\`@mc/hermes-mock\` 0.1.0 en http://127.0.0.1:${MOCK_PORT} (clave generada en tiempo de ejecución, guardada como secreto de Paperclip; nunca escrita aquí)`,
      Empresa: `\`${COMPANY_ID}\` (objetos con prefijo "${OBJECT_PREFIX}")`,
      Node: process.version,
      'Fecha de ejecución (UTC)': utc(),
      'Agentes creados': `${created.agents.length} (todos pausados al terminar)`,
      'Escenarios registrados': rows.map((r) => r.id).join(', '),
    };
    const noDemuestra = [
      '**Mock ≠ Hermes real.** El mock imita el contrato HTTP (cabeceras, SSE, idempotencia, códigos de error) leído del clon `a28a5d03`; no ejecuta modelo ni herramientas, no persiste sesiones y su "tokens" es `ceil(caracteres/4)`. Un Hermes real puede fallar de maneras que el mock no modela (reinicio con sesiones SQLite, eventos retirados tras un tiempo, límites propios del modelo, SSE con proxys intermedios).',
      '**Un solo equipo.** Paperclip, el mock y las pruebas corren en el mismo contenedor por loopback; no hay latencia real, pérdida de paquetes ni particiones de red entre PCs (Tailscale). El corte del SSE se simula cerrando el socket, no con una red inestable.',
      '**Sin HTTPS.** Todo va por HTTP en 127.0.0.1 (el adaptador lo permite en loopback). El camino HTTPS/certificados hacia un Hermes remoto no se ha ejercitado.',
      '**Un solo build.** Resultados válidos para `paperclipai@2026.1005.0`; el código de recuperación del clon (HEAD 2026-10-07) difiere (umbrales de silencio, política de presupuesto sin precio) y no se ha probado.',
      '**Agente que sí ejecuta herramientas.** El mock nunca llama a la API de Paperclip para cambiar el estado de la tarea, por lo que la "reparación de disposición" (2 runs extra y bloqueo) aparece siempre tras un éxito; un Hermes real con instrucciones correctas debería evitarla, pero eso no se ha comprobado aquí.',
      '**Escala y duración.** Pocas tareas, ventanas de observación de 60–90 s: no se prueba la deriva a largo plazo, reintentos tras horas ni cargas concurrentes reales; los umbrales de 30 s/60 s de Paperclip se observaron solo dentro de esas ventanas.',
      '**Reinicio de Paperclip.** Se simuló el reinicio del *ejecutor* (mock), no el del servidor Paperclip (no se toca el Paperclip vivo); el comportamiento `process_lost` del reaper sigue siendo una inferencia del código.',
      '**Coste.** Los tokens del mock se registran en `usageJson`, pero `costStatus` queda `unpriced` y el coste en centavos es 0: la contabilidad en dinero no se demuestra.',
    ];
    const md = renderReport({ env, rows, generatedUtc: utc(), noDemuestra });
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, md);
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(path.join(RUNTIME_DIR, `fallos-${utc().replace(/[:.]/g, '-')}.json`), JSON.stringify({ env, rows }, null, 2));
    console.log(`Informe: ${REPORT_PATH}`);
  });

  /* =========================================================================================== */
  /* 1. Camino feliz                                                                              */
  /* =========================================================================================== */
  it('1. Camino feliz contra el mock', { timeout: 420_000, skip: !wanted(1) }, async () => {
    await scenario(1, 'Camino feliz', 'sin fallos; completeDelayMs 1500; timeoutSec 60; reviewPolicy human_only', async (rec) => {
      await useMock({ completeDelayMs: 1500 });
      const agent = await newAgent(1, { timeoutSec: 60 });
      const issue = await newIssue(1, agent.id);
      const t0 = Date.now();
      const run = await pc.waitFor(agent.id, (rs) => rs.find((r) => r.invocationSource === 'assignment' && pc.isTerminal(r)), { timeoutMs: 90_000, label: 'run de asignación terminal' });
      const secsToResult = Math.round((Date.now() - t0) / 100) / 10;
      assert.equal(run.status, 'succeeded');
      assert.equal(run.invocationSource, 'assignment');

      // Resultado en comentario
      let comment;
      for (let i = 0; i < 30 && !comment; i++) {
        comment = (await pc.comments(issue.id)).find((c) => c.authorType === 'agent' && String(c.body).includes(MARK));
        if (!comment) await sleep(1000);
      }
      assert.ok(comment, `comentario del agente con ${MARK}`);

      // Lo que vio el mock: Idempotency-Key = id del run de Paperclip y X-Hermes-Session-Key presente
      const post = allRequests().slice(rec.requestsFrom).find((r) => r.method === 'POST' && r.path === '/v1/runs' && r.headers['idempotency-key'] === run.id);
      assert.ok(post, 'POST /v1/runs con Idempotency-Key = id del run de Paperclip');
      assert.ok(post.headers['x-hermes-session-key'], 'X-Hermes-Session-Key presente');
      assert.equal(post.status, 202);
      const mrun = mockRunForPcRun(run.id);
      assert.ok(mrun?.usage, 'el mock registró consumo');
      assert.equal(run.usageJson?.inputTokens, mrun.usage.input_tokens, 'tokens de entrada del mock == usageJson');
      assert.equal(run.usageJson?.outputTokens, mrun.usage.output_tokens, 'tokens de salida del mock == usageJson');

      // Reparación de disposición: 2 runs de automatización y bloqueo
      let blocked;
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline) {
        const cur = await pc.getIssue(issue.id);
        if (cur.status === 'blocked') { blocked = cur; break; }
        await sleep(3000);
      }
      assert.ok(blocked, 'la tarea llegó a blocked');
      const runs = await pc.listRuns(agent.id);
      const automation = runs.filter((r) => r.invocationSource === 'automation');
      assert.equal(automation.length, 2, 'dos runs de reparación de disposición');
      const act = await pc.activity(issue.id);
      const esc = act.find((a) => a.action === 'issue.disposition_repair_escalated');
      assert.ok(esc, 'actividad issue.disposition_repair_escalated');
      assert.equal(esc.details.maxAttempts, 2);
      assert.equal(esc.details.attemptCount, 2);
      const sys = (await pc.comments(issue.id)).find((c) => c.authorType === 'system');
      assert.match(sys?.body ?? '', /exhausted the bounded original-owner disposition repair/);

      // Cierre como operador
      const inReview = await pc.patchIssue(issue.id, { status: 'in_review', comment: `${OBJECT_PREFIX} operador: resultado recibido, paso a revisión.` });
      assert.equal(inReview.status, 'in_review');
      const done = await pc.patchIssue(issue.id, { status: 'done', comment: `${OBJECT_PREFIX} operador: revisado y aceptado.` });
      assert.equal(done.status, 'done');
      const costs = (await pc.costsByAgent()).find((c) => c.agentId === agent.id);

      const win = mockWindow(rec);
      const keys = postRuns(win.reqs).map((r) => r.headers['idempotency-key']);
      assert.deepEqual([...keys].sort(), runs.map((r) => r.id).sort(), 'una Idempotency-Key distinta por run, igual al id del run de Paperclip');
      rec.resultado = `assignment ${run.status} en ${secsToResult} s; comentario ${MARK}; ${runs.length} runs (1 assignment + ${automation.length} automation); issue blocked → in_review → done; ${win.posts} POST /v1/runs (claves = ids de run), tokens in/out ${run.usageJson.inputTokens}/${run.usageJson.outputTokens} (== mock); costStatus ${run.usageJson.costStatus}`;
      rec.veredicto = 'cubre';
      rec.significado = 'El circuito solicitud → ejecución → resultado → revisión humana funciona de punta a punta contra el adaptador real, y el consumo (tokens) queda registrado por run. Con un ejecutor que no cambia el estado, cada tarea cuesta 2 runs extra y acaba en blocked: MC debe obligar a que el ejecutor registre la disposición.';
      rec.raw = {
        agentId: agent.id, issue: { id: issue.id, identifier: issue.identifier, finalStatus: done.status },
        runs: runs.map(runInfo), assignmentRunDetail: await detailRun(run),
        mockPost: { headers: post.headers, status: post.status, bodyKeys: Object.keys(post.body ?? {}) },
        mockUsage: mrun.usage, escalation: esc.details, systemComment: sys.body.slice(0, 400),
        costsByAgent: costs ?? null, mockHistogram: win.histogram,
      };
      await finish(agent, null);
    });
  });

  /* =========================================================================================== */
  /* 2. Corte del SSE                                                                             */
  /* =========================================================================================== */
  it('2. Corte del SSE', { timeout: 180_000, skip: !wanted(2) }, async () => {
    await scenario(2, 'Corte del SSE', 'dropSseAfterEvents: 2; completeDelayMs 4000; eventReconnectMs 500', async (rec) => {
      const mock = await useMock({ completeDelayMs: 4000, faults: { dropSseAfterEvents: 2 } });
      const agent = await newAgent(2, { timeoutSec: 60, eventReconnectMs: 500 });
      const issue = await newIssue(2, agent.id);
      const run = await pc.waitFor(agent.id, (rs) => rs.find((r) => r.invocationSource === 'assignment' && pc.isTerminal(r)), { timeoutMs: 90_000, label: 'run terminal' });
      const win = mockWindow(rec);
      const gets = eventGets(win.reqs);
      const detail = await detailRun(run);
      assert.equal(run.status, 'succeeded');
      assert.ok(gets.length >= 2, `≥2 GET /events (hubo ${gets.length})`);
      assert.equal(mock.getFaults().dropSseAfterEvents, undefined, 'el corte se consumió');
      const withLast = gets.filter((g) => g.headers['last-event-id']).length;
      const logHit = detail.log.filter((l) => /disconnect|reconnect/i.test(l));
      rec.resultado = `run ${run.status} (${secondsBetween(run.startedAt, run.finishedAt)} s), errorCode ${run.errorCode ?? '-'}; ${gets.length} GET /events (${withLast} con Last-Event-ID), ${win.statusGets} GET /v1/runs/{id} (sondeo), ${win.posts} POST /v1/runs; log: ${logHit.length ? `"${logHit[0].slice(0, 100)}"` : 'sin línea de desconexión visible'}; tokens ${run.usageJson?.inputTokens}/${run.usageJson?.outputTokens}`;
      rec.veredicto = 'cubre';
      rec.significado = 'Un corte de la conexión de eventos NO pierde el resultado ni duplica el run: el adaptador reconecta solo (y además sondea el estado), por lo que MC no necesita lógica propia para cortes breves de red. No hay Last-Event-ID: la reconexión repite los eventos.';
      rec.notas.push(`Peticiones de eventos: ${JSON.stringify(summarizeRequests(gets))}`);
      rec.raw = { run: detail, mockHistogram: win.histogram, mockRequests: cap(win.summary), logLinesWithDisconnect: logHit };
      await finish(agent, issue);
    });
  });

  /* =========================================================================================== */
  /* 3. Ejecutor colgado / timeout                                                                */
  /* =========================================================================================== */
  it('3. Ejecutor colgado → timeout', { timeout: 240_000, skip: !wanted(3) }, async () => {
    await scenario(3, 'Ejecutor colgado / timeout', 'hangNextRun: true; timeoutSec 15; eventReconnectMs 500', async (rec) => {
      await useMock({ completeDelayMs: 800, faults: { hangNextRun: true } });
      const agent = await newAgent(3, { timeoutSec: 15, eventReconnectMs: 500 });
      const t0 = Date.now();
      const issue = await newIssue(3, agent.id);
      const run = await pc.waitFor(agent.id, (rs) => rs.find((r) => r.invocationSource === 'assignment' && pc.isTerminal(r)), { timeoutMs: 120_000, label: 'run terminal' });
      const wall = Math.round((Date.now() - t0) / 100) / 10;
      const win = mockWindow(rec);
      const detail = await detailRun(run);
      assert.notEqual(run.status, 'succeeded');
      assert.ok(win.stops >= 1, 'el adaptador llamó POST /v1/runs/{id}/stop');
      const after = await observeFor(agent.id, 45, 'tras timeout');
      const win2 = mockWindow(rec);
      const mrun = mockRunForPcRun(run.id);
      const tr3 = await trail(issue.id);
      rec.resultado = `run ${run.status}, errorCode ${run.errorCode ?? '-'}, ${secondsBetween(run.startedAt, run.finishedAt)} s en Paperclip (${wall} s desde crear la tarea); ${win.stops} POST /stop; estado final del run en el mock: ${mrun?.status}; tras 45 s más: ${after.runs.length} runs (${JSON.stringify(bySource(after.runs))}), ${win2.posts} POST /v1/runs; tokens ${run.usageJson ? `${run.usageJson.inputTokens}/${run.usageJson.outputTokens}` : 'sin usageJson'}; issue ${tr3.status}`;
      const exact = run.status === 'timed_out';
      rec.veredicto = exact ? 'cubre' : 'parcial';
      rec.significado = exact
        ? 'Un ejecutor colgado no deja el run abierto indefinidamente: a los timeoutSec Paperclip pide stop al ejecutor y cierra el run como timed_out (el build vivo guarda errorCode `timeout`; el código `hermes_gateway_timeout` del adaptador no llega al campo errorCode del run). MC debe fijar un timeoutSec realista por tipo de tarea; no existe otro corte por silencio (umbral del build vivo: 60 min).'
        : `Comportamiento distinto al esperado (status ${run.status}, errorCode ${run.errorCode}); revisar.`;
      rec.raw = { run: detail, afterTimeoutRuns: after.runs.map(runInfo), issueTrail: tr3, resultJson: run.resultJson ?? null, mockRunState: mrun ? { status: mrun.status, lastEvent: mrun.lastEvent, events: mrun.events.length } : null, mockHistogram: win2.histogram, mockRequests: cap(win2.summary) };
      await finish(agent, issue);
    });
  });

  /* =========================================================================================== */
  /* 4. Fallo del run                                                                             */
  /* =========================================================================================== */
  it('4. Fallo del run', { timeout: 300_000, skip: !wanted(4) }, async () => {
    await scenario(4, 'Fallo del run', 'failNextRun: true; ventana de observación 90 s', async (rec) => {
      await useMock({ completeDelayMs: 800, faults: { failNextRun: true } });
      const agent = await newAgent(4, { timeoutSec: 60 });
      const issue = await newIssue(4, agent.id);
      const first = await pc.waitFor(agent.id, (rs) => rs.find((r) => r.invocationSource === 'assignment' && pc.isTerminal(r)), { timeoutMs: 90_000, label: 'primer run terminal' });
      const seen = await observeFor(agent.id, 90, 'ventana 90 s');
      const tr4 = await trail(issue.id);
      const issueNow = { status: tr4.status, assigneeAgentId: tr4.assigneeAgentId };
      const win = mockWindow(rec);
      const detail = await detailRun(first);
      assert.equal(first.status, 'failed');
      assert.equal(issueNow.assigneeAgentId, agent.id, 'la tarea sigue asignada al mismo agente');
      const retries = seen.runs.filter((r) => r.id !== first.id);
      rec.resultado = `primer run ${first.status}, errorCode ${first.errorCode ?? '-'}; en 90 s: ${seen.runs.length} runs ${JSON.stringify(bySource(seen.runs))} (${retries.map((r) => `${r.invocationSource}/${r.status}/${r.scheduledRetryReason ?? '-'}`).join(', ') || 'sin reintentos'}); ${win.posts} POST /v1/runs; issue ${issueNow.status} (${tr4.activity.filter((a) => a.action === 'issue.execution_recovery_settled').map((a) => `${a.action} ${JSON.stringify(a.details)} +${secondsBetween(first.finishedAt, a.at)} s`).join('; ') || 'sin acción de recuperación'}), asignada=${issueNow.assigneeAgentId === agent.id}; comentarios del agente pese al fallo: ${tr4.comments.filter((c) => c.authorType === 'agent').length}`;
      const noAuto = retries.length === 0;
      rec.veredicto = 'cubre';
      rec.significado = noAuto
        ? 'Un fallo del ejecutor queda visible (failed + hermes_gateway_run_failed) y NO provoca reintento automático ni tormenta: Paperclip deja la tarea con su dueño pero en blocked (acción de recuperación a cargo del board, a los pocos segundos). Ojo: el texto parcial que el ejecutor llegó a emitir se publica igualmente como comentario del agente aunque el run falló. MC debe vigilar runs failed/blocked y decidir (reintentar, reasignar o escalar al humano), y no tomar un comentario del agente como prueba de éxito.'
        : `Paperclip generó ${retries.length} run(s) adicionales tras el fallo (${retries.map((r) => r.scheduledRetryReason ?? r.invocationSource).join(', ')}): hay reintentos/recuperación automáticos acotados; MC debe contarlos y respetar su propio tope.`;
      rec.raw = { firstRun: detail, runsIn90s: seen.runs.map(runInfo), issueTrail: tr4, mockRunError: mockRunForPcRun(first.id)?.error, mockHistogram: win.histogram, mockRequests: cap(win.summary) };
      await finish(agent, issue);
    });
  });

  /* =========================================================================================== */
  /* 5. Clave rechazada                                                                           */
  /* =========================================================================================== */
  it('5. Clave rechazada (401)', { timeout: 240_000, skip: !wanted(5) }, async () => {
    await scenario(5, 'Clave rechazada', 'unauthorizedNext: true; ventana de observación 60 s', async (rec) => {
      await useMock({ completeDelayMs: 800, faults: { unauthorizedNext: true } });
      const agent = await newAgent(5, { timeoutSec: 60 });
      const issue = await newIssue(5, agent.id);
      const first = await pc.waitFor(agent.id, (rs) => rs.find((r) => r.invocationSource === 'assignment' && pc.isTerminal(r)), { timeoutMs: 90_000, label: 'primer run terminal' });
      const seen = await observeFor(agent.id, 60, 'ventana 60 s');
      const win = mockWindow(rec);
      const detail = await detailRun(first);
      assert.equal(first.status, 'failed');
      assert.match(first.errorCode ?? '', /auth/);
      const retries = seen.runs.filter((r) => r.id !== first.id);
      const first401 = win.reqs.filter((r) => r.status === 401).length;
      const tr5 = await trail(issue.id);
      rec.resultado = `primer run ${first.status}, errorCode ${first.errorCode}; error: "${String(first.error).slice(0, 110)}"; en 60 s: ${seen.runs.length} runs ${JSON.stringify(bySource(seen.runs))}; ${win.posts} POST /v1/runs (${first401} con 401); issue ${tr5.status} (${tr5.activity.filter((a) => a.action === 'issue.execution_recovery_settled').map((a) => `${a.action} ${JSON.stringify(a.details)} +${secondsBetween(first.finishedAt, a.at)} s`).join('; ') || 'sin acción de recuperación'})`;
      rec.veredicto = retries.length === 0 ? 'cubre' : 'parcial';
      rec.significado = retries.length === 0
        ? 'Una clave rechazada se reporta con un código específico (hermes_gateway_auth_failed) y no se reintenta: no hay tormenta de reintentos, y la tarea pasa a blocked para el board. MC puede distinguir "clave mala" de "ejecutor caído" por el errorCode y avisar al operador para rotar la clave.'
        : `Tras el 401 hubo ${retries.length} run(s) adicionales (${retries.map((r) => r.invocationSource).join(', ')}); en el mock la falla era de una sola vez, así que estos runs sí llegaron. MC debe tratar el errorCode de auth como no reintentable.`;
      rec.raw = { firstRun: detail, runsIn60s: seen.runs.map(runInfo), issueTrail: tr5, mockHistogram: win.histogram, mockRequests: cap(win.summary) };
      await finish(agent, issue);
    });
  });

  /* =========================================================================================== */
  /* 6. Límite de concurrencia / 429                                                              */
  /* =========================================================================================== */
  it('6. Límite de concurrencia (429)', { timeout: 300_000, skip: !wanted(6) }, async () => {
    await scenario(6, 'Límite de concurrencia', 'rateLimitNext: true (429 + Retry-After: 1); ventana de observación 90 s', async (rec) => {
      await useMock({ completeDelayMs: 800, faults: { rateLimitNext: true } });
      const agent = await newAgent(6, { timeoutSec: 60 });
      const issue = await newIssue(6, agent.id);
      const first = await pc.waitFor(agent.id, (rs) => rs.find((r) => r.invocationSource === 'assignment' && pc.isTerminal(r)), { timeoutMs: 90_000, label: 'primer run terminal' });
      const seen = await observeFor(agent.id, 90, 'ventana 90 s');
      const win = mockWindow(rec);
      const detail = await detailRun(first);
      assert.notEqual(first.status, 'succeeded');
      const others = seen.runs.filter((r) => r.id !== first.id);
      const retryRuns = seen.runs.filter((r) => r.scheduledRetryReason || r.retryOfRunId);
      const okAfter = seen.runs.some((r) => r.status === 'succeeded');
      const tr6 = await trail(issue.id);
      const issueNow = { status: tr6.status };
      rec.resultado = `primer run ${first.status}, errorCode ${first.errorCode ?? '-'} (${first.error ? String(first.error).slice(0, 90) : 'sin error'}); en 90 s: ${seen.runs.length} runs ${JSON.stringify(bySource(seen.runs))}, reintentos programados: ${retryRuns.length} (${retryRuns.map((r) => `${r.scheduledRetryReason ?? '-'}#${r.scheduledRetryAttempt}→${r.status}`).join(', ') || 'ninguno'}); ${win.posts} POST /v1/runs (${win.reqs.filter((r) => r.status === 429).length} con 429); algún run succeeded: ${okAfter}; issue ${issueNow.status} (${tr6.activity.filter((a) => a.action === 'issue.execution_recovery_settled').map((a) => `${a.action} ${JSON.stringify(a.details)} +${secondsBetween(first.finishedAt, a.at)} s`).join('; ') || 'sin acción de recuperación'})`;
      rec.veredicto = retryRuns.length > 0 || okAfter ? 'cubre' : 'parcial';
      rec.significado = retryRuns.length > 0
        ? 'El 429 se trata como fallo transitorio: Paperclip reprograma un reintento acotado (no inmediato) del mismo trabajo; con el mock el reintento sí avanza. MC no necesita bucle propio para el 429 pero sí un tope de intentos propio por tarea.'
        : 'El 429 se trata como cualquier otro fallo: el run queda failed (hermes_gateway_rate_limited) SIN reintento automático en el build vivo (aunque el adaptador lo marca transient_upstream) y la tarea pasa a blocked para el board. Un tope de concurrencia del ejecutor, que es transitorio, exige que MC encole/re-despache por su cuenta y respete Retry-After.';
      rec.raw = { firstRun: detail, runsIn90s: seen.runs.map(runInfo), otherRuns: others.length, issueTrail: tr6, mockHistogram: win.histogram, mockRequests: cap(win.summary) };
      await finish(agent, issue);
    });
  });

  /* =========================================================================================== */
  /* 7. Duplicados                                                                                */
  /* =========================================================================================== */
  it('7. Duplicados (invocaciones simultáneas)', { timeout: 420_000, skip: !wanted(7) }, async () => {
    await scenario(7, 'Duplicados', 'dos POST /heartbeat/invoke {issueId} en <1 s sobre UNA tarea; completeDelayMs 6000; luego duplicateReplayAsNew: true', async (rec) => {
      const mock = await useMock({ completeDelayMs: 6000 });
      const raw = {};
      // (a) tarea asignada: el run de asignación está en vuelo cuando llegan las dos invocaciones
      const agentA = await newAgent('7a', { timeoutSec: 60 });
      const issueA = await newIssue('7a', agentA.id);
      await pc.waitFor(agentA.id, (rs) => rs.length >= 1, { timeoutMs: 30_000, pollMs: 250, label: 'run de asignación creado' });
      const [r1, r2] = await Promise.all([pc.invoke(agentA.id, { issueId: issueA.id }), pc.invoke(agentA.id, { issueId: issueA.id })]);
      await sleep(25_000);
      const runsA = await pc.listRuns(agentA.id);
      const winA = mockWindow(rec);
      const keysA = postRuns(winA.reqs).map((r) => r.headers['idempotency-key']);
      assert.equal(new Set(keysA).size, keysA.length, 'cada POST /v1/runs lleva una Idempotency-Key distinta');
      for (const k of keysA) assert.ok(runsA.some((r) => r.id === k), 'la clave es un id de run de Paperclip');
      raw.asignada = { invokeResponses: [{ id: r1.id, status: r1.status, source: r1.invocationSource }, { id: r2.id, status: r2.status, source: r2.invocationSource }], sameInvokeRunId: r1.id === r2.id, runs: runsA.map(runInfo), postsToMock: winA.posts, keys: keysA };
      await finish(agentA, issueA);
      const baseB = allRequests().length;

      // (b) tarea sin asignar: aísla la deduplicación de las propias invocaciones
      const agentB = await newAgent('7b', { timeoutSec: 60 });
      const issueB = await newIssue('7b', null);
      const [b1, b2] = await Promise.all([pc.invoke(agentB.id, { issueId: issueB.id }), pc.invoke(agentB.id, { issueId: issueB.id })]);
      await sleep(20_000);
      const runsB = await pc.listRuns(agentB.id);
      const reqsB = allRequests().slice(baseB);
      const keysB = postRuns(reqsB).map((r) => r.headers['idempotency-key']);
      assert.equal(new Set(keysB).size, keysB.length);
      raw.sinAsignar = { invokeResponses: [{ id: b1.id, status: b1.status }, { id: b2.id, status: b2.status }], sameInvokeRunId: b1.id === b2.id, runs: runsB.map(runInfo), postsToMock: keysB.length, keys: keysB };
      await finish(agentB, issueB);

      // (d) mismo experimento pero con idempotencyKey en el cuerpo de la invocación (el endpoint la admite)
      const agentD = await newAgent('7d', { timeoutSec: 60 });
      const issueD = await newIssue('7d', null);
      const idemD = `autotest-fallos-${Date.now().toString(36)}`;
      const baseD = allRequests().length;
      const [d1, d2] = await Promise.all([pc.invoke(agentD.id, { issueId: issueD.id, idempotencyKey: idemD }), pc.invoke(agentD.id, { issueId: issueD.id, idempotencyKey: idemD })]);
      await sleep(15_000);
      const runsD = await pc.listRuns(agentD.id);
      const keysD = postRuns(allRequests().slice(baseD)).map((r) => r.headers['idempotency-key']);
      raw.conIdempotencyKeyEnInvoke = { idempotencyKey: idemD, invokeResponses: [{ id: d1.id, status: d1.status }, { id: d2.id, status: d2.status }], sameInvokeRunId: d1.id === d2.id, runs: runsD.map(runInfo), postsToMock: keysD.length, keys: keysD };
      await finish(agentD, issueD);

      // (c) mock con mal comportamiento: sondeo directo y luego el mismo experimento a través de Paperclip
      const h = (k) => ({ Authorization: `Bearer ${mockKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': k, 'X-Hermes-Session-Key': 'probe-7' });
      const post = async (k) => (await fetch(`${mock.url}/v1/runs`, { method: 'POST', headers: h(k), body: JSON.stringify({ input: 'sonda de duplicados' }) })).json();
      const okA = await post('autotest-fallos-sonda-ok'); const okB = await post('autotest-fallos-sonda-ok');
      mock.setFaults({ duplicateReplayAsNew: true });
      const badA = await post('autotest-fallos-sonda-mal'); const badB = await post('autotest-fallos-sonda-mal');
      raw.sondaDirectaMock = {
        conIdempotencia: { primera: okA.run_id, segunda: okB.run_id, replayed: okB.replayed, mismoRun: okA.run_id === okB.run_id },
        duplicateReplayAsNew: { primera: badA.run_id, segunda: badB.run_id, replayed: badB.replayed, mismoRun: badA.run_id === badB.run_id },
      };
      assert.ok(okA.run_id && okB.run_id, `la sonda llegó al mock: ${JSON.stringify([okA, okB])}`);
      assert.equal(okA.run_id, okB.run_id);
      assert.ok(badA.run_id && badB.run_id);
      assert.notEqual(badA.run_id, badB.run_id, 'con duplicateReplayAsNew el mock crea un run nuevo por petición');
      const baseC = allRequests().length;
      const agentC = await newAgent('7c', { timeoutSec: 60 });
      const issueC = await newIssue('7c', agentC.id);
      await pc.waitFor(agentC.id, (rs) => rs.length >= 1, { timeoutMs: 30_000, pollMs: 250, label: 'run de asignación creado' });
      const [c1, c2] = await Promise.all([pc.invoke(agentC.id, { issueId: issueC.id }), pc.invoke(agentC.id, { issueId: issueC.id })]);
      await sleep(25_000);
      const runsC = await pc.listRuns(agentC.id);
      const reqsC = allRequests().slice(baseC);
      const keysC = postRuns(reqsC).map((r) => r.headers['idempotency-key']);
      raw.conDuplicateReplayAsNew = { invokeResponses: [{ id: c1.id, status: c1.status }, { id: c2.id, status: c2.status }], runs: runsC.map(runInfo), postsToMock: keysC.length, keysDistintas: new Set(keysC).size, mockRunsCreados: allMockRuns().filter((r) => keysC.includes(r.idempotencyKey)).length };
      await finish(agentC, issueC);

      const onDemand = (rs) => rs.filter((r) => r.invocationSource === 'on_demand').length;
      const coalA = r1.id === r2.id; const coalB = b1.id === b2.id; const coalD = d1.id === d2.id;
      rec.resultado = `(a) tarea asignada con run en vuelo + invoke×2: ${coalA ? 'ids IGUALES (coalescido)' : 'ids distintos'}, ${runsA.length} runs ${JSON.stringify(bySource(runsA))}, ${winA.posts} POST al mock, claves únicas=${new Set(keysA).size === keysA.length}; (b) tarea sin asignar + invoke×2: ${coalB ? 'ids IGUALES' : 'ids distintos'}, ${onDemand(runsB)} runs on_demand, ${keysB.length} POST; (d) invoke×2 con idempotencyKey: ${coalD ? 'ids IGUALES (un solo run)' : 'ids distintos'}, ${onDemand(runsD)} run(s) on_demand, ${keysD.length} POST; issueId en el contexto del run on_demand: ${runsB.find((r) => r.invocationSource === 'on_demand')?.contextSnapshot?.issueId ? 'sí' : 'NO (el endpoint lo ignora)'}; (c) mock duplicateReplayAsNew: sonda directa con la MISMA clave → run_id ${raw.sondaDirectaMock.duplicateReplayAsNew.mismoRun ? 'iguales' : 'DISTINTOS (duplica)'} vs. sin fallo → ${raw.sondaDirectaMock.conIdempotencia.mismoRun ? 'mismo run_id (replayed)' : 'distinto'}; vía Paperclip con ese fallo: ${runsC.length} runs, ${keysC.length} POST, ${raw.conDuplicateReplayAsNew.keysDistintas} claves distintas`;
      rec.veredicto = 'parcial';
      rec.significado = `Dos invocaciones simultáneas SIN idempotencyKey ${coalB ? 'se coalescen' : `NO se coalescen: Paperclip crea ${onDemand(runsB)} runs on_demand, cada uno con su propia Idempotency-Key (= su id de run) y su POST al ejecutor, es decir trabajo duplicado`}; ${coalD ? 'con idempotencyKey en el cuerpo de la invocación sí se reduce a un solo run' : 'ni siquiera con idempotencyKey en el cuerpo se reduce a un solo run'}. Además el endpoint legacy ignora issueId. Como Paperclip nunca repite un POST con la misma clave, la idempotencia del ejecutor solo cubre reintentos de red del mismo run y un ejecutor mal portado (duplicateReplayAsNew) no cambia nada vía Paperclip. MC debe deduplicar por su cuenta (idempotencyKey al crear la tarea y al despertar al agente).`;
      rec.raw = raw;
    });
  });

  /* =========================================================================================== */
  /* 8. Reinicio del ejecutor remoto                                                              */
  /* =========================================================================================== */
  it('8. Reinicio del ejecutor remoto a mitad de run', { timeout: 540_000, skip: !wanted(8) }, async () => {
    await scenario(8, 'Reinicio del ejecutor', 'completeDelayMs 8000; close() a los 2 s; reinicio 5 s después (estado nuevo, run desconocido); timeoutSec 45', async (rec) => {
      const first = await useMock({ completeDelayMs: 8000 });
      const agent = await newAgent(8, { timeoutSec: 45, eventReconnectMs: 500 });
      const t0 = Date.now();
      const issue = await newIssue(8, agent.id);
      const seenPost = Date.now();
      for (let i = 0; i < 100 && postRuns(first.requests).length === 0; i++) await sleep(100);
      assert.ok(postRuns(first.requests).length >= 1, 'el run llegó al mock');
      const runIdAtMock = [...first.runs.keys()][0];
      await sleep(Math.max(0, 2000 - (Date.now() - seenPost)));
      const tClose = utc();
      const stateBefore = { mockRunId: runIdAtMock, status: first.runs.get(runIdAtMock)?.status, events: first.runs.get(runIdAtMock)?.events.length };
      await closeMock();
      await sleep(5000);
      const tRestart = utc();
      await useMock({ completeDelayMs: 800 }); // estado nuevo: el run anterior es desconocido
      const run = await pc.waitFor(agent.id, (rs) => rs.find((r) => r.invocationSource === 'assignment' && pc.isTerminal(r)), { timeoutMs: 150_000, pollMs: 1000, label: 'run terminal tras reinicio' });
      const tTerminal = Math.round((Date.now() - t0) / 100) / 10;
      const detail = await detailRun(run);
      const seen = await observeFor(agent.id, 75, 'continuación');
      const tr8 = await trail(issue.id);
      const issueNow = { status: tr8.status };
      const win = mockWindow(rec);
      assert.notEqual(run.status, 'succeeded', 'el run no puede haber tenido éxito: el ejecutor perdió su estado');
      const extra = seen.runs.filter((r) => r.id !== run.id);
      const post2 = win.reqs.filter((r) => r.method === 'POST' && r.path === '/v1/runs');
      rec.resultado = `mock cerrado ${tClose} (run ${stateBefore.status}, ${stateBefore.events} eventos) y reiniciado ${tRestart}; run de Paperclip ${run.status}, errorCode ${run.errorCode ?? '-'} a los ${tTerminal} s; error "${String(run.error).slice(0, 100)}"; en 75 s más: ${seen.runs.length} runs ${JSON.stringify(bySource(seen.runs))} (${extra.map((r) => `${r.invocationSource}/${r.status}/${r.errorCode ?? r.scheduledRetryReason ?? '-'}`).join(', ') || 'sin runs adicionales'}); ${post2.length} POST /v1/runs en total; ${win.reqs.filter((r) => r.status === 404).length} respuestas 404 del mock (sondeo/eventos del run desconocido) antes del timeout; issue ${issueNow.status} (${tr8.activity.filter((a) => a.action === 'issue.execution_recovery_settled').map((a) => `${a.action} ${JSON.stringify(a.details)} +${secondsBetween(run.finishedAt, a.at)} s`).join('; ') || 'sin acción de recuperación'})`;
      rec.veredicto = 'parcial';
      rec.significado = 'Apagar o reiniciar el ejecutor a mitad de tarea NO se recupera: el adaptador no distingue "ejecutor reiniciado" de "red caída" (ECONNREFUSED y luego 404 del run desconocido se tratan como errores transitorios, con unas 2 peticiones/s) y no abandona hasta agotar timeoutSec; entonces el run queda timed_out y la tarea pasa a blocked para el board, sin re-despacho automático. Con el timeoutSec por defecto (600 s) una tarea quedaría 10 min colgada. MC debe fijar timeoutSec acorde a la tarea y vigilar blocked/timed_out; el re-despacho (con otra Idempotency-Key) puede duplicar trabajo si el ejecutor original sigue vivo.';
      rec.raw = { mockBeforeClose: stateBefore, closeAtUtc: tClose, restartAtUtc: tRestart, terminalRun: detail, runsAfter75s: seen.runs.map(runInfo), issueStatusAfter: issueNow.status, issueTrail: tr8, mockHistogram: win.histogram, mockRequests: cap(win.summary) };
      await finish(agent, issue);
    });
  });
});
