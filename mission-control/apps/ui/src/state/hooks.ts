import { useCallback, useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';
import { ApiRequestError } from '../lib/api.ts';
import { buildHash, parseHash } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';

export interface Resource<T> {
  data: T | undefined;
  error: ApiRequestError | Error | undefined;
  /** true solo en la primera carga (sin datos previos) */
  loading: boolean;
  /** true mientras se vuelve a pedir con datos previos en pantalla */
  reloading: boolean;
  reload: () => void;
}

/** Carga con estados explícitos. Conserva los datos anteriores mientras recarga ("refetch keeps the frame"). */
export function useResource<T>(fetcher: () => Promise<T>, deps: DependencyList, enabled = true): Resource<T> {
  const [state, setState] = useState<{ data?: T; error?: ApiRequestError | Error; busy: boolean }>({ busy: enabled });
  const [tick, setTick] = useState(0);
  const ref = useRef(fetcher);
  ref.current = fetcher;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((s) => ({ ...s, busy: true }));
    ref.current().then(
      (data) => { if (!cancelled) setState({ data, busy: false }); },
      (error: unknown) => {
        if (cancelled) return;
        const err = error instanceof Error ? error : new Error(String(error));
        setState((s) => ({ ...(s.data !== undefined ? { data: s.data } : {}), error: err, busy: false }));
      },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, loading: state.busy && state.data === undefined && !state.error, reloading: state.busy && state.data !== undefined, reload };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(typeof location !== 'undefined' ? location.hash : ''));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(view: string, id?: string, query?: Record<string, string | undefined>): void {
  const next = buildHash(view, id, query);
  if (location.hash === next) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = next;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Reloj que se actualiza cada `ms` (para "hace 5 min"). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useLocalPref<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback((next: T) => {
    setV(next);
    try { localStorage.setItem(key, next); } catch { /* sin almacenamiento */ }
  }, [key]);
  return [v, set];
}
