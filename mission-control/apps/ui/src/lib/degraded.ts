// Lógica pura del modo degradado: decide si el BFF/Paperclip están caídos a partir del ÚLTIMO resultado
// de /health (aunque haya datos previos) y cuándo hay que refrescar las listas.
import type { HealthReport } from '@mc/contracts';
import { ApiRequestError } from './api.ts';
import type { StreamState } from './sse.ts';

/** true si el error indica que el BFF no responde (sin red, proxy sin BFF o 5xx propio). */
export function isBffDownError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  // Paperclip/Hermes caídos son fallos aguas abajo: el BFF sí responde.
  if (error.code === 'paperclip_unreachable' || error.code === 'hermes_unreachable') return false;
  return error.code === 'network' || error.status === 0 || error.status >= 500;
}

export interface Degraded {
  bff: boolean;
  paperclipBaseUrl?: string | undefined;
  /** Marca de tiempo (ms) del último informe bueno cuando el BFF está caído y aún se muestran datos viejos. */
  staleSince?: number | undefined;
}

/** Estado degradado a partir del último error y los últimos datos conocidos de /health. */
export function computeDegraded(health: { data?: HealthReport | undefined; error?: unknown; staleSince?: number | undefined }): Degraded {
  const bff = isBffDownError(health.error);
  // Con el BFF caído el último informe es historia: no se lee como "Paperclip vivo/caído".
  const paperclipDown = !bff && health.data !== undefined && !health.data.paperclip.reachable;
  return {
    bff,
    paperclipBaseUrl: paperclipDown ? health.data?.paperclip.baseUrl : undefined,
    staleSince: bff ? health.staleSince : undefined,
  };
}

/** Al recuperar el BFF (caído -> sano) hay que refrescar todas las listas. */
export function recovered(prevBffDown: boolean, bffDown: boolean): boolean {
  return prevBffDown && !bffDown;
}

/** Tras reconectar el flujo SSE se pudieron perder eventos: hay que re-sincronizar. */
export function resyncAfterStream(prev: StreamState, next: StreamState): boolean {
  return prev === 'reconnecting' && next === 'open';
}
