import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import { statfs } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import type { MachineHealthSample } from '@mc/contracts';
import type { Config } from './config.js';
import { type Logger, createLogger } from './log.js';

interface CpuSnapshot {
  idle: number;
  total: number;
}

function cpuSnapshot(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const c of cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** CPU % a partir de dos instantáneas de os.cpus() separadas por `intervalMs` (200 ms por defecto). */
export async function sampleCpuPercent(intervalMs = 200): Promise<number> {
  const a = cpuSnapshot();
  await sleep(intervalMs);
  const b = cpuSnapshot();
  const total = b.total - a.total;
  const idle = b.idle - a.idle;
  if (total <= 0) return 0;
  const pct = (1 - idle / total) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
}

export async function sampleDisk(diskPath: string, log: Logger): Promise<{ used: number; total: number }> {
  try {
    const s = await statfs(diskPath);
    const total = Number(s.blocks) * Number(s.bsize);
    const used = (Number(s.blocks) - Number(s.bfree)) * Number(s.bsize);
    return { used: Math.max(0, used), total: Math.max(0, total) };
  } catch (err) {
    log.warn('No se pudo leer el disco; se informa 0', { diskPath, error: (err as Error).message });
    return { used: 0, total: 0 };
  }
}

function execText(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

type Gpu = NonNullable<MachineHealthSample['gpu']>;

/** Parsea la salida CSV de nvidia-smi (primera GPU). Exportada para pruebas. */
export function parseNvidiaSmi(out: string): Gpu | null {
  const line = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '');
  if (!line) return null;
  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 4) return null;
  const [name, used, total, util] = parts as [string, string, string, string];
  const usedMiB = Number(used);
  const totalMiB = Number(total);
  if (!name || !Number.isFinite(usedMiB) || !Number.isFinite(totalMiB)) return null;
  const gpu: Gpu = { name, memUsedBytes: usedMiB * 1048576, memTotalBytes: totalMiB * 1048576 };
  const u = Number(util);
  if (Number.isFinite(u)) gpu.utilPercent = u;
  return gpu;
}

export async function sampleGpu(): Promise<Gpu | null> {
  try {
    const out = await execText(
      'nvidia-smi',
      ['--query-gpu=name,memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits'],
      3000,
    );
    return parseNvidiaSmi(out);
  } catch {
    return null; // sin nvidia-smi (ENOENT), sin GPU NVIDIA o timeout
  }
}

export async function sampleHealth(
  cfg: Pick<Config, 'diskPath'>,
  log: Logger = createLogger(),
): Promise<MachineHealthSample> {
  const [cpuPercent, disk, gpu] = await Promise.all([sampleCpuPercent(200), sampleDisk(cfg.diskPath, log), sampleGpu()]);
  const total = totalmem();
  return {
    at: new Date().toISOString(),
    cpuPercent,
    memUsedBytes: Math.max(0, total - freemem()),
    memTotalBytes: total,
    diskUsedBytes: disk.used,
    diskTotalBytes: disk.total,
    gpu,
    loadAvg1: process.platform === 'win32' ? 0 : (loadavg()[0] ?? 0),
    uptimeSec: Math.round(uptime()),
  };
}
