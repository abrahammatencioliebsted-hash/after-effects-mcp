// Ayudantes para el mock de Hermes (@mc/hermes-mock) y para analizar su registro de peticiones.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOCK_DIST = path.resolve(HERE, '../../packages/hermes-mock/dist/index.js');

/**
 * Carga `startHermesMock`. Primero el paquete del workspace (`@mc/hermes-mock`, si está enlazado);
 * si no, el `dist` por ruta relativa (así `@mc/tests` no obliga a tocar el lockfile).
 */
export async function loadMock() {
  try {
    return await import('@mc/hermes-mock');
  } catch {
    if (!fs.existsSync(MOCK_DIST)) throw new Error(`Falta el build del mock: ${MOCK_DIST} (pnpm --filter @mc/hermes-mock build)`);
    return import(pathToFileURL(MOCK_DIST).href);
  }
}

/** Peticiones registradas que corresponden a un run de Paperclip (por Idempotency-Key) o a un run del mock. */
export function requestsFor(requests, { mockRunId } = {}) {
  return requests.filter((r) => mockRunId && r.path.startsWith(`/v1/runs/${mockRunId}`));
}

export const countPath = (requests, method, re) =>
  requests.filter((r) => r.method === method && re.test(r.path.split('?')[0])).length;

export const postRuns = (requests) => requests.filter((r) => r.method === 'POST' && r.path.split('?')[0] === '/v1/runs');
export const eventGets = (requests) => requests.filter((r) => r.method === 'GET' && /^\/v1\/runs\/[^/]+\/events$/.test(r.path.split('?')[0]));
export const stops = (requests) => requests.filter((r) => r.method === 'POST' && /^\/v1\/runs\/[^/]+\/stop$/.test(r.path.split('?')[0]));
export const statusGets = (requests) => requests.filter((r) => r.method === 'GET' && /^\/v1\/runs\/[^/]+$/.test(r.path.split('?')[0]));

/** Resumen compacto de peticiones (sin cuerpos largos) para el informe. */
export function summarizeRequests(requests) {
  return requests.map((r) => ({
    at: r.at, method: r.method, path: r.path, status: r.status ?? null,
    ...(r.headers['idempotency-key'] ? { idempotencyKey: r.headers['idempotency-key'] } : {}),
    ...(r.headers['x-hermes-session-key'] ? { sessionKey: r.headers['x-hermes-session-key'] } : {}),
    ...(r.headers['last-event-id'] ? { lastEventId: r.headers['last-event-id'] } : {}),
  }));
}

/** Tokens declarados por el mock para un run (fuente de verdad de lo que Paperclip debería registrar). */
export function mockUsage(mock, mockRunId) {
  const run = mock.runs.get(mockRunId);
  return run?.usage ? { input: run.usage.input_tokens, output: run.usage.output_tokens } : null;
}

/** Agrupa por método+ruta normalizada (ids → :id) para tablas de recuento. */
export function histogram(requests) {
  const h = {};
  for (const r of requests) {
    const key = `${r.method} ${r.path.split('?')[0].replace(/run_[0-9a-f]+/g, ':runId')}${r.status ? ` → ${r.status}` : ''}`;
    h[key] = (h[key] ?? 0) + 1;
  }
  return h;
}
