/**
 * Tipos de los objetos de Paperclip que consume Mission Control.
 *
 * Fuente: formas observadas en vivo contra paperclipai@2026.1005.0 (ver
 * docs/09-hechos-tecnicos.md) y esquemas de packages/shared del clon de Paperclip.
 * El OpenAPI de Paperclip no describe la mayoría de las respuestas (`{}`), así que
 * estos tipos son "observados": los campos conocidos van tipados y el resto cae en
 * la firma de índice `[k: string]: unknown`.
 */

// ---------------------------------------------------------------------------
// Enumeraciones (uniones de cadenas)
// ---------------------------------------------------------------------------

export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked' | 'cancelled';
export type IssuePriority = 'critical' | 'high' | 'medium' | 'low';
export type ReviewPolicy = 'anyone' | 'not_creator' | 'human_only';
export type WorkMode = 'standard' | 'ask' | 'planning' | 'skill_test';
/** Estados de un heartbeat run (HEARTBEAT_RUN_STATUSES de Paperclip). */
export type RunStatus =
  | 'queued'
  | 'scheduled_retry'
  | 'running'
  | 'succeeded'
  | 'interrupted'
  | 'failed'
  | 'cancelled'
  | 'timed_out';
export type RunInvocationSource = 'timer' | 'assignment' | 'on_demand' | 'automation';
export type AgentStatus = 'active' | 'paused' | 'idle' | 'running' | 'error' | 'pending_approval' | 'terminated';
export type AgentRole =
  | 'ceo' | 'cto' | 'cmo' | 'cfo' | 'security' | 'engineer' | 'designer' | 'pm' | 'qa' | 'devops' | 'researcher' | 'general';
export type ApprovalStatus = 'pending' | 'revision_requested' | 'approved' | 'rejected' | 'cancelled';
export type ApprovalType = 'hire_agent' | 'approve_ceo_strategy' | 'budget_override_required' | 'request_board_approval';
export type RoutineStatus = 'active' | 'paused' | 'archived';
export type RoutineConcurrencyPolicy = 'coalesce_if_active' | 'always_enqueue' | 'skip_if_active';
export type RoutineCatchUpPolicy = 'skip_missed' | 'enqueue_missed_with_cap';
export type SecretProvider = 'local_encrypted' | 'aws_secrets_manager' | 'gcp_secret_manager' | 'vault';
export type SecretManagedMode = 'paperclip_managed' | 'external_reference';
export type ActorType = 'user' | 'agent' | 'system' | 'plugin';
export type CommentAuthorType = 'user' | 'agent' | 'system';

/** Referencia a un secreto de Paperclip dentro de `adapterConfig` (p. ej. `apiKey`). */
export interface SecretRef {
  type: 'secret_ref';
  secretId: string;
  version: 'latest' | string;
}

// ---------------------------------------------------------------------------
// Objetos
// ---------------------------------------------------------------------------

export interface PaperclipCompany {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
  issuePrefix?: string;
  issueCounter?: number;
  budgetMonthlyCents?: number;
  spentMonthlyCents?: number;
  defaultResponsibleUserId?: string | null;
  requireBoardApprovalForNewAgents?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface PaperclipAgent {
  id: string;
  companyId: string;
  name: string;
  role?: AgentRole | string;
  title?: string | null;
  icon?: string | null;
  status: AgentStatus | string;
  reportsTo: string | null;
  capabilities?: string | null;
  adapterType: string;
  /** Puede contener `SecretRef` (p. ej. `apiKey`); la clave literal nunca vuelve. */
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  permissions?: Record<string, unknown>;
  pauseReason?: string | null;
  pausedAt?: string | null;
  errorReason?: string | null;
  metadata: Record<string, unknown> | null;
  lastHeartbeatAt: string | null;
  urlKey: string;
  avatarUrl: string | null;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface PaperclipIssue {
  id: string;
  companyId: string;
  /** Identificador legible, p. ej. "MIS-1". */
  identifier: string;
  issueNumber?: number;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  /** `null` si la issue se creó sin política (observado). */
  reviewPolicy: ReviewPolicy | null;
  workMode: WorkMode | string;
  assigneeAgentId: string | null;
  assigneeUserId?: string | null;
  parentId: string | null;
  projectId?: string | null;
  executionRunId: string | null;
  checkoutRunId: string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  startedAt?: string | null;
  completedAt: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
  [k: string]: unknown;
}

export interface PaperclipComment {
  id: string;
  companyId?: string;
  issueId: string;
  body: string;
  authorType: CommentAuthorType | string;
  authorAgentId: string | null;
  authorUserId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface PaperclipActivity {
  id: string;
  companyId?: string;
  /** p. ej. issue.created | issue.updated | issue.comment_added | issue.disposition_repair_escalated */
  action: string;
  actorType: ActorType | string;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  agentId?: string | null;
  runId?: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  [k: string]: unknown;
}

/** `usageJson` de un run. `hermes_gateway` informa tokens pero no modelo ni precio (costStatus "unpriced"). */
export interface PaperclipRunUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  model?: string;
  provider?: string;
  biller?: string;
  billingType?: string;
  costStatus?: string;
  [k: string]: unknown;
}

export interface PaperclipHeartbeatRun {
  id: string;
  companyId: string;
  agentId: string;
  status: RunStatus | string;
  invocationSource: RunInvocationSource | string;
  triggerDetail?: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  errorCode: string | null;
  exitCode?: number | null;
  usageJson: PaperclipRunUsage | null;
  resultJson?: Record<string, unknown> | null;
  retryOfRunId: string | null;
  scheduledRetryAt: string | null;
  scheduledRetryAttempt?: number;
  processLossRetryCount: number;
  contextSnapshot?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface PaperclipRunEvent {
  id?: number;
  runId?: string;
  agentId?: string;
  seq: number;
  /** p. ej. lifecycle | adapter.invoke | run.presentation.resolved */
  eventType: string;
  stream?: string;
  level?: string;
  message?: string | null;
  payload: unknown;
  createdAt?: string;
  [k: string]: unknown;
}

export interface PaperclipApproval {
  id: string;
  companyId: string;
  type: ApprovalType | string;
  status: ApprovalStatus | string;
  requestedByAgentId?: string | null;
  requestedByUserId?: string | null;
  payload: Record<string, unknown>;
  decisionNote?: string | null;
  decidedByUserId?: string | null;
  decidedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface PaperclipRoutine {
  id: string;
  companyId: string;
  title: string;
  description?: string | null;
  assigneeAgentId?: string | null;
  priority?: IssuePriority;
  status: RoutineStatus | string;
  concurrencyPolicy?: RoutineConcurrencyPolicy | string;
  catchUpPolicy?: RoutineCatchUpPolicy | string;
  lastTriggeredAt?: string | null;
  lastEnqueuedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface PaperclipDashboard {
  companyId?: string;
  agents: { active: number; running: number; paused: number; error: number; [k: string]: unknown };
  tasks: { open: number; inProgress: number; blocked: number; done: number; [k: string]: unknown };
  costs: { monthSpendCents: number; monthBudgetCents: number; monthUtilizationPercent: number; [k: string]: unknown };
  pendingApprovals: number;
  budgets: { activeIncidents?: number; pendingApprovals?: number; pausedAgents?: number; pausedProjects?: number; [k: string]: unknown };
  runActivity: Array<{
    date: string;
    succeeded: number;
    failed: number;
    recovered: number;
    other: number;
    total: number;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

export interface PaperclipCostByAgent {
  agentId: string;
  agentName: string;
  agentStatus?: string;
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  avatarUrl?: string | null;
  [k: string]: unknown;
}

export interface PaperclipCostByAgentModel {
  agentId: string;
  provider: string;
  biller: string;
  billingType: string;
  model: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  [k: string]: unknown;
}

/** Vista de presupuestos (`GET /companies/{id}/budgets/overview`). */
export interface PaperclipBudgetOverview {
  companyId?: string;
  policies: Array<{
    policyId: string;
    scopeType: string;
    scopeId: string;
    scopeName?: string;
    metric?: string;
    amount: number;
    observedAmount: number;
    remainingAmount?: number;
    utilizationPercent?: number;
    status?: string;
    paused?: boolean;
    [k: string]: unknown;
  }>;
  activeIncidents: unknown[];
  pausedAgentCount?: number;
  pausedProjectCount?: number;
  pendingApprovalCount?: number;
  [k: string]: unknown;
}

/** Los secretos nunca devuelven `value`. */
export interface PaperclipSecret {
  id: string;
  companyId?: string;
  key: string;
  name: string;
  provider: SecretProvider | string;
  status?: string;
  managedMode?: SecretManagedMode | string;
  latestVersion: number;
  description?: string | null;
  referenceCount?: number;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface PaperclipAdapterCapabilities {
  supportsSkills?: boolean;
  supportsInstructionsBundle?: boolean;
  supportsLocalAgentJwt?: boolean;
  [k: string]: unknown;
}

export interface PaperclipAdapter {
  type: string;
  label: string;
  source?: string;
  modelsCount?: number;
  loaded?: boolean;
  disabled?: boolean;
  capabilities?: PaperclipAdapterCapabilities;
  [k: string]: unknown;
}

export interface PaperclipAdapterConfigField {
  key: string;
  label?: string;
  type: string;
  required?: boolean;
  hint?: string;
  default?: unknown;
  options?: unknown;
  [k: string]: unknown;
}

export interface PaperclipAdapterConfigSchema {
  fields: PaperclipAdapterConfigField[];
  [k: string]: unknown;
}

export interface PaperclipHealth {
  status: 'ok' | 'unhealthy' | string;
  version?: string;
  commit?: string | null;
  deploymentMode?: string;
  deploymentExposure?: string;
  authReady?: boolean;
  bootstrapStatus?: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Cuerpos de petición (parciales; Paperclip valida con Zod y rechaza con 400)
// ---------------------------------------------------------------------------

export interface CreateCompanyBody {
  name: string;
  description?: string | null;
  budgetMonthlyCents?: number;
  defaultResponsibleUserId?: string | null;
  [k: string]: unknown;
}

export interface CreateAgentBody {
  name: string;
  role?: AgentRole | string;
  title?: string | null;
  icon?: string;
  reportsTo?: string | null;
  capabilities?: string | null;
  adapterType: string;
  adapterConfig?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
  budgetMonthlyCents?: number;
  permissions?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

export type UpdateAgentBody = Partial<CreateAgentBody> & {
  status?: AgentStatus;
  replaceAdapterConfig?: boolean;
  [k: string]: unknown;
};

export interface CreateIssueBody {
  /** Se exige título o descripción. */
  title?: string;
  description?: string | null;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  parentId?: string | null;
  reviewPolicy?: ReviewPolicy;
  workMode?: WorkMode;
  projectId?: string | null;
  goalId?: string | null;
  executionPolicy?: Record<string, unknown> | null;
  [k: string]: unknown;
}

export type UpdateIssueBody = Partial<CreateIssueBody> & {
  /** Comentario atómico con el cambio. */
  comment?: string;
  reopen?: boolean;
  resume?: boolean;
  interrupt?: boolean;
  [k: string]: unknown;
};

export interface AddCommentBody {
  body: string;
  authorType?: CommentAuthorType;
  attachmentIds?: string[];
  metadata?: Record<string, unknown> | null;
  reopen?: boolean;
  resume?: boolean;
  interrupt?: boolean;
  [k: string]: unknown;
}

export interface HeartbeatInvokeBody {
  source?: RunInvocationSource;
  triggerDetail?: 'manual' | 'ping' | 'callback' | 'system';
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  forceFreshSession?: boolean;
  [k: string]: unknown;
}

export interface DecisionBody {
  decisionNote?: string | null;
  [k: string]: unknown;
}

export interface CreateRoutineBody {
  title: string;
  description?: string | null;
  assigneeAgentId?: string | null;
  priority?: IssuePriority;
  status?: RoutineStatus;
  concurrencyPolicy?: RoutineConcurrencyPolicy;
  catchUpPolicy?: RoutineCatchUpPolicy;
  activityGatePolicy?: 'always' | 'require_external_activity';
  variables?: unknown[];
  env?: Record<string, unknown> | null;
  projectId?: string | null;
  parentIssueId?: string | null;
  [k: string]: unknown;
}

export type UpdateRoutineBody = Partial<CreateRoutineBody> & { baseRevisionId?: string | null; [k: string]: unknown };

export interface RunRoutineBody {
  triggerId?: string | null;
  payload?: Record<string, unknown> | null;
  variables?: Record<string, unknown> | null;
  assigneeAgentId?: string | null;
  idempotencyKey?: string | null;
  source?: 'manual' | 'api';
  [k: string]: unknown;
}

export interface CreateSecretBody {
  name: string;
  key?: string;
  provider?: SecretProvider;
  managedMode?: SecretManagedMode;
  /** Valor en claro; solo viaja en la creación y nunca vuelve en la respuesta. */
  value?: string | null;
  description?: string | null;
  externalRef?: string | null;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Parámetros de consulta
// ---------------------------------------------------------------------------

export interface ListIssuesParams {
  /** Uno o varios estados (se envían separados por coma). */
  status?: IssueStatus | IssueStatus[];
  assigneeAgentId?: string;
  parentId?: string;
  /** Búsqueda de texto. */
  q?: string;
  /** 1..1000 (Paperclip responde 400 fuera de rango; por defecto 500). */
  limit?: number;
  /** Desplazamiento. La ruta no tiene cursor; `cursor` es un alias de `offset`. */
  offset?: number;
  /** Alias de `offset` (cadena numérica opaca para el BFF). */
  cursor?: string;
  /** Solo issues actualizadas desde (ISO 8601). */
  updatedSince?: string;
  sortField?: 'updated' | 'id';
  sortDir?: 'asc' | 'desc';
  projectId?: string;
  includeRoutineExecutions?: boolean;
  excludeRoutineExecutions?: boolean;
}

export interface ListCompanyActivityParams {
  agentId?: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
}

export interface ListHeartbeatRunsParams {
  agentId?: string;
  /** 1..1000; sin límite, Paperclip aplica su valor por defecto. */
  limit?: number;
  /** Versión resumida de cada run (sin contextSnapshot completo). */
  summary?: boolean;
}

export interface ListLiveRunsParams {
  /** Relleno mínimo de runs recientes (por defecto 0: solo los vivos). */
  minCount?: number;
  limit?: number;
  distinctTasks?: boolean;
}

export interface ListRunEventsParams {
  afterSeq?: number;
  limit?: number;
}

export interface CostParams {
  /** `all` = histórico completo (no admite from/to); `month` = mes en curso. */
  period?: 'all' | 'month';
  /** ISO 8601 */
  from?: string;
  /** ISO 8601 */
  to?: string;
}

export interface ListApprovalsParams {
  status?: ApprovalStatus;
}
