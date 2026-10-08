/**
 * Contratos compartidos de Mission Control.
 * Los consumen: apps/ui, apps/bff, apps/node-agent, packages/catalog, packages/hermes-mock, tests.
 * Regla: todo lo que viaja entre procesos se declara aquí. Nada de este archivo contiene credenciales.
 */

// ---------------------------------------------------------------------------
// Identidad de plataformas, equipos y modos
// ---------------------------------------------------------------------------

/** Plataformas ejecutoras obligatorias (decisión del 8 oct 2026) + "operador" para acciones humanas. */
export type Platform = 'hermes' | 'claude' | 'codex' | 'grok' | 'mimo' | 'operador';

/** Adaptadores de Paperclip que usamos (nombres exactos de `GET /api/adapters`). */
export type PaperclipAdapterType =
  | 'hermes_gateway'
  | 'hermes_local'
  | 'claude_local'
  | 'codex_local'
  | 'grok_local'
  | 'http'
  | 'process';

/** Equipos físicos del piloto. `nube` cubre sesiones Cloud de construcción. */
export type MachineId = 'win-principal' | 'win-laptop-1' | 'win-laptop-2' | 'mac' | 'nube' | (string & {});

export type MachineOs = 'windows' | 'macos' | 'linux';

/** Origen de los datos que ve la UI. Siempre visible en pantalla. */
export type BackendMode = 'paperclip' | 'demo';

// ---------------------------------------------------------------------------
// Misiones (proyección de las issues de Paperclip)
// ---------------------------------------------------------------------------

/** Estados del tablero MC. Mapeo a Paperclip en docs/03-arquitectura.md §4. */
export type MissionStatus = 'briefing' | 'ongoing' | 'review' | 'delivered' | 'blocked' | 'cancelled';

export type PaperclipIssueStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked'
  | 'cancelled';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export type TeamMode = 'boss' | 'manual' | 'rules';

export type ReportLength = 'short' | 'medium' | 'long';

export type FinishPolicy = 'deliver' | 'review_first';

export interface MissionLimits {
  /** Tope de duración total en minutos (se traduce a timeoutSec del adaptador y a vigilancia del BFF). */
  maxMinutes: number;
  /** Número máximo de pasos/subtareas que el plan puede proponer. */
  maxSteps: number;
  reportLength: ReportLength;
}

export interface MissionTeam {
  mode: TeamMode;
  /** Agentes elegidos a mano cuando mode === 'manual'. */
  agentIds: string[];
  /** Agente coordinador cuando mode === 'boss' (debe tener modelo con herramientas). */
  bossAgentId?: string;
}

export interface MissionCreateRequest {
  title: string;
  objective: string;
  priority: Priority;
  /** ISO 8601 con zona horaria, opcional. */
  targetDate?: string;
  team: MissionTeam;
  limits: MissionLimits;
  finish: FinishPolicy;
  /** Capacidades del catálogo que la misión requiere (ids). Guían la asignación por reglas. */
  requiredCapabilities?: string[];
  /** Separación de ámbitos: trabajo, proyectos o personal nunca se mezclan en una misión. */
  scope: 'trabajo' | 'proyectos' | 'personal';
  /** Id de idea del Registro de elecciones que origina la misión (p. ej. "N05"), si aplica. */
  ideaId?: string;
}

export interface MissionSummary {
  id: string;
  /** Identificador legible de Paperclip (p. ej. "MIS-1"). En demo: "DEMO-n". */
  identifier: string;
  title: string;
  status: MissionStatus;
  paperclipStatus?: PaperclipIssueStatus;
  priority: Priority;
  scope: MissionCreateRequest['scope'];
  assigneeAgentId?: string;
  assigneeName?: string;
  machineId?: MachineId;
  platform?: Platform;
  modelLabel?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  targetDate?: string;
  /** Duración acumulada de runs en segundos. */
  durationSec: number;
  tokens: TokenUsage;
  retryCount: number;
  approvalPending: boolean;
  childCount: number;
  childDoneCount: number;
  ideaId?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  cachedInput: number;
  /** Coste estimado en centavos de USD; null cuando el proveedor no informa precio (hermes_gateway). */
  estimatedCents: number | null;
  /** 'reported' si vino del proveedor; 'estimated' si lo calculó MC con su tabla; 'unpriced' si no hay dato. */
  costStatus: 'reported' | 'estimated' | 'unpriced';
}

export type TimelineKind =
  | 'created'
  | 'assigned'
  | 'run_started'
  | 'run_finished'
  | 'run_failed'
  | 'message'
  | 'plan_proposed'
  | 'plan_approved'
  | 'status_changed'
  | 'retry'
  | 'escalated'
  | 'review_requested'
  | 'accepted'
  | 'rejected'
  | 'document'
  | 'system';

export interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  /** Quién: 'user' (tú), 'agent', 'system' (Paperclip/MC). */
  actorType: 'user' | 'agent' | 'system';
  actorId?: string;
  actorName?: string;
  /** Texto breve para la línea de tiempo. */
  summary: string;
  /** Cuerpo completo (mensaje, informe, error) cuando exista. */
  body?: string;
  runId?: string;
  /** Datos crudos de origen, para replay y auditoría. */
  raw?: unknown;
}

export interface RunSummary {
  id: string;
  agentId: string;
  agentName: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
  source: 'assignment' | 'on_demand' | 'automation' | 'timer' | 'unknown';
  startedAt?: string;
  finishedAt?: string;
  durationSec?: number;
  tokens: TokenUsage;
  modelLabel?: string;
  adapterType?: PaperclipAdapterType | string;
  machineId?: MachineId;
  error?: string;
  errorCode?: string;
}

export interface MissionDetail extends MissionSummary {
  objective: string;
  team: MissionTeam;
  limits: MissionLimits;
  finish: FinishPolicy;
  timeline: TimelineEvent[];
  runs: RunSummary[];
  children: MissionSummary[];
  /** Plan propuesto (por agente jefe o por reglas) pendiente o aprobado. */
  plan?: MissionPlan;
  documents: DocumentSummary[];
  /** Resultado final (último comentario del agente o documento marcado como entregable). */
  result?: { at: string; agentName: string; body: string };
  /** Qué partes de esta misión son reales y cuáles simuladas, para la UI. */
  provenance: ProvenanceNote[];
}

export interface MissionPlan {
  id: string;
  proposedAt: string;
  proposedBy: { type: 'agent' | 'rules'; name: string };
  status: 'pending' | 'approved' | 'rejected';
  steps: Array<{ order: number; title: string; agentId?: string; agentName?: string; machineId?: MachineId; minutes?: number }>;
  rationale: string;
  approvalId?: string;
}

export interface ProvenanceNote {
  component: string;
  state: 'real' | 'simulado' | 'pendiente';
  note: string;
}

// ---------------------------------------------------------------------------
// Agentes y máquinas
// ---------------------------------------------------------------------------

export type AgentState = 'working' | 'available' | 'paused' | 'error' | 'offline';

export interface AgentSummary {
  id: string;
  name: string;
  /** Nombre corto para la ciudad/torre (p. ej. "Research"). */
  shortName: string;
  role: string;
  title?: string;
  platform: Platform;
  adapterType?: PaperclipAdapterType | string;
  machineId?: MachineId;
  state: AgentState;
  modelLabel?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'unknown';
  isBoss: boolean;
  reportsTo?: string;
  lastRunAt?: string;
  activeRunId?: string;
  /** Porcentaje del total de runs de la empresa en la ventana consultada. */
  workloadShare: number;
  avgDurationSec: number;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  tokens: TokenUsage;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  /** 'real' si está en Paperclip; 'demo' si es semilla del backend simulado. */
  origin: BackendMode;
}

export interface AgentCreateRequest {
  name: string;
  shortName?: string;
  role: string;
  platform: Platform;
  machineId: MachineId;
  modelLabel?: string;
  effort?: AgentSummary['effort'];
  /** Instrucciones estables (en hermes_gateway viajan en adapterConfig.instructions). */
  instructions?: string;
  budgetMonthlyCents?: number;
  reportsTo?: string;
}

export interface MachineHealthSample {
  at: string;
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  gpu?: { name: string; memUsedBytes: number; memTotalBytes: number; utilPercent?: number } | null;
  loadAvg1?: number;
  uptimeSec: number;
}

export interface MachineHermesStatus {
  installed: boolean;
  version?: string;
  apiServer: { reachable: boolean; baseUrl?: string; lastCheckedAt?: string; error?: string };
  profiles?: string[];
}

export interface MachineSummary {
  id: MachineId;
  name: string;
  os: MachineOs;
  /** Papel asignado en el piloto (docs/03-arquitectura.md). */
  role: string;
  status: 'online' | 'stale' | 'offline' | 'unknown';
  lastSeenAt?: string;
  health?: MachineHealthSample;
  hermes?: MachineHermesStatus;
  /** Agentes de Paperclip ligados a este equipo. */
  agentIds: string[];
  /** Capacidades del catálogo disponibles en este equipo (ids). */
  capabilityIds: string[];
  /** Límite de trabajos pesados simultáneos (GPU) acordado en el plan. */
  maxHeavyJobs: number;
  activeHeavyJobs: number;
  origin: BackendMode;
}

/** Latido que envía node-agent al BFF: POST /api/mc/machines/:id/heartbeat (Authorization: Bearer <token>). */
export interface MachineHeartbeat {
  machineId: MachineId;
  name: string;
  os: MachineOs;
  nodeAgentVersion: string;
  health: MachineHealthSample;
  hermes: MachineHermesStatus;
  /** Comandos permitidos declarados por el node-agent (ids). */
  allowedCommandIds: string[];
  /** URL base del propio node-agent alcanzable desde el BFF (p. ej. http://100.x.y.z:3400); si falta, el BFF no reenvía comandos. */
  nodeAgentUrl?: string;
  /** Límite de trabajos pesados simultáneos declarado por el equipo (MC_MAX_HEAVY_JOBS). */
  maxHeavyJobs?: number;
  /** Trabajos pesados en curso según el node-agent (0 si no los mide todavía). */
  activeHeavyJobs?: number;
}

/** Comando rápido ejecutable desde la UI vía node-agent. Siempre de lista permitida y con confirmación. */
export interface AllowedCommand {
  id: string;
  label: string;
  description: string;
  /** Ejecutable y argumentos fijos; no admite entrada libre del usuario. */
  argv: string[];
  requiresConfirmation: boolean;
  timeoutSec: number;
}

// ---------------------------------------------------------------------------
// Catálogo de capacidades
// ---------------------------------------------------------------------------

export type CapabilityType =
  | 'skill'
  | 'mcp'
  | 'plugin'
  | 'api'
  | 'conector'
  | 'herramienta-local'
  | 'navegador'
  | 'automatizacion'
  | 'modelo';

/** Estados de compatibilidad heredados de tu plan: NC → FV → VL → PF. */
export type CompatibilityState = 'NC' | 'FV' | 'VL' | 'PF';

export type CapabilityState = 'descubierta' | 'configurada' | 'probada' | 'pendiente' | 'incompatible';

export type ConsumptionClass = 'local' | 'suscripcion' | 'api-facturada' | 'sin-modelo';

export interface CapabilityEvidence {
  fecha: string;
  donde: MachineId | 'nube' | 'documentacion';
  resultado: string;
  /** Ruta o URL de la prueba o de la fuente. */
  referencia?: string;
}

export interface Capability {
  id: string;
  nombre: string;
  tipo: CapabilityType;
  que_hace: string;
  necesita: string[];
  ejecutores: Platform[];
  equipos: MachineId[];
  /** Niveles de contexto de tu sistema: A común breve, B proyecto, C tarea. */
  contexto: Array<'A' | 'B' | 'C'>;
  permisos: { lectura: string[]; escritura: string[] };
  consumo: ConsumptionClass;
  estado: CapabilityState;
  compatibilidad: Partial<Record<Platform, CompatibilityState>>;
  evidencia: CapabilityEvidence[];
  version?: string;
  /** Fuente de la definición (ruta en Obsidian, URL de documentación oficial). */
  fuente?: string;
  /** [C] confirmado, [H] comprobado, [P] plan histórico, [F] fuente externa, [I] inferencia, [Pr] propuesta. */
  procedencia: 'C' | 'H' | 'P' | 'F' | 'I' | 'Pr';
  /** Enlace a la skill/MCP/plugin en Paperclip cuando exista. */
  paperclipRef?: { kind: 'skill' | 'mcp' | 'plugin'; id: string };
  /** Enlace a la definición en Hermes cuando exista (ruta de skill, nombre de toolset). */
  hermesRef?: string;
}

export interface CatalogValidationIssue {
  capabilityId?: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

// ---------------------------------------------------------------------------
// Ideas (Registro de elecciones, solo lectura)
// ---------------------------------------------------------------------------

export interface Idea {
  /** Id del registro (p. ej. "N05"). */
  id: string;
  fecha: string;
  idea: string;
  /** Texto literal de la columna Decisión del registro. */
  decision: string;
  /** 'sin-decision' cuando el registro dice "sin decisión tuya". */
  estado: 'sin-decision' | 'elegida' | 'modificada' | 'aplazada' | 'descartada';
  razonLiteral?: string;
  dondeLoDijiste?: string;
  cambioProximaRonda?: string;
  /** Misión creada a partir de la idea, si tú la elegiste desde MC. */
  missionId?: string;
}

// ---------------------------------------------------------------------------
// Programación, documentos, actividad, salud y resumen
// ---------------------------------------------------------------------------

export interface RoutineSummary {
  id: string;
  title: string;
  schedule: string;
  status: 'active' | 'paused' | 'archived';
  assigneeAgentId?: string;
  assigneeName?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  source: 'paperclip' | 'hermes-cron';
  canRunNow: boolean;
}

export interface DocumentSummary {
  id: string;
  title: string;
  missionId?: string;
  missionIdentifier?: string;
  authorName: string;
  authorType: 'agent' | 'user';
  createdAt: string;
  updatedAt?: string;
  /** Primeras líneas para la tarjeta. */
  excerpt: string;
  wordCount: number;
  source: 'paperclip-document' | 'paperclip-comment' | 'mc-note';
}

export interface ActivityItem {
  id: string;
  at: string;
  actorType: 'user' | 'agent' | 'system';
  actorName: string;
  action: string;
  missionIdentifier?: string;
  machineId?: MachineId;
  summary: string;
}

export interface Overview {
  mode: BackendMode;
  generatedAt: string;
  missions: { total: number; byStatus: Record<MissionStatus, number>; retrying: number; deployed: number };
  /** Porcentaje 0–100 de runs con éxito en la ventana. */
  successRatePercent: number;
  avgMissionDurationSec: number;
  agents: { total: number; working: number; available: number; paused: number; error: number; topActive: Array<{ agentId: string; name: string; workloadShare: number }> };
  machines: { total: number; online: number };
  tokens: TokenUsage;
  budget: { monthBudgetCents: number; monthSpendCents: number; utilizationPercent: number; incidents: number };
  pendingApprovals: number;
  /** Serie diaria para las gráficas (últimos 14 días). */
  runActivity: Array<{ date: string; succeeded: number; failed: number; other: number }>;
  /** Mapa de calor 7×24 de runs: fila 0 = domingo … fila 6 = sábado (getUTCDay), columna = hora UTC (getUTCHours). La UI rota a lunes-primero y rotula «horas UTC». */
  heatmap: number[][];
  modelsInUse: Array<{ modelLabel: string; agentCount: number }>;
}

export interface HealthReport {
  bff: { ok: boolean; version: string; mode: BackendMode; uptimeSec: number };
  paperclip: { reachable: boolean; baseUrl: string; version?: string; deploymentMode?: string; error?: string };
  hermesGateways: Array<{ machineId: MachineId; baseUrl: string; reachable: boolean; error?: string }>;
  machinesOnline: number;
  catalog: { capabilities: number; errors: number; warnings: number };
  notes: ProvenanceNote[];
}

// ---------------------------------------------------------------------------
// Eventos en tiempo real (SSE: GET /api/mc/events)
// ---------------------------------------------------------------------------

export type McEvent =
  | { type: 'mission.changed'; missionId: string; status: MissionStatus; at: string }
  | { type: 'mission.message'; missionId: string; event: TimelineEvent }
  | { type: 'agent.changed'; agentId: string; state: AgentState; at: string }
  | { type: 'machine.changed'; machineId: MachineId; status: MachineSummary['status']; at: string }
  | { type: 'activity'; item: ActivityItem }
  | { type: 'heartbeat'; at: string };

// ---------------------------------------------------------------------------
// Ajustes compartidos (los personales viven en localStorage del navegador)
// ---------------------------------------------------------------------------

export interface SharedSettings {
  ownerName: string;
  bossAgentId?: string;
  /** Tabla de precios por modelo (USD por millón de tokens) para estimar consumo "unpriced". `nota` es texto libre (p. ej. "ejemplo, ajustar"). */
  modelPrices: Array<{ modelLabel: string; inputPerMTok: number; outputPerMTok: number; nota?: string }>;
  /** Topes que el BFF aplica a cada agente que crea (Paperclip no detecta el consumo "unpriced" de hermes_gateway). */
  agentDefaults?: { maxDailyRuns?: number; maxDailyCostCents?: number; maxConcurrentRuns?: number; timeoutSec?: number };
  /** Id del secreto de Paperclip con la clave del API server de Hermes de cada equipo (solo ids, nunca valores). */
  hermesSecretIds?: Partial<Record<MachineId, string>>;
  /** Umbrales de alerta de salud por equipo. */
  healthThresholds: { cpuPercent: number; memPercent: number; diskPercent: number };
  /** Ruta del Registro de elecciones (solo lectura) y de la bóveda, por equipo. */
  vaultPaths: Partial<Record<MachineId, { vaultRoot: string; electionsFile: string }>>;
}

// ---------------------------------------------------------------------------
// Errores de API
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  code:
    | 'not_found'
    | 'invalid_request'
    | 'paperclip_unreachable'
    | 'hermes_unreachable'
    | 'unauthorized'
    | 'conflict'
    | 'idempotency_key_conflict'
    | 'forbidden_host'
    | 'forbidden_origin'
    | 'unsupported_media_type'
    | 'payload_too_large'
    | 'simulated_only'
    | 'internal';
  details?: unknown;
}
