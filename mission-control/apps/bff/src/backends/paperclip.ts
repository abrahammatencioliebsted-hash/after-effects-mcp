import { randomUUID } from 'node:crypto';
import { PaperclipError, type PaperclipAgent, type PaperclipClient, type PaperclipHeartbeatRun, type PaperclipIssue } from '@mc/paperclip-client';
import type {
  ActivityItem,
  AgentCreateRequest,
  AgentState,
  AgentSummary,
  DocumentSummary,
  HealthReport,
  MachineId,
  MachineSummary,
  McEvent,
  MissionCreateRequest,
  MissionDetail,
  MissionPlan,
  MissionStatus,
  MissionSummary,
  Overview,
  Platform,
  ProvenanceNote,
  RoutineSummary,
  RunSummary,
  TimelineEvent,
  TokenUsage,
} from '@mc/contracts';
import { avg, countByStatus, emptyTokens, heatmapFrom, runsInWindow, successRate, sumTokens } from '../aggregate.js';
import { HttpError, badRequest, conflict, notFound } from '../errors.js';
import { actionAllowed, isPriority, mapIssueStatus, paperclipStatusesFor, type MissionAction } from '../status.js';
import { activityToTimeline, commentsToTimeline, isRetryRun, mergeTimeline, runsToTimeline } from '../timeline.js';
import { asRecord, excerpt, iso, num, paginate, str, wordCount } from '../util.js';
import { BFF_VERSION, type BackendDeps, type McBackend, type MissionQuery } from './types.js';

export interface PaperclipBackendOptions {
  client: PaperclipClient;
  baseUrl: string;
  companyId?: string;
  /** Intervalo del sondeo que alimenta el SSE. Por defecto 5000 ms. */
  pollMs?: number;
  /** ¿Hay token de node-agent configurado? (solo para las notas de salud) */
  nodeAgentTokenSet?: boolean;
  fetchImpl?: typeof fetch;
}

const TITLE_SUFFIX = /\s·\s[0-9a-f]{6}$/;
const AGENT_ROLES = ['ceo', 'cto', 'cmo', 'cfo', 'security', 'engineer', 'designer', 'pm', 'qa', 'devops', 'researcher', 'general'];
const ACTIVE_RUN = new Set(['queued', 'scheduled_retry', 'running']);

interface AgentInfo {
  raw: PaperclipAgent;
  id: string;
  name: string;
  shortName: string;
  platform: Platform;
  machineId?: MachineId;
  modelLabel?: string;
  effort: NonNullable<AgentSummary['effort']>;
}

interface MetaRow {
  issue_id: string;
  objective: string;
  team_json: string;
  limits_json: string;
  finish: string;
  scope: string;
  idea_id: string | null;
  target_date: string | null;
  title: string | null;
  required_caps_json: string;
  retry_count: number;
}

interface PlanRow {
  id: string;
  issue_id: string;
  status: string;
  plan_json: string;
  note: string | null;
  created_at: number;
  decided_at: number | null;
}

/** Traduce errores del cliente de Paperclip al contrato de errores del BFF. */
export function mapPaperclipError(err: unknown, baseUrl: string): HttpError | undefined {
  if (!(err instanceof PaperclipError)) return undefined;
  switch (err.code) {
    case 'unreachable':
    case 'timeout':
      return new HttpError(503, 'paperclip_unreachable', `Paperclip no responde en ${baseUrl}`, { baseUrl, reason: err.message });
    case 'unauthorized':
      return new HttpError(503, 'paperclip_unreachable', 'Paperclip rechazó las credenciales (revisa MC_PAPERCLIP_TOKEN)', { baseUrl, status: err.status });
    case 'not_found':
      return new HttpError(404, 'not_found', 'No encontrado en Paperclip', { baseUrl, reason: err.message });
    case 'conflict':
      return new HttpError(409, 'conflict', err.message, { body: err.body });
    case 'invalid':
      return new HttpError(err.status === 422 ? 409 : 400, err.status === 422 ? 'conflict' : 'invalid_request', err.message, { body: err.body });
    default:
      return new HttpError(502, 'internal', err.message, { baseUrl, status: err.status });
  }
}

export class PaperclipBackend implements McBackend {
  readonly mode = 'paperclip' as const;
  private readonly c: PaperclipClient;
  private readonly baseUrl: string;
  private companyIdCache: string | undefined;
  private readonly listeners = new Set<(e: McEvent) => void>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private readonly pollMs: number;
  private readonly memo = new Map<string, { at: number; value: Promise<unknown> }>();
  private readonly startedAtMs = Date.now();
  private readonly doFetch: typeof fetch;
  // estado del sondeo
  private snap: { issues: Map<string, string>; runs: Map<string, string>; agents: Map<string, AgentState>; activityIds: Set<string>; comments: Map<string, string> } | null = null;

  constructor(
    private readonly deps: BackendDeps,
    private readonly opts: PaperclipBackendOptions,
  ) {
    this.c = opts.client;
    this.baseUrl = opts.baseUrl;
    this.companyIdCache = opts.companyId;
    this.pollMs = opts.pollMs ?? 5000;
    this.doFetch = opts.fetchImpl ?? ((...a) => globalThis.fetch(...a));
  }

  mapError(err: unknown): HttpError | undefined {
    return mapPaperclipError(err, this.baseUrl);
  }

  // ---------------------------------------------------------------- utilidades

  private async company(): Promise<string> {
    if (this.companyIdCache) return this.companyIdCache;
    const list = await this.c.listCompanies();
    const first = list[0];
    if (!first) throw new HttpError(409, 'conflict', 'Paperclip no tiene ninguna empresa; define MC_PAPERCLIP_COMPANY_ID o crea una');
    this.companyIdCache = first.id;
    return first.id;
  }

  /** Cachea una consulta unos segundos para que las vistas que piden lo mismo en paralelo no multipliquen llamadas. */
  private cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.memo.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
    const value = fn();
    this.memo.set(key, { at: Date.now(), value });
    value.catch(() => this.memo.delete(key));
    return value;
  }

  private invalidate(): void {
    this.memo.clear();
  }

  private now(): number {
    return this.deps.now ? this.deps.now().getTime() : Date.now();
  }

  private async rawAgents(): Promise<PaperclipAgent[]> {
    const cid = await this.company();
    return this.cached('agents', 3000, () => this.c.listAgents(cid));
  }

  private async rawIssues(): Promise<PaperclipIssue[]> {
    const cid = await this.company();
    const all = await this.cached('issues', 3000, () => this.c.listIssues(cid, { limit: 1000 }));
    return all.filter((i) => !str(asRecord(i).hiddenAt));
  }

  private async rawRuns(): Promise<PaperclipHeartbeatRun[]> {
    const cid = await this.company();
    return this.cached('runs', 3000, () => this.c.listHeartbeatRuns(cid, { limit: 1000 }));
  }

  /** `GET /issues/{id}/runs` (devuelve `runId` en vez de `id`); se normaliza a la forma de heartbeat-run. */
  private async issueRuns(issueId: string): Promise<PaperclipHeartbeatRun[]> {
    const list = await this.c.request<Array<Record<string, unknown>>>('GET', `/issues/${issueId}/runs`).catch(() => [] as Array<Record<string, unknown>>);
    return list.map((r) => ({ ...r, id: str(r.id) ?? str(r.runId) ?? '' }) as unknown as PaperclipHeartbeatRun).filter((r) => r.id);
  }

  private async rawLive(): Promise<PaperclipHeartbeatRun[]> {
    const cid = await this.company();
    return this.cached('live', 2000, () => this.c.listLiveRuns(cid));
  }

  private archivedSet(): Set<string> {
    const rows = this.deps.db.prepare('SELECT agent_id FROM archived_agents').all() as Array<{ agent_id: string }>;
    return new Set(rows.map((r) => r.agent_id));
  }

  private platformOf(a: PaperclipAgent): Platform {
    const meta = asRecord(a.metadata);
    const mp = str(meta.platform);
    if (mp && ['hermes', 'claude', 'codex', 'grok', 'mimo', 'operador'].includes(mp)) return mp as Platform;
    switch (a.adapterType) {
      case 'hermes_gateway':
      case 'hermes_local':
        return 'hermes';
      case 'claude_local':
        return 'claude';
      case 'codex_local':
        return 'codex';
      case 'grok_local':
        return 'grok';
      default:
        return 'operador';
    }
  }

  private machineOf(a: PaperclipAgent): MachineId | undefined {
    const meta = asRecord(a.metadata);
    const mm = str(meta.machineId);
    if (mm) return mm;
    const base = str(asRecord(a.adapterConfig).apiBaseUrl);
    if (base) {
      const hit = this.deps.machines.list().find((m) => m.hermes?.apiServer.baseUrl && m.hermes.apiServer.baseUrl.replace(/\/+$/, '') === base.replace(/\/+$/, ''));
      if (hit) return hit.id;
      if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(base)) return 'win-principal';
      return undefined;
    }
    // adaptadores locales corren donde corre Paperclip
    return 'win-principal';
  }

  private async agentIndex(): Promise<Map<string, AgentInfo>> {
    const archived = this.archivedSet();
    const map = new Map<string, AgentInfo>();
    for (const raw of await this.rawAgents()) {
      if (archived.has(raw.id) || raw.status === 'terminated') continue;
      const meta = asRecord(raw.metadata);
      const effort = str(meta.effort);
      const machineId = this.machineOf(raw);
      const modelLabel = str(meta.modelLabel);
      map.set(raw.id, {
        raw,
        id: raw.id,
        name: raw.name,
        shortName: str(meta.shortName) ?? raw.name.split(/\s+/)[0]!.slice(0, 12),
        platform: this.platformOf(raw),
        ...(machineId ? { machineId } : {}),
        ...(modelLabel ? { modelLabel } : {}),
        effort: (['low', 'medium', 'high', 'xhigh', 'max'].includes(effort ?? '') ? effort : 'unknown') as NonNullable<AgentSummary['effort']>,
      });
    }
    return map;
  }

  private tokensOfRun(r: PaperclipHeartbeatRun, agent?: AgentInfo): TokenUsage {
    const u = asRecord(r.usageJson);
    if (!r.usageJson) return emptyTokens();
    const base = { input: num(u.inputTokens), output: num(u.outputTokens), cachedInput: num(u.cachedInputTokens) };
    const status = str(u.costStatus);
    if (status && status !== 'unpriced' && status !== 'unknown') {
      const cents = typeof u.costCents === 'number' ? u.costCents : typeof u.costUsd === 'number' ? u.costUsd * 100 : null;
      return { ...base, estimatedCents: cents, costStatus: 'reported' };
    }
    const model = str(u.model) && u.model !== 'unknown' ? (u.model as string) : agent?.modelLabel;
    return this.deps.settings.applyEstimate({ ...base, estimatedCents: null, costStatus: 'unpriced' }, model);
  }

  private toRun(r: PaperclipHeartbeatRun, agents: Map<string, AgentInfo>): RunSummary {
    const agent = agents.get(r.agentId);
    const started = r.startedAt ?? undefined;
    const finished = r.finishedAt ?? undefined;
    let status: RunSummary['status'];
    let errorCode = r.errorCode ?? undefined;
    switch (r.status) {
      case 'queued':
      case 'scheduled_retry':
        status = 'queued';
        break;
      case 'running':
        status = 'running';
        break;
      case 'succeeded':
        status = 'succeeded';
        break;
      case 'cancelled':
      case 'canceled':
        status = 'cancelled';
        break;
      case 'timed_out':
        status = 'timed_out';
        break;
      case 'interrupted':
        status = 'failed';
        errorCode = errorCode ?? 'interrupted';
        break;
      default:
        status = 'failed';
    }
    const src = r.invocationSource;
    const source: RunSummary['source'] = src === 'assignment' || src === 'on_demand' || src === 'automation' || src === 'timer' ? src : 'unknown';
    const u = asRecord(r.usageJson);
    const model = str(u.model) && u.model !== 'unknown' ? (u.model as string) : agent?.modelLabel;
    return {
      id: r.id,
      agentId: r.agentId,
      agentName: agent?.name ?? asRecord(r).agentName?.toString() ?? r.agentId.slice(0, 8),
      status,
      source,
      ...(started ? { startedAt: started } : {}),
      ...(finished ? { finishedAt: finished } : {}),
      ...(started && finished ? { durationSec: Math.max(0, Math.round((Date.parse(finished) - Date.parse(started)) / 1000)) } : {}),
      tokens: this.tokensOfRun(r, agent),
      ...(model ? { modelLabel: model } : {}),
      adapterType: agent?.raw.adapterType ?? str(u.provider) ?? 'unknown',
      ...(agent?.machineId ? { machineId: agent.machineId } : {}),
      ...(r.error ? { error: r.error } : {}),
      ...(errorCode ? { errorCode } : {}),
    };
  }

  private runIssueId(r: PaperclipHeartbeatRun): string | undefined {
    const ctx = asRecord(r.contextSnapshot);
    return str(ctx.issueId) ?? str(ctx.taskId);
  }

  private meta(issueId: string): MetaRow | undefined {
    return this.deps.db.prepare('SELECT * FROM missions_meta WHERE issue_id = ?').get(issueId) as MetaRow | undefined;
  }

  private latestPlan(issueId: string): PlanRow | undefined {
    return this.deps.db.prepare('SELECT * FROM plans WHERE issue_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(issueId) as PlanRow | undefined;
  }

  private planOf(row: PlanRow | undefined): MissionPlan | undefined {
    if (!row) return undefined;
    const p = JSON.parse(row.plan_json) as MissionPlan;
    return { ...p, id: row.id, status: row.status as MissionPlan['status'] };
  }

  private displayTitle(i: PaperclipIssue): string {
    return i.title.replace(TITLE_SUFFIX, '');
  }

  private summarize(i: PaperclipIssue, ctx: { agents: Map<string, AgentInfo>; runsByIssue: Map<string, PaperclipHeartbeatRun[]>; issues: PaperclipIssue[] }): MissionSummary {
    const meta = this.meta(i.id);
    const a = i.assigneeAgentId ? ctx.agents.get(i.assigneeAgentId) : undefined;
    const rawRuns = ctx.runsByIssue.get(i.id) ?? [];
    const runs = rawRuns.map((r) => this.toRun(r, ctx.agents));
    const kids = ctx.issues.filter((k) => k.parentId === i.id);
    const retries = rawRuns.filter((r) => isRetryRun(r as unknown as Record<string, unknown>)).length + (meta?.retry_count ?? 0);
    const priority = isPriority(i.priority) ? i.priority : 'medium';
    return {
      id: i.id,
      identifier: i.identifier,
      title: this.displayTitle(i),
      status: mapIssueStatus(i.status),
      paperclipStatus: i.status,
      priority,
      scope: (meta?.scope as MissionSummary['scope'] | undefined) ?? 'trabajo',
      ...(i.assigneeAgentId ? { assigneeAgentId: i.assigneeAgentId } : {}),
      ...(a ? { assigneeName: a.name, ...(a.machineId ? { machineId: a.machineId } : {}), platform: a.platform, ...(a.modelLabel ? { modelLabel: a.modelLabel } : {}) } : {}),
      createdAt: i.createdAt,
      ...(i.startedAt ? { startedAt: i.startedAt } : {}),
      ...(i.completedAt ? { completedAt: i.completedAt } : {}),
      ...(meta?.target_date ? { targetDate: meta.target_date } : {}),
      durationSec: runs.reduce((s, r) => s + (r.durationSec ?? 0), 0),
      tokens: sumTokens(runs.map((r) => r.tokens)),
      retryCount: retries,
      approvalPending: this.latestPlan(i.id)?.status === 'pending',
      childCount: kids.length,
      childDoneCount: kids.filter((k) => k.status === 'done').length,
      ...(meta?.idea_id ? { ideaId: meta.idea_id } : {}),
    };
  }

  private async runsByIssue(): Promise<Map<string, PaperclipHeartbeatRun[]>> {
    const m = new Map<string, PaperclipHeartbeatRun[]>();
    for (const r of await this.rawRuns()) {
      const id = this.runIssueId(r);
      if (!id) continue;
      const l = m.get(id);
      if (l) l.push(r);
      else m.set(id, [r]);
    }
    return m;
  }

  // ---------------------------------------------------------------- suscripción y sondeo

  subscribe(listener: (e: McEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: McEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch {
        /* oyente roto */
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Un ciclo de sondeo: compara issues/runs/agentes/actividad con la foto anterior y emite eventos. Público para pruebas. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      this.invalidate();
      const [issues, runs, agents, live] = await Promise.all([this.rawIssues(), this.rawRuns(), this.agentIndex(), this.rawLive()]);
      const cid = await this.company();
      const activity = await this.c.listCompanyActivity(cid, { limit: 30 });
      const liveAgents = new Set(live.map((r) => r.agentId));
      const next = {
        issues: new Map(issues.map((i) => [i.id, `${i.status}|${i.updatedAt}`])),
        runs: new Map(runs.map((r) => [r.id, r.status])),
        agents: new Map([...agents.values()].map((a) => [a.id, this.stateOf(a, liveAgents.has(a.id))])),
        activityIds: new Set(activity.map((a) => a.id)),
        comments: this.snap?.comments ?? new Map<string, string>(),
      };
      const prev = this.snap;
      this.snap = next;
      if (!prev) return;
      const at = iso(this.now());
      const byId = new Map(issues.map((i) => [i.id, i]));
      const changedIssues: PaperclipIssue[] = [];
      for (const [id, sig] of next.issues) {
        if (prev.issues.get(id) !== sig) {
          const i = byId.get(id)!;
          changedIssues.push(i);
          this.emit({ type: 'mission.changed', missionId: id, status: mapIssueStatus(i.status), at });
        }
      }
      for (const [rid, st] of next.runs) {
        if (prev.runs.get(rid) !== st) {
          const r = runs.find((x) => x.id === rid);
          const issueId = r ? this.runIssueId(r) : undefined;
          const i = issueId ? byId.get(issueId) : undefined;
          if (i && !changedIssues.includes(i)) this.emit({ type: 'mission.changed', missionId: i.id, status: mapIssueStatus(i.status), at });
        }
      }
      for (const [aid, st] of next.agents) {
        if (prev.agents.get(aid) !== st) this.emit({ type: 'agent.changed', agentId: aid, state: st, at });
      }
      for (const item of activity.slice().reverse()) {
        if (!prev.activityIds.has(item.id)) this.emit({ type: 'activity', item: this.activityItem(item as unknown as Record<string, unknown>, agents) });
      }
      for (const i of changedIssues.slice(0, 10)) {
        const comments = await this.c.listIssueComments(i.id);
        const lastSeen = next.comments.get(i.id) ?? iso(this.now() - 2 * this.pollMs - 1000);
        const fresh = commentsToTimeline(comments, { agentName: (id) => (id ? agents.get(id)?.name : undefined) }).filter((e) => e.at > lastSeen);
        for (const e of fresh) this.emit({ type: 'mission.message', missionId: i.id, event: e });
        const newest = comments.map((c) => c.createdAt).sort().pop();
        if (newest) next.comments.set(i.id, newest);
      }
    } catch (err) {
      if (process.env.MC_DEBUG) console.error('[mc-bff] sondeo falló:', err);
      /* Paperclip no disponible: se reintenta en el siguiente ciclo */
    } finally {
      this.polling = false;
    }
  }

  private stateOf(a: AgentInfo, hasLiveRun: boolean): AgentState {
    if (hasLiveRun) return 'working';
    const s = a.raw.status;
    if (s === 'paused' || s === 'pending_approval') return 'paused';
    if (s === 'error') return 'error';
    if (s === 'terminated') return 'offline';
    return 'available';
  }

  // ---------------------------------------------------------------- vistas

  async overview(days: number): Promise<Overview> {
    const cid = await this.company();
    const [issues, runsRaw, agentsMap, dash, live, machines] = await Promise.all([this.rawIssues(), this.rawRuns(), this.agentIndex(), this.c.getDashboard(cid), this.rawLive(), this.listMachines()]);
    const now = this.now();
    const runs = runsInWindow(runsRaw.map((r) => this.toRun(r, agentsMap)), days, now);
    const statuses = issues.map((i) => mapIssueStatus(i.status));
    const rbi = await this.runsByIssue();
    const delivered = issues.filter((i) => i.status === 'done');
    const liveAgents = new Set(live.map((r) => r.agentId));
    const states = [...agentsMap.values()].map((a) => ({ a, st: this.stateOf(a, liveAgents.has(a.id)) }));
    const agentRuns = new Map<string, number>();
    for (const r of runs) agentRuns.set(r.agentId, (agentRuns.get(r.agentId) ?? 0) + 1);
    const models = new Map<string, number>();
    for (const { a } of states) {
      const label = a.modelLabel ?? 'sin modelo informado';
      models.set(label, (models.get(label) ?? 0) + 1);
    }
    const planPending = (this.deps.db.prepare("SELECT COUNT(*) AS n FROM plans WHERE status = 'pending'").get() as { n: number }).n;
    return {
      mode: 'paperclip',
      generatedAt: iso(now),
      missions: {
        total: issues.length,
        byStatus: countByStatus(statuses),
        retrying: issues.filter((i) => ['in_progress', 'blocked'].includes(i.status) && (rbi.get(i.id) ?? []).some((r) => isRetryRun(r as unknown as Record<string, unknown>))).length,
        deployed: delivered.length,
      },
      successRatePercent: successRate(runs),
      avgMissionDurationSec: avg(delivered.map((i) => Math.max(0, Math.round((Date.parse(i.completedAt ?? i.updatedAt) - Date.parse(i.startedAt ?? i.createdAt)) / 1000)))),
      agents: {
        total: states.length,
        working: states.filter((s) => s.st === 'working').length,
        available: states.filter((s) => s.st === 'available').length,
        paused: states.filter((s) => s.st === 'paused').length,
        error: states.filter((s) => s.st === 'error').length,
        topActive: states
          .map(({ a }) => ({ agentId: a.id, name: a.name, workloadShare: runs.length ? Math.round(((agentRuns.get(a.id) ?? 0) / runs.length) * 1000) / 10 : 0 }))
          .sort((x, y) => y.workloadShare - x.workloadShare)
          .slice(0, 3),
      },
      machines: { total: machines.length, online: machines.filter((m) => m.status === 'online').length },
      tokens: sumTokens(runs.map((r) => r.tokens)),
      budget: {
        monthBudgetCents: num(dash.costs?.monthBudgetCents),
        monthSpendCents: num(dash.costs?.monthSpendCents),
        utilizationPercent: num(dash.costs?.monthUtilizationPercent),
        incidents: num(asRecord(dash.budgets).activeIncidents),
      },
      pendingApprovals: num(dash.pendingApprovals) + planPending,
      runActivity: this.runActivity(dash.runActivity, runsRaw.map((r) => this.toRun(r, agentsMap)), now),
      heatmap: heatmapFrom(runs),
      modelsInUse: [...models.entries()].map(([modelLabel, agentCount]) => ({ modelLabel, agentCount })),
    };
  }

  private runActivity(dash: Array<{ date: string; succeeded: number; failed: number; recovered: number; other: number }> | undefined, runs: RunSummary[], now: number): Overview['runActivity'] {
    if (Array.isArray(dash) && dash.length) return dash.slice(-14).map((d) => ({ date: d.date, succeeded: num(d.succeeded), failed: num(d.failed), other: num(d.recovered) + num(d.other) }));
    return computeRunActivity(runs, now);
  }

  async listMissions(q: MissionQuery): Promise<{ items: MissionSummary[]; nextCursor?: string }> {
    const [issues, agents, runsByIssue] = await Promise.all([this.rawIssues(), this.agentIndex(), this.runsByIssue()]);
    const wanted = q.status?.length ? new Set(q.status.flatMap((s) => paperclipStatusesFor(s))) : null;
    const needle = q.q?.toLowerCase();
    let list = issues.filter((i) => {
      if (wanted && !wanted.has(i.status)) return false;
      if (needle && !`${i.title} ${i.identifier} ${i.description ?? ''}`.toLowerCase().includes(needle)) return false;
      if (q.scope && (this.meta(i.id)?.scope ?? 'trabajo') !== q.scope) return false;
      return true;
    });
    list = list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const ctx = { agents, runsByIssue, issues };
    return paginate(list.map((i) => this.summarize(i, ctx)), q.limit, q.cursor);
  }

  private async issueOf(id: string): Promise<PaperclipIssue> {
    return this.c.getIssue(id);
  }

  async getMission(id: string): Promise<MissionDetail> {
    const issue = await this.issueOf(id);
    return this.detail(issue);
  }

  private async detail(issue: PaperclipIssue, opts: { includeNoise?: boolean } = {}): Promise<MissionDetail> {
    const [agents, issues, comments, activity, issueRuns] = await Promise.all([
      this.agentIndex(),
      this.rawIssues(),
      this.c.listIssueComments(issue.id),
      this.c.listIssueActivity(issue.id),
      this.issueRuns(issue.id),
    ]);
    // /issues/{id}/runs puede traer menos campos; se completa con la lista de la empresa cuando coincide.
    const companyRuns = await this.rawRuns();
    const byId = new Map(companyRuns.map((r) => [r.id, r]));
    const rawRuns: PaperclipHeartbeatRun[] = [];
    const seen = new Set<string>();
    for (const r of issueRuns) {
      const full = byId.get(r.id) ?? r;
      rawRuns.push(full);
      seen.add(r.id);
    }
    for (const r of companyRuns) if (!seen.has(r.id) && this.runIssueId(r) === issue.id) rawRuns.push(r);
    rawRuns.sort((a, b) => Date.parse(a.startedAt ?? a.createdAt ?? '') - Date.parse(b.startedAt ?? b.createdAt ?? ''));

    const runsByIssue = new Map([[issue.id, rawRuns]]);
    const base = this.summarize(issue, { agents, runsByIssue, issues });
    const runs = rawRuns.map((r) => this.toRun(r, agents));
    const actors = { agentName: (aid: string | undefined) => (aid ? (agents.get(aid)?.name ?? aid.slice(0, 8)) : undefined) };
    const rawMap = new Map(rawRuns.map((r) => [r.id, r as unknown]));
    const planRows = this.deps.db.prepare('SELECT * FROM plans WHERE issue_id = ? ORDER BY created_at ASC').all(issue.id) as unknown as PlanRow[];
    const planEvents: TimelineEvent[] = [];
    for (const row of planRows) {
      const p = JSON.parse(row.plan_json) as MissionPlan;
      planEvents.push({ id: `plan-${row.id}`, at: iso(row.created_at), kind: 'plan_proposed', actorType: p.proposedBy.type === 'agent' ? 'agent' : 'system', actorName: p.proposedBy.name, summary: `Plan propuesto (${p.steps.length} pasos)`, body: p.rationale, raw: p });
      if (row.decided_at) planEvents.push({ id: `plan-${row.id}-decision`, at: iso(row.decided_at), kind: row.status === 'approved' ? 'plan_approved' : 'rejected', actorType: 'user', actorName: 'Operador', summary: row.status === 'approved' ? 'Plan aprobado por el operador' : 'Plan rechazado por el operador', ...(row.note ? { body: row.note } : {}) });
    }
    const timeline = mergeTimeline(
      activityToTimeline(activity, actors, opts),
      commentsToTimeline(comments, actors),
      runsToTimeline(runs, rawMap),
      planEvents,
    );

    const meta = this.meta(issue.id);
    const assignee = issue.assigneeAgentId ? agents.get(issue.assigneeAgentId) : undefined;
    const timeoutMin = assignee ? Math.round(num(asRecord(assignee.raw.adapterConfig).timeoutSec, 1800) / 60) : 30;
    const docs = this.docsFromComments(issue, comments, agents);
    const noteDocs = this.noteDocs(issue.id, issue.identifier);
    const runStatus = new Map(runs.map((r) => [r.id, r.status]));
    const failedRun = (c: object): boolean => {
      const rid = (c as { createdByRunId?: unknown }).createdByRunId;
      const st = typeof rid === 'string' ? runStatus.get(rid) : undefined;
      return st === 'failed' || st === 'timed_out';
    };
    // Solo un comentario de un run exitoso cuenta como resultado; el de un run fallido queda como mensaje de la línea de tiempo.
    const agentComments = comments.filter((c) => c.authorType === 'agent' && !failedRun(c)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const last = agentComments[agentComments.length - 1];
    const showResult = (base.status === 'review' || base.status === 'delivered' || base.status === 'blocked') && last;
    for (const e of timeline) {
      if (e.kind === 'message' && e.actorType === 'agent' && e.runId && (runStatus.get(e.runId) === 'failed' || runStatus.get(e.runId) === 'timed_out')) {
        e.summary = `[run fallido] ${e.summary}`;
        e.body = `Nota: run fallido; el texto del agente es parcial y no se presenta como resultado.\n\n${e.body ?? ''}`;
      }
    }
    const children = issues.filter((k) => k.parentId === issue.id).map((k) => this.summarize(k, { agents, runsByIssue: new Map(), issues }));
    const unknownModel = runs.every((r) => !r.modelLabel);
    const provenance: ProvenanceNote[] = [
      { component: 'Misión', state: 'real', note: `Issue ${issue.identifier} de Paperclip (${this.baseUrl}).` },
      { component: 'Línea de tiempo', state: 'real', note: 'Actividad, comentarios y runs reales de Paperclip, fusionados por el BFF.' },
      { component: 'Plan y aprobación', state: 'pendiente', note: 'Hito 1: el plan y su aprobación viven en el BFF (SQLite), no en las approvals de Paperclip.' },
      {
        component: 'Modelo y coste',
        state: 'pendiente',
        note: unknownModel ? 'Paperclip no informa el modelo ni el precio de hermes_gateway (unpriced); no se estima coste sin modelo conocido.' : 'Coste estimado con la tabla de precios de Ajustes cuando el modelo está listado.',
      },
    ];
    return {
      ...base,
      objective: meta?.objective || issue.description || '',
      team: meta ? (JSON.parse(meta.team_json) as MissionDetail['team']) : { mode: 'manual', agentIds: issue.assigneeAgentId ? [issue.assigneeAgentId] : [] },
      limits: meta ? (JSON.parse(meta.limits_json) as MissionDetail['limits']) : { maxMinutes: Math.max(1, timeoutMin), maxSteps: 5, reportLength: 'medium' },
      finish: (meta?.finish as MissionDetail['finish'] | undefined) ?? (issue.reviewPolicy === 'human_only' ? 'review_first' : 'deliver'),
      timeline,
      runs,
      children,
      ...(this.planOf(this.latestPlan(issue.id)) ? { plan: this.planOf(this.latestPlan(issue.id))! } : {}),
      documents: [...docs, ...noteDocs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      ...(showResult ? { result: { at: last.createdAt, agentName: agents.get(last.authorAgentId ?? '')?.name ?? 'Agente', body: last.body } } : {}),
      provenance,
    };
  }

  async replay(id: string): Promise<{ events: TimelineEvent[] }> {
    const issue = await this.issueOf(id);
    const d = await this.detail(issue, { includeNoise: true });
    return { events: d.timeline };
  }

  // ---------------------------------------------------------------- crear misión

  async createMission(req: MissionCreateRequest): Promise<MissionDetail> {
    const cid = await this.company();
    const agents = await this.agentIndex();
    const missionUuid = randomUUID();
    const short = missionUuid.slice(0, 6);
    let assigneeId: string | undefined;
    let extra: AgentInfo[] = [];
    let plan: Omit<MissionPlan, 'id' | 'status'> | undefined;
    let status: 'todo' | 'backlog' = 'todo';

    if (req.team.mode === 'manual') {
      if (!req.team.agentIds.length) throw badRequest('team.agentIds no puede estar vacío en modo manual');
      const chosen = req.team.agentIds.map((id) => {
        const a = agents.get(id);
        if (!a) throw badRequest(`Agente desconocido o archivado: ${id}`);
        return a;
      });
      assigneeId = chosen[0]!.id;
      extra = chosen.slice(1);
    } else if (req.team.mode === 'boss') {
      const boss = agents.get(req.team.bossAgentId ?? this.deps.settings.get().bossAgentId ?? '');
      if (!boss) throw badRequest('bossAgentId no corresponde a un agente existente');
      assigneeId = boss.id;
    } else {
      const machines = await this.listMachines();
      const summaries = await this.listAgents(14);
      const required = req.requiredCapabilities ?? [];
      const cands = required.length ? await this.deps.catalog.match(required, summaries, machines, req.scope) : [];
      let pick = cands[0] ? agents.get(cands[0].agentId) : undefined;
      let rationale: string;
      if (pick && cands[0]) rationale = `Regla del catálogo: ${cands[0].reasons.join('; ') || 'cumple las capacidades requeridas'} (puntaje ${cands[0].score}).`;
      else {
        pick = [...agents.values()].find((a) => a.raw.status !== 'paused' && a.raw.status !== 'error');
        rationale = required.length ? 'Ningún ejecutor cumple todas las capacidades requeridas; se propone el primer agente disponible. Revísalo antes de aprobar.' : 'Sin capacidades requeridas; se propone el primer agente disponible.';
      }
      if (!pick) throw new HttpError(409, 'conflict', 'No hay agentes disponibles a los que asignar la misión');
      assigneeId = pick.id;
      status = 'backlog';
      const steps: MissionPlan['steps'] = [{ order: 1, title: 'Ejecutar el objetivo de la misión', agentId: pick.id, agentName: pick.name, ...(pick.machineId ? { machineId: pick.machineId } : {}), minutes: Math.min(req.limits.maxMinutes, 30) }];
      if (req.finish === 'review_first' && req.limits.maxSteps >= 2) steps.push({ order: 2, title: 'Revisión humana antes de cerrar' });
      plan = { proposedAt: iso(this.now()), proposedBy: { type: 'rules', name: 'Regla del catálogo' }, steps, rationale };
    }

    const description = [
      req.objective.trim(),
      '',
      '---',
      'Parámetros de Mission Control',
      `- Límites: hasta ${req.limits.maxMinutes} min, ${req.limits.maxSteps} pasos, informe ${{ short: 'corto', medium: 'medio', long: 'largo' }[req.limits.reportLength]}.`,
      `- Entrega: ${req.finish === 'review_first' ? 'revisión humana antes de cerrar' : 'entregar directamente'}.`,
      `- Ámbito: ${req.scope}.`,
      ...(req.targetDate ? [`- Fecha objetivo: ${req.targetDate}.`] : []),
      ...(req.ideaId ? [`- Idea de origen: ${req.ideaId}.`] : []),
      ...(req.requiredCapabilities?.length ? [`- Capacidades requeridas: ${req.requiredCapabilities.join(', ')}.`] : []),
    ].join('\n');

    const body: Record<string, unknown> = {
      title: `${req.title.trim()} · ${short}`,
      description,
      status,
      priority: req.priority,
      assigneeAgentId: assigneeId,
      idempotencyKey: missionUuid,
      ...(req.finish === 'review_first' ? { reviewPolicy: 'human_only' } : {}),
    };
    const issue = await this.c.createIssue(cid, body);
    this.deps.db
      .prepare(
        'INSERT OR REPLACE INTO missions_meta(issue_id, identifier, objective, team_json, limits_json, finish, scope, idea_id, target_date, title, required_caps_json, retry_count, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(issue.id, issue.identifier, req.objective, JSON.stringify(req.team), JSON.stringify(req.limits), req.finish, req.scope, req.ideaId ?? null, req.targetDate ?? null, req.title.trim(), JSON.stringify(req.requiredCapabilities ?? []), 0, Date.now());
    if (plan) {
      const planId = randomUUID();
      this.deps.db.prepare('INSERT INTO plans(id, issue_id, status, plan_json, created_at) VALUES(?,?,?,?,?)').run(planId, issue.id, 'pending', JSON.stringify({ ...plan, id: planId, status: 'pending' }), Date.now());
    }
    for (const a of extra) {
      const childUuid = randomUUID();
      const child = await this.c.createIssue(cid, {
        title: `${req.title.trim()} — parte de ${a.name} · ${childUuid.slice(0, 6)}`,
        description: `Subtarea de ${issue.identifier}.\n\n${req.objective.trim()}`,
        status: 'todo',
        priority: req.priority,
        assigneeAgentId: a.id,
        parentId: issue.id,
        idempotencyKey: childUuid,
        ...(req.finish === 'review_first' ? { reviewPolicy: 'human_only' } : {}),
      });
      this.deps.db
        .prepare('INSERT OR REPLACE INTO missions_meta(issue_id, identifier, objective, team_json, limits_json, finish, scope, idea_id, target_date, title, required_caps_json, retry_count, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(child.id, child.identifier, req.objective, JSON.stringify({ mode: 'manual', agentIds: [a.id] }), JSON.stringify(req.limits), req.finish, req.scope, req.ideaId ?? null, null, `${req.title.trim()} — parte de ${a.name}`, '[]', 0, Date.now());
    }
    this.invalidate();
    return this.detail(await this.issueOf(issue.id));
  }

  // ---------------------------------------------------------------- acciones

  private async guard(id: string, action: MissionAction): Promise<PaperclipIssue> {
    const issue = await this.issueOf(id);
    const st = mapIssueStatus(issue.status);
    if (!actionAllowed(action, st)) throw conflict(`La acción ${action} no es válida con la misión en estado ${st}`, { status: st });
    return issue;
  }

  /** Si tras cambiar el estado Paperclip no despertó al asignado, lo despierta (idempotente por run reciente). */
  private async ensureWake(issue: PaperclipIssue, sinceMs: number): Promise<void> {
    if (!issue.assigneeAgentId) return;
    await new Promise((r) => setTimeout(r, 400));
    const runs = await this.issueRuns(issue.id);
    const recent = runs.some((r) => Date.parse(r.createdAt ?? r.startedAt ?? '') >= sinceMs - 1000 && r.status !== 'cancelled');
    if (!recent) await this.c.invokeHeartbeat(issue.assigneeAgentId, { source: 'on_demand', triggerDetail: 'manual', reason: 'mc_plan_approved', payload: { issueId: issue.id }, issueId: issue.id });
  }

  async approvePlan(id: string, note?: string): Promise<MissionDetail> {
    const issue = await this.issueOf(id);
    const row = this.latestPlan(issue.id);
    if (!row || row.status !== 'pending') throw conflict('La misión no tiene un plan pendiente de aprobación');
    const t = Date.now();
    this.deps.db.prepare("UPDATE plans SET status = 'approved', note = ?, decided_at = ? WHERE id = ?").run(note ?? null, t, row.id);
    const plan = JSON.parse(row.plan_json) as MissionPlan;
    const target = plan.steps[0]?.agentId;
    const upd: Record<string, unknown> = { status: 'todo' };
    if (target && target !== issue.assigneeAgentId) upd.assigneeAgentId = target;
    const updated = await this.c.updateIssue(issue.id, upd);
    this.invalidate();
    await this.ensureWake(updated, t);
    this.invalidate();
    return this.detail(await this.issueOf(issue.id));
  }

  async rejectPlan(id: string, note: string): Promise<MissionDetail> {
    const issue = await this.issueOf(id);
    const row = this.latestPlan(issue.id);
    if (!row || row.status !== 'pending') throw conflict('La misión no tiene un plan pendiente de aprobación');
    this.deps.db.prepare("UPDATE plans SET status = 'rejected', note = ?, decided_at = ? WHERE id = ?").run(note, Date.now(), row.id);
    if (issue.status !== 'backlog' && issue.status !== 'todo') await this.c.updateIssue(issue.id, { status: 'backlog' });
    this.invalidate();
    return this.detail(await this.issueOf(issue.id));
  }

  async acceptMission(id: string, note?: string): Promise<MissionDetail> {
    const issue = await this.guard(id, 'accept');
    await this.c.updateIssue(issue.id, { status: 'done', comment: `[Operador humano] ${note?.trim() || 'Revisado y aceptado desde Mission Control.'}` });
    this.invalidate();
    return this.detail(await this.issueOf(issue.id));
  }

  async requestChanges(id: string, note: string): Promise<MissionDetail> {
    const issue = await this.guard(id, 'request-changes');
    await this.c.updateIssue(issue.id, { status: 'in_progress', comment: `[Operador humano] Cambios solicitados: ${note}`, ...(issue.status === 'done' ? { reopen: true } : {}) });
    this.invalidate();
    return this.detail(await this.issueOf(issue.id));
  }

  async rerunMission(id: string, note?: string): Promise<MissionDetail> {
    const issue = await this.guard(id, 'rerun');
    if (!issue.assigneeAgentId) throw conflict('La misión no tiene agente asignado');
    // Candado de 60 s por misión: dos clics seguidos no crean dos runs.
    const lockKey = `rerun-lock:${issue.id}`;
    const lock = this.deps.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(lockKey) as { value_json: string } | undefined;
    if (lock && Date.now() - Number(lock.value_json) < 60_000) throw conflict('Ya se pidió un reintento de esta misión hace menos de 60 s', { code: 'rerun_locked' });
    this.deps.db.prepare('INSERT INTO settings(key, value_json) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json').run(lockKey, String(Date.now()));
    const retryNo = (this.meta(issue.id)?.retry_count ?? 0) + 1;
    if (issue.status !== 'in_progress') await this.c.updateIssue(issue.id, { status: 'in_progress', ...(issue.status === 'done' || issue.status === 'cancelled' ? { reopen: true } : {}) });
    if (note?.trim()) await this.c.addIssueComment(issue.id, { body: `[Operador humano] Reintento solicitado: ${note.trim()}`, authorType: 'user' });
    const m = this.meta(issue.id);
    try {
      await this.wakeForRerun(issue, retryNo);
    } catch (err) {
      this.deps.db.prepare('DELETE FROM settings WHERE key = ?').run(lockKey); // el reintento no se hizo: se libera el candado
      throw err;
    }
    if (m) this.deps.db.prepare('UPDATE missions_meta SET retry_count = retry_count + 1 WHERE issue_id = ?').run(issue.id);
    else {
      this.deps.db
        .prepare('INSERT INTO missions_meta(issue_id, identifier, objective, team_json, limits_json, finish, scope, idea_id, target_date, title, required_caps_json, retry_count, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(issue.id, issue.identifier, issue.description ?? '', JSON.stringify({ mode: 'manual', agentIds: [issue.assigneeAgentId] }), JSON.stringify({ maxMinutes: 30, maxSteps: 5, reportLength: 'medium' }), issue.reviewPolicy === 'human_only' ? 'review_first' : 'deliver', 'trabajo', null, null, null, '[]', 1, Date.now());
    }
    this.invalidate();
    return this.detail(await this.issueOf(issue.id));
  }

  /**
   * Despierta al asignado con `POST /agents/{id}/wakeup` (admite idempotencyKey y liga el run a la issue).
   * Si el build de Paperclip no tiene la ruta (404/405), cae a `heartbeat/invoke`, que no deduplica: ahí protege el candado de 60 s.
   */
  private async wakeForRerun(issue: PaperclipIssue, retryNo: number): Promise<void> {
    const agentId = issue.assigneeAgentId!;
    const body = {
      source: 'on_demand',
      triggerDetail: 'manual',
      reason: 'mc_rerun',
      payload: { issueId: issue.id, taskId: issue.id },
      issueId: issue.id,
      idempotencyKey: `mc:rerun:${issue.id}:${retryNo}`,
      forceFreshSession: false,
    };
    try {
      await this.c.request('POST', `/agents/${agentId}/wakeup`, { body });
    } catch (err) {
      if (err instanceof PaperclipError && (err.status === 404 || err.status === 405)) {
        await this.c.invokeHeartbeat(agentId, { source: 'on_demand', triggerDetail: 'manual', reason: 'mc_rerun', payload: { issueId: issue.id }, issueId: issue.id, idempotencyKey: body.idempotencyKey });
        return;
      }
      throw err;
    }
  }

  async stopMission(id: string, note?: string): Promise<MissionDetail> {
    const issue = await this.guard(id, 'stop');
    const runs = await this.issueRuns(issue.id);
    const live = runs.filter((r) => ACTIVE_RUN.has(r.status));
    for (const r of live) {
      try {
        await this.c.cancelRun(r.id);
      } catch (err) {
        if (!(err instanceof PaperclipError) || err.code !== 'conflict') throw err;
      }
    }
    await this.c.updateIssue(issue.id, { status: 'cancelled', comment: `[Operador humano] Misión detenida${note?.trim() ? `: ${note.trim()}` : ' desde Mission Control.'}` });
    this.invalidate();
    return this.detail(await this.issueOf(issue.id));
  }

  // ---------------------------------------------------------------- agentes

  async listAgents(days: number): Promise<AgentSummary[]> {
    const [agents, runsRaw, live, costs] = await Promise.all([this.agentIndex(), this.rawRuns(), this.rawLive(), this.company().then((cid) => this.c.costsByAgent(cid, { period: 'month' }).catch(() => []))]);
    const now = this.now();
    const all = runsRaw.map((r) => this.toRun(r, agents));
    const win = runsInWindow(all, days, now);
    const liveBy = new Map(live.map((r) => [r.agentId, r]));
    const spentBy = new Map(costs.map((c) => [c.agentId, c.costCents]));
    return [...agents.values()].map((a) => {
      const mine = win.filter((r) => r.agentId === a.id);
      const done = mine.filter((r) => r.durationSec !== undefined);
      const last = all.filter((r) => r.agentId === a.id && r.startedAt).sort((x, y) => Date.parse(y.startedAt!) - Date.parse(x.startedAt!))[0];
      const lr = liveBy.get(a.id);
      const isBoss = a.id === this.deps.settings.get().bossAgentId || a.raw.role === 'ceo';
      return {
        id: a.id,
        name: a.name,
        shortName: a.shortName,
        role: String(a.raw.role ?? 'general'),
        ...(a.raw.title ? { title: a.raw.title } : {}),
        platform: a.platform,
        adapterType: a.raw.adapterType,
        ...(a.machineId ? { machineId: a.machineId } : {}),
        state: this.stateOf(a, Boolean(lr)),
        ...(a.modelLabel ? { modelLabel: a.modelLabel } : {}),
        effort: a.effort,
        isBoss,
        ...(a.raw.reportsTo ? { reportsTo: a.raw.reportsTo } : {}),
        ...(last?.startedAt ? { lastRunAt: last.startedAt } : {}),
        ...(lr ? { activeRunId: lr.id } : {}),
        workloadShare: win.length ? Math.round((mine.length / win.length) * 1000) / 10 : 0,
        avgDurationSec: avg(done.map((r) => r.durationSec!)),
        runsTotal: mine.length,
        runsSucceeded: mine.filter((r) => r.status === 'succeeded').length,
        runsFailed: mine.filter((r) => r.status === 'failed' || r.status === 'timed_out').length,
        tokens: sumTokens(mine.map((r) => r.tokens)),
        budgetMonthlyCents: a.raw.budgetMonthlyCents,
        spentMonthlyCents: spentBy.get(a.id) ?? a.raw.spentMonthlyCents ?? 0,
        origin: 'paperclip',
      } satisfies AgentSummary;
    });
  }

  async createAgent(req: AgentCreateRequest): Promise<AgentSummary> {
    if (!req.name?.trim()) throw badRequest('name es obligatorio');
    const cid = await this.company();
    const s = this.deps.settings.get();
    const adapterByPlatform: Partial<Record<Platform, string>> = { hermes: 'hermes_gateway', mimo: 'hermes_gateway', claude: 'claude_local', codex: 'codex_local', grok: 'grok_local' };
    const adapterType = adapterByPlatform[req.platform];
    if (!adapterType) throw badRequest(`Plataforma no soportada para agentes ejecutores: ${req.platform}`);
    let adapterConfig: Record<string, unknown> = {};
    if (adapterType === 'hermes_gateway') {
      const baseUrl = this.deps.machines.hermesBaseUrl(req.machineId) ?? this.hermesBaseFromEnv(req.machineId);
      if (!baseUrl) throw new HttpError(409, 'conflict', `El equipo ${req.machineId} no ha reportado la URL del API server de Hermes (latido del node-agent). Regístrala primero.`, { machineId: req.machineId });
      const secretId = this.deps.settings.getHermesSecretId(req.machineId);
      if (!secretId) throw new HttpError(409, 'conflict', `Falta el secreto con la clave del gateway de ${req.machineId}: crea el secreto en Paperclip y registra su id con PUT /api/mc/settings (hermesSecretIds) o la variable MC_HERMES_SECRET_${req.machineId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}.`, { machineId: req.machineId });
      const mimoNote = req.platform === 'mimo' ? `\nModelo: mimo${req.modelLabel ? ` (${req.modelLabel})` : ''}, configurado en el perfil de Hermes de ${req.machineId}; Paperclip no tiene adaptador propio de MiMo.` : '';
      adapterConfig = {
        apiBaseUrl: baseUrl,
        apiKey: { type: 'secret_ref', secretId, version: 'latest' },
        sessionKeyStrategy: 'issue',
        timeoutSec: s.agentDefaults.timeoutSec,
        eventReconnectMs: 2000,
        instructions: `${req.instructions?.trim() ?? ''}${mimoNote}`.trim() || undefined,
      };
      if (adapterConfig.instructions === undefined) delete adapterConfig.instructions;
    } else {
      adapterConfig = { ...(req.modelLabel ? { model: req.modelLabel } : {}) };
    }
    const role = AGENT_ROLES.includes(req.role) ? req.role : 'general';
    const body: Record<string, unknown> = {
      name: req.name.trim(),
      role,
      title: req.role,
      adapterType,
      adapterConfig,
      capabilities: req.instructions?.trim() || null,
      budgetMonthlyCents: req.budgetMonthlyCents ?? 500,
      ...(req.reportsTo ? { reportsTo: req.reportsTo } : {}),
      permissions: { canCreateAgents: false, canCreateSkills: false },
      runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1, maxDailyRuns: s.agentDefaults.maxDailyRuns, maxDailyCostCents: s.agentDefaults.maxDailyCostCents } },
      metadata: { createdBy: 'mission-control', machineId: req.machineId, platform: req.platform, shortName: req.shortName ?? req.name.trim().slice(0, 12), ...(req.modelLabel ? { modelLabel: req.modelLabel } : {}), ...(req.effort ? { effort: req.effort } : {}) },
    };
    const created = await this.c.createAgent(cid, body as never);
    this.invalidate();
    const list = await this.listAgents(14);
    const found = list.find((a) => a.id === created.id);
    if (!found) throw new HttpError(500, 'internal', 'El agente se creó pero no aparece en la lista');
    return found;
  }

  private hermesBaseFromEnv(machineId: MachineId): string | undefined {
    const key = `MC_HERMES_URL_${machineId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    return process.env[key] || undefined;
  }

  async deleteAgent(id: string): Promise<{ ok: true }> {
    const agents = await this.agentIndex();
    if (!agents.has(id)) throw notFound('Agente', id);
    await this.c.pauseAgent(id);
    this.deps.db.prepare('INSERT OR REPLACE INTO archived_agents(agent_id, archived_at) VALUES(?, ?)').run(id, Date.now());
    this.invalidate();
    return { ok: true };
  }

  async listAgentRuns(id: string, limit: number): Promise<RunSummary[]> {
    const agents = await this.agentIndex();
    if (!agents.has(id)) throw notFound('Agente', id);
    const cid = await this.company();
    const runs = await this.c.listHeartbeatRuns(cid, { agentId: id, limit });
    return runs
      .filter((r) => r.agentId === id)
      .map((r) => this.toRun(r, agents))
      .sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''))
      .slice(0, limit);
  }

  async listMachines(): Promise<MachineSummary[]> {
    const [agents, caps, live] = await Promise.all([this.agentIndex().catch(() => new Map<string, AgentInfo>()), this.deps.catalog.capabilityIdsByMachine(), this.rawLive().catch(() => [] as PaperclipHeartbeatRun[])]);
    const liveAgents = new Set(live.map((r) => r.agentId));
    return this.deps.machines.list().map((m) => {
      const mine = [...agents.values()].filter((a) => a.machineId === m.id);
      return this.deps.machines.toSummary(m, {
        agentIds: mine.map((a) => a.id),
        capabilityIds: caps.get(m.id) ?? [],
        activeHeavyJobs: Math.min(m.maxHeavyJobs, mine.filter((a) => liveAgents.has(a.id)).length),
        origin: 'paperclip',
      });
    });
  }

  // ---------------------------------------------------------------- documentos

  private docsFromComments(issue: PaperclipIssue, comments: Array<{ id: string; body: string; authorType: string; authorAgentId: string | null; createdAt: string }>, agents: Map<string, AgentInfo>): DocumentSummary[] {
    return comments
      .filter((c) => c.authorType === 'agent' && wordCount(c.body) >= 120)
      .map((c) => {
        const heading = c.body.split('\n').find((l) => l.trim().startsWith('#'));
        const title = (heading ? heading.replace(/^#+\s*/, '') : excerpt(c.body, 70)).trim();
        const author = agents.get(c.authorAgentId ?? '')?.name ?? 'Agente';
        return {
          id: `comment:${issue.id}:${c.id}`,
          title: title || `Informe de ${author}`,
          missionId: issue.id,
          missionIdentifier: issue.identifier,
          authorName: author,
          authorType: 'agent' as const,
          createdAt: c.createdAt,
          excerpt: excerpt(c.body),
          wordCount: wordCount(c.body),
          source: 'paperclip-comment' as const,
        };
      });
  }

  private noteRows(missionId?: string): Array<{ id: string; title: string; markdown: string; mission_id: string | null; created_at: number }> {
    const sql = missionId ? 'SELECT * FROM notes WHERE mission_id = ? ORDER BY created_at DESC' : 'SELECT * FROM notes ORDER BY created_at DESC';
    return (missionId ? this.deps.db.prepare(sql).all(missionId) : this.deps.db.prepare(sql).all()) as never;
  }

  private noteSummary(n: { id: string; title: string; markdown: string; mission_id: string | null; created_at: number }, identifier?: string): DocumentSummary {
    return {
      id: `note:${n.id}`,
      title: n.title,
      ...(n.mission_id ? { missionId: n.mission_id } : {}),
      ...(identifier ? { missionIdentifier: identifier } : {}),
      authorName: this.deps.settings.get().ownerName,
      authorType: 'user',
      createdAt: iso(n.created_at),
      excerpt: excerpt(n.markdown),
      wordCount: wordCount(n.markdown),
      source: 'mc-note',
    };
  }

  private noteDocs(missionId: string, identifier: string): DocumentSummary[] {
    return this.noteRows(missionId).map((n) => this.noteSummary(n, identifier));
  }

  async listDocs(q: { missionId?: string; q?: string }): Promise<DocumentSummary[]> {
    const agents = await this.agentIndex();
    let issues: PaperclipIssue[];
    if (q.missionId) issues = [await this.issueOf(q.missionId)];
    else issues = (await this.rawIssues()).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 40);
    const out: DocumentSummary[] = [];
    const queue = [...issues];
    const worker = async (): Promise<void> => {
      for (let i = queue.shift(); i; i = queue.shift()) {
        try {
          const comments = await this.c.listIssueComments(i.id);
          out.push(...this.docsFromComments(i, comments, agents));
        } catch {
          /* una issue ilegible no tumba la lista */
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const byId = new Map(issues.map((i) => [i.id, i.identifier]));
    const notes = this.noteRows(q.missionId ? issues[0]?.id : undefined).map((n) => this.noteSummary(n, n.mission_id ? byId.get(n.mission_id) : undefined));
    const needle = q.q?.toLowerCase();
    return [...out, ...notes].filter((d) => !needle || `${d.title} ${d.excerpt}`.toLowerCase().includes(needle)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async getDoc(id: string): Promise<{ summary: DocumentSummary; markdown: string }> {
    if (id.startsWith('note:')) {
      const n = this.deps.db.prepare('SELECT * FROM notes WHERE id = ?').get(id.slice(5)) as { id: string; title: string; markdown: string; mission_id: string | null; created_at: number } | undefined;
      if (!n) throw notFound('Documento', id);
      return { summary: this.noteSummary(n), markdown: n.markdown };
    }
    const m = /^comment:([^:]+):([^:]+)$/.exec(id);
    if (!m) throw notFound('Documento', id);
    const [, issueId, commentId] = m;
    const [issue, comments, agents] = await Promise.all([this.issueOf(issueId!), this.c.listIssueComments(issueId!), this.agentIndex()]);
    const c = comments.find((x) => x.id === commentId);
    if (!c) throw notFound('Documento', id);
    const summary = this.docsFromComments(issue, [c], agents)[0] ?? {
      id,
      title: excerpt(c.body, 70),
      missionId: issue.id,
      missionIdentifier: issue.identifier,
      authorName: agents.get(c.authorAgentId ?? '')?.name ?? 'Agente',
      authorType: 'agent' as const,
      createdAt: c.createdAt,
      excerpt: excerpt(c.body),
      wordCount: wordCount(c.body),
      source: 'paperclip-comment' as const,
    };
    return { summary, markdown: c.body };
  }

  async createDoc(req: { title: string; markdown: string; missionId?: string }): Promise<DocumentSummary> {
    let issueId: string | undefined;
    let identifier: string | undefined;
    if (req.missionId) {
      const issue = await this.issueOf(req.missionId);
      issueId = issue.id;
      identifier = issue.identifier;
    }
    const id = randomUUID();
    this.deps.db.prepare('INSERT INTO notes(id, title, markdown, mission_id, created_at) VALUES(?,?,?,?,?)').run(id, req.title, req.markdown, issueId ?? null, Date.now());
    return this.noteSummary({ id, title: req.title, markdown: req.markdown, mission_id: issueId ?? null, created_at: Date.now() }, identifier);
  }

  // ---------------------------------------------------------------- agenda y actividad

  async listSchedule(): Promise<RoutineSummary[]> {
    const cid = await this.company();
    const [routines, agents] = await Promise.all([this.c.listRoutines(cid), this.agentIndex()]);
    return routines.map((r) => {
      const rec = asRecord(r);
      const triggers = Array.isArray(rec.triggers) ? (rec.triggers as unknown[]).map(asRecord) : [];
      const sched = triggers.find((t) => str(t.cronExpression)) ?? triggers[0];
      const schedule = str(sched?.cronExpression) ?? (triggers.length ? `trigger:${str(sched?.kind) ?? 'manual'}` : 'manual');
      const status = r.status === 'paused' || r.status === 'archived' ? (r.status as 'paused' | 'archived') : 'active';
      const a = r.assigneeAgentId ? agents.get(r.assigneeAgentId) : undefined;
      const last = str(r.lastTriggeredAt) ?? str(r.lastEnqueuedAt);
      const next = str(sched?.nextRunAt);
      return {
        id: r.id,
        title: r.title,
        schedule,
        status,
        ...(r.assigneeAgentId ? { assigneeAgentId: r.assigneeAgentId } : {}),
        ...(a ? { assigneeName: a.name } : {}),
        ...(next ? { nextRunAt: next } : {}),
        ...(last ? { lastRunAt: last } : {}),
        source: 'paperclip' as const,
        canRunNow: status === 'active' && Boolean(r.assigneeAgentId),
      };
    });
  }

  async runRoutineNow(id: string): Promise<{ ok: true }> {
    await this.c.runRoutine(id, { source: 'manual' });
    this.invalidate();
    return { ok: true };
  }

  private activityItem(a: Record<string, unknown>, agents: Map<string, AgentInfo>): ActivityItem {
    const details = asRecord(a.details);
    const actorType = a.actorType === 'agent' ? 'agent' : a.actorType === 'user' ? 'user' : 'system';
    const agentId = str(a.agentId) ?? (actorType === 'agent' ? str(a.actorId) : undefined);
    const ident = str(details.identifier);
    const action = str(a.action) ?? 'unknown';
    let summary: string;
    if (action === 'issue.comment_added') summary = `${ident ?? 'Misión'}: ${str(details.bodySnippet) ?? 'comentario'}`;
    else if (action === 'issue.created') summary = `Misión creada ${ident ?? ''}: ${str(details.title) ?? ''}`.trim();
    else if (action === 'issue.updated') {
      const st = asRecord(asRecord(details.changes).status);
      summary = str(st.to) ? `${ident ?? 'Misión'}: ${str(st.from) ?? '?'} → ${str(st.to)}` : `${ident ?? 'Misión'} actualizada`;
    } else summary = `${action.replace(/_/g, ' ')}${ident ? ` · ${ident}` : ''}`;
    return {
      id: String(a.id),
      at: str(a.createdAt) ?? iso(this.now()),
      actorType,
      actorName: actorType === 'agent' ? (agents.get(agentId ?? '')?.name ?? 'Agente') : actorType === 'user' ? 'Operador' : 'Paperclip',
      action,
      ...(ident ? { missionIdentifier: ident } : {}),
      summary,
    };
  }

  async listActivity(q: { limit: number; cursor?: string }): Promise<{ items: ActivityItem[]; nextCursor?: string }> {
    const cid = await this.company();
    const agents = await this.agentIndex();
    const all = await this.c.listCompanyActivity(cid, { limit: 200 });
    const items = all.map((a) => this.activityItem(a as unknown as Record<string, unknown>, agents)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return paginate(items, q.limit, q.cursor);
  }

  // ---------------------------------------------------------------- salud

  private async probe(baseUrl: string): Promise<{ reachable: boolean; error?: string }> {
    try {
      const res = await this.doFetch(`${baseUrl.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok ? { reachable: true } : { reachable: false, error: `HTTP ${res.status}` };
    } catch (err) {
      return { reachable: false, error: (err as Error).message };
    }
  }

  async health(): Promise<HealthReport> {
    let pc: HealthReport['paperclip'];
    try {
      const h = await this.c.health();
      pc = { reachable: h.status === 'ok', baseUrl: this.baseUrl, ...(h.version ? { version: h.version } : {}), ...(h.deploymentMode ? { deploymentMode: h.deploymentMode } : {}), ...(h.status !== 'ok' ? { error: `estado ${h.status}` } : {}) };
    } catch (err) {
      pc = { reachable: false, baseUrl: this.baseUrl, error: (err as Error).message };
    }
    const targets = new Map<string, MachineId>();
    for (const m of this.deps.machines.list()) if (m.hermes?.apiServer.baseUrl) targets.set(m.hermes.apiServer.baseUrl, m.id);
    if (pc.reachable) {
      try {
        for (const a of (await this.agentIndex()).values()) {
          const base = str(asRecord(a.raw.adapterConfig).apiBaseUrl);
          if (base && !targets.has(base)) targets.set(base, a.machineId ?? 'win-principal');
        }
      } catch {
        /* sin agentes: solo se prueban los del registro */
      }
    }
    const gateways = await Promise.all([...targets.entries()].map(async ([baseUrl, machineId]) => ({ machineId, baseUrl, ...(await this.probe(baseUrl)) })));
    const machines = this.deps.machines.list();
    const notes: ProvenanceNote[] = [
      { component: 'Backend', state: 'real', note: `MODO PAPERCLIP: datos reales de ${this.baseUrl}.` },
      { component: 'Plan y aprobación', state: 'pendiente', note: 'Hito 1: las aprobaciones del plan viven en el BFF (SQLite), no en las approvals de Paperclip.' },
      { component: 'Presupuesto', state: 'pendiente', note: 'Presupuesto en centavos no detecta consumo de hermes_gateway (unpriced); se usan topes diarios de runs.' },
      { component: 'Secretos', state: 'pendiente', note: 'Recomendado PAPERCLIP_SECRETS_STRICT_MODE=true en la instancia de Paperclip (no se puede leer desde la API).' },
      { component: 'Coste estimado', state: 'pendiente', note: 'Solo se estima cuando se conoce el modelo y está en la tabla de precios de Ajustes; si no, se muestra como no informado.' },
      this.opts.nodeAgentTokenSet
        ? { component: 'Latidos de node-agent', state: 'real', note: 'Autenticados con MC_NODE_AGENT_TOKEN; equipos sin latido figuran como unknown.' }
        : { component: 'Latidos de node-agent', state: 'pendiente', note: 'MC_NODE_AGENT_TOKEN no está definido: los latidos se rechazan (401) y los equipos figuran como unknown.' },
    ];
    return {
      bff: { ok: true, version: BFF_VERSION, mode: 'paperclip', uptimeSec: Math.round((Date.now() - this.startedAtMs) / 1000) },
      paperclip: pc,
      hermesGateways: gateways,
      machinesOnline: machines.filter((m) => this.deps.machines.statusOf(m) === 'online').length,
      catalog: await this.deps.catalog.counts(),
      notes,
    };
  }
}

function computeRunActivity(runs: RunSummary[], now: number): Overview['runActivity'] {
  const out: Overview['runActivity'] = [];
  const idx = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const date = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    idx.set(date, out.length);
    out.push({ date, succeeded: 0, failed: 0, other: 0 });
  }
  for (const r of runs) {
    const i = r.startedAt ? idx.get(r.startedAt.slice(0, 10)) : undefined;
    if (i === undefined) continue;
    const row = out[i]!;
    if (r.status === 'succeeded') row.succeeded += 1;
    else if (r.status === 'failed' || r.status === 'timed_out') row.failed += 1;
    else row.other += 1;
  }
  return out;
}
