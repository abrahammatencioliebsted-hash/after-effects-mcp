// Ayudantes mínimos para hablar con la API REAL de Paperclip (local_trusted, sin autenticación en loopback).
// Solo `fetch` de Node; sin dependencias. Todo objeto creado lleva el prefijo OBJECT_PREFIX.
import { randomBytes } from 'node:crypto';

export const OBJECT_PREFIX = '[auto-test fallos]';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Marca de tiempo UTC con milisegundos (ISO-8601 con Z). */
export const utc = (d = new Date()) => new Date(d).toISOString();

/** Garantiza el prefijo en cualquier nombre/título que se cree en Paperclip. */
export function withPrefix(name) {
  const s = String(name);
  return s.startsWith(OBJECT_PREFIX) ? s : `${OBJECT_PREFIX} ${s}`;
}

/** Clave efímera para el mock (nunca se escribe en código ni en el informe). */
export function generateMockKey() {
  return `mock-${randomBytes(18).toString('hex')}`;
}

/** Sustituye cualquier aparición de `secret` en `text` (defensa para informes y logs). */
export function redactSecret(text, secret) {
  if (!secret) return String(text);
  return String(text).split(secret).join('***');
}

/** Segundos (1 decimal) entre dos instantes ISO / Date / ms. */
export function secondsBetween(a, b) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.round(((tb - ta) / 1000) * 10) / 10;
}

export class PaperclipError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} -> ${status} ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Cliente fino. `baseUrl` sin barra final; `companyId` obligatorio para las rutas de empresa.
 */
export function createPaperclip({ baseUrl, companyId, token }) {
  const root = String(baseUrl).replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };

  async function request(method, path, body, { allow = [] } = {}) {
    const res = await fetch(`${root}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!res.ok && !allow.includes(res.status)) throw new PaperclipError(method, path, res.status, json);
    return json;
  }
  const arr = (x, key) => (Array.isArray(x) ? x : (x && Array.isArray(x[key]) ? x[key] : []));

  const api = {
    root, companyId, request,
    health: () => request('GET', '/api/health'),

    /** Crea un secreto con el valor de la clave del mock (la respuesta no devuelve el valor). */
    createSecret: (name, value) => request('POST', `/api/companies/${companyId}/secrets`, {
      name: withPrefix(name).replace(/[^A-Za-z0-9_\- \[\]]/g, '_'),
      provider: 'local_encrypted', managedMode: 'paperclip_managed', value,
      description: 'Clave efímera del mock de Hermes (auto-test fallos). Puede borrarse.',
    }),

    /** Agente hermes_gateway apuntando a `apiBaseUrl` (mock). */
    createAgent: ({ name, apiBaseUrl, secretId, timeoutSec = 60, eventReconnectMs = 500, sessionKeyStrategy = 'issue', instructions }) =>
      request('POST', `/api/companies/${companyId}/agents`, {
        name: withPrefix(name), role: 'engineer', title: 'Ejecutor de pruebas de fallos (mock de Hermes)', icon: 'terminal',
        adapterType: 'hermes_gateway',
        adapterConfig: {
          apiBaseUrl, apiKey: { type: 'secret_ref', secretId, version: 'latest' },
          sessionKeyStrategy, timeoutSec, eventReconnectMs,
          ...(instructions ? { instructions } : {}),
        },
        capabilities: 'Solo pruebas de fallos contra un mock. No usar en producción.',
        budgetMonthlyCents: 0,
        permissions: { canCreateAgents: false, canCreateSkills: false },
      }),

    getAgent: (id) => request('GET', `/api/agents/${id}`),
    pauseAgent: (id) => request('PATCH', `/api/agents/${id}`, { status: 'paused' }),

    createIssue: ({ title, description, agentId, priority = 'low' }) =>
      request('POST', `/api/companies/${companyId}/issues`, {
        title: withPrefix(title), description, status: 'todo', priority,
        assigneeAgentId: agentId, reviewPolicy: 'human_only',
        allowDuplicate: true,
      }),
    getIssue: (id) => request('GET', `/api/issues/${id}`),
    patchIssue: (id, patch) => request('PATCH', `/api/issues/${id}`, patch),
    cancelIssue: (id, comment = '[auto-test fallos] limpieza') => request('PATCH', `/api/issues/${id}`, { status: 'cancelled', comment }),

    invoke: (agentId, body) => request('POST', `/api/agents/${agentId}/heartbeat/invoke`, body),

    /** Todos los runs de la empresa (lista completa) filtrados por agente, más antiguos primero. */
    listRuns: async (agentId) => {
      const all = arr(await request('GET', `/api/companies/${companyId}/heartbeat-runs`), 'runs');
      return all.filter((r) => !agentId || r.agentId === agentId)
        .sort((a, b) => new Date(a.createdAt ?? a.startedAt ?? 0) - new Date(b.createdAt ?? b.startedAt ?? 0));
    },
    getRun: (runId) => request('GET', `/api/heartbeat-runs/${runId}`, undefined, { allow: [404] }),
    runEvents: async (runId) => arr(await request('GET', `/api/heartbeat-runs/${runId}/events`), 'events'),
    runLog: async (runId) => {
      const res = await fetch(`${root}/api/heartbeat-runs/${runId}/log`, { headers });
      return res.ok ? res.text() : `HTTP ${res.status}`;
    },
    comments: async (issueId) => arr(await request('GET', `/api/issues/${issueId}/comments`), 'comments'),
    activity: async (issueId) => arr(await request('GET', `/api/issues/${issueId}/activity`), 'activity'),
    costsByAgent: async () => arr(await request('GET', `/api/companies/${companyId}/costs/by-agent`), 'agents'),
  };

  /**
   * Sondea los runs de un agente hasta que `predicate(runs)` devuelva algo truthy.
   * Devuelve ese valor; si vence el plazo, lanza con el último estado visto.
   */
  api.waitFor = async (agentId, predicate, { timeoutMs = 120_000, pollMs = 1_000, label = 'condición' } = {}) => {
    const t0 = Date.now();
    let last = [];
    while (Date.now() - t0 < timeoutMs) {
      last = await api.listRuns(agentId);
      const v = await predicate(last);
      if (v) return v;
      await sleep(pollMs);
    }
    const brief = last.map((r) => `${r.id.slice(0, 8)}:${r.status}/${r.errorCode ?? '-'}`).join(', ');
    throw new Error(`Plazo vencido (${timeoutMs} ms) esperando ${label}. Runs vistos: [${brief}]`);
  };

  /** Sobrevive hasta que haya un run terminal (o solo `succeeded`, etc.) de ese agente. */
  const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'interrupted']);
  api.isTerminal = (r) => TERMINAL.has(r.status);
  api.waitForTerminalRun = (agentId, { timeoutMs = 120_000, after = null, source = null, ...rest } = {}) =>
    api.waitFor(agentId, (runs) => runs.find((r) => api.isTerminal(r) && (!source || r.invocationSource === source) && (!after || new Date(r.createdAt ?? 0) >= new Date(after))),
      { timeoutMs, label: 'un run terminal', ...rest });

  /** Reúne lo observable de un run: evento, registro y consumo (usageJson). */
  api.snapshotRun = async (run) => {
    const fresh = (await api.getRun(run.id)) ?? run;
    const events = await api.runEvents(run.id).catch(() => []);
    const log = await api.runLog(run.id).catch(() => '');
    return { run: fresh, events, log };
  };

  return api;
}

export { arrOf };
function arrOf(x, key) { return Array.isArray(x) ? x : (x && Array.isArray(x[key]) ? x[key] : []); }
