// Métricas derivadas de una máquina para los medidores (CPU/RAM/disco/GPU). Lógica pura.
import type { MachineSummary, SharedSettings } from '@mc/contracts';
import { formatBytes, pct } from './format.ts';
import { severityFor } from './status.ts';
import type { Severity } from './status.ts';

export interface Metric {
  key: 'cpu' | 'mem' | 'disk' | 'gpu';
  name: string;
  percent: number | null;
  severity: Severity;
  sub?: string;
  alertAt: number;
}

export const DEFAULT_THRESHOLDS: SharedSettings['healthThresholds'] = { cpuPercent: 85, memPercent: 85, diskPercent: 90 };

export function machineMetrics(m: MachineSummary, thresholds: SharedSettings['healthThresholds'] = DEFAULT_THRESHOLDS): Metric[] {
  const h = m.health;
  if (!h) {
    return (['cpu', 'mem', 'disk'] as const).map((key) => ({ key, name: key === 'cpu' ? 'CPU' : key === 'mem' ? 'RAM' : 'Disco', percent: null, severity: 'ok' as const, alertAt: 100 }));
  }
  const memP = pct(h.memUsedBytes, h.memTotalBytes);
  const diskP = pct(h.diskUsedBytes, h.diskTotalBytes);
  const out: Metric[] = [
    { key: 'cpu', name: 'CPU', percent: h.cpuPercent, severity: severityFor(h.cpuPercent, thresholds.cpuPercent), ...(h.loadAvg1 !== undefined ? { sub: `carga ${h.loadAvg1}` } : {}), alertAt: thresholds.cpuPercent },
    { key: 'mem', name: 'RAM', percent: memP, severity: severityFor(memP, thresholds.memPercent), sub: `${formatBytes(h.memUsedBytes)} de ${formatBytes(h.memTotalBytes)}`, alertAt: thresholds.memPercent },
    { key: 'disk', name: 'Disco', percent: diskP, severity: severityFor(diskP, thresholds.diskPercent), sub: `${formatBytes(h.diskUsedBytes)} de ${formatBytes(h.diskTotalBytes)}`, alertAt: thresholds.diskPercent },
  ];
  if (h.gpu) {
    const gp = h.gpu.utilPercent ?? pct(h.gpu.memUsedBytes, h.gpu.memTotalBytes);
    out.push({ key: 'gpu', name: 'GPU', percent: gp, severity: severityFor(gp, 90), sub: `VRAM ${formatBytes(h.gpu.memUsedBytes)} de ${formatBytes(h.gpu.memTotalBytes)}`, alertAt: 90 });
  }
  return out;
}

/** Peor severidad entre varias métricas. */
export function worstSeverity(metrics: Metric[]): Severity {
  if (metrics.some((m) => m.severity === 'crit')) return 'crit';
  if (metrics.some((m) => m.severity === 'warn')) return 'warn';
  return 'ok';
}
