// Mapeo estado -> etiqueta en español, tono (token de color) e icono. Lógica pura, sin React.
import type {
  AgentState,
  CapabilityState,
  CompatibilityState,
  MachineSummary,
  MissionStatus,
  Priority,
  ProvenanceNote,
  RunSummary,
  TimelineKind,
} from '@mc/contracts';

/** Tonos disponibles. Cada uno corresponde a un token CSS `--tone-<tono>`. */
export type Tone = 'accent' | 'ok' | 'warn' | 'crit' | 'info' | 'idle' | 'muted';

export interface StatusInfo {
  label: string;
  tone: Tone;
  /** Nombre de icono de components/Icon.tsx (el estado nunca va solo en color). */
  icon: string;
}

export function toneVar(tone: Tone): string {
  return `var(--tone-${tone})`;
}

const MISSION: Record<MissionStatus, StatusInfo> = {
  briefing: { label: 'Briefing', tone: 'info', icon: 'clipboard' },
  ongoing: { label: 'En curso', tone: 'accent', icon: 'activity' },
  review: { label: 'Revisión', tone: 'warn', icon: 'eye' },
  delivered: { label: 'Entregada', tone: 'ok', icon: 'check' },
  blocked: { label: 'Bloqueada', tone: 'crit', icon: 'alert' },
  cancelled: { label: 'Cancelada', tone: 'muted', icon: 'x' },
};

export function missionStatusInfo(status: MissionStatus): StatusInfo {
  return MISSION[status] ?? { label: String(status), tone: 'muted', icon: 'dot' };
}

/** Columnas del kanban, en orden. */
export const KANBAN_COLUMNS: MissionStatus[] = ['briefing', 'ongoing', 'review', 'delivered'];
export const MISSION_STATUSES: MissionStatus[] = ['briefing', 'ongoing', 'review', 'delivered', 'blocked', 'cancelled'];

const AGENT: Record<AgentState, StatusInfo> = {
  working: { label: 'Trabajando', tone: 'accent', icon: 'activity' },
  available: { label: 'Disponible', tone: 'idle', icon: 'check' },
  paused: { label: 'En pausa', tone: 'muted', icon: 'pause' },
  error: { label: 'Con error', tone: 'crit', icon: 'alert' },
  offline: { label: 'Sin conexión', tone: 'muted', icon: 'x' },
};

export function agentStateInfo(state: AgentState): StatusInfo {
  return AGENT[state] ?? { label: String(state), tone: 'muted', icon: 'dot' };
}

const PRIORITY: Record<Priority, StatusInfo & { rank: number }> = {
  critical: { label: 'Crítica', tone: 'crit', icon: 'flag', rank: 0 },
  high: { label: 'Alta', tone: 'warn', icon: 'flag', rank: 1 },
  medium: { label: 'Estándar', tone: 'info', icon: 'flag', rank: 2 },
  low: { label: 'Baja', tone: 'muted', icon: 'flag', rank: 3 },
};

export function priorityInfo(p: Priority): StatusInfo & { rank: number } {
  return PRIORITY[p] ?? { label: String(p), tone: 'muted', icon: 'flag', rank: 9 };
}

export function comparePriority(a: Priority, b: Priority): number {
  return priorityInfo(a).rank - priorityInfo(b).rank;
}

const MACHINE: Record<MachineSummary['status'], StatusInfo> = {
  online: { label: 'En línea', tone: 'ok', icon: 'check' },
  stale: { label: 'Latido atrasado', tone: 'warn', icon: 'clock' },
  offline: { label: 'Sin conexión', tone: 'crit', icon: 'x' },
  unknown: { label: 'Sin datos', tone: 'muted', icon: 'dot' },
};

export function machineStatusInfo(s: MachineSummary['status']): StatusInfo {
  return MACHINE[s] ?? MACHINE.unknown;
}

const RUN: Record<RunSummary['status'], StatusInfo> = {
  queued: { label: 'En cola', tone: 'muted', icon: 'clock' },
  running: { label: 'En ejecución', tone: 'accent', icon: 'activity' },
  succeeded: { label: 'Éxito', tone: 'ok', icon: 'check' },
  failed: { label: 'Falló', tone: 'crit', icon: 'alert' },
  cancelled: { label: 'Cancelado', tone: 'muted', icon: 'x' },
  timed_out: { label: 'Tiempo agotado', tone: 'warn', icon: 'clock' },
};

export function runStatusInfo(s: RunSummary['status']): StatusInfo {
  return RUN[s] ?? { label: String(s), tone: 'muted', icon: 'dot' };
}

const COMPAT: Record<CompatibilityState, StatusInfo & { long: string }> = {
  NC: { label: 'NC', long: 'No compatible', tone: 'crit', icon: 'x' },
  FV: { label: 'FV', long: 'Estructura verificada', tone: 'warn', icon: 'doc' },
  VL: { label: 'VL', long: 'Verificado en local', tone: 'info', icon: 'check' },
  PF: { label: 'PF', long: 'Listo para usar', tone: 'ok', icon: 'check' },
};

export function compatInfo(c: CompatibilityState): StatusInfo & { long: string } {
  return COMPAT[c] ?? { label: String(c), long: String(c), tone: 'muted', icon: 'dot' };
}

const CAP_STATE: Record<CapabilityState, StatusInfo> = {
  descubierta: { label: 'Descubierta', tone: 'muted', icon: 'search' },
  configurada: { label: 'Configurada', tone: 'info', icon: 'settings' },
  probada: { label: 'Probada', tone: 'ok', icon: 'check' },
  pendiente: { label: 'Pendiente', tone: 'warn', icon: 'clock' },
  incompatible: { label: 'Incompatible', tone: 'crit', icon: 'x' },
};

export function capabilityStateInfo(s: CapabilityState): StatusInfo {
  return CAP_STATE[s] ?? { label: String(s), tone: 'muted', icon: 'dot' };
}

const PROVENANCE: Record<ProvenanceNote['state'], StatusInfo> = {
  real: { label: 'Real', tone: 'ok', icon: 'check' },
  simulado: { label: 'Simulado', tone: 'warn', icon: 'flask' },
  pendiente: { label: 'Pendiente', tone: 'muted', icon: 'clock' },
};

export function provenanceInfo(s: ProvenanceNote['state']): StatusInfo {
  return PROVENANCE[s] ?? { label: String(s), tone: 'muted', icon: 'dot' };
}

const TIMELINE: Record<TimelineKind, { label: string; icon: string; tone: Tone }> = {
  created: { label: 'Creada', icon: 'plus', tone: 'info' },
  assigned: { label: 'Asignada', icon: 'user', tone: 'info' },
  run_started: { label: 'Run iniciado', icon: 'play', tone: 'accent' },
  run_finished: { label: 'Run terminado', icon: 'check', tone: 'ok' },
  run_failed: { label: 'Run fallido', icon: 'alert', tone: 'crit' },
  message: { label: 'Mensaje', icon: 'chat', tone: 'accent' },
  plan_proposed: { label: 'Plan propuesto', icon: 'clipboard', tone: 'warn' },
  plan_approved: { label: 'Plan aprobado', icon: 'check', tone: 'ok' },
  status_changed: { label: 'Cambio de estado', icon: 'flag', tone: 'muted' },
  retry: { label: 'Reintento', icon: 'refresh', tone: 'warn' },
  escalated: { label: 'Escalada', icon: 'alert', tone: 'crit' },
  review_requested: { label: 'Revisión pedida', icon: 'eye', tone: 'warn' },
  accepted: { label: 'Aceptada', icon: 'check', tone: 'ok' },
  rejected: { label: 'Rechazada', icon: 'x', tone: 'crit' },
  document: { label: 'Documento', icon: 'doc', tone: 'info' },
  system: { label: 'Sistema', icon: 'cpu', tone: 'muted' },
};

export function timelineKindInfo(k: TimelineKind): { label: string; icon: string; tone: Tone } {
  return TIMELINE[k] ?? { label: String(k), icon: 'dot', tone: 'muted' };
}

/** Severidad de una medición contra su umbral de alerta (para medidores). */
export type Severity = 'ok' | 'warn' | 'crit';

export function severityFor(percent: number, alertAt: number): Severity {
  if (!Number.isFinite(percent)) return 'ok';
  if (percent >= alertAt) return 'crit';
  if (percent >= alertAt - 15) return 'warn';
  return 'ok';
}

export function severityTone(s: Severity): Tone {
  return s === 'ok' ? 'accent' : s === 'warn' ? 'warn' : 'crit';
}

export const SEVERITY_TEXT: Record<Severity, string> = { ok: 'Normal', warn: 'Atención', crit: 'Crítico' };

/** Etiqueta humana de plataforma. */
export function platformLabel(p: string | undefined): string {
  switch (p) {
    case 'hermes': return 'Hermes';
    case 'claude': return 'Claude';
    case 'codex': return 'Codex';
    case 'grok': return 'Grok';
    case 'mimo': return 'MiMo';
    case 'operador': return 'Operador';
    default: return p ?? '—';
  }
}

export function scopeLabel(s: string): string {
  return s === 'trabajo' ? 'Trabajo' : s === 'proyectos' ? 'Proyectos' : s === 'personal' ? 'Personal' : s;
}

/** Une páginas de una lista paginada por cursor sin repetir elementos (gana la primera aparición). */
export function mergePages<T extends { id: string }>(...pages: T[][]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages) for (const it of page) if (!seen.has(it.id)) { seen.add(it.id); out.push(it); }
  return out;
}
