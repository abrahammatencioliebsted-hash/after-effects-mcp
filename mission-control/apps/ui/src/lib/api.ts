// Cliente tipado de la API del BFF (docs/08-contrato-bff.md). Todos los endpoints bajo /api/mc.
import type {
  ActivityItem,
  AgentCreateRequest,
  AgentSummary,
  AllowedCommand,
  ApiError,
  Capability,
  CatalogValidationIssue,
  DocumentSummary,
  HealthReport,
  Idea,
  MachineSummary,
  MissionCreateRequest,
  MissionDetail,
  MissionStatus,
  MissionSummary,
  Overview,
  RoutineSummary,
  RunSummary,
  SharedSettings,
  TimelineEvent,
} from '@mc/contracts';

export const API_BASE = '/api/mc';

export type Query = Record<string, string | number | boolean | undefined | null | Array<string | number>>;

/** Construye `/api/mc/<path>?<query>`; omite valores vacíos y une arreglos con comas. */
export function buildUrl(path: string, query?: Query, base: string = API_BASE): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const params = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) {
        if (v.length > 0) params.set(k, v.join(','));
      } else {
        params.set(k, String(v));
      }
    }
  }
  const qs = params.toString();
  return `${base}${clean}${qs ? `?${qs}` : ''}`;
}

export class ApiRequestError extends Error {
  status: number;
  code: ApiError['code'] | 'network';
  details: unknown;
  constructor(message: string, status: number, code: ApiError['code'] | 'network', details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** URL base de Paperclip cuando el BFF informa `paperclip_unreachable`. */
  get paperclipBaseUrl(): string | undefined {
    const d = this.details as { baseUrl?: unknown } | undefined;
    return this.code === 'paperclip_unreachable' && typeof d?.baseUrl === 'string' ? d.baseUrl : undefined;
  }
}

export function isMockEnabled(search?: string): boolean {
  const s = search ?? (typeof location !== 'undefined' ? location.search : '');
  return new URLSearchParams(s).get('mock') === '1';
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

type MockHandler = (method: string, path: string, query: Query | undefined, body: unknown) => Promise<unknown>;
let mockHandlerPromise: Promise<MockHandler> | null = null;

async function mockRequest<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
  mockHandlerPromise ??= import('../mocks/mockApi.ts').then((m) => m.handleMock as MockHandler);
  const handler = await mockHandlerPromise;
  return (await handler(method, path, opts.query, opts.body)) as T;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  if (isMockEnabled()) return mockRequest<T>(method, path, opts);
  const url = buildUrl(path, opts.query);
  const hasBody = opts.body !== undefined;
  let res: Response;
  try {
    const init: RequestInit = {
      method,
      headers: { Accept: 'application/json', ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
    };
    if (hasBody) init.body = JSON.stringify(opts.body);
    if (opts.signal) init.signal = opts.signal;
    res = await fetch(url, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiRequestError('No se pudo contactar con el BFF de Mission Control.', 0, 'network', { url });
  }
  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!res.ok) {
    const err = payload as Partial<ApiError> | null;
    // Un proxy de desarrollo sin BFF detrás responde 502/503/504 sin cuerpo ApiError: se trata como "sin conexión".
    const proxyDown = !err?.code && (res.status === 502 || res.status === 503 || res.status === 504);
    throw new ApiRequestError(
      typeof err?.error === 'string' ? err.error : proxyDown ? 'No se pudo contactar con el BFF de Mission Control.' : `Error ${res.status} del BFF`,
      res.status,
      proxyDown ? 'network' : ((err?.code as ApiError['code']) ?? 'internal'),
      err?.details,
    );
  }
  return payload as T;
}

const enc = encodeURIComponent;

export interface MissionListQuery {
  status?: MissionStatus[];
  scope?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthReport>('GET', '/health', signal ? { signal } : {}),
  overview: (days = 14) => request<Overview>('GET', '/overview', { query: { days } }),

  missions: (q: MissionListQuery = {}) =>
    request<{ items: MissionSummary[]; nextCursor?: string }>('GET', '/missions', { query: { ...q, status: q.status } }),
  createMission: (body: MissionCreateRequest, idempotencyKey?: string) =>
    request<MissionDetail>('POST', '/missions', { body, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  mission: (id: string) => request<MissionDetail>('GET', `/missions/${enc(id)}`),
  approvePlan: (id: string, note?: string) => request<MissionDetail>('POST', `/missions/${enc(id)}/plan/approve`, { body: { note } }),
  rejectPlan: (id: string, note: string) => request<MissionDetail>('POST', `/missions/${enc(id)}/plan/reject`, { body: { note } }),
  acceptMission: (id: string, note?: string) => request<MissionDetail>('POST', `/missions/${enc(id)}/accept`, { body: { note } }),
  requestChanges: (id: string, note: string) => request<MissionDetail>('POST', `/missions/${enc(id)}/request-changes`, { body: { note } }),
  rerunMission: (id: string, note?: string) => request<MissionDetail>('POST', `/missions/${enc(id)}/rerun`, { body: { note } }),
  stopMission: (id: string, note?: string) => request<MissionDetail>('POST', `/missions/${enc(id)}/stop`, { body: { note } }),
  replay: (id: string) => request<{ events: TimelineEvent[] }>('GET', `/missions/${enc(id)}/replay`),

  agents: (days = 14) => request<AgentSummary[]>('GET', '/agents', { query: { days } }),
  createAgent: (body: AgentCreateRequest) => request<AgentSummary>('POST', '/agents', { body }),
  deleteAgent: (id: string) => request<{ ok: true }>('DELETE', `/agents/${enc(id)}`),
  agentRuns: (id: string, limit = 10) => request<RunSummary[]>('GET', `/agents/${enc(id)}/runs`, { query: { limit } }),

  machines: () => request<MachineSummary[]>('GET', '/machines'),
  commands: (machineId: string) => request<AllowedCommand[]>('GET', `/machines/${enc(machineId)}/commands`),
  runCommand: (machineId: string, commandId: string) =>
    request<CommandResult>('POST', `/machines/${enc(machineId)}/commands/${enc(commandId)}`, { body: { confirm: true } }),

  catalog: (q: { tipo?: string; equipo?: string; ejecutor?: string; estado?: string } = {}) => request<Capability[]>('GET', '/catalog', { query: q }),
  validateCatalog: () => request<{ ok: boolean; issues: CatalogValidationIssue[] }>('GET', '/catalog/validate'),
  matchCatalog: (capabilities: string[], scope?: string) =>
    request<{ candidates: Array<{ agentId: string; machineId: string; score: number; reasons: string[] }> }>('GET', '/catalog/match', { query: { capabilities, scope } }),

  ideas: () => request<Idea[]>('GET', '/ideas'),

  docs: (q: { missionId?: string; q?: string } = {}) => request<DocumentSummary[]>('GET', '/docs', { query: q }),
  doc: (id: string) => request<{ summary: DocumentSummary; markdown: string }>('GET', `/docs/${enc(id)}`),
  createDoc: (body: { title: string; markdown: string; missionId?: string }) => request<DocumentSummary>('POST', '/docs', { body }),

  schedule: () => request<RoutineSummary[]>('GET', '/schedule'),
  runRoutineNow: (id: string) => request<{ ok: true }>('POST', `/schedule/${enc(id)}/run-now`),

  activity: (q: { limit?: number; cursor?: string } = {}) => request<{ items: ActivityItem[]; nextCursor?: string }>('GET', '/activity', { query: q }),

  settings: () => request<SharedSettings>('GET', '/settings'),
  saveSettings: (body: SharedSettings) => request<SharedSettings>('PUT', '/settings', { body }),
};

/** URL absoluta del flujo SSE (para EventSource). */
export const EVENTS_URL = `${API_BASE}/events`;
