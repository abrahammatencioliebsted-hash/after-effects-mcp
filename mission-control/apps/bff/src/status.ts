import type { MissionStatus, PaperclipIssueStatus } from '@mc/contracts';

/** Mapeo issue de Paperclip → estado del tablero MC (docs/03-arquitectura.md §4). */
export function mapIssueStatus(s: string | undefined | null): MissionStatus {
  switch (s) {
    case 'backlog':
    case 'todo':
      return 'briefing';
    case 'in_progress':
      return 'ongoing';
    case 'in_review':
      return 'review';
    case 'done':
      return 'delivered';
    case 'blocked':
      return 'blocked';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    default:
      return 'briefing';
  }
}

/** Estado de issue de Paperclip que corresponde a cada estado MC (inverso aproximado, para filtros). */
export function paperclipStatusesFor(s: MissionStatus): PaperclipIssueStatus[] {
  switch (s) {
    case 'briefing':
      return ['backlog', 'todo'];
    case 'ongoing':
      return ['in_progress'];
    case 'review':
      return ['in_review'];
    case 'delivered':
      return ['done'];
    case 'blocked':
      return ['blocked'];
    case 'cancelled':
      return ['cancelled'];
  }
}

export const MISSION_STATUSES: MissionStatus[] = ['briefing', 'ongoing', 'review', 'delivered', 'blocked', 'cancelled'];

export function isMissionStatus(s: string): s is MissionStatus {
  return (MISSION_STATUSES as string[]).includes(s);
}

export function isPriority(s: unknown): s is 'critical' | 'high' | 'medium' | 'low' {
  return s === 'critical' || s === 'high' || s === 'medium' || s === 'low';
}

export type MissionAction = 'accept' | 'request-changes' | 'rerun' | 'stop';

const ALLOWED: Record<MissionAction, MissionStatus[]> = {
  accept: ['review', 'blocked', 'ongoing'],
  'request-changes': ['review', 'blocked', 'delivered'],
  rerun: ['review', 'blocked', 'delivered', 'cancelled'],
  stop: ['briefing', 'ongoing', 'review', 'blocked'],
};

/** ¿Se permite la acción desde este estado? Mismas reglas en demo y paperclip. */
export function actionAllowed(action: MissionAction, status: MissionStatus): boolean {
  return ALLOWED[action].includes(status);
}
