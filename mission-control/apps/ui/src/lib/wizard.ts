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

export function validateStep(step: number, d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 0) {
    if (!d.title.trim()) e.title = 'Escribe un título.';
    else if (d.title.trim().length < 4) e.title = 'El título es demasiado corto.';
    if (!d.objective.trim()) e.objective = 'Describe el objetivo para que el agente sepa qué entregar.';
  }
  if (step === 1) {
    if (d.teamMode === 'manual' && d.agentIds.length === 0) e.team = 'Elige al menos un agente.';
    if (d.teamMode === 'boss' && !d.bossAgentId) e.team = 'No hay agente jefe definido: elígelo en Ajustes o usa equipo manual.';
  }
  if (step === 2) {
    if (!(d.maxMinutes >= 5 && d.maxMinutes <= 720)) e.maxMinutes = 'Entre 5 y 720 minutos.';
    if (!(d.maxSteps >= 1 && d.maxSteps <= 12)) e.maxSteps = 'Entre 1 y 12 pasos.';
  }
  return e;
}

