// Conjunto pequeño de datos SIMULADOS para ?mock=1 (la UI se puede ver sin BFF). Nada aquí es real.
import type {
  ActivityItem,
  AgentSummary,
  AllowedCommand,
  Capability,
  DocumentSummary,
  HealthReport,
  Idea,
  MachineSummary,
  MissionDetail,
  MissionPlan,
  MissionStatus,
  MissionSummary,
  Overview,
  Priority,
  ProvenanceNote,
  RoutineSummary,
  RunSummary,
  SharedSettings,
  TimelineEvent,
  TokenUsage,
} from '@mc/contracts';

export const MOCK_LABEL = 'SIMULADO';

const MIN = 60_000;
export const nowMs = () => Date.now();
const ago = (minutes: number) => new Date(nowMs() - minutes * MIN).toISOString();
const ahead = (minutes: number) => new Date(nowMs() + minutes * MIN).toISOString();

const tokens = (input: number, output: number, cents: number | null = null): TokenUsage => ({
  input,
  output,
  cachedInput: Math.round(input * 0.3),
  estimatedCents: cents,
  costStatus: cents === null ? 'unpriced' : 'estimated',
});

// --- agentes --------------------------------------------------------------------------------

interface AgentSeed {
  id: string; name: string; shortName: string; role: string; platform: AgentSummary['platform']; adapter: string; machineId: string;
  state: AgentSummary['state']; model: string; boss?: boolean; share: number; avg: number; total: number; failed: number; lastRunMin: number; spent: number;
}

const AGENT_SEEDS: AgentSeed[] = [
  { id: 'ag-executor', name: 'Executor', shortName: 'Executor', role: 'Agente jefe · coordina el equipo', platform: 'hermes', adapter: 'hermes_gateway', machineId: 'win-principal', state: 'available', model: 'mimo-v2.5-pro', boss: true, share: 24, avg: 210, total: 41, failed: 1, lastRunMin: 12, spent: 420 },
  { id: 'ag-research', name: 'Research', shortName: 'Research', role: 'Investigación con fuentes en vivo', platform: 'hermes', adapter: 'hermes_gateway', machineId: 'win-laptop-1', state: 'working', model: 'mimo-v2.5-pro', share: 21, avg: 540, total: 36, failed: 2, lastRunMin: 1, spent: 310 },
  { id: 'ag-codigo', name: 'Desarrollador', shortName: 'Código', role: 'Software y revisión de código', platform: 'codex', adapter: 'codex_local', machineId: 'win-principal', state: 'working', model: 'gpt-5.5-codex', share: 17, avg: 780, total: 29, failed: 3, lastRunMin: 3, spent: 880 },
  { id: 'ag-redactor', name: 'Redactor', shortName: 'Contenido', role: 'Redacción de informes y artículos', platform: 'hermes', adapter: 'hermes_gateway', machineId: 'win-laptop-1', state: 'available', model: 'mimo-v2.5-pro', share: 14, avg: 330, total: 24, failed: 0, lastRunMin: 38, spent: 150 },
  { id: 'ag-datos', name: 'Analista de datos', shortName: 'Datos', role: 'Limpieza, análisis y gráficas', platform: 'claude', adapter: 'claude_local', machineId: 'win-principal', state: 'available', model: 'claude-sonnet-5-5', share: 11, avg: 420, total: 19, failed: 1, lastRunMin: 95, spent: 560 },
  { id: 'ag-diseno', name: 'Diseñador', shortName: 'Diseño', role: 'Piezas visuales y maquetación', platform: 'claude', adapter: 'claude_local', machineId: 'mac', state: 'available', model: 'claude-sonnet-5-5', share: 7, avg: 260, total: 12, failed: 0, lastRunMin: 240, spent: 190 },
  { id: 'ag-ops', name: 'Operaciones', shortName: 'Ops', role: 'Mantenimiento y respaldos', platform: 'hermes', adapter: 'hermes_gateway', machineId: 'win-laptop-2', state: 'paused', model: 'mimo-v2.5-pro', share: 4, avg: 95, total: 8, failed: 0, lastRunMin: 1500, spent: 40 },
  { id: 'ag-correo', name: 'Correo', shortName: 'Correo', role: 'Resúmenes de correo y agenda', platform: 'hermes', adapter: 'hermes_gateway', machineId: 'win-laptop-2', state: 'error', model: 'mimo-v2.5-pro', share: 2, avg: 60, total: 6, failed: 4, lastRunMin: 600, spent: 25 },
];

export function seedAgents(): AgentSummary[] {
  return AGENT_SEEDS.map((s) => ({
    id: s.id,
    name: s.name,
    shortName: s.shortName,
    role: s.role,
    platform: s.platform,
    adapterType: s.adapter,
    machineId: s.machineId,
    state: s.state,
    modelLabel: s.model,
    effort: 'high',
    isBoss: Boolean(s.boss),
    ...(s.boss ? {} : { reportsTo: 'ag-executor' }),
    lastRunAt: ago(s.lastRunMin),
    ...(s.state === 'working' ? { activeRunId: `run-${s.id}-live` } : {}),
    workloadShare: s.share,
    avgDurationSec: s.avg,
    runsTotal: s.total,
    runsSucceeded: s.total - s.failed,
    runsFailed: s.failed,
    tokens: tokens(s.total * 9000, s.total * 2400, s.spent),
    budgetMonthlyCents: 2500,
    spentMonthlyCents: s.spent,
    origin: 'demo',
  }));
}

// --- máquinas -------------------------------------------------------------------------------

export function seedMachines(): MachineSummary[] {
  const GB = 1024 ** 3;
  const mk = (id: string, name: string, os: MachineSummary['os'], role: string, status: MachineSummary['status'], cpu: number, memTotal: number, memUsed: number, diskTotal: number, diskUsed: number, agentIds: string[], extra: Partial<MachineSummary> = {}): MachineSummary => ({
    id,
    name,
    os,
    role,
    status,
    ...(status === 'offline' ? { lastSeenAt: ago(95) } : { lastSeenAt: ago(status === 'stale' ? 4 : 0.3) }),
    ...(status === 'offline'
      ? {}
      : {
          health: {
            at: ago(0.3),
            cpuPercent: cpu,
            memUsedBytes: memUsed * GB,
            memTotalBytes: memTotal * GB,
            diskUsedBytes: diskUsed * GB,
            diskTotalBytes: diskTotal * GB,
            loadAvg1: Math.round(cpu / 12) / 10,
            uptimeSec: 86400 * 6 + 3600 * 4,
          },
        }),
    hermes: { installed: true, version: '0.9.2', apiServer: { reachable: status !== 'offline', baseUrl: 'http://127.0.0.1:8642', lastCheckedAt: ago(0.3) }, profiles: ['default', 'mc'] },
    agentIds,
    capabilityIds: ['cap-web-research', 'cap-git', 'cap-hermes-cron'],
    maxHeavyJobs: 1,
    activeHeavyJobs: 0,
    origin: 'demo',
    ...extra,
  });
  return [
    mk('win-principal', 'Windows principal', 'windows', 'Paperclip + BFF + modelos locales', 'online', 46, 96, 52, 2000, 1180, ['ag-executor', 'ag-codigo', 'ag-datos'], {
      health: { at: ago(0.3), cpuPercent: 46, memUsedBytes: 52 * GB, memTotalBytes: 96 * GB, diskUsedBytes: 1180 * GB, diskTotalBytes: 2000 * GB, gpu: { name: 'GPU 24 GB (simulada)', memUsedBytes: 14 * GB, memTotalBytes: 24 * GB, utilPercent: 38 }, loadAvg1: 3.4, uptimeSec: 86400 * 6 + 3600 * 4 },
      activeHeavyJobs: 1,
    }),
    mk('win-laptop-1', 'Windows laptop 1', 'windows', 'Hermes gateway · investigación y redacción', 'online', 71, 32, 24, 1000, 640, ['ag-research', 'ag-redactor']),
    mk('win-laptop-2', 'Windows laptop 2', 'windows', 'Hermes gateway · operaciones y correo', 'stale', 22, 16, 13, 512, 470, ['ag-ops', 'ag-correo']),
    mk('mac', 'Mac', 'macos', 'Hermes gateway · Obsidian y diseño', 'offline', 0, 24, 0, 1000, 0, ['ag-diseno']),
  ];
}

export const COMMANDS: AllowedCommand[] = [
  { id: 'hermes-profile', label: 'Ver perfil de Hermes', description: 'Muestra el perfil activo de Hermes en este equipo (solo lectura).', argv: ['hermes', 'profile', 'show'], requiresConfirmation: true, timeoutSec: 15 },
  { id: 'hermes-status', label: 'Estado del gateway', description: 'Consulta el estado del API server de Hermes.', argv: ['hermes', 'gateway', 'status'], requiresConfirmation: true, timeoutSec: 15 },
  { id: 'hermes-restart', label: 'Reiniciar gateway de Hermes', description: 'Reinicia el API server de Hermes. Interrumpe los runs activos de este equipo.', argv: ['hermes', 'gateway', 'restart'], requiresConfirmation: true, timeoutSec: 60 },
  { id: 'disk-report', label: 'Informe de disco', description: 'Espacio libre por unidad.', argv: ['df', '-h'], requiresConfirmation: true, timeoutSec: 10 },
];

// --- misiones -------------------------------------------------------------------------------

interface MissionSeed {
  n: number; title: string; status: MissionStatus; priority: Priority; scope: MissionSummary['scope']; agent: string; createdMin: number; durationMin: number;
  retry?: number; approval?: boolean; objective: string; result?: string; idea?: string; children?: [number, number];
}

const MISSION_SEEDS: MissionSeed[] = [
  { n: 1, title: 'Frustraciones al trabajar con varios agentes de IA', status: 'briefing', priority: 'medium', scope: 'proyectos', agent: 'ag-research', createdMin: 6, durationMin: 0, approval: true, objective: 'Investigar las frustraciones recurrentes de quienes trabajan con varios agentes de IA y cómo mejorarlas. Entregar un informe breve con evidencia citada.' },
  { n: 2, title: 'Plantillas de respuesta para soporte', status: 'briefing', priority: 'low', scope: 'trabajo', agent: 'ag-redactor', createdMin: 55, durationMin: 0, approval: true, objective: 'Redactar cinco plantillas de respuesta para los casos de soporte más frecuentes.' },
  { n: 3, title: 'Auditoría de dependencias del BFF', status: 'ongoing', priority: 'high', scope: 'proyectos', agent: 'ag-codigo', createdMin: 48, durationMin: 31, objective: 'Revisar las dependencias del BFF, detectar versiones desfasadas y proponer actualizaciones seguras.', children: [3, 1] },
  { n: 4, title: 'Resumen semanal de actividad de agentes', status: 'ongoing', priority: 'medium', scope: 'trabajo', agent: 'ag-research', createdMin: 25, durationMin: 7, retry: 1, objective: 'Compilar la actividad de la semana: misiones, errores y consumo.' },
  { n: 5, title: 'Comparativa de modelos para tareas de código', status: 'review', priority: 'high', scope: 'proyectos', agent: 'ag-datos', createdMin: 190, durationMin: 52, objective: 'Comparar tres modelos en tareas de código con criterios de coste y calidad.', result: '## Resultado\n\nSe compararon tres modelos en 12 tareas de código.\n\n- **Calidad:** el modelo B resolvió 11/12.\n- **Coste:** el modelo A es 3x más barato.\n\n> Recomendación: usar A para tareas rutinarias y B para revisiones.\n' },
  { n: 6, title: 'Guion del vídeo de presentación', status: 'review', priority: 'medium', scope: 'proyectos', agent: 'ag-redactor', createdMin: 300, durationMin: 18, objective: 'Escribir un guion de 3 minutos para el vídeo de presentación del panel.', result: '## Guion\n\n1. Apertura con el cockpit.\n2. Ciudad de agentes.\n3. Lanzar una misión.\n' },
  { n: 7, title: 'Informe de postales del océano profundo', status: 'delivered', priority: 'low', scope: 'personal', agent: 'ag-research', createdMin: 1500, durationMin: 24, objective: 'Informe de investigación sobre postales y arte del océano profundo.', result: '## Informe\n\nSíntesis de fuentes sobre arte marino.\n' },
  { n: 8, title: 'Ordenar respaldos de la laptop 2', status: 'delivered', priority: 'medium', scope: 'trabajo', agent: 'ag-ops', createdMin: 2900, durationMin: 9, objective: 'Verificar y ordenar los respaldos semanales.', result: '## Respaldos\n\nTodos los respaldos verificados.\n' },
  { n: 9, title: 'Limpieza de la hoja de gastos', status: 'delivered', priority: 'medium', scope: 'personal', agent: 'ag-datos', createdMin: 4300, durationMin: 14, objective: 'Normalizar categorías de gasto y detectar duplicados.', result: '## Gastos\n\nSe normalizaron 212 filas.\n' },
  { n: 10, title: 'Diseño de portada del informe trimestral', status: 'delivered', priority: 'low', scope: 'trabajo', agent: 'ag-diseno', createdMin: 5100, durationMin: 33, objective: 'Diseñar la portada del informe trimestral.', result: '## Portada\n\nTres propuestas entregadas.\n' },
  { n: 11, title: 'Digest diario de correos pendientes', status: 'blocked', priority: 'high', scope: 'trabajo', agent: 'ag-correo', createdMin: 700, durationMin: 4, retry: 2, objective: 'Resumen diario de correos pendientes de respuesta.' },
  { n: 12, title: 'Migrar notas antiguas a Docs', status: 'cancelled', priority: 'low', scope: 'personal', agent: 'ag-ops', createdMin: 6000, durationMin: 2, objective: 'Importar notas antiguas al módulo de documentos.' },
];

const agentName = (id: string) => AGENT_SEEDS.find((a) => a.id === id)?.name ?? id;
const agentSeed = (id: string) => AGENT_SEEDS.find((a) => a.id === id);

function buildPlan(seed: MissionSeed, status: 'pending' | 'approved'): MissionPlan {
  const ag = agentSeed(seed.agent);
  return {
    id: `plan-${seed.n}`,
    proposedAt: ago(seed.createdMin - 1),
    proposedBy: { type: 'agent', name: 'Executor' },
    status,
    rationale: `Executor propone que ${agentName(seed.agent)} lidere la misión por su rol (${ag?.role ?? ''}) y que Analista de datos valide el resultado.`,
    steps: [
      { order: 1, title: 'Reunir fuentes y contexto', agentId: seed.agent, agentName: agentName(seed.agent), ...(ag ? { machineId: ag.machineId } : {}), minutes: 20 },
      { order: 2, title: 'Analizar y contrastar hallazgos', agentId: 'ag-datos', agentName: 'Analista de datos', machineId: 'win-principal', minutes: 15 },
      { order: 3, title: 'Redactar el entregable final', agentId: 'ag-redactor', agentName: 'Redactor', machineId: 'win-laptop-1', minutes: 10 },
    ],
  };
}

function buildTimeline(seed: MissionSeed, plan: MissionPlan | undefined): TimelineEvent[] {
  const t = (offsetMin: number) => ago(seed.createdMin - offsetMin);
  const ev: TimelineEvent[] = [];
  let k = 0;
  const push = (offset: number, e: Omit<TimelineEvent, 'id' | 'at'>) => ev.push({ id: `m${seed.n}-e${++k}`, at: t(offset), ...e });
  push(0, { kind: 'created', actorType: 'user', actorName: 'Tú', summary: 'Misión creada desde el asistente' });
  if (plan) push(1, { kind: 'plan_proposed', actorType: 'agent', actorId: 'ag-executor', actorName: 'Executor', summary: 'Executor propone un plan de 3 pasos', body: plan.rationale });
  if (seed.status === 'briefing') return ev;
  push(2, { kind: 'plan_approved', actorType: 'user', actorName: 'Tú', summary: 'Plan aprobado' });
  push(3, { kind: 'assigned', actorType: 'system', actorName: 'Paperclip', summary: `Asignada a ${agentName(seed.agent)}` });
  push(3.5, { kind: 'message', actorType: 'agent', actorId: 'ag-executor', actorName: 'Executor', summary: `Executor → ${agentName(seed.agent)}`, body: `Hay una misión nueva: «${seed.title}». Dedica hasta 20 minutos a reunir fuentes y deja las notas en el documento de la misión.` });
  push(4, { kind: 'run_started', actorType: 'agent', actorId: seed.agent, actorName: agentName(seed.agent), summary: 'Run iniciado', runId: `run-${seed.n}-1` });
  if (seed.retry) push(10, { kind: 'retry', actorType: 'system', actorName: 'Paperclip', summary: `Reintento ${seed.retry}/2`, body: 'El run anterior terminó con error de red; se reintenta.' });
  push(Math.max(8, seed.durationMin * 0.6), { kind: 'message', actorType: 'agent', actorId: seed.agent, actorName: agentName(seed.agent), summary: `${agentName(seed.agent)} → Executor`, body: 'Avance: encontré 14 fuentes relevantes; descarté 5 por baja calidad. Sigo con el análisis.' });
  if (seed.status === 'blocked') {
    push(seed.durationMin + 4, { kind: 'run_failed', actorType: 'agent', actorId: seed.agent, actorName: agentName(seed.agent), summary: 'Run fallido', body: 'No se pudo autenticar con el buzón (credencial caducada).' });
    push(seed.durationMin + 5, { kind: 'escalated', actorType: 'system', actorName: 'Paperclip', summary: 'Escalada al tablero tras 2 reintentos' });
    return ev;
  }
  if (seed.status === 'cancelled') {
    push(seed.durationMin + 5, { kind: 'status_changed', actorType: 'user', actorName: 'Tú', summary: 'Misión cancelada' });
    return ev;
  }
  if (seed.status === 'ongoing') {
    push(seed.durationMin + 4, { kind: 'message', actorType: 'agent', actorId: seed.agent, actorName: agentName(seed.agent), summary: `${agentName(seed.agent)} escribe`, body: 'Trabajando en el paso 2: contrastando hallazgos…' });
    return ev;
  }
  push(seed.durationMin + 4, { kind: 'run_finished', actorType: 'agent', actorId: seed.agent, actorName: agentName(seed.agent), summary: 'Run terminado', runId: `run-${seed.n}-1` });
  push(seed.durationMin + 5, { kind: 'document', actorType: 'agent', actorId: seed.agent, actorName: agentName(seed.agent), summary: 'Informe guardado en Docs' });
  if (seed.status === 'review') push(seed.durationMin + 6, { kind: 'review_requested', actorType: 'system', actorName: 'Paperclip', summary: 'Resultados listos: esperan tu revisión' });
  if (seed.status === 'delivered') {
    push(seed.durationMin + 6, { kind: 'review_requested', actorType: 'system', actorName: 'Paperclip', summary: 'Resultados listos para revisión' });
    push(seed.durationMin + 30, { kind: 'accepted', actorType: 'user', actorName: 'Tú', summary: 'Resultados aceptados' });
  }
  return ev;
}

function buildRuns(seed: MissionSeed): RunSummary[] {
  if (seed.status === 'briefing') return [];
  const sec = seed.durationMin * 60;
  const ag = agentSeed(seed.agent);
  const runs: RunSummary[] = [];
  if (seed.retry) {
    runs.push({ id: `run-${seed.n}-0`, agentId: seed.agent, agentName: agentName(seed.agent), status: 'failed', source: 'assignment', startedAt: ago(seed.createdMin - 4), finishedAt: ago(seed.createdMin - 6), durationSec: 90, tokens: tokens(3200, 120), modelLabel: ag?.model, ...(ag ? { adapterType: ag.adapter, machineId: ag.machineId } : {}), error: 'Tiempo de espera de red agotado', errorCode: 'timeout' });
  }
  runs.push({
    id: `run-${seed.n}-1`, agentId: seed.agent, agentName: agentName(seed.agent),
    status: seed.status === 'ongoing' ? 'running' : seed.status === 'blocked' ? 'failed' : seed.status === 'cancelled' ? 'cancelled' : 'succeeded',
    source: seed.retry ? 'on_demand' : 'assignment', startedAt: ago(seed.createdMin - 4),
    ...(seed.status === 'ongoing' ? {} : { finishedAt: ago(seed.createdMin - 4 - seed.durationMin) }),
    durationSec: sec, tokens: tokens(9000 + seed.n * 700, 2200 + seed.n * 120, seed.n % 3 === 0 ? null : 40 + seed.n * 6), modelLabel: ag?.model,
    ...(ag ? { adapterType: ag.adapter, machineId: ag.machineId } : {}),
    ...(seed.status === 'blocked' ? { error: 'Credencial del buzón caducada', errorCode: 'auth' } : {}),
  });
  return runs;
}

function sumTokens(runs: RunSummary[]): TokenUsage {
  const input = runs.reduce((a, r) => a + r.tokens.input, 0);
  const output = runs.reduce((a, r) => a + r.tokens.output, 0);
  const priced = runs.every((r) => r.tokens.estimatedCents !== null);
  return { input, output, cachedInput: Math.round(input * 0.3), estimatedCents: priced ? runs.reduce((a, r) => a + (r.tokens.estimatedCents ?? 0), 0) : null, costStatus: priced ? 'estimated' : 'unpriced' };
}

function docsFor(seed: MissionSeed): DocumentSummary[] {
  if (!seed.result) return [];
  return [{ id: `doc-m${seed.n}`, title: seed.title, missionId: `mis-${seed.n}`, missionIdentifier: `DEMO-${seed.n}`, authorName: agentName(seed.agent), authorType: 'agent', createdAt: ago(seed.createdMin - seed.durationMin - 5), excerpt: seed.result.replace(/[#>*\n]+/g, ' ').trim().slice(0, 140), wordCount: 60 + seed.n * 11, source: 'paperclip-document' }];
}

const PROVENANCE: ProvenanceNote[] = [
  { component: 'Misiones y agentes', state: 'simulado', note: 'Datos de ejemplo cargados en el navegador (?mock=1); no hay BFF.' },
  { component: 'Paperclip', state: 'pendiente', note: 'Sin conexión: la UI funciona sobre datos de fixtures.' },
  { component: 'Hermes API server', state: 'simulado', note: 'Estado inventado para ver los componentes.' },
];

export function buildMissionDetail(seed: MissionSeed): MissionDetail {
  const plan = seed.status === 'cancelled' ? undefined : buildPlan(seed, seed.status === 'briefing' ? 'pending' : 'approved');
  const runs = buildRuns(seed);
  const ag = agentSeed(seed.agent);
  const [childTotal, childDone] = seed.children ?? [0, 0];
  const detail: MissionDetail = {
    id: `mis-${seed.n}`,
    identifier: `DEMO-${seed.n}`,
    title: seed.title,
    status: seed.status,
    paperclipStatus: ({ briefing: 'todo', ongoing: 'in_progress', review: 'in_review', delivered: 'done', blocked: 'blocked', cancelled: 'cancelled' } as const)[seed.status],
    priority: seed.priority,
    scope: seed.scope,
    assigneeAgentId: seed.agent,
    assigneeName: agentName(seed.agent),
    ...(ag ? { machineId: ag.machineId, platform: ag.platform, modelLabel: ag.model } : {}),
    createdAt: ago(seed.createdMin),
    ...(seed.status !== 'briefing' ? { startedAt: ago(seed.createdMin - 4) } : {}),
    ...(seed.status === 'delivered' ? { completedAt: ago(seed.createdMin - seed.durationMin - 30) } : {}),
    durationSec: seed.durationMin * 60,
    tokens: sumTokens(runs),
    retryCount: seed.retry ?? 0,
    approvalPending: Boolean(seed.approval),
    childCount: childTotal,
    childDoneCount: childDone,
    ...(seed.idea ? { ideaId: seed.idea } : {}),
    objective: seed.objective,
    team: { mode: 'boss', agentIds: [], bossAgentId: 'ag-executor' },
    limits: { maxMinutes: 60, maxSteps: 3, reportLength: 'medium' },
    finish: seed.status === 'review' ? 'review_first' : 'deliver',
    timeline: buildTimeline(seed, plan),
    runs,
    children: [],
    ...(plan ? { plan } : {}),
    documents: docsFor(seed),
    ...(seed.result ? { result: { at: ago(seed.createdMin - seed.durationMin - 5), agentName: agentName(seed.agent), body: seed.result } } : {}),
    provenance: PROVENANCE,
  };
  return detail;
}

export function seedMissions(): MissionDetail[] {
  return MISSION_SEEDS.map(buildMissionDetail);
}

// --- documentos, rutinas, actividad ---------------------------------------------------------

export const DOC_MARKDOWN: Record<string, string> = {
  'doc-nota-1': '# Reglas de la casa\n\n- Los informes largos van a **Docs**, no al chat.\n- Cada misión tiene un tope de minutos.\n\n## Revisión\n\nNada se cierra sin tu aceptación cuando la misión pide revisión previa.\n',
};

export function seedDocs(missions: MissionDetail[]): Array<{ summary: DocumentSummary; markdown: string }> {
  const out = missions.flatMap((m) =>
    m.documents.map((d) => ({
      summary: d,
      markdown: `# ${d.title}\n\n*Informe generado por ${d.authorName} (SIMULADO).*\n\n${m.result?.body ?? ''}\n## Fuentes\n\n- [Documentación de Paperclip](https://example.com/paperclip)\n- Notas internas del equipo\n\n| Fuente | Fiabilidad |\n| --- | --- |\n| Informe interno | Alta |\n| Foro público | Media |\n`,
    })),
  );
  out.push({
    summary: { id: 'doc-nota-1', title: 'Reglas de la casa', authorName: 'Tú', authorType: 'user', createdAt: ago(3000), excerpt: 'Los informes largos van a Docs, no al chat.', wordCount: 38, source: 'mc-note' },
    markdown: DOC_MARKDOWN['doc-nota-1'] ?? '',
  });
  return out;
}

export function seedRoutines(): RoutineSummary[] {
  return [
    { id: 'rt-digest', title: 'Digest diario de misiones', schedule: '0 8 * * *', status: 'active', assigneeAgentId: 'ag-executor', assigneeName: 'Executor', nextRunAt: ahead(380), lastRunAt: ago(1060), source: 'paperclip', canRunNow: true },
    { id: 'rt-backup', title: 'Verificación de respaldos', schedule: '30 2 * * 1', status: 'active', assigneeAgentId: 'ag-ops', assigneeName: 'Operaciones', nextRunAt: ahead(4200), lastRunAt: ago(5900), source: 'paperclip', canRunNow: true },
    { id: 'rt-correo', title: 'Resumen de correos sin leer', schedule: '0 7 * * 1-5', status: 'paused', assigneeAgentId: 'ag-correo', assigneeName: 'Correo', lastRunAt: ago(2800), source: 'paperclip', canRunNow: false },
    { id: 'rt-hermes-limpieza', title: 'Limpieza de caché (cron de Hermes)', schedule: '*/30 * * * *', status: 'active', nextRunAt: ahead(12), lastRunAt: ago(18), source: 'hermes-cron', canRunNow: false },
  ];
}

export function seedActivity(): ActivityItem[] {
  const rows: Array<[number, ActivityItem['actorType'], string, string, string, string?, string?]> = [
    [1, 'agent', 'Research', 'run.progress', 'Research sigue reuniendo fuentes de la misión DEMO-4', 'DEMO-4', 'win-laptop-1'],
    [3, 'agent', 'Desarrollador', 'run.started', 'Desarrollador inició el análisis de dependencias', 'DEMO-3', 'win-principal'],
    [12, 'agent', 'Executor', 'chat', 'Executor conversó con el propietario', undefined, 'win-principal'],
    [30, 'user', 'Tú', 'mission.created', 'Misión creada: Frustraciones al trabajar con varios agentes', 'DEMO-1'],
    [55, 'system', 'Paperclip', 'plan.proposed', 'Plan propuesto para DEMO-2', 'DEMO-2'],
    [95, 'agent', 'Analista de datos', 'run.finished', 'Analista de datos terminó la comparativa de modelos', 'DEMO-5', 'win-principal'],
    [240, 'agent', 'Diseñador', 'document.saved', 'Diseñador guardó una propuesta de portada', 'DEMO-10', 'mac'],
    [600, 'agent', 'Correo', 'run.failed', 'Correo falló: credencial del buzón caducada', 'DEMO-11', 'win-laptop-2'],
    [1500, 'user', 'Tú', 'mission.accepted', 'Resultados aceptados de DEMO-7', 'DEMO-7'],
  ];
  return rows.map(([min, actorType, actorName, action, summary, ident, machineId], i) => ({
    id: `act-${i + 1}`, at: ago(min), actorType, actorName, action, summary, ...(ident ? { missionIdentifier: ident } : {}), ...(machineId ? { machineId } : {}),
  }));
}

// --- catálogo, ideas -------------------------------------------------------------------------

export function seedCatalog(): Capability[] {
  const base = { permisos: { lectura: ['web'], escritura: [] as string[] }, contexto: ['A', 'C'] as Capability['contexto'], necesita: [] as string[], evidencia: [] as Capability['evidencia'], procedencia: 'H' as const };
  return [
    { ...base, id: 'cap-web-research', nombre: 'Investigación web con fuentes', tipo: 'skill', que_hace: 'Busca y contrasta fuentes en vivo y devuelve notas con enlaces.', ejecutores: ['hermes', 'claude'], equipos: ['win-principal', 'win-laptop-1'], consumo: 'suscripcion', estado: 'probada', compatibilidad: { hermes: 'VL', claude: 'FV', codex: 'NC' }, evidencia: [{ fecha: '2026-10-08', donde: 'win-principal', resultado: 'Run de ejemplo con 14 fuentes', referencia: 'docs/06-evidencias.md' }] },
    { ...base, id: 'cap-git', nombre: 'Git y revisión de código', tipo: 'herramienta-local', que_hace: 'Lee repositorios, abre ramas y propone cambios.', ejecutores: ['codex', 'claude'], equipos: ['win-principal', 'mac'], consumo: 'suscripcion', estado: 'configurada', compatibilidad: { codex: 'PF', claude: 'VL' }, permisos: { lectura: ['repos'], escritura: ['repos'] } },
    { ...base, id: 'cap-hermes-cron', nombre: 'Cron de Hermes', tipo: 'automatizacion', que_hace: 'Programa tareas recurrentes dentro de Hermes.', ejecutores: ['hermes'], equipos: ['win-laptop-2'], consumo: 'local', estado: 'descubierta', compatibilidad: { hermes: 'FV' } },
    { ...base, id: 'cap-obsidian', nombre: 'Lector de Obsidian', tipo: 'mcp', que_hace: 'Lee notas de la bóveda (solo lectura).', ejecutores: ['hermes', 'claude', 'codex'], equipos: ['mac'], consumo: 'sin-modelo', estado: 'pendiente', compatibilidad: { hermes: 'FV', claude: 'FV' } },
    { ...base, id: 'cap-slack', nombre: 'Slack: lectura de canales', tipo: 'conector', que_hace: 'Lee canales autorizados y resume hilos.', ejecutores: ['claude'], equipos: ['win-principal'], consumo: 'suscripcion', estado: 'pendiente', compatibilidad: { claude: 'NC' }, necesita: ['Token de Slack'] },
    { ...base, id: 'cap-ollama', nombre: 'Modelos locales (Ollama)', tipo: 'modelo', que_hace: 'Ejecuta modelos abiertos en la GPU de la Windows principal.', ejecutores: ['hermes'], equipos: ['win-principal'], consumo: 'local', estado: 'configurada', compatibilidad: { hermes: 'VL' }, necesita: ['GPU 24 GB'] },
    { ...base, id: 'cap-browser', nombre: 'Navegador controlado', tipo: 'navegador', que_hace: 'Navega páginas con permisos acotados.', ejecutores: ['claude', 'grok'], equipos: ['win-laptop-1'], consumo: 'api-facturada', estado: 'incompatible', compatibilidad: { claude: 'NC', grok: 'NC' } },
  ];
}

export function seedIdeas(): Idea[] {
  return [
    { id: 'N05', fecha: '2026-10-07', idea: 'Resumen semanal automático de lo que hicieron los agentes', decision: 'sin decisión tuya', estado: 'sin-decision', dondeLoDijiste: 'Conversación del 7 oct', cambioProximaRonda: 'Reformular como rutina del Schedule' },
    { id: 'N06', fecha: '2026-10-07', idea: 'Comparar modelos de MiMo contra Claude en tareas de redacción', decision: 'Elegida', estado: 'elegida', razonLiteral: 'Necesito saber si compensa el Token Plan', dondeLoDijiste: 'Slack #ideas' },
    { id: 'N07', fecha: '2026-10-08', idea: 'Reloj de respiración 4-7-8 dentro del panel', decision: 'Aplazada', estado: 'aplazada', razonLiteral: 'Después del hito 1' },
    { id: 'N08', fecha: '2026-10-08', idea: 'Control del panel con las manos', decision: 'Descartada por ahora', estado: 'descartada', razonLiteral: 'Fuera del alcance del hito' },
    { id: 'N09', fecha: '2026-10-08', idea: 'Importar notas antiguas de Notion a Docs', decision: 'sin decisión tuya', estado: 'sin-decision' },
  ];
}

export function seedSettings(): SharedSettings {
  return {
    ownerName: 'Abraham',
    bossAgentId: 'ag-executor',
    modelPrices: [
      { modelLabel: 'mimo-v2.5-pro', inputPerMTok: 0.4, outputPerMTok: 1.6, nota: 'Precio de ejemplo (simulado)' } as SharedSettings['modelPrices'][number],
      { modelLabel: 'claude-sonnet-5-5', inputPerMTok: 3, outputPerMTok: 15 },
      { modelLabel: 'gpt-5.5-codex', inputPerMTok: 1.25, outputPerMTok: 10 },
    ],
    healthThresholds: { cpuPercent: 85, memPercent: 85, diskPercent: 90 },
    vaultPaths: {},
    ...({ agentDefaults: { maxDailyRuns: 40, maxDailyCostCents: 500, maxConcurrentRuns: 2 }, hermesSecretIds: { 'win-principal': 'secret-hermes-win-principal' } } as object),
  };
}

export function buildHealth(mode: 'demo'): HealthReport {
  return {
    bff: { ok: true, version: '0.1.0-mock', mode, uptimeSec: 5400 },
    paperclip: { reachable: true, baseUrl: 'http://127.0.0.1:3100', version: '2026.1005.0 (simulado)', deploymentMode: 'local_trusted' },
    hermesGateways: [
      { machineId: 'win-principal', baseUrl: 'http://127.0.0.1:8642', reachable: true },
      { machineId: 'win-laptop-1', baseUrl: 'https://laptop1.tailnet.ts.net', reachable: true },
      { machineId: 'win-laptop-2', baseUrl: 'https://laptop2.tailnet.ts.net', reachable: false, error: 'Latido atrasado' },
    ],
    machinesOnline: 2,
    catalog: { capabilities: 7, errors: 0, warnings: 2 },
    notes: PROVENANCE,
  };
}

export function buildOverview(missions: MissionDetail[], agents: AgentSummary[], machines: MachineSummary[]): Overview {
  const byStatus: Record<MissionStatus, number> = { briefing: 0, ongoing: 0, review: 0, delivered: 0, blocked: 0, cancelled: 0 };
  for (const m of missions) byStatus[m.status]++;
  // Misma forma que el BFF: fila 0 = domingo (getUTCDay), columnas = hora UTC.
  const heat: number[][] = [];
  for (let s = 0; s < 7; s++) {
    const d = (s + 6) % 7; // 0 = lunes, para el patrón laboral/fin de semana
    const row: number[] = [];
    for (let h = 0; h < 24; h++) {
      const work = h >= 8 && h <= 20 ? 1 : 0.15;
      const weekend = d >= 5 ? 0.35 : 1;
      const wave = 1 + Math.sin((h + d * 3) / 2.3);
      row.push(Math.max(0, Math.round(work * weekend * wave * 3 + ((d * 7 + h * 3) % 4) - 1)));
    }
    heat.push(row);
  }
  const days: Overview['runActivity'] = [];
  for (let i = 13; i >= 0; i--) {
    const date = new Date(nowMs() - i * 86400_000).toISOString().slice(0, 10);
    const base = 4 + ((i * 5) % 9);
    days.push({ date, succeeded: base, failed: i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0, other: i % 4 === 0 ? 1 : 0 });
  }
  const models = new Map<string, number>();
  for (const a of agents) models.set(a.modelLabel ?? 'sin modelo', (models.get(a.modelLabel ?? 'sin modelo') ?? 0) + 1);
  const spend = agents.reduce((a, g) => a + g.spentMonthlyCents, 0);
  return {
    mode: 'demo',
    generatedAt: new Date(nowMs()).toISOString(),
    missions: { total: 142, byStatus: { ...byStatus, delivered: byStatus.delivered + 118 }, retrying: missions.filter((m) => m.retryCount > 0 && m.status === 'ongoing').length, deployed: byStatus.ongoing },
    successRatePercent: 94,
    avgMissionDurationSec: 1380,
    agents: {
      total: agents.length,
      working: agents.filter((a) => a.state === 'working').length,
      available: agents.filter((a) => a.state === 'available').length,
      paused: agents.filter((a) => a.state === 'paused').length,
      error: agents.filter((a) => a.state === 'error').length,
      topActive: [...agents].sort((a, b) => b.workloadShare - a.workloadShare).slice(0, 4).map((a) => ({ agentId: a.id, name: a.name, workloadShare: a.workloadShare })),
    },
    machines: { total: machines.length, online: machines.filter((m) => m.status === 'online').length },
    tokens: tokens(1_840_000, 512_000, 2575),
    budget: { monthBudgetCents: agents.length * 2500, monthSpendCents: spend, utilizationPercent: Math.round((spend / (agents.length * 2500)) * 100), incidents: 0 },
    pendingApprovals: missions.filter((m) => m.approvalPending).length,
    runActivity: days,
    heatmap: heat,
    modelsInUse: [...models.entries()].map(([modelLabel, agentCount]) => ({ modelLabel, agentCount })),
  };
}
