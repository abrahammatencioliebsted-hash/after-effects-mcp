// Hook de EventSource con reconexión automática (backoff exponencial con tope) sobre GET /api/mc/events.
import { useEffect, useRef, useState } from 'react';
import type { McEvent } from '@mc/contracts';
import { EVENTS_URL, isMockEnabled } from './api.ts';

export type StreamState = 'connecting' | 'open' | 'reconnecting' | 'mock' | 'closed';

export const EVENT_TYPES: McEvent['type'][] = ['mission.changed', 'mission.message', 'agent.changed', 'machine.changed', 'activity', 'heartbeat'];

/** Backoff: 1 s, 2 s, 4 s ... tope 20 s. */
export function backoffMs(attempt: number): number {
  return Math.min(20_000, 1000 * 2 ** Math.max(0, attempt));
}

export function parseEvent(type: string, data: string): McEvent | null {
  try {
    const obj = JSON.parse(data) as Record<string, unknown>;
    return { ...obj, type } as McEvent;
  } catch {
    return null;
  }
}

/** Suscribe `onEvent` al flujo SSE. Devuelve el estado de la conexión. */
export function useEventStream(onEvent: (e: McEvent) => void): StreamState {
  const [state, setState] = useState<StreamState>(isMockEnabled() ? 'mock' : 'connecting');
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (isMockEnabled()) {
      // En modo ?mock=1 no hay BFF ni flujo en vivo.
      setState('mock');
      return;
    }
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      es = new EventSource(EVENTS_URL);
      es.onopen = () => {
        attempt = 0;
        setState('open');
      };
      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (ev) => {
          const parsed = parseEvent(type, (ev as MessageEvent<string>).data);
          if (parsed) handler.current(parsed);
        });
      }
      es.onerror = () => {
        es?.close();
        es = null;
        if (stopped) return;
        setState('reconnecting');
        timer = setTimeout(connect, backoffMs(attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      es?.close();
      setState('closed');
    };
  }, []);

  return state;
}
