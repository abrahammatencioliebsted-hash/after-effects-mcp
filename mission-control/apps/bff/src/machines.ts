import type { MachineHeartbeat, MachineHealthSample, MachineHermesStatus, MachineId, MachineOs, MachineSummary, AllowedCommand } from '@mc/contracts';
import type { Db } from './db.js';
import { badRequest } from './errors.js';
import { asRecord, iso } from './util.js';

/** Los cuatro equipos del piloto (docs/03-arquitectura.md §2). */
export const KNOWN_MACHINES: Array<{ id: MachineId; name: string; os: MachineOs; role: string; maxHeavyJobs: number }> = [
  { id: 'win-principal', name: 'Windows principal', os: 'windows', role: 'Plano de control: Paperclip, BFF, UI y modelos locales (96 GB RAM, 24 GB VRAM)', maxHeavyJobs: 1 },
  { id: 'win-laptop-1', name: 'Windows laptop 1', os: 'windows', role: 'Ejecutor Hermes remoto (gateway por Tailscale)', maxHeavyJobs: 1 },
  { id: 'win-laptop-2', name: 'Windows laptop 2', os: 'windows', role: 'Ejecutor Hermes remoto (gateway por Tailscale)', maxHeavyJobs: 1 },
  { id: 'mac', name: 'Mac', os: 'macos', role: 'Ejecutor Hermes remoto y bóveda de Obsidian', maxHeavyJobs: 1 },
];

export const ONLINE_MS = 90_000;
export const STALE_MS = 10 * 60_000;
export const NEXT_INTERVAL_SEC = 30;

/** online < 90 s, stale < 10 min, offline después; unknown si nunca hubo latido. */
export function machineStatus(lastSeenMs: number | undefined | null, nowMs: number): MachineSummary['status'] {
  if (lastSeenMs === undefined || lastSeenMs === null) return 'unknown';
  const age = nowMs - lastSeenMs;
  if (age < ONLINE_MS) return 'online';
  if (age < STALE_MS) return 'stale';
  return 'offline';
}

export interface StoredMachine {
  id: MachineId;
  name: string;
  os: MachineOs;
  role: string;
  nodeAgentVersion?: string;
  lastSeenMs?: number;
  health?: MachineHealthSample;
  hermes?: MachineHermesStatus;
  allowedCommandIds: string[];
  maxHeavyJobs: number;
}

interface Row {
  id: string;
  name: string;
  os: string;
  role: string;
  node_agent_version: string | null;
  last_seen_at: number | null;
  health_json: string | null;
  hermes_json: string | null;
  allowed_commands_json: string;
}

export class MachineRegistry {
  private readonly now: () => number;
  private readonly lastStatus = new Map<string, MachineSummary['status']>();

  constructor(
    private readonly db: Db,
    opts: { now?: () => number } = {},
  ) {
    this.now = opts.now ?? Date.now;
    const ins = db.prepare('INSERT OR IGNORE INTO machines(id, name, os, role) VALUES(?, ?, ?, ?)');
    for (const m of KNOWN_MACHINES) ins.run(m.id, m.name, m.os, m.role);
  }

  list(): StoredMachine[] {
    const rows = this.db.prepare('SELECT * FROM machines ORDER BY rowid').all() as unknown as Row[];
    return rows.map((r) => this.fromRow(r));
  }

  get(id: MachineId): StoredMachine | undefined {
    const r = this.db.prepare('SELECT * FROM machines WHERE id = ?').get(id) as Row | undefined;
    return r ? this.fromRow(r) : undefined;
  }

  private fromRow(r: Row): StoredMachine {
    const known = KNOWN_MACHINES.find((k) => k.id === r.id);
    return {
      id: r.id,
      name: r.name,
      os: r.os as MachineOs,
      role: r.role,
      ...(r.node_agent_version ? { nodeAgentVersion: r.node_agent_version } : {}),
      ...(r.last_seen_at !== null ? { lastSeenMs: r.last_seen_at } : {}),
      ...(r.health_json ? { health: JSON.parse(r.health_json) as MachineHealthSample } : {}),
      ...(r.hermes_json ? { hermes: JSON.parse(r.hermes_json) as MachineHermesStatus } : {}),
      allowedCommandIds: JSON.parse(r.allowed_commands_json) as string[],
      maxHeavyJobs: known?.maxHeavyJobs ?? 1,
    };
  }

  statusOf(m: StoredMachine): MachineSummary['status'] {
    return machineStatus(m.lastSeenMs, this.now());
  }

  /** Valida y guarda un latido. Devuelve el equipo y el cambio de estado, si lo hubo. */
  heartbeat(pathId: MachineId, body: unknown): { machine: StoredMachine; changed?: { from: MachineSummary['status']; to: MachineSummary['status'] } } {
    const hb = validateHeartbeat(body);
    if (hb.machineId !== pathId) throw badRequest(`machineId del cuerpo (${hb.machineId}) no coincide con la ruta (${pathId})`);
    const before = this.get(pathId);
    const prev = before ? this.statusOf(before) : 'unknown';
    const known = KNOWN_MACHINES.find((k) => k.id === pathId);
    this.db
      .prepare(
        `INSERT INTO machines(id, name, os, role, node_agent_version, last_seen_at, health_json, hermes_json, allowed_commands_json)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, os = excluded.os, node_agent_version = excluded.node_agent_version,
           last_seen_at = excluded.last_seen_at, health_json = excluded.health_json, hermes_json = excluded.hermes_json,
           allowed_commands_json = excluded.allowed_commands_json`,
      )
      .run(pathId, hb.name, hb.os, known?.role ?? before?.role ?? '', hb.nodeAgentVersion, this.now(), JSON.stringify(hb.health), JSON.stringify(hb.hermes), JSON.stringify(hb.allowedCommandIds));
    const machine = this.get(pathId)!;
    const to = this.statusOf(machine);
    this.lastStatus.set(pathId, to);
    return prev !== to ? { machine, changed: { from: prev, to } } : { machine };
  }

  /** Recorre los equipos y devuelve los que cambiaron de estado desde la última vez (para eventos SSE). */
  detectTransitions(): Array<{ machineId: MachineId; status: MachineSummary['status'] }> {
    const out: Array<{ machineId: MachineId; status: MachineSummary['status'] }> = [];
    for (const m of this.list()) {
      const s = this.statusOf(m);
      const prev = this.lastStatus.get(m.id);
      if (prev !== undefined && prev !== s) out.push({ machineId: m.id, status: s });
      this.lastStatus.set(m.id, s);
    }
    return out;
  }

  hermesBaseUrl(id: MachineId): string | undefined {
    return this.get(id)?.hermes?.apiServer.baseUrl;
  }

  toSummary(m: StoredMachine, extras: { agentIds: string[]; capabilityIds: string[]; activeHeavyJobs?: number; origin: MachineSummary['origin'] }): MachineSummary {
    return {
      id: m.id,
      name: m.name,
      os: m.os,
      role: m.role,
      status: this.statusOf(m),
      ...(m.lastSeenMs !== undefined ? { lastSeenAt: iso(m.lastSeenMs) } : {}),
      ...(m.health ? { health: m.health } : {}),
      ...(m.hermes ? { hermes: m.hermes } : {}),
      agentIds: extras.agentIds,
      capabilityIds: extras.capabilityIds,
      maxHeavyJobs: m.maxHeavyJobs,
      activeHeavyJobs: extras.activeHeavyJobs ?? 0,
      origin: extras.origin,
    };
  }

  /** Comandos declarados por el node-agent: el BFF solo conoce los ids; el argv real vive en el node-agent. */
  commandsFor(id: MachineId): AllowedCommand[] {
    const m = this.get(id);
    return (m?.allowedCommandIds ?? []).map((cid) => ({
      id: cid,
      label: cid,
      description: 'Comando de la lista permitida declarada por el node-agent (el argv no sale del equipo).',
      argv: [],
      requiresConfirmation: true,
      timeoutSec: 30,
    }));
  }
}

function validateHeartbeat(body: unknown): MachineHeartbeat {
  const b = asRecord(body);
  if (typeof b.machineId !== 'string' || !b.machineId) throw badRequest('machineId es obligatorio');
  if (typeof b.name !== 'string' || !b.name) throw badRequest('name es obligatorio');
  if (b.os !== 'windows' && b.os !== 'macos' && b.os !== 'linux') throw badRequest('os debe ser windows, macos o linux');
  if (typeof b.nodeAgentVersion !== 'string') throw badRequest('nodeAgentVersion es obligatorio');
  const h = asRecord(b.health);
  for (const k of ['cpuPercent', 'memUsedBytes', 'memTotalBytes', 'diskUsedBytes', 'diskTotalBytes', 'uptimeSec']) {
    if (typeof h[k] !== 'number' || !Number.isFinite(h[k] as number)) throw badRequest(`health.${k} debe ser numérico`);
  }
  if (typeof h.at !== 'string') throw badRequest('health.at es obligatorio (ISO 8601)');
  const he = asRecord(b.hermes);
  if (typeof he.installed !== 'boolean' || typeof asRecord(he.apiServer).reachable !== 'boolean') {
    throw badRequest('hermes.installed y hermes.apiServer.reachable son obligatorios');
  }
  if (!Array.isArray(b.allowedCommandIds) || !b.allowedCommandIds.every((x) => typeof x === 'string')) {
    throw badRequest('allowedCommandIds debe ser una lista de textos');
  }
  return b as unknown as MachineHeartbeat;
}
