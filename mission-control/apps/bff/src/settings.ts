import { existsSync, readFileSync } from 'node:fs';
import type { MachineId, SharedSettings, TokenUsage } from '@mc/contracts';
import type { Db } from './db.js';
import { badRequest } from './errors.js';
import { asRecord, envKeyForMachine } from './util.js';

/** Precio por modelo; `nota` es opcional y la UI debe mostrarla (los números por defecto son de ejemplo). */
export type ModelPrice = SharedSettings['modelPrices'][number] & { nota?: string };

export type SharedSettingsView = Omit<SharedSettings, 'modelPrices'> & {
  modelPrices: ModelPrice[];
  /** Ids (no valores) de los secretos de Paperclip que guardan la clave del API server de Hermes por equipo. */
  hermesSecretIds: Record<string, string>;
  /** Topes por defecto de los agentes que crea MC (hermes_gateway no informa precio: el presupuesto en centavos no se dispara, los topes de runs sí). */
  agentDefaults: { maxDailyRuns: number; maxDailyCostCents: number };
};

export const DEFAULT_AGENT_LIMITS = { maxDailyRuns: 40, maxDailyCostCents: 500 };

export const DEFAULT_SETTINGS: SharedSettings & { modelPrices: ModelPrice[] } = {
  ownerName: 'Operador',
  modelPrices: [
    // Números de ejemplo: NO son la tarifa real del proveedor.
    { modelLabel: 'mimo-v2.6-pro', inputPerMTok: 0.3, outputPerMTok: 1.2, nota: 'ejemplo, ajustar' },
  ],
  healthThresholds: { cpuPercent: 85, memPercent: 90, diskPercent: 90 },
  vaultPaths: {},
};

export class SettingsStore {
  constructor(
    private readonly db: Db,
    private readonly opts: { modelPricesFile?: string; env?: NodeJS.ProcessEnv } = {},
  ) {}

  private stored(): Partial<SharedSettings> {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get('shared') as { value_json: string } | undefined;
    if (!row) return {};
    try {
      return JSON.parse(row.value_json) as Partial<SharedSettings>;
    } catch {
      return {};
    }
  }

  private filePrices(): ModelPrice[] | undefined {
    const f = this.opts.modelPricesFile;
    if (!f || !existsSync(f)) return undefined;
    try {
      const raw = JSON.parse(readFileSync(f, 'utf8')) as unknown;
      const list = Array.isArray(raw) ? raw : asRecord(raw).modelPrices;
      if (Array.isArray(list)) return list.filter(isPrice) as ModelPrice[];
    } catch {
      /* archivo ilegible: se ignora */
    }
    return undefined;
  }

  get(): SharedSettingsView {
    const s = this.stored();
    const prices = (s.modelPrices as ModelPrice[] | undefined) ?? this.filePrices() ?? DEFAULT_SETTINGS.modelPrices;
    return {
      ownerName: s.ownerName ?? DEFAULT_SETTINGS.ownerName,
      ...(s.bossAgentId ? { bossAgentId: s.bossAgentId } : {}),
      modelPrices: prices,
      healthThresholds: s.healthThresholds ?? DEFAULT_SETTINGS.healthThresholds,
      vaultPaths: s.vaultPaths ?? DEFAULT_SETTINGS.vaultPaths,
      hermesSecretIds: this.allHermesSecrets(),
      agentDefaults: (s as { agentDefaults?: SharedSettingsView['agentDefaults'] }).agentDefaults ?? DEFAULT_AGENT_LIMITS,
    };
  }

  /** Valida y guarda. Acepta `hermesSecretIds` opcional (id de secreto por equipo). */
  put(body: unknown): SharedSettingsView {
    const b = asRecord(body);
    if (typeof b.ownerName !== 'string' || !b.ownerName.trim()) throw badRequest('ownerName es obligatorio');
    if (!Array.isArray(b.modelPrices) || !b.modelPrices.every(isPrice)) {
      throw badRequest('modelPrices debe ser una lista de { modelLabel, inputPerMTok >= 0, outputPerMTok >= 0 }');
    }
    const t = asRecord(b.healthThresholds);
    for (const k of ['cpuPercent', 'memPercent', 'diskPercent']) {
      const v = t[k];
      if (typeof v !== 'number' || v < 0 || v > 100) throw badRequest(`healthThresholds.${k} debe ser un número entre 0 y 100`);
    }
    const vp = asRecord(b.vaultPaths);
    for (const [m, v] of Object.entries(vp)) {
      const r = asRecord(v);
      if (typeof r.vaultRoot !== 'string' || typeof r.electionsFile !== 'string') {
        throw badRequest(`vaultPaths.${m} requiere vaultRoot y electionsFile`);
      }
    }
    if (b.bossAgentId !== undefined && typeof b.bossAgentId !== 'string') throw badRequest('bossAgentId debe ser texto');
    const ad = asRecord(b.agentDefaults);
    const prev = this.stored() as { agentDefaults?: SharedSettingsView['agentDefaults'] };
    const agentDefaults = {
      maxDailyRuns: typeof ad.maxDailyRuns === 'number' && ad.maxDailyRuns >= 1 ? Math.floor(ad.maxDailyRuns) : (prev.agentDefaults?.maxDailyRuns ?? DEFAULT_AGENT_LIMITS.maxDailyRuns),
      maxDailyCostCents: typeof ad.maxDailyCostCents === 'number' && ad.maxDailyCostCents >= 0 ? Math.floor(ad.maxDailyCostCents) : (prev.agentDefaults?.maxDailyCostCents ?? DEFAULT_AGENT_LIMITS.maxDailyCostCents),
    };
    const next: SharedSettings & { agentDefaults: typeof agentDefaults } = {
      agentDefaults,
      ownerName: b.ownerName.trim(),
      ...(typeof b.bossAgentId === 'string' && b.bossAgentId ? { bossAgentId: b.bossAgentId } : {}),
      modelPrices: b.modelPrices as ModelPrice[],
      healthThresholds: {
        cpuPercent: t.cpuPercent as number,
        memPercent: t.memPercent as number,
        diskPercent: t.diskPercent as number,
      },
      vaultPaths: vp as SharedSettings['vaultPaths'],
    };
    this.db
      .prepare('INSERT INTO settings(key, value_json) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
      .run('shared', JSON.stringify(next));
    if (b.hermesSecretIds !== undefined) {
      const m = asRecord(b.hermesSecretIds);
      for (const [machineId, secretId] of Object.entries(m)) {
        if (typeof secretId !== 'string' || !secretId.trim()) throw badRequest(`hermesSecretIds.${machineId} debe ser el id del secreto`);
        this.setHermesSecret(machineId, secretId.trim());
      }
    }
    return this.get();
  }

  setHermesSecret(machineId: MachineId, secretId: string): void {
    this.db
      .prepare(
        'INSERT INTO machine_secrets(machine_id, secret_id, updated_at) VALUES(?, ?, ?) ON CONFLICT(machine_id) DO UPDATE SET secret_id = excluded.secret_id, updated_at = excluded.updated_at',
      )
      .run(machineId, secretId, Date.now());
  }

  /** Orden: SQLite (operador por PUT) > variable MC_HERMES_SECRET_<MACHINEID>. */
  getHermesSecretId(machineId: MachineId): string | undefined {
    const row = this.db.prepare('SELECT secret_id FROM machine_secrets WHERE machine_id = ?').get(machineId) as { secret_id: string } | undefined;
    if (row) return row.secret_id;
    const env = this.opts.env ?? process.env;
    return env[`MC_HERMES_SECRET_${envKeyForMachine(machineId)}`] || undefined;
  }

  private allHermesSecrets(): Record<string, string> {
    const out: Record<string, string> = {};
    const env = this.opts.env ?? process.env;
    for (const [k, v] of Object.entries(env)) {
      const m = /^MC_HERMES_SECRET_(.+)$/.exec(k);
      if (m && v) out[m[1]!.toLowerCase().replace(/_/g, '-')] = v;
    }
    const rows = this.db.prepare('SELECT machine_id, secret_id FROM machine_secrets').all() as Array<{ machine_id: string; secret_id: string }>;
    for (const r of rows) out[r.machine_id] = r.secret_id;
    return out;
  }

  /** Busca precio por modelo (igualdad sin mayúsculas o prefijo). */
  priceFor(modelLabel: string | undefined): ModelPrice | undefined {
    if (!modelLabel || modelLabel === 'unknown') return undefined;
    const l = modelLabel.toLowerCase();
    return this.get().modelPrices.find((p) => {
      const pl = p.modelLabel.toLowerCase();
      return pl === l || l.startsWith(pl);
    });
  }

  /** Estima centavos de USD para un uso; null cuando no se conoce el modelo o no hay precio. */
  estimateCents(modelLabel: string | undefined, input: number, output: number): number | null {
    const p = this.priceFor(modelLabel);
    if (!p) return null;
    const usd = (input / 1e6) * p.inputPerMTok + (output / 1e6) * p.outputPerMTok;
    return Math.round(usd * 100 * 10000) / 10000;
  }

  /** Aplica la estimación a un `TokenUsage` 'unpriced' si se conoce el modelo. */
  applyEstimate(t: TokenUsage, modelLabel: string | undefined): TokenUsage {
    if (t.costStatus === 'reported') return t;
    const cents = this.estimateCents(modelLabel, t.input, t.output);
    return cents === null ? { ...t, estimatedCents: null, costStatus: 'unpriced' } : { ...t, estimatedCents: cents, costStatus: 'estimated' };
  }
}

function isPrice(p: unknown): boolean {
  const r = asRecord(p);
  return (
    typeof r.modelLabel === 'string' &&
    r.modelLabel.length > 0 &&
    typeof r.inputPerMTok === 'number' &&
    r.inputPerMTok >= 0 &&
    typeof r.outputPerMTok === 'number' &&
    r.outputPerMTok >= 0
  );
}
