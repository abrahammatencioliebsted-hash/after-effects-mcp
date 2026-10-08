import { stat } from 'node:fs/promises';
import { loadCatalog, matchCapabilities } from '@mc/catalog';
import type { AgentSummary, Capability, CatalogValidationIssue, MachineSummary } from '@mc/contracts';

export interface CatalogFilter {
  tipo?: string;
  equipo?: string;
  ejecutor?: string;
  estado?: string;
}

/** Carga el catálogo YAML (@mc/catalog), lo guarda en caché con TTL y lo expone filtrado/validado/emparejado. */
export class CatalogService {
  private cache: { at: number; mtimeMs: number; capabilities: Capability[]; issues: CatalogValidationIssue[] } | null = null;

  constructor(
    private readonly dir: string,
    private readonly ttlMs = 5000,
  ) {}

  private async mtime(): Promise<number> {
    try {
      return (await stat(this.dir)).mtimeMs;
    } catch {
      return -1;
    }
  }

  async load(force = false): Promise<{ capabilities: Capability[]; issues: CatalogValidationIssue[] }> {
    const now = Date.now();
    if (!force && this.cache && now - this.cache.at < this.ttlMs) return this.cache;
    const mt = await this.mtime();
    if (!force && this.cache && mt === this.cache.mtimeMs && now - this.cache.at < this.ttlMs * 6) {
      this.cache.at = now;
      return this.cache;
    }
    try {
      const r = await loadCatalog(this.dir);
      this.cache = { at: now, mtimeMs: mt, capabilities: r.capabilities, issues: r.issues };
    } catch (err) {
      this.cache = {
        at: now,
        mtimeMs: mt,
        capabilities: [],
        issues: [{ path: this.dir, message: `No se pudo cargar el catálogo: ${(err as Error).message}`, severity: 'error' }],
      };
    }
    return this.cache;
  }

  async list(f: CatalogFilter = {}): Promise<Capability[]> {
    const { capabilities } = await this.load();
    return capabilities.filter(
      (c) =>
        (!f.tipo || c.tipo === f.tipo) &&
        (!f.equipo || c.equipos.includes(f.equipo)) &&
        (!f.ejecutor || (c.ejecutores as string[]).includes(f.ejecutor)) &&
        (!f.estado || c.estado === f.estado),
    );
  }

  async validate(): Promise<{ ok: boolean; issues: CatalogValidationIssue[] }> {
    const { issues } = await this.load(true);
    return { ok: !issues.some((i) => i.severity === 'error'), issues };
  }

  async counts(): Promise<{ capabilities: number; errors: number; warnings: number }> {
    const { capabilities, issues } = await this.load();
    return {
      capabilities: capabilities.length,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
    };
  }

  async match(
    required: string[],
    agents: AgentSummary[],
    machines: MachineSummary[],
    scope?: string,
  ): Promise<Array<{ agentId: string; machineId: string; score: number; reasons: string[] }>> {
    const { capabilities } = await this.load();
    return matchCapabilities(required, { capabilities, agents, machines, ...(scope ? { scope } : {}) });
  }

  /** Ids de capacidades disponibles por equipo. */
  async capabilityIdsByMachine(): Promise<Map<string, string[]>> {
    const { capabilities } = await this.load();
    const m = new Map<string, string[]>();
    for (const c of capabilities) for (const e of c.equipos) m.set(e, [...(m.get(e) ?? []), c.id]);
    return m;
  }
}
