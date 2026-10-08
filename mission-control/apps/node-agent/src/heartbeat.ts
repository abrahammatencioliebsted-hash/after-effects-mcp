import type { AllowedCommand, MachineHeartbeat } from '@mc/contracts';
import type { Config } from './config.js';
import { sampleHealth } from './health.js';
import { checkHermes } from './hermes.js';
import type { Logger } from './log.js';
import { VERSION } from './version.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const WILDCARD = new Set(['0.0.0.0', '::', '[::]']);

/** URL que el BFF usaría para reenviar comandos; undefined si el agente solo escucha en loopback (o comodín). */
export function nodeAgentUrl(cfg: Pick<Config, 'host' | 'port'>): string | undefined {
  if (LOOPBACK.has(cfg.host) || WILDCARD.has(cfg.host)) return undefined;
  const host = cfg.host.includes(':') && !cfg.host.startsWith('[') ? `[${cfg.host}]` : cfg.host;
  return `http://${host}:${cfg.port}`;
}

export async function collectHeartbeat(cfg: Config, commands: AllowedCommand[], log: Logger): Promise<MachineHeartbeat> {
  const [health, hermes] = await Promise.all([sampleHealth(cfg, log), checkHermes(cfg)]);
  const hb: MachineHeartbeat = {
    machineId: cfg.machineId,
    name: cfg.machineName,
    os: cfg.machineOs,
    nodeAgentVersion: VERSION,
    health,
    hermes,
    allowedCommandIds: commands.map((c) => c.id),
    maxHeavyJobs: cfg.maxHeavyJobs,
    activeHeavyJobs: 0,
  };
  const url = nodeAgentUrl(cfg);
  if (url) hb.nodeAgentUrl = url;
  return hb;
}

export interface HeartbeatOptions {
  cfg: Config;
  log: Logger;
  collect: () => Promise<MachineHeartbeat>;
  fetchImpl?: typeof fetch;
  /** Solo para pruebas: sustituye el intervalo base (ms). */
  intervalMs?: number;
  maxBackoffMs?: number;
  requestTimeoutMs?: number;
  onSnapshot?: (hb: MachineHeartbeat) => void;
}

export interface TickResult {
  ok: boolean;
  /** Espera hasta el siguiente latido, en ms. */
  delayMs: number;
  error?: string;
}

export const MAX_BACKOFF_MS = 5 * 60 * 1000;

export class HeartbeatLoop {
  private readonly o: HeartbeatOptions;
  private failures = 0;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  latest: MachineHeartbeat | undefined;

  constructor(options: HeartbeatOptions) {
    this.o = options;
  }

  get consecutiveFailures(): number {
    return this.failures;
  }

  private baseMs(): number {
    return this.o.intervalMs ?? this.o.cfg.heartbeatSec * 1000;
  }

  /** Una iteración: muestrea, envía (si hay BFF) y calcula la espera siguiente. Nunca lanza. */
  async tick(): Promise<TickResult> {
    const { cfg, log } = this.o;
    let hb: MachineHeartbeat;
    try {
      hb = await this.o.collect();
      this.latest = hb;
      this.o.onSnapshot?.(hb);
    } catch (err) {
      log.error('Falló la recolección de salud', { error: (err as Error).message });
      return this.fail((err as Error).message);
    }
    if (!cfg.bffUrl) return { ok: true, delayMs: this.baseMs() };

    const url = `${cfg.bffUrl}/api/mc/machines/${encodeURIComponent(cfg.machineId)}/heartbeat`;
    try {
      const res = await (this.o.fetchImpl ?? fetch)(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token ?? ''}` },
        body: JSON.stringify(hb),
        signal: AbortSignal.timeout(this.o.requestTimeoutMs ?? 10_000),
      });
      if (!res.ok) {
        await res.arrayBuffer().catch(() => undefined);
        throw new Error(`El BFF respondió HTTP ${res.status}`);
      }
      let next: number | undefined;
      try {
        const body = (await res.json()) as { nextIntervalSec?: unknown };
        if (typeof body.nextIntervalSec === 'number' && Number.isFinite(body.nextIntervalSec) && body.nextIntervalSec > 0) {
          next = Math.min(3600, body.nextIntervalSec);
        }
      } catch {
        /* cuerpo no JSON: se usa el intervalo configurado */
      }
      if (this.failures > 0) log.info('Latido restablecido tras fallos', { failures: this.failures });
      this.failures = 0;
      log.debug('Latido enviado', { url });
      return { ok: true, delayMs: next !== undefined ? next * 1000 : this.baseMs() };
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } };
      return this.fail(e.cause?.code ?? e.message);
    }
  }

  private fail(error: string): TickResult {
    this.failures += 1;
    const max = this.o.maxBackoffMs ?? MAX_BACKOFF_MS;
    // Primer reintento al intervalo base (no al doble): con 30 s + 10 s de timeout el hueco queda por debajo de los 90 s de "online" del BFF.
    const delayMs = Math.min(max, this.baseMs() * 2 ** (this.failures - 1));
    this.o.log.warn('Latido fallido; se reintentará con retroceso exponencial', { error, failures: this.failures, retryInMs: delayMs });
    return { ok: false, delayMs, error };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = async (): Promise<void> => {
      if (!this.running) return;
      const r = await this.tick();
      if (!this.running) return;
      this.timer = setTimeout(() => void loop(), r.delayMs);
    };
    void loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
