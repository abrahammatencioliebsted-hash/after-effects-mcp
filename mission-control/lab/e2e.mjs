#!/usr/bin/env node
// Recorrido de laboratorio: solicitud → asignación → ejecución → revisión → resultado.
// Usa Paperclip REAL y el Hermes API server REAL; el modelo detrás de Hermes puede ser el stub (SIMULADO).
// Sin dependencias. Variables: PAPERCLIP_URL, PAPERCLIP_TOKEN (opcional), PAPERCLIP_COMPANY_ID (opcional),
// HERMES_URL, HERMES_API_KEY (obligatoria), E2E_MARKER (def. MC-STUB-OK), E2E_TIMEOUT_SEC (def. 120).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAPERCLIP_URL = (process.env.PAPERCLIP_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const HERMES_URL = (process.env.HERMES_URL || 'http://127.0.0.1:8642').replace(/\/$/, '');
const HERMES_API_KEY = process.env.HERMES_API_KEY;
const MARKER = process.env.E2E_MARKER || 'MC-STUB-OK';
const TIMEOUT_SEC = Number(process.env.E2E_TIMEOUT_SEC || 120);
const TOKEN = process.env.PAPERCLIP_TOKEN;
if (!HERMES_API_KEY) { console.error('Falta HERMES_API_KEY'); process.exit(2); }

const report = [];
const log = (line) => { const l = `${new Date().toISOString()} ${line}`; console.log(l); report.push(l); };
const headers = { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) };
async function api(method, p, body) {
  const res = await fetch(`${PAPERCLIP_URL}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${typeof json === 'string' ? json.slice(0, 200) : JSON.stringify(json).slice(0, 300)}`);
  return json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runtimeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.runtime'); // fileURLToPath: rutas con espacios y unidades de Windows
fs.mkdirSync(runtimeDir, { recursive: true });
const steps = [];
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); log(`${ok ? 'OK ' : 'FALLO'} ${name}${detail ? ' — ' + detail : ''}`); };

try {
  // 0. Pre-comprobaciones
  const health = await api('GET', '/api/health');
  step('Paperclip responde', health.status === 'ok', `v${health.version} ${health.deploymentMode}`);
  const hh = await fetch(`${HERMES_URL}/health`).then((r) => r.json());
  step('Hermes API server responde', hh.status === 'ok', JSON.stringify(hh));
  const caps = await fetch(`${HERMES_URL}/v1/capabilities`, { headers: { authorization: `Bearer ${HERMES_API_KEY}` } });
  step('Hermes acepta la clave', caps.status === 200, `HTTP ${caps.status}`);
  const adapters = await api('GET', '/api/adapters');
  step('Adaptador hermes_gateway presente', adapters.some((a) => a.type === 'hermes_gateway'));

  // 1. Empresa
  let companyId = process.env.PAPERCLIP_COMPANY_ID;
  if (!companyId) {
    const c = await api('POST', '/api/companies', { name: `[e2e] Mission Control ${stamp}`, description: 'Empresa de prueba creada por lab/e2e.mjs' });
    companyId = c.id; step('Empresa creada', true, `${c.id} prefijo ${c.issuePrefix}`);
  } else step('Empresa reutilizada', true, companyId);

  // 2. Secreto + agente
  // Con HERMES_SECRET_ID se reutiliza un secreto existente (evita acumular copias cifradas de la clave real en cada ejecución).
  let secret;
  if (process.env.HERMES_SECRET_ID) {
    secret = { id: process.env.HERMES_SECRET_ID };
    step('Secreto reutilizado (HERMES_SECRET_ID)', true, secret.id);
  } else {
    secret = await api('POST', `/api/companies/${companyId}/secrets`, { name: `[e2e] HERMES_API_SERVER_KEY_${stamp}`, provider: 'local_encrypted', managedMode: 'paperclip_managed', value: HERMES_API_KEY, description: 'Clave del API server de Hermes (e2e). Valor nunca mostrado. Reutilízalo con HERMES_SECRET_ID; el build actual no expone DELETE de secretos.' });
    step('Secreto guardado (sin eco del valor)', !!secret.id && !JSON.stringify(secret).includes(HERMES_API_KEY), secret.id);
  }
  const agent = await api('POST', `/api/companies/${companyId}/agents`, {
    name: `[e2e] Ejecutor Hermes ${stamp.slice(11, 19)}`, role: 'engineer', title: 'Ejecutor e2e (Hermes real)', icon: 'terminal',
    adapterType: 'hermes_gateway',
    adapterConfig: { apiBaseUrl: HERMES_URL, apiKey: { type: 'secret_ref', secretId: secret.id, version: 'latest' }, sessionKeyStrategy: 'issue', timeoutSec: 120, eventReconnectMs: 2000, instructions: `Responde en español, breve, y termina con la marca ${MARKER}.` },
    budgetMonthlyCents: 500,
  });
  step('Agente hermes_gateway creado', agent.status === 'idle', `${agent.id} apiKey=${agent.adapterConfig?.apiKey?.type}`);

  // 3. Solicitud (issue) con revisión humana → debe despertar al agente por asignación
  const t0 = Date.now();
  const issue = await api('POST', `/api/companies/${companyId}/issues`, {
    title: `[e2e] Recorrido ${stamp}`, description: `Tarea de prueba e2e. Devuelve un comentario con la marca ${MARKER}.`,
    status: 'todo', priority: 'high', assigneeAgentId: agent.id, reviewPolicy: 'human_only',
  });
  step('Solicitud creada', !!issue.identifier, `${issue.identifier} (${issue.id}) reviewPolicy=${issue.reviewPolicy}`);

  // 4. Ejecución: esperar run de asignación y comentario con la marca
  let run, comment; const deadline = Date.now() + TIMEOUT_SEC * 1000;
  while (Date.now() < deadline) {
    const runs = await api('GET', `/api/companies/${companyId}/heartbeat-runs`);
    const mine = (Array.isArray(runs) ? runs : runs.runs || []).filter((r) => r.agentId === agent.id);
    run = mine.find((r) => r.status === 'succeeded') || mine[0];
    const comments = await api('GET', `/api/issues/${issue.id}/comments`);
    comment = (Array.isArray(comments) ? comments : comments.comments || []).find((c) => c.authorType === 'agent' && (c.body || '').includes(MARKER));
    if (run?.status === 'succeeded' && comment) break;
    await sleep(2000);
  }
  step('Agente despertado por asignación', run?.invocationSource === 'assignment', run ? `run ${run.id} source=${run.invocationSource} status=${run.status}` : 'sin run');
  step('Run terminado con éxito', run?.status === 'succeeded', run ? `tokens in=${run.usageJson?.inputTokens} out=${run.usageJson?.outputTokens} cost=${run.usageJson?.costStatus}` : '');
  step(`Resultado con la marca ${MARKER}`, !!comment, comment ? `comentario ${comment.id} en ${Math.round((Date.now() - t0) / 1000)} s` : 'no llegó');
  if (run) {
    const events = await api('GET', `/api/heartbeat-runs/${run.id}/events`);
    const ev = Array.isArray(events) ? events : events.events || [];
    const invoke = ev.find((e) => (e.eventType || e.type) === 'adapter.invoke');
    step('Evento adapter.invoke registrado', !!invoke, invoke ? JSON.stringify(invoke.payload).slice(0, 160) : '');
  }

  // 5. Revisión humana y resultado
  const reviewed = await api('PATCH', `/api/issues/${issue.id}`, { status: 'in_review', comment: '[e2e · operador] Resultado recibido; paso a revisión.' });
  step('Revisión: in_review', reviewed.status === 'in_review');
  const done = await api('PATCH', `/api/issues/${issue.id}`, { status: 'done', comment: '[e2e · operador] Revisado y aceptado.' });
  step('Resultado: done', done.status === 'done', `completedAt=${done.completedAt}`);

  // 6. Consumo visible
  const costs = await api('GET', `/api/companies/${companyId}/costs/by-agent`);
  const mineCost = (Array.isArray(costs) ? costs : []).find((c) => c.agentId === agent.id);
  step('Consumo registrado por agente', !!mineCost && mineCost.inputTokens > 0, mineCost ? `in=${mineCost.inputTokens} out=${mineCost.outputTokens} costCents=${mineCost.costCents}` : '');

  // 7. Limpieza mínima: pausar el agente e2e para que el vigilante no lo despierte más
  try { await api('PATCH', `/api/agents/${agent.id}`, { status: 'paused' }); step('Agente e2e pausado', true); } catch (e) { step('Agente e2e pausado', false, String(e.message).slice(0, 120)); }
} catch (e) {
  step('Excepción', false, String(e.message));
}
const okCount = steps.filter((s) => s.ok).length;
const md = [`# Recorrido e2e — ${stamp}`, '', `Paperclip: ${PAPERCLIP_URL} · Hermes: ${HERMES_URL} · marca: ${MARKER}`, '', '| Paso | Resultado | Detalle |', '| --- | --- | --- |', ...steps.map((s) => `| ${s.name} | ${s.ok ? '✅' : '❌'} | ${String(s.detail || '').replace(/\|/g, '\\|')} |`), '', `**${okCount}/${steps.length} pasos correctos.** El modelo detrás de Hermes puede ser SIMULADO; este recorrido no prueba calidad de modelo ni red entre equipos.`, '', '## Registro', '', '```', ...report, '```'].join('\n');
const out = path.join(runtimeDir, `e2e-${stamp}.md`);
fs.writeFileSync(out, md);
console.log(`\nInforme: ${out}\n${okCount}/${steps.length} pasos correctos`);
process.exit(okCount === steps.length ? 0 : 1);
