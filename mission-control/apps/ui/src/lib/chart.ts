// Matemática de gráficas (pura): escalas, arcos, niveles del mapa de calor, proyección isométrica.

/** Techo "bonito" para un eje: 1, 2, 5 × 10^n. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const f = value / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: round2(cx + r * Math.cos(a)), y: round2(cy + r * Math.sin(a)) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Arco SVG entre dos ángulos (grados, 0 = derecha, sentido horario en pantalla). */
export function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

/** Ángulo final del arco del medidor (barrido de 240°: de 150° a 390°). */
export const GAUGE_START = 150;
export const GAUGE_SWEEP = 240;

export function gaugeEnd(percent: number): number {
  return GAUGE_START + (clamp(percent, 0, 100) / 100) * GAUGE_SWEEP;
}

/** Cuántos segmentos se encienden en una barra segmentada. */
export function litSegments(percent: number, segments: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return clamp(Math.ceil((clamp(percent, 0, 100) / 100) * segments - 1e-9), 0, segments);
}

/** Nivel 0–4 de intensidad para el mapa de calor (0 = sin actividad). */
export function heatLevel(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  const r = value / max;
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}

export function matrixMax(m: number[][]): number {
  let max = 0;
  for (const row of m) for (const v of row) if (v > max) max = v;
  return max;
}

/** Suma por hora (24) o por día (7) de una matriz 7×24. */
export function sumByHour(m: number[][]): number[] {
  const out = new Array<number>(24).fill(0);
  for (const row of m) for (let h = 0; h < 24; h++) out[h] = (out[h] ?? 0) + (row[h] ?? 0);
  return out;
}

export function sumByDay(m: number[][]): number[] {
  const out: number[] = [];
  for (let d = 0; d < 7; d++) out.push((m[d] ?? []).reduce((a, b) => a + b, 0));
  return out;
}

/** Normaliza cualquier matriz recibida a 7×24 numérica. */
export function normalizeHeatmap(m: number[][] | undefined): number[][] {
  const out: number[][] = [];
  for (let d = 0; d < 7; d++) {
    const row = m?.[d] ?? [];
    const r: number[] = [];
    for (let h = 0; h < 24; h++) {
      const v = Number(row[h] ?? 0);
      r.push(Number.isFinite(v) && v > 0 ? v : 0);
    }
    out.push(r);
  }
  return out;
}

/** Proyección isométrica 2:1 de una celda de cuadrícula (gx, gy) a pantalla. */
export function isoProject(gx: number, gy: number, tileW: number, tileH: number): { x: number; y: number } {
  return { x: ((gx - gy) * tileW) / 2, y: ((gx + gy) * tileH) / 2 };
}

/** Posiciones de cuadrícula para n torres (jefe al centro-fondo si se pide). Devuelve [gx, gy]. */
export function cityLayout(n: number): Array<[number, number]> {
  if (n <= 0) return [];
  const cols = Math.ceil(Math.sqrt(n));
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) out.push([i % cols, Math.floor(i / cols)]);
  return out;
}

/** Altura de la torre en px según carga de trabajo (0–100) y si es jefe. */
export function towerHeight(workloadShare: number, isBoss: boolean): number {
  const base = 44 + clamp(workloadShare, 0, 100) * 1.1;
  return Math.round(isBoss ? Math.max(base, 96) + 18 : base);
}

/** Estrella de puntos de una polilínea de sparkline normalizada a un recuadro. */
export function sparkPoints(values: number[], w: number, h: number, pad = 2): Array<[number, number]> {
  if (values.length === 0) return [];
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  return values.map((v, i) => [
    round2(pad + (values.length === 1 ? (w - 2 * pad) / 2 : (i / (values.length - 1)) * (w - 2 * pad))),
    round2(h - pad - ((v - min) / span) * (h - 2 * pad)),
  ]);
}
