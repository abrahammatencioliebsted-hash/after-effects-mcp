/**
 * Tipos públicos del mock de Hermes. Es una SIMULACIÓN del contrato HTTP del
 * API server de Hermes (gateway/platforms/api_server*.py); no ejecuta modelo ni herramientas.
 */

/** Fallos inyectables. Los "Next" se consumen al usarse (una sola vez). */
export interface Faults {
  /** Cierra el socket SSE tras escribir N eventos (una sola vez); la reconexión funciona normal. */
  dropSseAfterEvents?: number;
  /** El próximo run termina en `failed` con un `error` (se consume al crear el run). */
  failNextRun?: boolean;
  /** El próximo run no termina nunca hasta recibir stop (se consume al crear el run). */
  hangNextRun?: boolean;
  /** La próxima petición autenticada responde 401 aunque la clave sea correcta (una vez). */
  unauthorizedNext?: boolean;
  /** El próximo POST /v1/runs responde 429 + Retry-After (una vez). */
  rateLimitNext?: boolean;
  /** Milisegundos añadidos a cada respuesta (persistente hasta cambiarlo). */
  latencyMs?: number;
  /** Mal comportamiento: ignora la idempotencia y crea un run nuevo siempre (persistente). */
  duplicateReplayAsNew?: boolean;
}

export const FAULT_KEYS: ReadonlyArray<keyof Faults> = [
  'dropSseAfterEvents',
  'failNextRun',
  'hangNextRun',
  'unauthorizedNext',
  'rateLimitNext',
  'latencyMs',
  'duplicateReplayAsNew',
];

/** Estados del run, como en Hermes real (`stopped` del contrato informal = `cancelled`). */
export type MockRunStatus = 'queued' | 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export const TERMINAL_STATUSES: ReadonlySet<MockRunStatus> = new Set<MockRunStatus>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

export interface MockUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface MockRunEvent {
  /** Secuencia 0-based, es el `id:` del frame SSE. */
  seq: number;
  /** Carga completa (sin `seq`; se añade al serializar, como en Hermes real). */
  payload: Record<string, unknown>;
}

export interface MockRun {
  runId: string;
  status: MockRunStatus;
  /** Segundos epoch (float), como `time.time()` de Hermes. */
  createdAt: number;
  updatedAt: number;
  sessionId: string;
  /** Valor `X-Hermes-Session-Key` recibido (o null). */
  sessionKey: string | null;
  idempotencyKey: string | null;
  model: string;
  input: string;
  inputChars: number;
  instructions?: string;
  metadata?: unknown;
  lastEvent: string | null;
  output?: string;
  usage?: MockUsage;
  runtime?: { provider: string; model: string };
  error?: string;
  completed?: boolean;
  partial?: boolean;
  interrupted?: boolean;
  /** Se creó con `hangNextRun`. */
  hang: boolean;
  /** Se creó con `failNextRun`. */
  willFail: boolean;
  events: MockRunEvent[];
  /** El stream ya recibió su marca final (`: stream closed`). */
  streamClosed: boolean;
}

export interface MockRequestRecord {
  at: string;
  method: string;
  path: string;
  /** Cabeceras en minúsculas; `authorization` va enmascarada. */
  headers: Record<string, string>;
  body?: unknown;
  /** Código HTTP final (se rellena al terminar la respuesta). */
  status?: number;
}

export interface HermesMockOptions {
  port?: number;
  /** Solo loopback (127.0.0.1, localhost, ::1). */
  host?: string;
  apiKey: string;
  faults?: Partial<Faults>;
  /** Texto de salida; admite el marcador `{inputChars}`. Por defecto contiene "MC-MOCK-OK". */
  outputText?: string;
  /** Tope de runs activos; 0 lo desactiva. Por defecto 10 (igual que Hermes real). */
  maxConcurrentRuns?: number;
  /** Duración total simulada de un run. Por defecto 300 ms. */
  completeDelayMs?: number;
  /** Intervalo de comentarios `: keepalive` en SSE. Por defecto 10000 ms (como Hermes). */
  keepaliveMs?: number;
}

export interface HermesMockHandle {
  url: string;
  port: number;
  close(): Promise<void>;
  setFaults(f: Partial<Faults>): void;
  getFaults(): Faults;
  runs: ReadonlyMap<string, MockRun>;
  requests: MockRequestRecord[];
}
