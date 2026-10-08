import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentSummary, HealthReport, McEvent, SharedSettings } from '@mc/contracts';
import { api, isMockEnabled } from '../lib/api.ts';
import { DEFAULT_SETTINGS, applyTheme, loadLocalSettings, saveLocalSettings } from '../lib/theme.ts';
import type { LocalSettings } from '../lib/theme.ts';
import { useEventStream } from '../lib/sse.ts';
import type { StreamState } from '../lib/sse.ts';
import { useResource } from './hooks.ts';
import type { Resource } from './hooks.ts';

export interface WizardPrefill {
  title?: string;
  objective?: string;
  ideaId?: string;
}

export interface Toast {
  id: number;
  tone: 'ok' | 'crit' | 'info' | 'warn';
  text: string;
}

export interface LiveRevs {
  missions: number;
  agents: number;
  machines: number;
  activity: number;
  /** Último evento de mensaje de misión, para animar la línea de tiempo */
  lastMessageMission?: string;
}

interface AppValue {
  mock: boolean;
  local: LocalSettings;
  setLocal: (next: LocalSettings) => void;
  health: Resource<HealthReport>;
  agents: Resource<AgentSummary[]>;
  settings: Resource<SharedSettings>;
  live: LiveRevs;
  stream: StreamState;
  /** true si el BFF o Paperclip no responden */
  degraded: { bff: boolean; paperclipBaseUrl?: string | undefined };
  /** Fuerza la recarga de las listas que dependen de `live` (p. ej. tras una acción local). */
  bump: (k: 'missions' | 'agents' | 'machines' | 'activity') => void;
  toast: (tone: Toast['tone'], text: string) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  wizard: { open: boolean; prefill?: WizardPrefill | undefined };
  openWizard: (prefill?: WizardPrefill) => void;
  closeWizard: () => void;
  agentWizardOpen: boolean;
  setAgentWizardOpen: (v: boolean) => void;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp fuera de <AppProvider>');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const mock = isMockEnabled();
  const [local, setLocalState] = useState<LocalSettings>(() => loadLocalSettings());
  const [live, setLive] = useState<LiveRevs>({ missions: 0, agents: 0, machines: 0, activity: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [wizard, setWizard] = useState<AppValue['wizard']>({ open: false });
  const [agentWizardOpen, setAgentWizardOpen] = useState(false);
  const pending = useRef<Set<keyof LiveRevs>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { applyTheme(local); }, [local]);
  useEffect(() => {
    if (local.scheme !== 'auto' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const on = () => applyTheme(local);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [local]);

  const setLocal = useCallback((next: LocalSettings) => {
    setLocalState(next);
    saveLocalSettings(next);
  }, []);

  // Eventos SSE -> contadores de revisión (con agrupación de 400 ms para no inundar de peticiones)
  const flush = useCallback(() => {
    timer.current = undefined;
    const keys = pending.current;
    pending.current = new Set();
    setLive((l) => {
      const next = { ...l };
      for (const k of keys) if (k !== 'lastMessageMission') (next as unknown as Record<string, number>)[k] = ((next as unknown as Record<string, number>)[k] ?? 0) + 1;
      return next;
    });
  }, []);
  const onEvent = useCallback((e: McEvent) => {
    const add = (k: keyof LiveRevs) => {
      pending.current.add(k);
      timer.current ??= setTimeout(flush, 400);
    };
    switch (e.type) {
      case 'mission.changed': add('missions'); add('agents'); break;
      case 'mission.message': add('missions'); add('activity'); break;
      case 'agent.changed': add('agents'); add('activity'); break;
      case 'machine.changed': add('machines'); break;
      case 'activity': add('activity'); break;
      case 'heartbeat': break;
    }
  }, [flush]);
  const stream = useEventStream(onEvent);

  const health = useResource(() => api.health(), [live.machines]);
  const agents = useResource(() => api.agents(), [live.agents]);
  const settings = useResource(() => api.settings(), []);

  // Refresco periódico de salud para detectar caídas de Paperclip
  useEffect(() => {
    const t = setInterval(() => health.reload(), 20_000);
    return () => clearInterval(t);
  }, [health.reload]);

  const toast = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const degraded = useMemo(() => {
    const bffDown = Boolean(health.error) && !health.data;
    const paperclipDown = health.data && !health.data.paperclip.reachable;
    return { bff: bffDown, paperclipBaseUrl: paperclipDown ? health.data?.paperclip.baseUrl : undefined };
  }, [health.error, health.data]);

  const bump = useCallback((k: 'missions' | 'agents' | 'machines' | 'activity') => setLive((l) => ({ ...l, [k]: l[k] + 1 })), []);

  const value: AppValue = {
    mock, local, setLocal, health, agents, settings, live, stream, degraded, bump, toast, toasts, dismissToast,
    wizard,
    openWizard: (prefill) => setWizard({ open: true, prefill }),
    closeWizard: () => setWizard({ open: false }),
    agentWizardOpen, setAgentWizardOpen,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { DEFAULT_SETTINGS };
