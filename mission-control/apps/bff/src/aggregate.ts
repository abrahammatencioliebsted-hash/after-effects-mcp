import type { MissionStatus, Overview, RunSummary, TokenUsage } from '@mc/contracts';
import { MISSION_STATUSES } from './status.js';

export const emptyTokens = (): TokenUsage => ({ input: 0, output: 0, cachedInput: 0, estimatedCents: null, costStatus: 'unpriced' });

/** Suma usos. estimatedCents suma solo los conocidos; costStatus: reported si todos lo son, estimated si hay alguno estimado, si no unpriced. */
export function sumTokens(list: TokenUsage[]): TokenUsage {
  if (list.length === 0) return emptyTokens();
  let input = 0;
  let output = 0;
  let cached = 0;
  let cents = 0;
  let known = 0;
  let reported = 0;
  for (const t of list) {
    input += t.input;
    output += t.output;
    cached += t.cachedInput;
    if (t.estimatedCents !== null) {
      cents += t.estimatedCents;
      known += 1;
    }
    if (t.costStatus === 'reported') reported += 1;
  }
  const status: TokenUsage['costStatus'] = reported === list.length ? 'reported' : known > 0 ? 'estimated' : 'unpriced';
  return { input, output, cachedInput: cached, estimatedCents: known > 0 ? Math.round(cents * 10000) / 10000 : null, costStatus: status };
}

const isFinished = (r: RunSummary): boolean => r.status === 'succeeded' || r.status === 'failed' || r.status === 'timed_out';

/** Éxito = succeeded / (succeeded + failed + timed_out). 0 cuando no hay runs terminados. */
export function successRate(runs: RunSummary[]): number {
  const done = runs.filter(isFinished);
  if (done.length === 0) return 0;
  const ok = done.filter((r) => r.status === 'succeeded').length;
  return Math.round((ok / done.length) * 1000) / 10;
}

export function runsInWindow(runs: RunSummary[], days: number, nowMs: number): RunSummary[] {
  const from = nowMs - days * 86_400_000;
  return runs.filter((r) => {
    const t = Date.parse(r.startedAt ?? '');
    return Number.isFinite(t) && t >= from && t <= nowMs + 60_000;
  });
}

/** Serie diaria (UTC) de los últimos `days` días, terminando hoy. */
export function runActivityFrom(runs: RunSummary[], days: number, nowMs: number): Overview['runActivity'] {
  const out: Overview['runActivity'] = [];
  const idx = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(nowMs - i * 86_400_000).toISOString().slice(0, 10);
    idx.set(date, out.length);
    out.push({ date, succeeded: 0, failed: 0, other: 0 });
  }
  for (const r of runs) {
    if (!r.startedAt) continue;
    const i = idx.get(r.startedAt.slice(0, 10));
    if (i === undefined) continue;
    const row = out[i]!;
    if (r.status === 'succeeded') row.succeeded += 1;
    else if (r.status === 'failed' || r.status === 'timed_out') row.failed += 1;
    else row.other += 1;
  }
  return out;
}

/** Mapa de calor 7×24 (fila 0 = domingo, UTC) con el número de runs por hora de inicio. */
export function heatmapFrom(runs: RunSummary[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const r of runs) {
    if (!r.startedAt) continue;
    const d = new Date(r.startedAt);
    if (Number.isNaN(d.getTime())) continue;
    grid[d.getUTCDay()]![d.getUTCHours()]! += 1;
  }
  return grid;
}

export function countByStatus(statuses: MissionStatus[]): Record<MissionStatus, number> {
  const out = Object.fromEntries(MISSION_STATUSES.map((s) => [s, 0])) as Record<MissionStatus, number>;
  for (const s of statuses) out[s] += 1;
  return out;
}

export function avg(nums: number[]): number {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
}
