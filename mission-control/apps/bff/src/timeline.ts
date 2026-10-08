import type { RunSummary, TimelineEvent, TimelineKind } from '@mc/contracts';
import { asRecord, str } from './util.js';

const RANK: Partial<Record<TimelineKind, number>> = {
  created: 0,
  assigned: 1,
  plan_proposed: 2,
  plan_approved: 3,
  run_started: 4,
  retry: 4,
  message: 5,
  document: 5,
  run_finished: 6,
  run_failed: 6,
  escalated: 7,
  review_requested: 8,
  accepted: 9,
  rejected: 9,
};

/** Fusiona listas de eventos y las ordena por tiempo (estable; a igual instante, por orden lógico y luego id). */
export function mergeTimeline(...parts: TimelineEvent[][]): TimelineEvent[] {
  const all = parts.flat();
  return all.sort((a, b) => {
    const ta = Date.parse(a.at);
    const tb = Date.parse(b.at);
    if (ta !== tb) return ta - tb;
    const ra = RANK[a.kind] ?? 5;
    const rb = RANK[b.kind] ?? 5;
    if (ra !== rb) return ra - rb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface ActorLookup {
  agentName(id: string | undefined): string | undefined;
}

/** Acciones de actividad que se consideran ruido en la vista normal (sí van en el replay). */
const NOISE = /inbox_archived|inbox_|read|viewed|seen|label/;

/** Actividad de la issue → eventos (los comentarios se tratan aparte para no duplicar). */
export function activityToTimeline(activity: unknown[], actors: ActorLookup, opts: { includeNoise?: boolean } = {}): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const raw of activity) {
    const a = asRecord(raw);
    const action = str(a.action) ?? 'unknown';
    const at = str(a.createdAt);
    const id = str(a.id);
    if (!at || !id) continue;
    if (action === 'issue.comment_added') continue;
    const details = asRecord(a.details);
    const actorType = a.actorType === 'agent' ? 'agent' : a.actorType === 'user' ? 'user' : 'system';
    const actorId = str(a.agentId) ?? str(a.actorId);
    const actorName = actorType === 'agent' ? actors.agentName(actorId) : actorType === 'user' ? 'Operador' : 'Paperclip';
    const base = {
      id: `act-${id}`,
      at,
      actorType,
      ...(actorId ? { actorId } : {}),
      ...(actorName ? { actorName } : {}),
      ...(str(a.runId) ? { runId: str(a.runId)! } : {}),
      raw,
    } as const;

    if (action === 'issue.created') {
      out.push({ ...base, kind: 'created', summary: `Misión creada: ${(str(details.title) ?? '').replace(/\s·\s[0-9a-f]{6}$/, '')}`.trim() });
    } else if (action === 'issue.disposition_repair_escalated') {
      const attempts = details.attemptCount ?? details.maxAttempts;
      out.push({
        ...base,
        kind: 'escalated',
        actorType: 'system',
        actorName: 'Paperclip',
        summary: `Escalada al operador tras ${String(attempts ?? '?')} intentos de reparación (${str(details.terminalReason) ?? 'sin motivo'})`,
        body: JSON.stringify(details, null, 2),
      });
    } else if (action === 'issue.updated') {
      const changes = asRecord(details.changes);
      const st = asRecord(changes.status);
      const to = str(st.to) ?? str(details.status);
      const from = str(st.from);
      const asg = asRecord(changes.assigneeAgentId);
      if (to) {
        const kind: TimelineKind = to === 'in_review' ? 'review_requested' : to === 'done' && actorType === 'user' ? 'accepted' : 'status_changed';
        out.push({ ...base, kind, summary: `Estado: ${from ?? '?'} → ${to}` });
      } else if (str(asg.to)) {
        out.push({ ...base, kind: 'assigned', summary: `Asignada a ${actors.agentName(str(asg.to)) ?? str(asg.to)}` });
      } else if (opts.includeNoise) {
        out.push({ ...base, kind: 'system', summary: 'Misión actualizada' });
      }
    } else if (/assign/.test(action)) {
      out.push({ ...base, kind: 'assigned', summary: `Asignación: ${action}` });
    } else if (/retry|recovery|watchdog|approval|document|checkout|release/.test(action)) {
      const kind: TimelineKind = /retry/.test(action) ? 'retry' : /document/.test(action) ? 'document' : 'system';
      out.push({ ...base, kind, summary: action.replace(/^issue\./, '').replace(/_/g, ' ') });
    } else if (opts.includeNoise || !NOISE.test(action)) {
      if (opts.includeNoise) out.push({ ...base, kind: 'system', summary: action });
    }
  }
  return out;
}

/** Comentarios de la issue → eventos de mensaje (agente/usuario) o de sistema. */
export function commentsToTimeline(comments: unknown[], actors: ActorLookup): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const raw of comments) {
    const c = asRecord(raw);
    const id = str(c.id);
    const at = str(c.createdAt);
    const body = str(c.body) ?? '';
    if (!id || !at) continue;
    const authorType = c.authorType === 'agent' ? 'agent' : c.authorType === 'user' ? 'user' : 'system';
    const agentId = str(c.authorAgentId) ?? str(c.derivedAuthorAgentId);
    const name = authorType === 'agent' ? actors.agentName(agentId) : authorType === 'user' ? 'Operador' : 'Paperclip';
    const firstLine = body.split('\n').find((l) => l.trim()) ?? '';
    out.push({
      id: `cmt-${id}`,
      at,
      kind: authorType === 'system' ? 'system' : 'message',
      actorType: authorType,
      ...(agentId ? { actorId: agentId } : {}),
      ...(name ? { actorName: name } : {}),
      summary: firstLine.length > 140 ? `${firstLine.slice(0, 139)}…` : firstLine,
      body,
      ...(str(c.createdByRunId) ? { runId: str(c.createdByRunId)! } : {}),
      raw,
    });
  }
  return out;
}

/** Un run cuenta como reintento si tiene retryOfRunId, scheduledRetryAttempt > 0 o nació por 'automation' (reparación del vigilante). */
export function isRetryRun(raw: Record<string, unknown>): boolean {
  const attempt = typeof raw.scheduledRetryAttempt === 'number' ? raw.scheduledRetryAttempt : 0;
  return Boolean(str(raw.retryOfRunId)) || attempt > 0 || raw.invocationSource === 'automation';
}

/** Runs → eventos run_started / run_finished / run_failed (+ retry si es reintento). */
export function runsToTimeline(runs: RunSummary[], rawById: Map<string, unknown> = new Map()): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const r of runs) {
    const raw = rawById.get(r.id);
    const rawRec = asRecord(raw);
    const start = r.startedAt ?? str(rawRec.createdAt);
    if (isRetryRun(rawRec) && start) {
      const of = str(rawRec.retryOfRunId);
      out.push({ id: `run-retry-${r.id}`, at: start, kind: 'retry', actorType: 'system', actorName: 'Paperclip', summary: of ? `Reintento del run ${of.slice(0, 8)}` : `Run de reparación/automático (${str(rawRec.invocationSource) ?? 'automation'})`, runId: r.id, raw });
    }
    if (str(rawRec.invocationSource) === 'assignment' && str(rawRec.createdAt)) {
      out.push({ id: `run-assigned-${r.id}`, at: str(rawRec.createdAt)!, kind: 'assigned', actorType: 'system', actorName: 'Paperclip', actorId: r.agentId, summary: `Asignada a ${r.agentName}; Paperclip despierta al agente`, runId: r.id, raw });
    }
    if (start) {
      out.push({ id: `run-start-${r.id}`, at: start, kind: 'run_started', actorType: 'agent', actorId: r.agentId, actorName: r.agentName, summary: `${r.agentName} inicia run (${r.source})`, runId: r.id, raw });
    }
    if (r.finishedAt) {
      const failed = r.status === 'failed' || r.status === 'timed_out';
      out.push({
        id: `run-end-${r.id}`,
        at: r.finishedAt,
        kind: failed ? 'run_failed' : 'run_finished',
        actorType: 'agent',
        actorId: r.agentId,
        actorName: r.agentName,
        summary: failed ? `Run fallido: ${r.errorCode ?? r.error ?? r.status}` : r.status === 'cancelled' ? `Run cancelado${r.error ? `: ${r.error}` : ''}` : `Run terminado (${r.durationSec ?? 0} s, ${r.tokens.input + r.tokens.output} tokens)`,
        ...(r.error ? { body: r.error } : {}),
        runId: r.id,
        raw,
      });
    }
  }
  return out;
}
