import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  FAULT_KEYS,
  TERMINAL_STATUSES,
  type Faults,
  type HermesMockHandle,
  type HermesMockOptions,
  type MockRequestRecord,
  type MockRun,
  type MockRunStatus,
  type MockUsage,
} from './types.js';

/* -------------------------------------------------------------------------- */
/* Constantes del contrato (espejo de gateway/platforms/api_server*.py)        */
/* -------------------------------------------------------------------------- */

const MAX_SESSION_HEADER_LEN = 256;
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_COMPLETE_DELAY_MS = 300;
const DEFAULT_MAX_CONCURRENT_RUNS = 10;
const DEFAULT_KEEPALIVE_MS = 10_000;
const DEFAULT_OUTPUT_TEMPLATE = 'MC-MOCK-OK: respuesta simulada del mock de Hermes (input_chars={inputChars}).';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const STATIC_FEATURE_FLAGS = {
  run_status: true,
  run_events_sse: true,
  run_stop: true,
  run_steer: true,
  run_approval_response: false,
  tool_progress_events: false,
  approval_events: false,
  session_resources: false,
  model_options: false,
  session_chat: false,
  session_chat_streaming: false,
  session_fork: false,
  session_model_lock: false,
  reasoning_streaming: false,
  admin_config_rw: false,
  jobs_admin: false,
  memory_write_api: false,
  skills_api: false,
  audio_api: false,
  realtime_voice: false,
  session_continuity_header: 'X-Hermes-Session-Id',
  session_key_header: 'X-Hermes-Session-Key',
} as const;

const CAPABILITY_ENDPOINTS: Record<string, { method: string; path: string }> = {
  health: { method: 'GET', path: '/health' },
  runs: { method: 'POST', path: '/v1/runs' },
  run_status: { method: 'GET', path: '/v1/runs/{run_id}' },
  run_events: { method: 'GET', path: '/v1/runs/{run_id}/events' },
  run_steer: { method: 'POST', path: '/v1/runs/{run_id}/steer' },
  run_stop: { method: 'POST', path: '/v1/runs/{run_id}/stop' },
};

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                  */
/* -------------------------------------------------------------------------- */

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Sobre de error estilo OpenAI que usa Hermes (`_openai_error`). */
function errorBody(message: string, type = 'invalid_request_error', code: string | null = null): unknown {
  return { error: { message, type, param: null, code } };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** JSON con escape ASCII, como `json.dumps` de Python en los frames SSE. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u0080-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is Record<string, unknown> => isRecord(p) && p['type'] === 'text')
      .map((p) => String(p['text'] ?? ''))
      .join(' ');
  }
  return '';
}

/** Mensaje de usuario como lo extrae Hermes: cadena, o `content` del último elemento de la lista. */
function extractUserMessage(rawInput: unknown): string {
  if (typeof rawInput === 'string') return rawInput;
  if (Array.isArray(rawInput)) {
    const last = rawInput[rawInput.length - 1];
    return isRecord(last) ? contentToText(last['content']) : '';
  }
  return '';
}

function nowSeconds(): number {
  return Date.now() / 1000;
}

function splitChunks(text: string, parts: number): string[] {
  const size = Math.max(1, Math.ceil(text.length / parts));
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length > 0 ? out : [''];
}

function validateFaultValue(key: keyof Faults, value: unknown): void {
  if (key === 'dropSseAfterEvents' || key === 'latencyMs') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`Fault "${key}" debe ser un número >= 0`);
    }
  } else if (typeof value !== 'boolean') {
    throw new TypeError(`Fault "${key}" debe ser booleano`);
  }
}

/* -------------------------------------------------------------------------- */
/* Servidor                                                                    */
/* -------------------------------------------------------------------------- */

interface RunInternals {
  timer: NodeJS.Timeout | undefined;
  waiters: Set<() => void>;
}

interface RouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  params: Record<string, string>;
  rawBody: string;
}

interface Route {
  method: string;
  pattern: RegExp;
  auth: boolean;
  mock?: boolean;
  handler: (ctx: RouteContext) => Promise<void> | void;
}

export async function startHermesMock(opts: HermesMockOptions): Promise<HermesMockHandle> {
  if (!opts || typeof opts.apiKey !== 'string' || opts.apiKey.length === 0) {
    throw new TypeError('startHermesMock: apiKey es obligatoria');
  }
  const host = opts.host ?? '127.0.0.1';
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`startHermesMock: solo se admite loopback (recibido "${host}")`);
  }
  const apiKeyBuf = Buffer.from(opts.apiKey);
  const completeDelayMs = Math.max(0, opts.completeDelayMs ?? DEFAULT_COMPLETE_DELAY_MS);
  const maxConcurrentRuns = Math.max(0, opts.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS);
  const keepaliveMs = Math.max(10, opts.keepaliveMs ?? DEFAULT_KEEPALIVE_MS);
  const outputTemplate = opts.outputText ?? DEFAULT_OUTPUT_TEMPLATE;

  const faults: Faults = {};
  const runs = new Map<string, MockRun>();
  const internals = new Map<string, RunInternals>();
  const requests: MockRequestRecord[] = [];
  /** Reservas de idempotencia (un único ámbito: hay una sola clave de API). */
  const idempotency = new Map<string, { fingerprint: string; runId: string }>();
  const timers = new Set<NodeJS.Timeout>();
  let closing = false;

  function applyFaults(patch: Partial<Faults>): void {
    for (const [k, v] of Object.entries(patch)) {
      if (!(FAULT_KEYS as readonly string[]).includes(k)) throw new TypeError(`Fault desconocido: "${k}"`);
      const key = k as keyof Faults;
      if (v === undefined || v === null) {
        delete faults[key];
        continue;
      }
      validateFaultValue(key, v);
      (faults as Record<string, unknown>)[key] = v;
    }
  }
  if (opts.faults) applyFaults(opts.faults);
  const initialFaults: Partial<Faults> = { ...faults };

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, ms);
      timers.add(t);
    });
  }

  /* --------------------------- respuestas HTTP --------------------------- */

  function sendJson(
    res: http.ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      ...headers,
    });
    res.end(payload);
  }

  function sendError(
    res: http.ServerResponse,
    status: number,
    message: string,
    opts2: { type?: string; code?: string | null; headers?: Record<string, string> } = {},
  ): void {
    sendJson(res, status, errorBody(message, opts2.type, opts2.code ?? null), opts2.headers);
  }

  function sendAuthFailed(res: http.ServerResponse): void {
    // Forma real de Hermes (`_auth_failed_response`).
    sendJson(res, 401, {
      error: {
        message: 'Invalid gateway API key (API_SERVER_KEY)',
        type: 'gateway_auth_error',
        code: 'gateway_auth_failed',
      },
    });
  }

  function sendText(res: http.ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
    res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      ...headers,
    });
    res.end(text);
  }

  function checkBearer(req: http.IncomingMessage): boolean {
    const header = req.headers['authorization'] ?? '';
    if (!header.startsWith('Bearer ')) return false;
    const token = Buffer.from(header.slice(7).trim());
    return token.length === apiKeyBuf.length && timingSafeEqual(token, apiKeyBuf);
  }

  async function readBody(req: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /* ------------------------------ ciclo de vida ------------------------------ */

  function wake(runId: string): void {
    const st = internals.get(runId);
    if (!st) return;
    for (const w of [...st.waiters]) w();
  }

  function pushEvent(run: MockRun, name: string, fields: Record<string, unknown> = {}): void {
    if (run.streamClosed) return;
    const seq = run.events.length;
    run.events.push({ seq, payload: { event: name, run_id: run.runId, timestamp: nowSeconds(), ...fields } });
    run.lastEvent = name;
    run.updatedAt = nowSeconds();
    wake(run.runId);
  }

  function setStatus(run: MockRun, status: MockRunStatus, lastEvent?: string): void {
    run.status = status;
    run.updatedAt = nowSeconds();
    if (lastEvent) run.lastEvent = lastEvent;
  }

  function usageFor(run: MockRun, output: string): MockUsage {
    const inTokens = Math.max(1, Math.ceil(run.inputChars / 4));
    const outTokens = Math.max(1, Math.ceil(output.length / 4));
    return {
      input_tokens: inTokens,
      output_tokens: outTokens,
      total_tokens: inTokens + outTokens,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    };
  }

  /** Estado terminal + evento `run.<status>` + marca de cierre del stream. */
  function finishRun(run: MockRun, status: Exclude<MockRunStatus, 'queued' | 'running' | 'stopping'>): void {
    if (TERMINAL_STATUSES.has(run.status)) return;
    const st = internals.get(run.runId);
    if (st?.timer) {
      clearTimeout(st.timer);
      timers.delete(st.timer);
      st.timer = undefined;
    }
    const fields: Record<string, unknown> = {};
    if (status === 'completed') {
      const output = renderOutput(run);
      run.output = output;
      run.usage = usageFor(run, output);
      run.runtime = { provider: 'mock', model: 'mock-model' };
      run.completed = true;
      run.partial = false;
      run.interrupted = false;
      Object.assign(fields, {
        output: run.output,
        usage: run.usage,
        runtime: run.runtime,
        completed: true,
        partial: false,
        interrupted: false,
      });
    } else if (status === 'failed') {
      run.error = 'Fallo simulado por el mock de Hermes (failNextRun)';
      run.completed = false;
      run.partial = false;
      run.interrupted = false;
      Object.assign(fields, { error: run.error, completed: false, partial: false, interrupted: false });
    } else {
      run.completed = false;
      run.partial = false;
      run.interrupted = status === 'cancelled';
      Object.assign(fields, { completed: false, partial: false, interrupted: run.interrupted });
    }
    setStatus(run, status, `run.${status}`);
    pushEvent(run, `run.${status}`, fields);
    run.streamClosed = true;
    wake(run.runId);
  }

  function renderOutput(run: MockRun): string {
    return outputTemplate.split('{inputChars}').join(String(run.inputChars));
  }

  function scheduleRun(run: MockRun): void {
    const st = internals.get(run.runId);
    if (!st) return;
    const output = renderOutput(run);
    const steps: Array<() => void> = [
      () => pushEvent(run, 'reasoning.available', { text: 'Razonamiento simulado (mock).' }),
      ...splitChunks(output, 3).map((delta) => () => pushEvent(run, 'message.delta', { delta })),
    ];
    // Un run colgado solo emite el primer evento y se queda esperando stop.
    const stepCount = run.hang ? 1 : steps.length;
    const interval = completeDelayMs / (stepCount + 1);
    let i = 0;
    const arm = (): void => {
      const t = setTimeout(() => {
        timers.delete(t);
        st.timer = undefined;
        if (closing || TERMINAL_STATUSES.has(run.status) || run.status === 'stopping') return;
        if (i < stepCount) {
          steps[i++]?.();
          arm();
        } else if (!run.hang) {
          finishRun(run, run.willFail ? 'failed' : 'completed');
        }
      }, interval);
      timers.add(t);
      st.timer = t;
    };
    const start = setTimeout(() => {
      timers.delete(start);
      if (closing || TERMINAL_STATUSES.has(run.status)) return;
      setStatus(run, 'running');
      arm();
    }, 0);
    timers.add(start);
    st.timer = start;
  }

  function activeRunCount(): number {
    let n = 0;
    for (const r of runs.values()) if (!TERMINAL_STATUSES.has(r.status)) n++;
    return n;
  }

  function serializeRun(run: MockRun): Record<string, unknown> {
    // Orden de claves igual que `_set_run_status` + `_finish` de Hermes.
    const out: Record<string, unknown> = {
      object: 'hermes.run',
      run_id: run.runId,
      status: run.status,
      updated_at: run.updatedAt,
      created_at: run.createdAt,
      session_id: run.sessionId,
      model: run.model,
      last_event: run.lastEvent,
    };
    if (run.error !== undefined) out['error'] = run.error;
    if (run.output !== undefined) out['output'] = run.output;
    if (run.usage !== undefined) out['usage'] = run.usage;
    if (run.runtime !== undefined) out['runtime'] = run.runtime;
    if (run.completed !== undefined) out['completed'] = run.completed;
    if (run.partial !== undefined) out['partial'] = run.partial;
    if (run.interrupted !== undefined) out['interrupted'] = run.interrupted;
    return out;
  }

  /* ------------------------------- manejadores ------------------------------- */

  function acceptedResponse(
    res: http.ServerResponse,
    run: MockRun,
    status: string,
    sessionKey: string | null,
    replayed: boolean,
  ): void {
    const headers: Record<string, string> = {};
    if (replayed) headers['Idempotency-Replayed'] = 'true';
    if (sessionKey) headers['X-Hermes-Session-Key'] = sessionKey;
    sendJson(res, 202, { run_id: run.runId, status, replayed }, headers);
  }

  async function handleCreateRun({ req, res, rawBody }: RouteContext): Promise<void> {
    if (faults.rateLimitNext) {
      delete faults.rateLimitNext;
      sendError(res, 429, 'Rate limit simulado por el mock (rateLimitNext)', {
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
        headers: { 'Retry-After': '1' },
      });
      return;
    }
    // X-Hermes-Session-Key
    const rawKey = (req.headers['x-hermes-session-key'] as string | undefined)?.trim() ?? '';
    let sessionKey: string | null = null;
    if (rawKey) {
      if (/[\r\n\0]/.test(rawKey)) {
        sendJson(res, 400, { error: { message: 'Invalid session key', type: 'invalid_request_error' } });
        return;
      }
      if (rawKey.length > MAX_SESSION_HEADER_LEN) {
        sendJson(res, 400, { error: { message: 'Session key too long', type: 'invalid_request_error' } });
        return;
      }
      sessionKey = rawKey;
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      sendError(res, 400, 'Invalid JSON');
      return;
    }
    if (!isRecord(body)) {
      sendError(res, 400, 'Request body must be a JSON object');
      return;
    }
    const idemKey = ((req.headers['idempotency-key'] as string | undefined) ?? '').trim();
    // eslint-disable-next-line no-control-regex
    if (idemKey.length > 255 || /[^\x21-\x7e]/.test(idemKey)) {
      sendError(res, 400, 'Idempotency-Key must be 1-255 visible ASCII characters', {
        code: 'invalid_idempotency_key',
      });
      return;
    }
    const fingerprint = idemKey
      ? createHash('sha256').update(canonicalJson({ body, gateway_session_key: sessionKey ?? '' })).digest('hex')
      : '';
    if (!body['input']) {
      sendError(res, 400, "Missing 'input' field");
      return;
    }
    const userMessage = extractUserMessage(body['input']);
    if (!userMessage) {
      sendError(res, 400, 'No user message found in input');
      return;
    }
    // Un replay se resuelve aunque el tope de concurrencia esté lleno (no reserva nada).
    const useIdempotency = idemKey !== '' && !faults.duplicateReplayAsNew;
    if (useIdempotency) {
      const stored = idempotency.get(idemKey);
      if (stored) {
        if (stored.fingerprint !== fingerprint) {
          sendError(res, 409, 'Idempotency-Key was already used with a different request payload', {
            code: 'idempotency_key_conflict',
          });
          return;
        }
        const original = runs.get(stored.runId);
        if (original) {
          acceptedResponse(res, original, original.status, sessionKey, true);
          return;
        }
      }
    }
    if (maxConcurrentRuns > 0 && activeRunCount() >= maxConcurrentRuns) {
      sendError(res, 429, `Too many concurrent runs (max ${maxConcurrentRuns})`, {
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
        headers: { 'Retry-After': '1' },
      });
      return;
    }

    const hang = faults.hangNextRun === true;
    const willFail = faults.failNextRun === true;
    delete faults.hangNextRun;
    delete faults.failNextRun;

    const runId = `run_${randomUUID().replaceAll('-', '')}`;
    const t = nowSeconds();
    const instructions = typeof body['instructions'] === 'string' ? body['instructions'] : undefined;
    const run: MockRun = {
      runId,
      status: 'queued',
      createdAt: t,
      updatedAt: t,
      sessionId: typeof body['session_id'] === 'string' && body['session_id'] ? body['session_id'] : runId,
      sessionKey,
      idempotencyKey: idemKey || null,
      model: typeof body['model'] === 'string' && body['model'] ? body['model'] : 'hermes-agent',
      input: userMessage,
      inputChars: userMessage.length,
      ...(instructions !== undefined ? { instructions } : {}),
      ...(body['metadata'] !== undefined ? { metadata: body['metadata'] } : {}),
      lastEvent: null,
      hang,
      willFail,
      events: [],
      streamClosed: false,
    };
    runs.set(runId, run);
    internals.set(runId, { timer: undefined, waiters: new Set() });
    if (useIdempotency) idempotency.set(idemKey, { fingerprint, runId });
    scheduleRun(run);
    acceptedResponse(res, run, 'started', sessionKey, false);
  }

  function findRun(res: http.ServerResponse, runId: string): MockRun | undefined {
    const run = runs.get(runId);
    if (!run) {
      sendError(res, 404, `Run not found: ${runId}`, { code: 'run_not_found' });
      return undefined;
    }
    return run;
  }

  function handleGetRun({ res, params }: RouteContext): void {
    const run = findRun(res, params['run_id'] ?? '');
    if (run) sendJson(res, 200, serializeRun(run));
  }

  function handleStopRun({ res, params }: RouteContext): void {
    const run = findRun(res, params['run_id'] ?? '');
    if (!run) return;
    if (TERMINAL_STATUSES.has(run.status)) {
      sendJson(res, 200, serializeRun(run));
      return;
    }
    setStatus(run, 'stopping', 'run.stopping');
    // Cancelación cooperativa: el estado terminal llega un instante después, como en Hermes.
    const st = internals.get(run.runId);
    if (st?.timer) {
      clearTimeout(st.timer);
      timers.delete(st.timer);
      st.timer = undefined;
    }
    const t = setTimeout(() => {
      timers.delete(t);
      if (!closing) finishRun(run, 'cancelled');
    }, 20);
    timers.add(t);
    sendJson(res, 200, { run_id: run.runId, status: 'stopping' });
  }

  async function handleSteerRun({ res, params, rawBody }: RouteContext): Promise<void> {
    const run = findRun(res, params['run_id'] ?? '');
    if (!run) return;
    if (run.status !== 'running') {
      sendError(res, 409, `Run is not currently accepting steer input: ${run.runId}`, {
        code: 'run_not_accepting_steer',
      });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      sendError(res, 400, 'Invalid JSON in request body');
      return;
    }
    if (!isRecord(body)) {
      sendError(res, 400, 'Request body must be a JSON object');
      return;
    }
    const text = contentToText(body['input'] ?? body['message'] ?? body['text'] ?? '').trim();
    if (!text) {
      sendError(res, 400, "Missing non-empty steer text; expected 'input', 'message', or 'text'.", {
        code: 'invalid_steer_input',
      });
      return;
    }
    pushEvent(run, 'run.steered', { accepted: true });
    sendJson(res, 200, { object: 'hermes.run.steer', run_id: run.runId, accepted: true });
  }

  function shouldDropSse(framesWritten: number): boolean {
    const n = faults.dropSseAfterEvents;
    return n !== undefined && framesWritten >= n;
  }

  async function handleRunEvents({ req, res, url, params }: RouteContext): Promise<void> {
    const run = findRun(res, params['run_id'] ?? '');
    if (!run) return;
    const st = internals.get(run.runId);
    if (!st) return;
    const rawLast = (req.headers['last-event-id'] as string | undefined) ?? url.searchParams.get('last_seq');
    let lastSeq = -1;
    if (rawLast !== undefined && rawLast !== null) {
      const parsed = Number.parseInt(String(rawLast).trim(), 10);
      lastSeq = Number.isFinite(parsed) ? Math.max(-1, parsed) : -1;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    let gone = false;
    res.on('close', () => {
      gone = true;
      for (const w of [...st.waiters]) w();
    });
    const write = (s: string): void => {
      if (!gone) res.write(s);
    };
    /** Escribe y espera a que el dato salga hacia el kernel (para cortar sin perder el ultimo frame). */
    const writeFlushed = (s: string): Promise<void> =>
      new Promise((resolve) => {
        if (gone) return resolve();
        res.write(s, () => resolve());
      });
    const drop = (): void => {
      delete faults.dropSseAfterEvents; // una sola vez
      gone = true;
      req.socket.destroy();
    };

    await writeFlushed(': open\n\n');
    let written = 0;
    if (shouldDropSse(written)) return drop();
    let next = lastSeq + 1;
    while (!gone && !closing) {
      while (next < run.events.length) {
        const ev = run.events[next]!;
        await writeFlushed(`id: ${ev.seq}\ndata: ${asciiJson({ ...ev.payload, seq: ev.seq })}\n\n`);
        next++;
        written++;
        if (shouldDropSse(written)) return drop();
      }
      if (run.streamClosed) {
        write(': stream closed\n\n');
        res.end();
        return;
      }
      const reason = await new Promise<'wake' | 'keepalive'>((resolve) => {
        const done = (r: 'wake' | 'keepalive'): void => {
          clearTimeout(t);
          timers.delete(t);
          st.waiters.delete(onWake);
          resolve(r);
        };
        const onWake = (): void => done('wake');
        const t = setTimeout(() => done('keepalive'), keepaliveMs);
        timers.add(t);
        st.waiters.add(onWake);
      });
      if (reason === 'keepalive') write(': keepalive\n\n');
    }
    if (!gone) res.end();
  }

  function handleCapabilities({ res }: RouteContext): void {
    sendJson(res, 200, {
      object: 'hermes.api_server.capabilities',
      platform: 'hermes-agent',
      model: 'hermes-agent',
      auth: { type: 'bearer', required: true },
      runtime: {
        mode: 'server_agent',
        tool_execution: 'server',
        split_runtime: false,
        description:
          'MOCK de Hermes: simula el contrato HTTP del API server; no ejecuta ningun modelo ni herramienta.',
      },
      features: {
        chat_completions: false,
        chat_completions_streaming: false,
        responses_api: false,
        responses_streaming: false,
        run_submission: true,
        runs_idempotency: { supported: true, durable: false, retention_seconds: 86400 },
        ...STATIC_FEATURE_FLAGS,
        cors: false,
      },
      endpoints: CAPABILITY_ENDPOINTS,
    });
  }

  function handleHealth({ res }: RouteContext): void {
    sendJson(res, 200, { status: 'ok', platform: 'hermes-agent', version: 'mock' });
  }

  /* ------------------------- rutas de control /__mock ------------------------- */

  async function handleMockFaults({ res, rawBody }: RouteContext): Promise<void> {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      sendError(res, 400, 'Invalid JSON');
      return;
    }
    if (!isRecord(body)) {
      sendError(res, 400, 'Request body must be a JSON object');
      return;
    }
    try {
      applyFaults(body as Partial<Faults>);
    } catch (e) {
      sendError(res, 400, (e as Error).message);
      return;
    }
    sendJson(res, 200, { faults: { ...faults } });
  }

  function handleMockState({ res }: RouteContext): void {
    sendJson(res, 200, {
      faults: { ...faults },
      runs: [...runs.values()],
      requests,
    });
  }

  function handleMockReset({ res }: RouteContext): void {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const st of internals.values()) for (const w of [...st.waiters]) w();
    runs.clear();
    internals.clear();
    idempotency.clear();
    requests.length = 0;
    for (const k of Object.keys(faults)) delete (faults as Record<string, unknown>)[k];
    Object.assign(faults, initialFaults);
    sendJson(res, 200, { ok: true });
  }

  /* ---------------------------------- rutas ---------------------------------- */

  const routes: Route[] = [
    { method: 'GET', pattern: /^\/health$/, auth: false, handler: handleHealth },
    { method: 'GET', pattern: /^\/v1\/health$/, auth: false, handler: handleHealth },
    { method: 'GET', pattern: /^\/v1\/capabilities$/, auth: true, handler: handleCapabilities },
    { method: 'POST', pattern: /^\/v1\/runs$/, auth: true, handler: handleCreateRun },
    { method: 'GET', pattern: /^\/v1\/runs\/(?<run_id>[^/]+)$/, auth: true, handler: handleGetRun },
    { method: 'GET', pattern: /^\/v1\/runs\/(?<run_id>[^/]+)\/events$/, auth: true, handler: handleRunEvents },
    { method: 'POST', pattern: /^\/v1\/runs\/(?<run_id>[^/]+)\/steer$/, auth: true, handler: handleSteerRun },
    { method: 'POST', pattern: /^\/v1\/runs\/(?<run_id>[^/]+)\/stop$/, auth: true, handler: handleStopRun },
    { method: 'POST', pattern: /^\/__mock\/faults$/, auth: true, mock: true, handler: handleMockFaults },
    { method: 'GET', pattern: /^\/__mock\/state$/, auth: true, mock: true, handler: handleMockState },
    { method: 'POST', pattern: /^\/__mock\/reset$/, auth: true, mock: true, handler: handleMockReset },
  ];

  async function dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', 'http://mock.local');
    const pathname = url.pathname;
    const isMockPath = pathname.startsWith('/__mock/');

    let rawBody = '';
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') rawBody = await readBody(req);

    let record: MockRequestRecord | undefined;
    if (!isMockPath) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        headers[k] = Array.isArray(v) ? v.join(', ') : v;
      }
      if (headers['authorization']) headers['authorization'] = 'Bearer ***';
      record = { at: new Date().toISOString(), method, path: pathname + url.search, headers };
      if (rawBody.trim() !== '') {
        try {
          record.body = JSON.parse(rawBody);
        } catch {
          record.body = rawBody;
        }
      }
      requests.push(record);
      res.on('finish', () => {
        if (record) record.status = res.statusCode;
      });
    }

    if (!isMockPath && faults.latencyMs && faults.latencyMs > 0) await sleep(faults.latencyMs);

    // Enrutado (antes que la autenticación, como aiohttp).
    let matched: { route: Route; params: Record<string, string> } | undefined;
    const allowed = new Set<string>();
    for (const route of routes) {
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      allowed.add(route.method);
      if (route.method === method) matched = { route, params: { ...(m.groups ?? {}) } };
    }
    if (!matched) {
      if (allowed.size > 0) {
        sendText(res, 405, '405: Method Not Allowed', { Allow: [...allowed].join(', ') });
      } else {
        sendText(res, 404, '404: Not Found');
      }
      return;
    }
    const { route, params } = matched;

    if (route.auth) {
      if (!route.mock && faults.unauthorizedNext) {
        delete faults.unauthorizedNext;
        sendAuthFailed(res);
        return;
      }
      if (!checkBearer(req)) {
        sendAuthFailed(res);
        return;
      }
    }

    await route.handler({ req, res, url, params, rawBody });
  }

  const server = http.createServer((req, res) => {
    dispatch(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        sendError(res, err.status, err.message);
      } else {
        sendError(res, 500, 'Internal mock error', { type: 'server_error' });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const addr = server.address() as AddressInfo;
  const urlHost = host === '::1' ? '[::1]' : host;

  return {
    url: `http://${urlHost}:${addr.port}`,
    port: addr.port,
    runs,
    requests,
    setFaults(f: Partial<Faults>): void {
      applyFaults(f);
    },
    getFaults(): Faults {
      return { ...faults };
    },
    async close(): Promise<void> {
      if (closing) return;
      closing = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const st of internals.values()) for (const w of [...st.waiters]) w();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
