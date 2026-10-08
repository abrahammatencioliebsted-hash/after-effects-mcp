// Qué acciones humanas se ofrecen para una misión según su estado. Pura.
import type { MissionStatus } from '@mc/contracts';

export type MissionAction = 'approve' | 'reject' | 'accept' | 'changes' | 'rerun' | 'stop';

export interface ActionContext {
  status: MissionStatus;
  approvalPending: boolean;
  plan?: { status: 'pending' | 'approved' | 'rejected' } | undefined;
}

export function availableActions(m: ActionContext): MissionAction[] {
  const planPending = m.approvalPending || m.plan?.status === 'pending';
  switch (m.status) {
    case 'briefing':
      return planPending ? ['approve', 'reject', 'stop'] : ['stop'];
    case 'ongoing':
      return ['stop', 'rerun'];
    case 'review':
      return ['accept', 'changes', 'rerun'];
    case 'delivered':
      return ['rerun'];
    case 'blocked':
      return ['rerun', 'stop'];
    case 'cancelled':
      return [];
  }
}
