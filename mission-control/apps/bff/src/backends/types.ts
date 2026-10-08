import type {
  ActivityItem,
  AgentCreateRequest,
  AgentSummary,
  BackendMode,
  DocumentSummary,
  HealthReport,
  MachineSummary,
  McEvent,
  MissionCreateRequest,
  MissionDetail,
  MissionStatus,
  MissionSummary,
  Overview,
  RoutineSummary,
  RunSummary,
  TimelineEvent,
} from '@mc/contracts';
import type { HttpError } from '../errors.js';
import type { CatalogService } from '../catalog.js';
import type { Db } from '../db.js';
import type { MachineRegistry } from '../machines.js';
import type { SettingsStore } from '../settings.js';

export interface MissionQuery {
  status?: MissionStatus[];
  scope?: string;
  q?: string;
  limit: number;
  cursor?: string;
}

/** Dependencias compartidas que `createApp`/`main` inyectan en ambos backends. */
export interface BackendDeps {
  db: Db;
  settings: SettingsStore;
  machines: MachineRegistry;
  catalog: CatalogService;
  now?: () => Date;
}

/**
 * Una interfaz para los dos backends (`paperclip` real, `demo` simulado).
 * Una función por endpoint de docs/08-contrato-bff.md. La UI no distingue salvo por `mode`.
 */
export interface McBackend {
  readonly mode: BackendMode;

  /** Arranca temporizadores (ejecutor simulado, sondeo SSE). Idempotente. */
  start(): void | Promise<void>;
  /** Detiene temporizadores. */
  stop(): void | Promise<void>;
  /** Eventos en vivo (misiones, agentes, actividad). Devuelve la función para cancelar. */
  subscribe(listener: (e: McEvent) => void): () => void;

  overview(days: number): Promise<Overview>;

  listMissions(q: MissionQuery): Promise<{ items: MissionSummary[]; nextCursor?: string }>;
  createMission(req: MissionCreateRequest): Promise<MissionDetail>;
  getMission(id: string): Promise<MissionDetail>;
  approvePlan(id: string, note?: string): Promise<MissionDetail>;
  rejectPlan(id: string, note: string): Promise<MissionDetail>;
  acceptMission(id: string, note?: string): Promise<MissionDetail>;
  requestChanges(id: string, note: string): Promise<MissionDetail>;
  rerunMission(id: string, note?: string): Promise<MissionDetail>;
  stopMission(id: string, note?: string): Promise<MissionDetail>;
  replay(id: string): Promise<{ events: TimelineEvent[] }>;

  listAgents(days: number): Promise<AgentSummary[]>;
  createAgent(req: AgentCreateRequest): Promise<AgentSummary>;
  deleteAgent(id: string): Promise<{ ok: true }>;
  listAgentRuns(id: string, limit: number): Promise<RunSummary[]>;

  /** Equipos con agentes y capacidades; en `paperclip` salen del registro de latidos, en `demo` son simulados. */
  listMachines(): Promise<MachineSummary[]>;

  listDocs(q: { missionId?: string; q?: string }): Promise<DocumentSummary[]>;
  getDoc(id: string): Promise<{ summary: DocumentSummary; markdown: string }>;
  createDoc(req: { title: string; markdown: string; missionId?: string }): Promise<DocumentSummary>;

  listSchedule(): Promise<RoutineSummary[]>;
  runRoutineNow(id: string): Promise<{ ok: true }>;

  listActivity(q: { limit: number; cursor?: string }): Promise<{ items: ActivityItem[]; nextCursor?: string }>;

  health(): Promise<HealthReport>;

  /** Traduce errores propios del backend (p. ej. de Paperclip) a `HttpError`; undefined si no los reconoce. */
  mapError?(err: unknown): HttpError | undefined;
}

export const BFF_VERSION = '0.1.0';
