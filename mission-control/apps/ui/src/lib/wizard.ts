// Borrador y validación del asistente de misiones (lógica pura, probada en test/).
import type { FinishPolicy, MissionCreateRequest, Priority, ReportLength, TeamMode } from '@mc/contracts';

export interface Draft {
  title: string;
  objective: string;
  priority: Priority;
  targetDate: string;
  scope: MissionCreateRequest['scope'];
  teamMode: TeamMode;
  agentIds: string[];
  bossAgentId: string;
  capabilities: string[];
  maxMinutes: number;
  maxSteps: number;
  reportLength: ReportLength;
  finish: FinishPolicy;
}

export const BLANK: Draft = {
  title: '', objective: '', priority: 'medium', targetDate: '', scope: 'proyectos', teamMode: 'boss', agentIds: [], bossAgentId: '', capabilities: [],
  maxMinutes: 60, maxSteps: 3, reportLength: 'medium', finish: 'review_first',
};

/** Datos externos de los que depende la validación del asistente. */
export interface StepContext {
  /** Modo «reglas»: hay catálogo cargado y con capacidades que elegir. */
  catalogReady: boolean;
}

export function validateStep(step: number, d: Draft, ctx: StepContext = { catalogReady: true }): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 0) {
    if (!d.title.trim()) e.title = 'Escribe un título.';
    else if (d.title.trim().length < 4) e.title = 'El título es demasiado corto.';
    if (!d.objective.trim()) e.objective = 'Describe el objetivo para que el agente sepa qué entregar.';
  }
  if (step === 1) {
    if (d.teamMode === 'manual' && d.agentIds.length === 0) e.team = 'Elige al menos un agente.';
    if (d.teamMode === 'rules' && !ctx.catalogReady) e.team = 'El catálogo de capacidades no está disponible: reintenta la carga o cambia de modo de equipo.';
    if (d.teamMode === 'boss' && !d.bossAgentId) e.team = 'No hay agente jefe definido: elígelo en Ajustes o usa equipo manual.';
  }
  if (step === 2) {
    if (!(d.maxMinutes >= 5 && d.maxMinutes <= 720)) e.maxMinutes = 'Entre 5 y 720 minutos.';
    if (!(d.maxSteps >= 1 && d.maxSteps <= 12)) e.maxSteps = 'Entre 1 y 12 pasos.';
  }
  return e;
}


/** Clave de idempotencia ligada al cuerpo enviado: mismo cuerpo = misma clave (reintento seguro); cuerpo distinto = clave nueva. */
export interface IdemState { key: string; fingerprint: string }

export function resolveIdempotencyKey(prev: IdemState | null, fingerprint: string, makeKey: () => string): IdemState {
  return prev && prev.fingerprint === fingerprint ? prev : { key: makeKey(), fingerprint };
}

/**
 * El BFF responde 409 con `code: 'conflict'` y `details.code: 'idempotency_key_conflict'` cuando la clave ya se usó con otro cuerpo
 * (también se acepta el código plano por si el contrato lo promueve).
 */
export function isIdempotencyConflict(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown; details?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  const inner = (e.details as { code?: unknown } | undefined)?.code;
  return e.code === 'idempotency_key_conflict' || (e.status === 409 && inner === 'idempotency_key_conflict');
}
