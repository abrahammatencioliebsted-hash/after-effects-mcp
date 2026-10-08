/**
 * @mc/paperclip-client — cliente HTTP tipado mínimo de la API de Paperclip.
 *
 * Solo usa `fetch` global y utilidades de Node. Sin dependencias en tiempo de ejecución.
 */
import type {
  AddCommentBody,
  CostParams,
  CreateAgentBody,
  CreateCompanyBody,
  CreateIssueBody,
  CreateRoutineBody,
  CreateSecretBody,
  DecisionBody,
  HeartbeatInvokeBody,
  ListApprovalsParams,
  ListCompanyActivityParams,
  ListHeartbeatRunsParams,
  ListIssuesParams,
  ListLiveRunsParams,
  ListRunEventsParams,
  PaperclipActivity,
  PaperclipAdapter,
  PaperclipAdapterConfigSchema,
  PaperclipAgent,
  PaperclipApproval,
  PaperclipBudgetOverview,
  PaperclipComment,
  PaperclipCompany,
  PaperclipCostByAgent,
  PaperclipCostByAgentModel,
  PaperclipDashboard,
  PaperclipHealth,
  PaperclipHeartbeatRun,
  PaperclipIssue,
  PaperclipRoutine,
  PaperclipRunEvent,
  PaperclipSecret,
  RunRoutineBody,
  UpdateAgentBody,
  UpdateIssueBody,
  UpdateRoutineBody,
} from './types.js';

export * from './types.js';

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export type PaperclipErrorCode =
  | 'unreachable'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'server'
  | 'timeout';

/** Error de cualquier llamada a Paperclip. `status` es 0 si no hubo respuesta HTTP. */
export class PaperclipError extends Error {
  readonly status: number;
  readonly code: PaperclipErrorCode;
  /** Cuerpo de la respuesta (JSON ya parseado si lo era; texto si no; undefined si vacío). */
  readonly body: unknown;
  /** URL pedida, sin credenciales ni token. */
  readonly url: string;

  constructor(init: { status: number; code: PaperclipErrorCode; message: string; body?: unknown; url: string; cause?: unknown }) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'PaperclipError';
    this.status = init.status;
    this.code = init.code;
    this.body = init.body;
    this.url = init.url;
  }
}

export function codeForStatus(status: number): PaperclipErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'server';
  return 'invalid'; // 400, 422 y el resto de 4xx (405, 429, …)
}

// ---------------------------------------------------------------------------
// Opciones y tipo del cliente
// ---------------------------------------------------------------------------

export interface PaperclipClientOptions {
  /** Base de Paperclip, p. ej. `http://127.0.0.1:3100` (se admite que termine en `/api`). */
  baseUrl: string;
  /** Bearer para instancias no locales. En `local_trusted` + loopback no hace falta. */
  token?: string;
  fetchImpl?: typeof fetch;
  /** Tiempo máximo por petición. Por defecto 15 000 ms. */
  timeoutMs?: number;
  userAgent?: string;
}

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Sustituye el timeout del cliente solo para esta petición. */
  timeoutMs?: number;
}

export interface PaperclipClient {
  /** Escotilla de escape: `path` con o sin prefijo `/api`. Devuelve el JSON ya parseado. */
  request<T = unknown>(method: string, path: string, opts?: RequestOptions): Promise<T>;

  health(): Promise<PaperclipHealth>;
  openapi(): Promise<Record<string, unknown>>;
  listAdapters(): Promise<PaperclipAdapter[]>;
  getAdapterConfigSchema(type: string): Promise<PaperclipAdapterConfigSchema>;

  listCompanies(): Promise<PaperclipCompany[]>;
  createCompany(body: CreateCompanyBody): Promise<PaperclipCompany>;
  getCompany(id: string): Promise<PaperclipCompany>;

  listAgents(companyId: string): Promise<PaperclipAgent[]>;
  getAgent(id: string): Promise<PaperclipAgent>;
  createAgent(companyId: string, body: CreateAgentBody): Promise<PaperclipAgent>;
  updateAgent(id: string, body: UpdateAgentBody): Promise<PaperclipAgent>;
  pauseAgent(id: string): Promise<PaperclipAgent>;
  resumeAgent(id: string): Promise<PaperclipAgent>;
  /** Baja definitiva (conserva el historial). */
  terminateAgent(id: string): Promise<PaperclipAgent>;

  listIssues(companyId: string, params?: ListIssuesParams): Promise<PaperclipIssue[]>;
  /** Acepta el UUID o el identificador legible (p. ej. "MIS-1"). */
  getIssue(id: string): Promise<PaperclipIssue>;
  createIssue(companyId: string, body: CreateIssueBody): Promise<PaperclipIssue>;
  updateIssue(id: string, body: UpdateIssueBody): Promise<PaperclipIssue>;
  listIssueComments(issueId: string): Promise<PaperclipComment[]>;
  addIssueComment(issueId: string, body: AddCommentBody): Promise<PaperclipComment>;
  listIssueActivity(issueId: string): Promise<PaperclipActivity[]>;
  listCompanyActivity(companyId: string, params?: ListCompanyActivityParams): Promise<PaperclipActivity[]>;

  listHeartbeatRuns(companyId: string, params?: ListHeartbeatRunsParams): Promise<PaperclipHeartbeatRun[]>;
  listLiveRuns(companyId: string, params?: ListLiveRunsParams): Promise<PaperclipHeartbeatRun[]>;
  getRun(runId: string): Promise<PaperclipHeartbeatRun>;
  listRunEvents(runId: string, params?: ListRunEventsParams): Promise<PaperclipRunEvent[]>;
  cancelRun(runId: string): Promise<PaperclipHeartbeatRun>;
  invokeHeartbeat(agentId: string, body?: HeartbeatInvokeBody): Promise<PaperclipHeartbeatRun>;

  listApprovals(companyId: string, params?: ListApprovalsParams): Promise<PaperclipApproval[]>;
  getApproval(id: string): Promise<PaperclipApproval>;
  approve(id: string, body?: DecisionBody): Promise<PaperclipApproval>;
  reject(id: string, body?: DecisionBody): Promise<PaperclipApproval>;
  requestRevision(id: string, body?: DecisionBody): Promise<PaperclipApproval>;

  listRoutines(companyId: string): Promise<PaperclipRoutine[]>;
  createRoutine(companyId: string, body: CreateRoutineBody): Promise<PaperclipRoutine>;
  getRoutine(id: string): Promise<PaperclipRoutine>;
  updateRoutine(id: string, body: UpdateRoutineBody): Promise<PaperclipRoutine>;
  /** `POST /api/routines/{id}/run` — ejecuta ahora. La forma de la respuesta no está tipada en OpenAPI. */
  runRoutine(id: string, body?: RunRoutineBody): Promise<Record<string, unknown>>;
  listRoutineRuns(id: string): Promise<Array<Record<string, unknown>>>;

  getDashboard(companyId: string): Promise<PaperclipDashboard>;
  costsByAgent(companyId: string, params?: CostParams): Promise<PaperclipCostByAgent[]>;
  costsByAgentModel(companyId: string, params?: CostParams): Promise<PaperclipCostByAgentModel[]>;
  /** `GET /companies/{id}/budgets/overview`. */
  listBudgets(companyId: string): Promise<PaperclipBudgetOverview>;

  listSecrets(companyId: string): Promise<PaperclipSecret[]>;
  createSecret(companyId: string, body: CreateSecretBody): Promise<PaperclipSecret>;
}

// ---------------------------------------------------------------------------
// Implementación
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;
const enc = encodeURIComponent;

function normalizeBase(baseUrl: string): string {
  let b = baseUrl.trim().replace(/\/+$/, '');
  if (b.endsWith('/api')) b = b.slice(0, -4);
  return b;
}

/** Sustituye el token (y cualquier `Bearer xxx`) por `[redacted]`. */
function makeRedactor(token: string | undefined): (s: string) => string {
  return (s: string) => {
    let out = s.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
    if (token) out = out.split(token).join('[redacted]');
    return out;
  };
}

function redactDeep(value: unknown, redact: (s: string) => string, depth = 0): unknown {
  if (typeof value === 'string') return redact(value);
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, redact, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, redact, depth + 1);
  return out;
}

function errorMessageFromBody(body: unknown): string | undefined {
  if (typeof body === 'string') return body.slice(0, 300);
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    if (typeof o.error === 'string') return o.error;
    if (o.error && typeof o.error === 'object' && typeof (o.error as Record<string, unknown>).message === 'string') {
      return (o.error as Record<string, string>).message;
    }
    if (typeof o.message === 'string') return o.message;
  }
  return undefined;
}

function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    sp.append(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function createPaperclipClient(opts: PaperclipClientOptions): PaperclipClient {
  if (!opts || typeof opts.baseUrl !== 'string' || !opts.baseUrl.trim()) {
    throw new TypeError('createPaperclipClient: baseUrl es obligatorio');
  }
  const base = normalizeBase(opts.baseUrl);
  const token = opts.token?.trim() || undefined;
  const fetchImpl: typeof fetch = opts.fetchImpl ?? ((...a) => globalThis.fetch(...a));
  const defaultTimeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = opts.userAgent ?? '@mc/paperclip-client';
  const redact = makeRedactor(token);

  async function request<T = unknown>(method: string, path: string, ro: RequestOptions = {}): Promise<T> {
    const apiPath = path === '/api' || path.startsWith('/api/') || path.startsWith('/api?') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
    const url = `${base}${apiPath}${buildQuery(ro.query)}`;
    const safeUrl = redact(url);
    const timeoutMs = ro.timeoutMs ?? defaultTimeout;

    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': userAgent, ...ro.headers };
    if (token) headers.authorization = `Bearer ${token}`;
    let payload: string | undefined;
    if (ro.body !== undefined) {
      payload = JSON.stringify(ro.body);
      headers['content-type'] = 'application/json';
    }

    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeoutMs);

    let res: Response;
    try {
      // La carrera con la señal garantiza el timeout aunque un `fetchImpl` propio ignore `signal`.
      const aborted = new Promise<never>((_, reject) => {
        ac.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      res = await Promise.race([fetchImpl(url, { method: method.toUpperCase(), headers, body: payload, signal: ac.signal }), aborted]);
    } catch (err) {
      clearTimeout(timer);
      const reason = redact(err instanceof Error ? `${err.message}${err.cause instanceof Error ? ` (${err.cause.message})` : ''}` : String(err));
      if (timedOut) {
        throw new PaperclipError({ status: 0, code: 'timeout', message: `Paperclip ${method} ${apiPath}: tiempo agotado (${timeoutMs} ms)`, url: safeUrl, cause: err });
      }
      throw new PaperclipError({ status: 0, code: 'unreachable', message: `Paperclip ${method} ${apiPath}: no se pudo conectar con ${base} — ${reason}`, url: safeUrl, cause: err });
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      clearTimeout(timer);
      if (timedOut) {
        throw new PaperclipError({ status: res.status, code: 'timeout', message: `Paperclip ${method} ${apiPath}: tiempo agotado leyendo la respuesta (${timeoutMs} ms)`, url: safeUrl, cause: err });
      }
      throw new PaperclipError({ status: res.status, code: 'unreachable', message: `Paperclip ${method} ${apiPath}: respuesta interrumpida — ${redact(String(err))}`, url: safeUrl, cause: err });
    }
    clearTimeout(timer);

    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const body = redactDeep(parsed, redact);
      const code = codeForStatus(res.status);
      const detail = errorMessageFromBody(body);
      throw new PaperclipError({
        status: res.status,
        code,
        message: `Paperclip ${method} ${apiPath} → ${res.status} ${code}${detail ? `: ${redact(detail)}` : ''}`,
        body,
        url: safeUrl,
      });
    }
    if (parsed === undefined) return undefined as T;
    // Una respuesta 2xx que no es JSON (p. ej. HTML de un proxy) es un fallo de contrato.
    if (typeof parsed === 'string') {
      throw new PaperclipError({ status: res.status, code: 'server', message: `Paperclip ${method} ${apiPath}: respuesta ${res.status} no es JSON`, body: parsed.slice(0, 300), url: safeUrl });
    }
    return parsed as T;
  }

  const get = <T>(path: string, query?: Record<string, QueryValue>) => request<T>('GET', path, { query });
  const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body });
  const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, { body });

  return {
    request,

    health: () => get('/health'),
    openapi: () => get('/openapi.json'),
    listAdapters: () => get('/adapters'),
    getAdapterConfigSchema: (type) => get(`/adapters/${enc(type)}/config-schema`),

    listCompanies: () => get('/companies'),
    createCompany: (body) => post('/companies', body),
    getCompany: (id) => get(`/companies/${enc(id)}`),

    listAgents: (c) => get(`/companies/${enc(c)}/agents`),
    getAgent: (id) => get(`/agents/${enc(id)}`),
    createAgent: (c, body) => post(`/companies/${enc(c)}/agents`, body),
    updateAgent: (id, body) => patch(`/agents/${enc(id)}`, body),
    pauseAgent: (id) => post(`/agents/${enc(id)}/pause`),
    resumeAgent: (id) => post(`/agents/${enc(id)}/resume`),
    terminateAgent: (id) => post(`/agents/${enc(id)}/terminate`),

    listIssues: (c, p = {}) => {
      const { cursor, offset, ...rest } = p;
      const off = offset ?? (cursor !== undefined && /^\d+$/.test(cursor) ? Number(cursor) : undefined);
      return get(`/companies/${enc(c)}/issues`, { ...rest, offset: off });
    },
    getIssue: (id) => get(`/issues/${enc(id)}`),
    createIssue: (c, body) => post(`/companies/${enc(c)}/issues`, body),
    updateIssue: (id, body) => patch(`/issues/${enc(id)}`, body),
    listIssueComments: (id) => get(`/issues/${enc(id)}/comments`),
    addIssueComment: (id, body) => post(`/issues/${enc(id)}/comments`, body),
    listIssueActivity: (id) => get(`/issues/${enc(id)}/activity`),
    listCompanyActivity: (c, p) => get(`/companies/${enc(c)}/activity`, { ...p }),

    listHeartbeatRuns: (c, p) => get(`/companies/${enc(c)}/heartbeat-runs`, { ...p }),
    listLiveRuns: (c, p) => get(`/companies/${enc(c)}/live-runs`, { ...p }),
    getRun: (id) => get(`/heartbeat-runs/${enc(id)}`),
    listRunEvents: (id, p) => get(`/heartbeat-runs/${enc(id)}/events`, { ...p }),
    cancelRun: (id) => post(`/heartbeat-runs/${enc(id)}/cancel`),
    invokeHeartbeat: (id, body) => post(`/agents/${enc(id)}/heartbeat/invoke`, body ?? {}),

    listApprovals: (c, p) => get(`/companies/${enc(c)}/approvals`, { ...p }),
    getApproval: (id) => get(`/approvals/${enc(id)}`),
    approve: (id, body) => post(`/approvals/${enc(id)}/approve`, body ?? {}),
    reject: (id, body) => post(`/approvals/${enc(id)}/reject`, body ?? {}),
    requestRevision: (id, body) => post(`/approvals/${enc(id)}/request-revision`, body ?? {}),

    listRoutines: (c) => get(`/companies/${enc(c)}/routines`),
    createRoutine: (c, body) => post(`/companies/${enc(c)}/routines`, body),
    getRoutine: (id) => get(`/routines/${enc(id)}`),
    updateRoutine: (id, body) => patch(`/routines/${enc(id)}`, body),
    runRoutine: (id, body) => post(`/routines/${enc(id)}/run`, body ?? {}),
    listRoutineRuns: (id) => get(`/routines/${enc(id)}/runs`),

    getDashboard: (c) => get(`/companies/${enc(c)}/dashboard`),
    costsByAgent: (c, p) => get(`/companies/${enc(c)}/costs/by-agent`, { ...p }),
    costsByAgentModel: (c, p) => get(`/companies/${enc(c)}/costs/by-agent-model`, { ...p }),
    listBudgets: (c) => get(`/companies/${enc(c)}/budgets/overview`),

    listSecrets: (c) => get(`/companies/${enc(c)}/secrets`),
    createSecret: (c, body) => post(`/companies/${enc(c)}/secrets`, body),
  };
}
