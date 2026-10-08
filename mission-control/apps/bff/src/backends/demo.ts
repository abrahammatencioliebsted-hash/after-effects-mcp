import type {
  ActivityItem,
  AgentCreateRequest,
  AgentSummary,
  DocumentSummary,
  HealthReport,
  MachineHermesStatus,
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
import { avg, countByStatus, emptyTokens, heatmapFrom, runActivityFrom, runsInWindow, successRate, sumTokens } from '../aggregate.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { KNOWN_MACHINES } from '../machines.js';
import { Rng } from '../rng.js';
import { MISSION_STATUSES } from '../status.js';
import { mergeTimeline } from '../timeline.js';
import { excerpt, paginate, wordCount } from '../util.js';
import { DEMO_AGENTS, DEMO_MISSIONS, REPORT_PARAGRAPHS, type DemoAgentSeed } from './demo-data.js';
import { BFF_VERSION, type BackendDeps, type McBackend, type MissionQuery } from './types.js';

const SEED = 20261008;
const MIN = 60_000;
const HOUR = 3_600_000;

interface DMission {
  id: string;
  seq: number;
  identifier: string;
  title: string;
  objective: string;
  status: MissionStatus;
  priority: MissionSummary['priority'];
  scope: MissionSummary['scope'];
  assigneeId: string;
  team: MissionDetail['team'];
  limits: MissionDetail['limits'];
  finish: MissionDetail['finish'];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  targetDate?: string;
  ideaId?: string;
  retryCount: number;
  timeline: TimelineEvent[];
  runs: RunSummary[];
  plan?: MissionPlan;
  docIds: string[];
  parentId?: string;
  stepsLeft: number;
}

interface DDoc {
  summary: DocumentSummary;
  markdown: string;
}

interface DRoutine extends RoutineSummary {
  lastRunAtMs?: number;
}

const STATUS_PLAN: MissionStatus[] = [
  ...Array<MissionStatus>(17).fill('delivered'),
  ...Array<MissionStatus>(5).fill('review'),
  ...Array<MissionStatus>(6).fill('ongoing'),
  ...Array<MissionStatus>(5).fill('briefing'),
  ...Array<MissionStatus>(3).fill('blocked'),
  ...Array<MissionStatus>(4).fill('cancelled'),
];

export class DemoBackend implements McBackend {
  readonly mode = 'demo' as const;
  private readonly deps: BackendDeps;
  private readonly now: () => number;
  private readonly rng: Rng;
  private readonly tickRng: Rng;
  private readonly listeners = new Set<(e: McEvent) => void>();
  private timer: NodeJS.Timeout | null = null;
  private readonly agents: Array<DemoAgentSeed & { createdAt: number }> = [];
  private readonly missions = new Map<string, DMission>();
  private readonly docs = new Map<string, DDoc>();
  private readonly routines: DRoutine[] = [];
  private readonly extraActivity: ActivityItem[] = [];
  private readonly machineState = new Map<string, { lastSeenOffsetMs: number; cpu: number; mem: number; disk: number; gpu: number }>();
  private seq = 0;
  private runSeq = 0;
  private docSeq = 0;
  private startedAtMs: number;

  constructor(deps: BackendDeps, opts: { tickMs?: number } = {}) {
    this.deps = deps;
    this.now = () => (deps.now ? deps.now().getTime() : Date.now());
    this.rng = new Rng(SEED);
    this.tickRng = new Rng(SEED + 1);
    this.tickMs = opts.tickMs ?? 3000;
    this.startedAtMs = this.now();
    this.seed();
  }

  private readonly tickMs: number;

  // ---------------------------------------------------------------- ciclo de vida

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

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

  // ---------------------------------------------------------------- semilla

  private iso(ms: number): string {
    return new Date(ms).toISOString();
  }

  /** Agente asignado o 409: tras `DELETE /agents/:id` la misión no puede operarse sin reasignarla. */
  private assignee(m: { assigneeId?: string }): DemoAgentSeed & { createdAt: number } {
    const a = this.agentById(m.assigneeId);
    if (!a) throw conflict(`El agente asignado (${m.assigneeId ?? 'ninguno'}) ya no existe; crea la misión de nuevo con otro agente`, { code: 'assignee_missing' });
    return a;
  }

  private agentById(id: string | undefined): (DemoAgentSeed & { createdAt: number }) | undefined {
    return this.agents.find((a) => a.id === id);
  }

  private seed(): void {
    const now = this.now();
    for (const a of DEMO_AGENTS) this.agents.push({ ...a, createdAt: now - 20 * 86_400_000 });

    // Máquinas simuladas (la salud varía en cada tick).
    for (const m of KNOWN_MACHINES) {
      this.machineState.set(m.id, {
        lastSeenOffsetMs: m.id === 'mac' ? 200_000 : 5_000,
        cpu: this.rng.int(8, 55),
        mem: this.rng.int(30, 70),
        disk: this.rng.int(35, 75),
        gpu: m.id === 'win-principal' ? this.rng.int(5, 40) : 0,
      });
    }

    // Misiones
    const statuses = this.rng.shuffle(STATUS_PLAN);
    const order = DEMO_MISSIONS.map((m, i) => ({ m, status: statuses[i] ?? 'delivered' }));
    const ages = order.map(({ status }) => this.ageFor(status));
    const idx = order.map((_, i) => i).sort((a, b) => ages[b]! - ages[a]!); // más antigua primero
    let n = 0;
    for (const i of idx) {
      n += 1;
      const { m, status } = order[i]!;
      this.seedMission(n, m, status, now - ages[i]!);
    }
    this.seq = n;

    // Notas propias
    this.addNote('Criterios de revisión humana', 'Notas para decidir cuándo una misión exige revisión previa.\n\n- Toda misión que toque contexto personal pasa por revisión.\n- Los informes largos van a Docs, no al chat.\n- Si el vigilante escala a 2/2 intentos, decide el operador.\n- Las estimaciones de coste solo cuando se conoce el modelo.\n'.repeat(2), undefined, now - 3 * 86_400_000);
    this.addNote('Convención de nombres de equipos', 'win-principal, win-laptop-1, win-laptop-2 y mac. Cada gateway de Hermes lleva su propia clave guardada como secreto en Paperclip.\n\nSe usa Tailscale para la red privada y HTTPS en los gateways remotos. Este texto es una nota de ejemplo del backend de demostración.\n'.repeat(3), undefined, now - 5 * 86_400_000);

    // Rutinas
    this.routines.push(
      { id: 'demo-routine-ideas', title: 'Resumen diario de ideas sin decisión', schedule: '0 8 * * *', status: 'active', assigneeAgentId: 'demo-agent-biblioteca', assigneeName: 'Biblioteca', nextRunAt: this.iso(this.nextHour(now, 8)), lastRunAt: this.iso(now - 16 * HOUR), source: 'paperclip', canRunNow: true },
      { id: 'demo-routine-respaldo', title: 'Respaldo semanal de la bóveda (solo lectura)', schedule: '0 3 * * 0', status: 'active', assigneeAgentId: 'demo-agent-operaciones', assigneeName: 'Operaciones', nextRunAt: this.iso(now + 3 * 86_400_000), lastRunAt: this.iso(now - 4 * 86_400_000), source: 'paperclip', canRunNow: true },
      { id: 'demo-routine-salud', title: 'Revisión de salud de equipos', schedule: '*/30 * * * *', status: 'paused', assigneeAgentId: 'demo-agent-operaciones', assigneeName: 'Operaciones', lastRunAt: this.iso(now - 2 * 86_400_000), source: 'paperclip', canRunNow: true },
      { id: 'demo-cron-hermes-limpieza', title: 'Limpieza de sesiones antiguas (cron de Hermes, solo lectura)', schedule: '30 4 * * *', status: 'active', source: 'hermes-cron', canRunNow: false },
    );
  }

  private nextHour(now: number, hourUtc: number): number {
    const d = new Date(now);
    d.setUTCHours(hourUtc, 0, 0, 0);
    if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
    return d.getTime();
  }

  private ageFor(status: MissionStatus): number {
    const d = 86_400_000;
    switch (status) {
      case 'delivered': return this.rng.int(3 * d, 13 * d);
      case 'review': return this.rng.int(1 * d, 4 * d);
      case 'ongoing': return this.rng.int(2 * HOUR, 1.5 * d);
      case 'briefing': return this.rng.int(30 * MIN, 1 * d);
      case 'blocked': return this.rng.int(1 * d, 6 * d);
      case 'cancelled': return this.rng.int(2 * d, 12 * d);
    }
  }

  private newRunId(): string {
    this.runSeq += 1;
    return `demo-run-${this.runSeq}`;
  }

  private tokensFor(agent: DemoAgentSeed, input: number, output: number, cached: number): TokenUsage {
    const base = { input, output, cachedInput: cached };
    if (agent.platform === 'hermes') return { ...base, estimatedCents: null, costStatus: 'unpriced' };
    if (agent.platform === 'mimo') return this.deps.settings.applyEstimate({ ...base, estimatedCents: null, costStatus: 'unpriced' }, agent.modelLabel);
    // claude / codex / grok: el proveedor informa coste (simulado)
    const cents = Math.round(((input / 1e6) * 3 + (output / 1e6) * 15) * 100 * 100) / 100;
    return { ...base, estimatedCents: cents, costStatus: 'reported' };
  }

  private mkRun(agent: DemoAgentSeed, startMs: number, status: RunSummary['status'], source: RunSummary['source']): RunSummary {
    const dur = status === 'running' || status === 'queued' ? undefined : this.rng.int(25, 420);
    const input = this.rng.int(8_000, 60_000);
    const output = this.rng.int(400, 9_000);
    const cached = agent.platform === 'claude' || agent.platform === 'codex' ? this.rng.int(0, Math.floor(input * 0.6)) : 0;
    const run: RunSummary = {
      id: this.newRunId(),
      agentId: agent.id,
      agentName: agent.name,
      status,
      source,
      startedAt: this.iso(startMs),
      ...(dur !== undefined ? { finishedAt: this.iso(startMs + dur * 1000), durationSec: dur } : {}),
      tokens: status === 'queued' ? emptyTokens() : this.tokensFor(agent, input, output, cached),
      modelLabel: agent.modelLabel,
      adapterType: agent.adapterType,
      machineId: agent.machineId,
      ...(status === 'failed' ? { error: 'El ejecutor simulado devolvió un error de tiempo de espera', errorCode: 'simulated_timeout' } : {}),
    };
    return run;
  }

  private ev(m: DMission, at: number, kind: TimelineEvent['kind'], actor: 'user' | 'agent' | 'system', summary: string, extra: Partial<TimelineEvent> = {}): TimelineEvent {
    const e: TimelineEvent = { id: `${m.id}-e${m.timeline.length + 1}`, at: this.iso(at), kind, actorType: actor, summary, raw: { source: 'demo', seed: SEED, kind }, ...extra };
    m.timeline.push(e);
    return e;
  }

  private agentEv(m: DMission, at: number, kind: TimelineEvent['kind'], agent: DemoAgentSeed, summary: string, extra: Partial<TimelineEvent> = {}): TimelineEvent {
    return this.ev(m, at, kind, 'agent', summary, { actorId: agent.id, actorName: agent.name, ...extra });
  }

  private pickPeer(agent: DemoAgentSeed): DemoAgentSeed {
    const others = this.agents.filter((a) => a.id !== agent.id);
    return this.rng.pick(others);
  }

  private voiceLine(agent: DemoAgentSeed, peer: DemoAgentSeed, r: Rng = this.rng): string {
    return r.pick(agent.voice).replaceAll('{peer}', peer.name);
  }

  private seedMission(n: number, seed: (typeof DEMO_MISSIONS)[number], status: MissionStatus, createdAt: number): void {
    const assignee = this.agents.find((a) => a.key === seed.agent)!;
    const boss = this.agents.find((a) => a.isBoss)!;
    const teamMode = this.rng.pick(['boss', 'boss', 'rules', 'manual'] as const);
    const m: DMission = {
      id: `demo-m-${n}`,
      seq: n,
      identifier: `DEMO-${n}`,
      title: seed.title,
      objective: seed.objective,
      status,
      priority: this.rng.pick(['critical', 'high', 'high', 'medium', 'medium', 'low'] as const),
      scope: seed.scope,
      assigneeId: assignee.id,
      team: teamMode === 'manual' ? { mode: 'manual', agentIds: [assignee.id] } : teamMode === 'boss' ? { mode: 'boss', agentIds: [], bossAgentId: boss.id } : { mode: 'rules', agentIds: [] },
      limits: { maxMinutes: this.rng.pick([15, 30, 60, 90]), maxSteps: this.rng.pick([3, 5, 8]), reportLength: this.rng.pick(['short', 'medium', 'long'] as const) },
      finish: status === 'review' ? 'review_first' : this.rng.pick(['deliver', 'review_first'] as const),
      createdAt,
      retryCount: 0,
      timeline: [],
      runs: [],
      docIds: [],
      stepsLeft: 0,
      ...(seed.ideaId ? { ideaId: seed.ideaId } : {}),
    };
    if (status === 'briefing' && n % 5 === 0) m.team = { mode: 'manual', agentIds: [assignee.id] };

    let t = createdAt;
    this.ev(m, t, 'created', 'user', `Misión creada: ${m.title}`);
    t += 1 * MIN;
    const planned = m.team.mode !== 'manual';
    this.ev(m, t, 'assigned', 'system', `Asignada a ${planned ? (m.team.mode === 'boss' ? boss.name : 'reglas del catálogo') : assignee.name}`, { actorName: 'Mission Control' });

    if (planned) {
      t += 3 * MIN;
      const pending = status === 'briefing';
      m.plan = this.makePlan(m, assignee, boss, t, pending ? 'pending' : 'approved');
      this.agentEv(m, t, 'plan_proposed', m.team.mode === 'boss' ? boss : assignee, `Plan propuesto (${m.plan.steps.length} pasos)`, { actorName: m.plan.proposedBy.name, body: m.plan.rationale });
      if (pending) {
        this.missions.set(m.id, m);
        return;
      }
      t += this.rng.int(8, 40) * MIN;
      this.ev(m, t, 'plan_approved', 'user', 'Plan aprobado por el operador');
    } else if (status === 'briefing') {
      this.missions.set(m.id, m);
      return;
    }

    m.startedAt = t;
    const runCount = status === 'blocked' ? 2 : this.rng.int(1, 3);
    for (let k = 0; k < runCount; k++) {
      t += this.rng.int(1, 6) * MIN;
      const last = k === runCount - 1;
      const runStatus: RunSummary['status'] = status === 'blocked' ? 'failed' : last && status === 'ongoing' ? 'running' : last && status === 'cancelled' ? 'cancelled' : 'succeeded';
      const agent = k === 0 || !planned ? assignee : this.rng.pick(this.agents.filter((a) => !a.isBoss));
      const run = this.mkRun(agent, t, runStatus, k === 0 ? 'assignment' : status === 'blocked' ? 'automation' : 'on_demand');
      m.runs.push(run);
      if (status === 'blocked' && k > 0) {
        m.retryCount += 1;
        this.ev(m, t, 'retry', 'system', 'Reintento automático del vigilante (reparación de disposición)', { actorName: 'Paperclip', runId: run.id });
      }
      this.agentEv(m, t, 'run_started', agent, `${agent.name} inicia run (${run.source})`, { runId: run.id });
      const msgs = this.rng.int(1, 3);
      for (let j = 0; j < msgs; j++) {
        t += this.rng.int(10, 120) * 1000;
        const peer = this.pickPeer(agent);
        this.agentEv(m, t, 'message', agent, this.voiceLine(agent, peer), { runId: run.id, body: this.voiceLine(agent, peer) });
      }
      const dur = (run.durationSec ?? 60) * 1000;
      t = Math.max(t + 5000, Date.parse(run.startedAt!) + dur);
      if (run.finishedAt) {
        const fin = Math.max(t, Date.parse(run.finishedAt));
        t = fin;
        run.finishedAt = this.iso(fin);
        run.durationSec = Math.round((fin - Date.parse(run.startedAt!)) / 1000);
        if (runStatus === 'failed') this.agentEv(m, fin, 'run_failed', agent, `Run fallido: ${run.errorCode}`, { runId: run.id, body: run.error });
        else if (runStatus === 'cancelled') this.agentEv(m, fin, 'run_finished', agent, 'Run cancelado por el operador', { runId: run.id });
        else this.agentEv(m, fin, 'run_finished', agent, `Run terminado (${run.durationSec} s, ${run.tokens.input + run.tokens.output} tokens)`, { runId: run.id });
      }
    }

    const finalAgent = this.agentById(m.runs[m.runs.length - 1]!.agentId)!;
    switch (status) {
      case 'ongoing':
        m.stepsLeft = this.rng.int(6, 40);
        break;
      case 'blocked':
        t += 2 * MIN;
        this.ev(m, t, 'escalated', 'system', 'Escalada al operador tras 2 intentos de reparación (unchanged_source_state_exhausted)', { actorName: 'Paperclip' });
        t += 1000;
        this.ev(m, t, 'status_changed', 'system', 'Estado: in_progress → blocked', { actorName: 'Paperclip' });
        break;
      case 'cancelled':
        t += 2 * MIN;
        this.ev(m, t, 'status_changed', 'user', 'Estado: in_progress → cancelled (detenida por el operador)');
        m.completedAt = t;
        break;
      case 'review':
      case 'delivered': {
        const doc = this.makeReportDoc(m, finalAgent, t + 30_000);
        m.docIds.push(doc.summary.id);
        this.agentEv(m, t + 30_000, 'document', finalAgent, `Informe entregado: ${doc.summary.title}`, { body: doc.markdown });
        t += 2 * MIN;
        this.ev(m, t, 'review_requested', 'system', 'Estado: in_progress → in_review', { actorName: 'Paperclip' });
        if (status === 'delivered') {
          t += this.rng.int(10, 600) * MIN;
          this.ev(m, t, 'accepted', 'user', 'Revisado y aceptado por el operador');
          m.completedAt = t;
        }
        break;
      }
      default:
        break;
    }
    this.missions.set(m.id, m);
  }

  private makePlan(m: DMission, assignee: DemoAgentSeed, boss: DemoAgentSeed, at: number, status: MissionPlan['status']): MissionPlan {
    const helper = this.pickPeer(assignee);
    const steps = [
      { order: 1, title: 'Leer el material de partida y fijar criterios', agentId: assignee.id, agentName: assignee.name, machineId: assignee.machineId, minutes: this.rng.int(5, 15) },
      { order: 2, title: 'Ejecutar la parte principal del trabajo', agentId: assignee.id, agentName: assignee.name, machineId: assignee.machineId, minutes: this.rng.int(10, 30) },
      { order: 3, title: 'Revisar y consolidar el informe', agentId: helper.id, agentName: helper.name, machineId: helper.machineId, minutes: this.rng.int(5, 15) },
    ].slice(0, Math.max(2, Math.min(3, m.limits.maxSteps)));
    const byBoss = m.team.mode === 'boss';
    return {
      id: `demo-plan-${m.seq}`,
      proposedAt: this.iso(at),
      proposedBy: byBoss ? { type: 'agent', name: boss.name } : { type: 'rules', name: 'Regla del catálogo (simulada)' },
      status,
      steps,
      rationale: byBoss
        ? `Reparto simulado: ${assignee.name} lleva la parte principal y ${helper.name} revisa. (Plan generado por plantilla, no por un modelo.)`
        : `Selección por reglas del catálogo (simulada): ${assignee.name} cumple las capacidades y su equipo tiene menor carga.`,
    };
  }

  private makeReportDoc(m: DMission, author: DemoAgentSeed, at: number): DDoc {
    const r = new Rng(SEED + m.seq * 31);
    const paras = r.shuffle(REPORT_PARAGRAPHS).slice(0, r.int(5, 8)).map((p) => p.replaceAll('{t}', m.title));
    const markdown = `# Informe: ${m.title}\n\n> Documento de demostración generado por plantilla. Nada de esto proviene de un modelo real.\n\n## Resumen\n\n${paras[0]}\n\n${paras
      .slice(1)
      .map((p, i) => `## Sección ${i + 1}\n\n${p}`)
      .join('\n\n')}\n`;
    this.docSeq += 1;
    const summary: DocumentSummary = {
      id: `demo-doc-${this.docSeq}`,
      title: `Informe: ${m.title}`,
      missionId: m.id,
      missionIdentifier: m.identifier,
      authorName: author.name,
      authorType: 'agent',
      createdAt: this.iso(at),
      excerpt: excerpt(paras[0]!),
      wordCount: wordCount(markdown),
      source: 'paperclip-comment',
    };
    const d = { summary, markdown };
    this.docs.set(summary.id, d);
    return d;
  }

  private addNote(title: string, markdown: string, missionId: string | undefined, at: number): DocumentSummary {
    this.docSeq += 1;
    const m = missionId ? this.missions.get(missionId) : undefined;
    const summary: DocumentSummary = {
      id: `demo-note-${this.docSeq}`,
      title,
      ...(m ? { missionId: m.id, missionIdentifier: m.identifier } : {}),
      authorName: this.deps.settings.get().ownerName,
      authorType: 'user',
      createdAt: this.iso(at),
      excerpt: excerpt(markdown),
      wordCount: wordCount(markdown),
      source: 'mc-note',
    };
    this.docs.set(summary.id, { summary, markdown });
    return summary;
  }

  // ---------------------------------------------------------------- proyecciones

  private tokensOf(m: DMission): TokenUsage {
    return sumTokens(m.runs.map((r) => r.tokens));
  }

  private summaryOf(m: DMission): MissionSummary {
    const a = this.agentById(m.assigneeId);
    const children = [...this.missions.values()].filter((c) => c.parentId === m.id);
    const pendingPlan = m.plan?.status === 'pending';
    return {
      id: m.id,
      identifier: m.identifier,
      title: m.title,
      status: m.status,
      priority: m.priority,
      scope: m.scope,
      assigneeAgentId: m.assigneeId,
      ...(a ? { assigneeName: a.name, machineId: a.machineId, platform: a.platform, modelLabel: a.modelLabel } : {}),
      createdAt: this.iso(m.createdAt),
      ...(m.startedAt ? { startedAt: this.iso(m.startedAt) } : {}),
      ...(m.completedAt ? { completedAt: this.iso(m.completedAt) } : {}),
      ...(m.targetDate ? { targetDate: m.targetDate } : {}),
      durationSec: m.runs.reduce((s, r) => s + (r.durationSec ?? 0), 0),
      tokens: this.tokensOf(m),
      retryCount: m.retryCount,
      approvalPending: pendingPlan,
      childCount: children.length,
      childDoneCount: children.filter((c) => c.status === 'delivered').length,
      ...(m.ideaId ? { ideaId: m.ideaId } : {}),
    };
  }

  private provenance(): ProvenanceNote[] {
    return [
      { component: 'Datos de la misión', state: 'simulado', note: 'Semilla determinista del backend demo; nada de esto existe en Paperclip.' },
      { component: 'Ejecución y mensajes entre agentes', state: 'simulado', note: 'Plantillas de texto avanzadas por un temporizador; ningún modelo respondió.' },
      { component: 'Plan y aprobación', state: 'simulado', note: 'El plan se genera por plantilla y la aprobación vive solo en memoria del BFF.' },
      { component: 'Consumo y coste', state: 'simulado', note: 'Tokens y centavos inventados; los precios "reportados" no son reales.' },
    ];
  }

  private detailOf(m: DMission): MissionDetail {
    const children = [...this.missions.values()].filter((c) => c.parentId === m.id).map((c) => this.summaryOf(c));
    const docs = m.docIds.map((id) => this.docs.get(id)?.summary).filter((d): d is DocumentSummary => Boolean(d));
    const lastMsg = [...m.timeline].reverse().find((e) => e.kind === 'document' || (e.kind === 'message' && e.actorType === 'agent'));
    const result = (m.status === 'review' || m.status === 'delivered') && lastMsg ? { at: lastMsg.at, agentName: lastMsg.actorName ?? 'Agente', body: lastMsg.body ?? lastMsg.summary } : undefined;
    return {
      ...this.summaryOf(m),
      objective: m.objective,
      team: m.team,
      limits: m.limits,
      finish: m.finish,
      timeline: mergeTimeline(m.timeline),
      runs: m.runs,
      children,
      ...(m.plan ? { plan: m.plan } : {}),
      documents: docs,
      ...(result ? { result } : {}),
      provenance: this.provenance(),
    };
  }

  private find(id: string): DMission {
    const key = id.toLowerCase();
    const m = this.missions.get(id) ?? [...this.missions.values()].find((x) => x.identifier.toLowerCase() === key);
    if (!m) throw notFound('Misión', id);
    return m;
  }

  private allRuns(): RunSummary[] {
    return [...this.missions.values()].flatMap((m) => m.runs);
  }

  // ---------------------------------------------------------------- McBackend

  async overview(days: number): Promise<Overview> {
    const now = this.now();
    const missions = [...this.missions.values()];
    const runs = runsInWindow(this.allRuns(), days, now);
    const agents = await this.listAgents(days);
    const machines = await this.listMachines();
    const delivered = missions.filter((m) => m.status === 'delivered' && m.completedAt);
    const spend = agents.reduce((s, a) => s + a.spentMonthlyCents, 0);
    const budget = agents.reduce((s, a) => s + a.budgetMonthlyCents, 0);
    const models = new Map<string, number>();
    for (const a of agents) if (a.modelLabel) models.set(a.modelLabel, (models.get(a.modelLabel) ?? 0) + 1);
    return {
      mode: 'demo',
      generatedAt: this.iso(now),
      missions: {
        total: missions.length,
        byStatus: countByStatus(missions.map((m) => m.status)),
        retrying: missions.filter((m) => m.retryCount > 0 && (m.status === 'ongoing' || m.status === 'blocked')).length,
        deployed: delivered.length,
      },
      successRatePercent: successRate(runs),
      avgMissionDurationSec: avg(delivered.map((m) => Math.round(((m.completedAt ?? m.createdAt) - (m.startedAt ?? m.createdAt)) / 1000))),
      agents: {
        total: agents.length,
        working: agents.filter((a) => a.state === 'working').length,
        available: agents.filter((a) => a.state === 'available').length,
        paused: agents.filter((a) => a.state === 'paused').length,
        error: agents.filter((a) => a.state === 'error').length,
        topActive: [...agents].sort((a, b) => b.workloadShare - a.workloadShare).slice(0, 3).map((a) => ({ agentId: a.id, name: a.name, workloadShare: a.workloadShare })),
      },
      machines: { total: machines.length, online: machines.filter((m) => m.status === 'online').length },
      tokens: sumTokens(runs.map((r) => r.tokens)),
      budget: { monthBudgetCents: budget, monthSpendCents: spend, utilizationPercent: budget ? Math.round((spend / budget) * 1000) / 10 : 0, incidents: agents.filter((a) => a.budgetMonthlyCents > 0 && a.spentMonthlyCents / a.budgetMonthlyCents > 0.9).length },
      pendingApprovals: missions.filter((m) => m.plan?.status === 'pending').length,
      runActivity: runActivityFrom(this.allRuns(), 14, now),
      heatmap: heatmapFrom(runs),
      modelsInUse: [...models.entries()].map(([modelLabel, agentCount]) => ({ modelLabel, agentCount })),
    };
  }

  async listMissions(q: MissionQuery): Promise<{ items: MissionSummary[]; nextCursor?: string }> {
    let list = [...this.missions.values()];
    if (q.status?.length) list = list.filter((m) => q.status!.includes(m.status));
    if (q.scope) list = list.filter((m) => m.scope === q.scope);
    if (q.q) {
      const s = q.q.toLowerCase();
      list = list.filter((m) => m.title.toLowerCase().includes(s) || m.identifier.toLowerCase().includes(s) || m.objective.toLowerCase().includes(s));
    }
    list.sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq);
    return paginate(list.map((m) => this.summaryOf(m)), q.limit, q.cursor);
  }

  async createMission(req: MissionCreateRequest): Promise<MissionDetail> {
    const now = this.now();
    const specialists = this.agents.filter((a) => !a.isBoss);
    let assignee: DemoAgentSeed | undefined;
    let rationale = '';
    const extraAgents: DemoAgentSeed[] = [];
    if (req.team.mode === 'manual') {
      if (!req.team.agentIds.length) throw badRequest('team.agentIds no puede estar vacío en modo manual');
      const chosen = req.team.agentIds.map((id) => {
        const a = this.agentById(id);
        if (!a) throw badRequest(`Agente desconocido: ${id}`);
        return a;
      });
      assignee = chosen[0];
      extraAgents.push(...chosen.slice(1));
    } else if (req.team.mode === 'boss') {
      assignee = this.agentById(req.team.bossAgentId ?? '');
      if (!assignee?.isBoss) throw badRequest('bossAgentId debe ser el agente jefe');
    } else {
      const machines = await this.listMachines();
      const cands = req.requiredCapabilities?.length ? await this.deps.catalog.match(req.requiredCapabilities, await this.listAgents(14), machines, req.scope) : [];
      assignee = cands.length ? this.agentById(cands[0]!.agentId) : undefined;
      rationale = cands.length ? `Coincidencia por catálogo: ${cands[0]!.reasons.join('; ')}` : 'Sin coincidencias en el catálogo; se usa el primer especialista disponible.';
      assignee ??= specialists.find((a) => a.state === 'available') ?? specialists[0];
    }
    if (!assignee) throw badRequest('No hay agente al que asignar');
    const boss = this.agents.find((a) => a.isBoss)!;
    this.seq += 1;
    const n = this.seq;
    const needsPlan = req.team.mode !== 'manual';
    const m: DMission = {
      id: `demo-m-${n}`,
      seq: n,
      identifier: `DEMO-${n}`,
      title: req.title,
      objective: req.objective,
      status: needsPlan ? 'briefing' : 'ongoing',
      priority: req.priority,
      scope: req.scope,
      assigneeId: assignee.id,
      team: req.team,
      limits: req.limits,
      finish: req.finish,
      createdAt: now,
      retryCount: 0,
      timeline: [],
      runs: [],
      docIds: [],
      stepsLeft: 0,
      ...(req.targetDate ? { targetDate: req.targetDate } : {}),
      ...(req.ideaId ? { ideaId: req.ideaId } : {}),
    };
    this.ev(m, now, 'created', 'user', `Misión creada: ${m.title}`);
    this.ev(m, now + 1, 'assigned', 'system', `Asignada a ${assignee.name}`, { actorName: 'Mission Control' });
    if (needsPlan) {
      m.plan = this.makePlan(m, assignee, boss, now + 2, 'pending');
      if (rationale) m.plan.rationale = rationale;
      this.ev(m, now + 2, 'plan_proposed', needsPlan && req.team.mode === 'boss' ? 'agent' : 'system', `Plan propuesto (${m.plan.steps.length} pasos)`, { actorName: m.plan.proposedBy.name, body: m.plan.rationale });
    } else {
      this.startExecution(m, assignee, now + 2);
    }
    this.missions.set(m.id, m);
    for (const extra of extraAgents) {
      this.seq += 1;
      const c: DMission = { ...m, id: `demo-m-${this.seq}`, seq: this.seq, identifier: `DEMO-${this.seq}`, title: `${req.title} — parte de ${extra.name}`, assigneeId: extra.id, parentId: m.id, timeline: [], runs: [], docIds: [], plan: undefined, status: 'ongoing' };
      this.ev(c, now, 'created', 'user', `Subtarea creada para ${extra.name}`);
      this.startExecution(c, extra, now + 3);
      this.missions.set(c.id, c);
    }
    this.pushActivity(m, 'user', 'Operador', 'mission.created', `Misión creada: ${m.title}`);
    this.emit({ type: 'mission.changed', missionId: m.id, status: m.status, at: this.iso(now) });
    return this.detailOf(m);
  }

  private startExecution(m: DMission, agent: DemoAgentSeed, at: number): void {
    m.status = 'ongoing';
    m.startedAt = at;
    m.stepsLeft = this.tickRng.int(4, 9);
    const run = this.mkRun(agent, at, 'running', m.runs.length === 0 ? 'assignment' : 'on_demand');
    run.tokens = emptyTokens();
    m.runs.push(run);
    this.agentEv(m, at, 'run_started', agent, `${agent.name} inicia run (${run.source})`, { runId: run.id });
  }

  async getMission(id: string): Promise<MissionDetail> {
    return this.detailOf(this.find(id));
  }

  private changed(m: DMission): void {
    this.emit({ type: 'mission.changed', missionId: m.id, status: m.status, at: this.iso(this.now()) });
  }

  async approvePlan(id: string, note?: string): Promise<MissionDetail> {
    const m = this.find(id);
    if (m.plan?.status !== 'pending') throw conflict('La misión no tiene un plan pendiente de aprobación');
    m.plan.status = 'approved';
    const approvedBy = this.assignee(m);
    this.ev(m, this.now(), 'plan_approved', 'user', 'Plan aprobado por el operador', note ? { body: note } : {});
    this.startExecution(m, approvedBy, this.now() + 1);
    this.pushActivity(m, 'user', 'Operador', 'plan.approved', `Plan aprobado: ${m.title}`);
    this.changed(m);
    return this.detailOf(m);
  }

  async rejectPlan(id: string, note: string): Promise<MissionDetail> {
    const m = this.find(id);
    if (m.plan?.status !== 'pending') throw conflict('La misión no tiene un plan pendiente de aprobación');
    m.plan.status = 'rejected';
    m.status = 'briefing';
    this.ev(m, this.now(), 'rejected', 'user', 'Plan rechazado por el operador', { body: note });
    this.pushActivity(m, 'user', 'Operador', 'plan.rejected', `Plan rechazado: ${m.title}`);
    this.changed(m);
    return this.detailOf(m);
  }

  async acceptMission(id: string, note?: string): Promise<MissionDetail> {
    const m = this.find(id);
    if (!['review', 'blocked', 'ongoing'].includes(m.status)) throw conflict(`No se puede aceptar una misión en estado ${m.status}`);
    m.status = 'delivered';
    m.completedAt = this.now();
    this.ev(m, this.now(), 'accepted', 'user', 'Revisado y aceptado por el operador', note ? { body: note } : {});
    this.pushActivity(m, 'user', 'Operador', 'mission.accepted', `Misión aceptada: ${m.title}`);
    this.changed(m);
    return this.detailOf(m);
  }

  async requestChanges(id: string, note: string): Promise<MissionDetail> {
    const m = this.find(id);
    if (!['review', 'blocked', 'delivered'].includes(m.status)) throw conflict(`No se pueden pedir cambios en estado ${m.status}`);
    const worker = this.assignee(m);
    delete m.completedAt;
    this.ev(m, this.now(), 'message', 'user', `Cambios solicitados: ${note}`, { actorName: 'Operador', body: note });
    this.startExecution(m, worker, this.now() + 1);
    this.pushActivity(m, 'user', 'Operador', 'mission.changes_requested', `Cambios solicitados: ${m.title}`);
    this.changed(m);
    return this.detailOf(m);
  }

  async rerunMission(id: string, note?: string): Promise<MissionDetail> {
    const m = this.find(id);
    if (m.status === 'briefing' || m.status === 'ongoing') throw conflict(`No se puede reintentar una misión en estado ${m.status}`);
    const worker = this.assignee(m);
    delete m.completedAt;
    m.retryCount += 1;
    this.ev(m, this.now(), 'retry', 'user', 'Reintento solicitado por el operador', { actorName: 'Operador', ...(note ? { body: note } : {}) });
    this.startExecution(m, worker, this.now() + 1);
    this.pushActivity(m, 'user', 'Operador', 'mission.rerun', `Reintento: ${m.title}`);
    this.changed(m);
    return this.detailOf(m);
  }

  async stopMission(id: string, note?: string): Promise<MissionDetail> {
    const m = this.find(id);
    if (m.status === 'delivered' || m.status === 'cancelled') throw conflict(`La misión ya está en estado ${m.status}`);
    for (const r of m.runs) {
      if (r.status === 'running' || r.status === 'queued') {
        r.status = 'cancelled';
        r.finishedAt = this.iso(this.now());
        r.durationSec = Math.max(1, Math.round((this.now() - Date.parse(r.startedAt ?? this.iso(this.now()))) / 1000));
      }
    }
    m.status = 'cancelled';
    m.completedAt = this.now();
    m.stepsLeft = 0;
    this.ev(m, this.now(), 'status_changed', 'user', 'Estado → cancelled (detenida por el operador)', note ? { body: note } : {});
    this.pushActivity(m, 'user', 'Operador', 'mission.stopped', `Misión detenida: ${m.title}`);
    this.changed(m);
    return this.detailOf(m);
  }

  async replay(id: string): Promise<{ events: TimelineEvent[] }> {
    const m = this.find(id);
    return { events: mergeTimeline(m.timeline) };
  }

  private agentSummary(a: DemoAgentSeed & { createdAt: number }, days: number): AgentSummary {
    const now = this.now();
    const all = this.allRuns();
    const win = runsInWindow(all, days, now);
    const mine = win.filter((r) => r.agentId === a.id);
    const done = mine.filter((r) => r.durationSec !== undefined);
    const active = all.find((r) => r.agentId === a.id && r.status === 'running');
    const last = all.filter((r) => r.agentId === a.id && r.startedAt).sort((x, y) => Date.parse(y.startedAt!) - Date.parse(x.startedAt!))[0];
    const tokens = this.deps.settings.applyEstimate(sumTokens(mine.map((r) => r.tokens)), a.platform === 'mimo' ? a.modelLabel : undefined);
    const tokensFinal = sumTokens(mine.map((r) => r.tokens));
    const monthSpend = Math.round(tokensFinal.estimatedCents ?? (a.platform === 'mimo' ? (tokens.estimatedCents ?? 0) : 0));
    return {
      id: a.id,
      name: a.name,
      shortName: a.shortName,
      role: a.role,
      title: a.title,
      platform: a.platform,
      adapterType: a.adapterType,
      machineId: a.machineId,
      state: active ? 'working' : a.state,
      modelLabel: a.modelLabel,
      effort: a.effort,
      isBoss: a.isBoss,
      ...(last ? { lastRunAt: last.startedAt! } : {}),
      ...(active ? { activeRunId: active.id } : {}),
      workloadShare: win.length ? Math.round((mine.length / win.length) * 1000) / 10 : 0,
      avgDurationSec: avg(done.map((r) => r.durationSec!)),
      runsTotal: mine.length,
      runsSucceeded: mine.filter((r) => r.status === 'succeeded').length,
      runsFailed: mine.filter((r) => r.status === 'failed' || r.status === 'timed_out').length,
      tokens: tokensFinal.costStatus === 'unpriced' && a.platform === 'mimo' ? tokens : tokensFinal,
      budgetMonthlyCents: a.budgetMonthlyCents,
      spentMonthlyCents: monthSpend,
      origin: 'demo',
    };
  }

  async listAgents(days: number): Promise<AgentSummary[]> {
    return this.agents.map((a) => this.agentSummary(a, days));
  }

  async createAgent(req: AgentCreateRequest): Promise<AgentSummary> {
    if (!req.name?.trim()) throw badRequest('name es obligatorio');
    const adapter: Record<Platform, string> = { hermes: 'hermes_gateway', claude: 'claude_local', codex: 'codex_local', grok: 'grok_local', mimo: 'hermes_gateway', operador: 'process' };
    const seed: DemoAgentSeed & { createdAt: number } = {
      key: `x${this.agents.length}`,
      id: `demo-agent-${this.agents.length + 1}-${req.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: req.name.trim(),
      shortName: req.shortName ?? req.name.trim().slice(0, 8),
      role: req.role,
      title: req.role,
      platform: req.platform,
      adapterType: adapter[req.platform],
      machineId: req.machineId,
      modelLabel: req.modelLabel ?? (req.platform === 'mimo' ? 'mimo-v2.6-pro' : 'por definir'),
      effort: (req.effort && req.effort !== 'unknown' ? req.effort : 'medium') as DemoAgentSeed['effort'],
      isBoss: false,
      budgetMonthlyCents: req.budgetMonthlyCents ?? 500,
      state: 'available',
      voice: ['Recibido; empiezo con la parte que me corresponde.', '@{peer}: te dejo el avance en el hilo.'],
      createdAt: this.now(),
    };
    this.agents.push(seed);
    this.emit({ type: 'agent.changed', agentId: seed.id, state: 'available', at: this.iso(this.now()) });
    return this.agentSummary(seed, 14);
  }

  async deleteAgent(id: string): Promise<{ ok: true }> {
    const i = this.agents.findIndex((a) => a.id === id);
    if (i < 0) throw notFound('Agente', id);
    if (this.agents[i]!.isBoss) throw conflict('El agente jefe de la demo no se puede archivar');
    this.agents.splice(i, 1);
    this.emit({ type: 'agent.changed', agentId: id, state: 'offline', at: this.iso(this.now()) });
    return { ok: true };
  }

  async listAgentRuns(id: string, limit: number): Promise<RunSummary[]> {
    if (!this.agentById(id)) throw notFound('Agente', id);
    return this.allRuns()
      .filter((r) => r.agentId === id)
      .sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''))
      .slice(0, limit);
  }

  async listMachines(): Promise<MachineSummary[]> {
    const caps = await this.deps.catalog.capabilityIdsByMachine();
    const now = this.now();
    return KNOWN_MACHINES.map((km) => {
      const st = this.machineState.get(km.id)!;
      const lastSeen = now - st.lastSeenOffsetMs;
      const status: MachineSummary['status'] = st.lastSeenOffsetMs < 90_000 ? 'online' : st.lastSeenOffsetMs < 600_000 ? 'stale' : 'offline';
      const gb = 1024 ** 3;
      const memTotal = (km.id === 'win-principal' ? 96 : km.id === 'mac' ? 32 : 16) * gb;
      const diskTotal = 1000 * gb;
      const hermes: MachineHermesStatus = {
        installed: true,
        version: 'demo',
        apiServer: { reachable: status === 'online', baseUrl: km.id === 'win-principal' ? 'http://127.0.0.1:8642' : `https://${km.id}.tailnet-demo.ts.net`, lastCheckedAt: this.iso(lastSeen) },
        profiles: ['default'],
      };
      const running = this.agents.filter((a) => a.machineId === km.id && this.allRuns().some((r) => r.agentId === a.id && r.status === 'running')).length;
      return {
        id: km.id,
        name: km.name,
        os: km.os,
        role: km.role,
        status,
        lastSeenAt: this.iso(lastSeen),
        health: {
          at: this.iso(lastSeen),
          cpuPercent: st.cpu,
          memUsedBytes: Math.round((st.mem / 100) * memTotal),
          memTotalBytes: memTotal,
          diskUsedBytes: Math.round((st.disk / 100) * diskTotal),
          diskTotalBytes: diskTotal,
          gpu: km.id === 'win-principal' ? { name: 'GPU 24 GB (simulada)', memUsedBytes: Math.round((st.gpu / 100) * 24 * gb), memTotalBytes: 24 * gb, utilPercent: st.gpu } : null,
          loadAvg1: Math.round(st.cpu) / 25,
          uptimeSec: 3 * 86_400 + st.cpu * 100,
        },
        hermes,
        agentIds: this.agents.filter((a) => a.machineId === km.id).map((a) => a.id),
        capabilityIds: caps.get(km.id) ?? [],
        maxHeavyJobs: km.maxHeavyJobs,
        activeHeavyJobs: Math.min(km.maxHeavyJobs, running),
        origin: 'demo',
      };
    });
  }

  async listDocs(q: { missionId?: string; q?: string }): Promise<DocumentSummary[]> {
    const mid = q.missionId ? this.missions.get(q.missionId)?.id ?? q.missionId : undefined;
    return [...this.docs.values()]
      .map((d) => d.summary)
      .filter((d) => (!mid || d.missionId === mid) && (!q.q || `${d.title} ${d.excerpt}`.toLowerCase().includes(q.q.toLowerCase())))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async getDoc(id: string): Promise<{ summary: DocumentSummary; markdown: string }> {
    const d = this.docs.get(id);
    if (!d) throw notFound('Documento', id);
    return d;
  }

  async createDoc(req: { title: string; markdown: string; missionId?: string }): Promise<DocumentSummary> {
    if (req.missionId) this.find(req.missionId);
    const mid = req.missionId ? this.find(req.missionId).id : undefined;
    return this.addNote(req.title, req.markdown, mid, this.now());
  }

  async listSchedule(): Promise<RoutineSummary[]> {
    return this.routines.map(({ lastRunAtMs: _x, ...r }) => r);
  }

  async runRoutineNow(id: string): Promise<{ ok: true }> {
    const r = this.routines.find((x) => x.id === id);
    if (!r) throw notFound('Rutina', id);
    if (r.source !== 'paperclip') throw badRequest('Solo se pueden ejecutar rutinas con source=paperclip');
    r.lastRunAt = this.iso(this.now());
    this.extraActivity.push({ id: `demo-act-routine-${this.now()}-${this.extraActivity.length}`, at: this.iso(this.now()), actorType: 'user', actorName: 'Operador', action: 'routine.run_now', summary: `Rutina ejecutada ahora (simulada): ${r.title}` });
    return { ok: true };
  }

  private pushActivity(m: DMission, actorType: ActivityItem['actorType'], actorName: string, action: string, summary: string): void {
    const item: ActivityItem = { id: `demo-act-live-${this.extraActivity.length + 1}`, at: this.iso(this.now()), actorType, actorName, action, missionIdentifier: m.identifier, summary };
    this.extraActivity.push(item);
    this.emit({ type: 'activity', item });
  }

  async listActivity(q: { limit: number; cursor?: string }): Promise<{ items: ActivityItem[]; nextCursor?: string }> {
    const fromTimeline: ActivityItem[] = [];
    for (const m of this.missions.values()) {
      for (const e of m.timeline) {
        fromTimeline.push({
          id: `demo-act-${e.id}`,
          at: e.at,
          actorType: e.actorType,
          actorName: e.actorName ?? (e.actorType === 'user' ? 'Operador' : 'Mission Control'),
          action: `mission.${e.kind}`,
          missionIdentifier: m.identifier,
          summary: `${m.identifier} · ${e.summary}`,
        });
      }
    }
    const all = [...fromTimeline, ...this.extraActivity].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : -1));
    return paginate(all, q.limit, q.cursor);
  }

  async health(): Promise<HealthReport> {
    const machines = await this.listMachines();
    const catalog = await this.deps.catalog.counts();
    return {
      bff: { ok: true, version: BFF_VERSION, mode: 'demo', uptimeSec: Math.round((Date.now() - this.startedAtMs) / 1000) },
      paperclip: { reachable: false, baseUrl: 'simulado (backend demo, no se contacta Paperclip)' },
      hermesGateways: machines.map((m) => ({ machineId: m.id, baseUrl: m.hermes?.apiServer.baseUrl ?? '', reachable: m.hermes?.apiServer.reachable ?? false, error: 'simulado' })),
      machinesOnline: machines.filter((m) => m.status === 'online').length,
      catalog,
      notes: [
        { component: 'Backend', state: 'simulado', note: 'MODO DEMO: misiones, agentes, equipos, consumo y documentos son datos de semilla; nada se ejecuta de verdad.' },
        { component: 'Ejecutor simulado', state: 'simulado', note: `Un temporizador (${Math.round(this.tickMs / 1000)} s) avanza las misiones en curso con texto de plantilla.` },
        { component: 'Catálogo y Registro de elecciones', state: 'real', note: 'El catálogo YAML y el Registro de elecciones se leen de verdad aunque el resto sea demo.' },
        { component: 'Latidos de node-agent', state: 'pendiente', note: 'Los latidos se aceptan y guardan, pero la vista de equipos del modo demo sigue siendo simulada.' },
      ],
    };
  }

  // ---------------------------------------------------------------- ejecutor simulado

  /** Avanza un paso las misiones `ongoing`. Público para pruebas deterministas. */
  tick(): void {
    const now = this.now();
    // equipos: latidos simulados
    for (const [id, st] of this.machineState) {
      st.cpu = clamp(st.cpu + this.tickRng.int(-6, 6), 3, 95);
      st.mem = clamp(st.mem + this.tickRng.int(-2, 2), 20, 90);
      if (id === 'win-principal') st.gpu = clamp(st.gpu + this.tickRng.int(-8, 8), 0, 100);
      if (id !== 'mac') st.lastSeenOffsetMs = 3000;
    }
    for (const m of this.missions.values()) {
      if (m.status !== 'ongoing') continue;
      if (!this.tickRng.chance(0.5)) continue;
      const agent = this.agentById(m.assigneeId);
      if (!agent) continue;
      const run = [...m.runs].reverse().find((r) => r.status === 'running');
      const peer = this.tickRng.pick(this.agents.filter((a) => a.id !== agent.id));
      const speaker = this.tickRng.chance(0.3) ? peer : agent;
      const other = speaker.id === agent.id ? peer : agent;
      const line = this.voiceLine(speaker, other, this.tickRng);
      const e = this.agentEv(m, now, 'message', speaker, line, { ...(run ? { runId: run.id } : {}), body: line });
      this.emit({ type: 'mission.message', missionId: m.id, event: e });
      this.pushActivity(m, 'agent', speaker.name, 'mission.message', `${m.identifier} · ${speaker.name}: ${line}`);
      m.stepsLeft -= 1;
      if (m.stepsLeft > 0) continue;
      if (run) {
        run.status = 'succeeded';
        run.finishedAt = this.iso(now);
        run.durationSec = Math.max(5, Math.round((now - Date.parse(run.startedAt!)) / 1000));
        run.tokens = this.tokensFor(agent, this.tickRng.int(8_000, 60_000), this.tickRng.int(400, 9_000), 0);
        this.agentEv(m, now, 'run_finished', agent, `Run terminado (${run.durationSec} s, ${run.tokens.input + run.tokens.output} tokens)`, { runId: run.id });
      }
      const doc = this.makeReportDoc(m, agent, now);
      m.docIds.push(doc.summary.id);
      this.agentEv(m, now, 'document', agent, `Informe entregado: ${doc.summary.title}`, { body: doc.markdown });
      if (m.finish === 'review_first') {
        m.status = 'review';
        this.ev(m, now, 'review_requested', 'system', 'Estado: in_progress → in_review', { actorName: 'Paperclip (simulado)' });
      } else {
        m.status = 'delivered';
        m.completedAt = now;
        this.ev(m, now, 'status_changed', 'system', 'Estado: in_progress → done', { actorName: 'Paperclip (simulado)' });
      }
      this.pushActivity(m, 'system', 'Mission Control', 'mission.status', `${m.identifier} pasó a ${m.status}`);
      this.changed(m);
      this.emit({ type: 'agent.changed', agentId: agent.id, state: 'available', at: this.iso(now) });
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export { MISSION_STATUSES };
