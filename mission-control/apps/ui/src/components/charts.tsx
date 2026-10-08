// Gráficas como SVG en línea (sin librerías). Guía dataviz: marcas finas, barras <= 24 px con extremo redondeado de 4 px,
// espacio de 2 px entre segmentos, rejilla hairline, leyenda siempre que hay >= 2 series, tooltip en hover Y foco, vista de tabla.
import { useId, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import { arcPath, GAUGE_START, GAUGE_SWEEP, gaugeEnd, heatLevel, litSegments, matrixMax, niceMax, sparkPoints } from '../lib/chart.ts';
import { SEVERITY_TEXT, severityTone, toneVar } from '../lib/status.ts';
import type { Severity, Tone } from '../lib/status.ts';

/* ------------------------------------------------------------------ Tooltip compartido ------------------------------------------------------------------ */

interface TipState { x: number; y: number; node: ReactNode }

export function useChartTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const showAtEvent = (e: React.PointerEvent | React.MouseEvent, node: ReactNode) => setTip({ x: e.clientX, y: e.clientY, node });
  const showAtEl = (el: Element, node: ReactNode) => {
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, node });
  };
  const hide = () => setTip(null);
  const view = tip ? (
    <div className="chart-tip" role="status" style={{ left: Math.min(tip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 200), top: tip.y + 16 }}>
      {tip.node}
    </div>
  ) : null;
  return { showAtEvent, showAtEl, hide, view };
}

/* ------------------------------------------------------------------ Medidor en arco (instrumento) ------------------------------------------------------------------ */

export interface ArcGaugeProps {
  /** 0–100 */
  value: number;
  /** Texto grande central, p. ej. "94%" */
  display: string;
  label: string;
  /** Línea secundaria bajo el valor */
  sub?: string;
  severity?: Severity;
  tone?: Tone;
  /** Texto accesible completo */
  ariaLabel: string;
}

export function ArcGauge({ value, display, label, sub, severity = 'ok', tone, ariaLabel }: ArcGaugeProps) {
  const cx = 100, cy = 100, r = 78;
  const total = (2 * Math.PI * r * GAUGE_SWEEP) / 360;
  const seg = total / 30;
  const dash = `${(seg * 0.78).toFixed(2)} ${(seg * 0.22).toFixed(2)}`;
  const t = tone ?? severityTone(severity);
  const v = Math.max(0, Math.min(100, value));
  const end = gaugeEnd(v);
  return (
    <div className="gauge-wrap">
      <svg viewBox="0 0 200 170" className="chart-svg" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={ariaLabel}>
        <path d={arcPath(cx, cy, r, GAUGE_START, GAUGE_START + GAUGE_SWEEP)} fill="none" strokeWidth={14} strokeDasharray={dash} style={{ stroke: 'var(--track)' }} />
        {v > 0 && <path d={arcPath(cx, cy, r, GAUGE_START, end)} fill="none" strokeWidth={14} strokeDasharray={dash} style={{ stroke: toneVar(t), filter: `drop-shadow(0 0 6px color-mix(in srgb, ${toneVar(t)} 55%, transparent))` }} />}
        <text x={36} y={160} textAnchor="middle">0</text>
        <text x={164} y={160} textAnchor="middle">100</text>
        <text x={cx} y={cy + 6} textAnchor="middle" style={{ fill: 'var(--text)', fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em' }}>{display}</text>
        <text x={cx} y={cy + 30} textAnchor="middle" style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 650 }}>{label}</text>
      </svg>
      {sub && <div className="t2" style={{ textAlign: 'center', fontSize: '.84rem', marginTop: -8 }}>{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Barra segmentada ------------------------------------------------------------------ */

export function SegBar({ percent, segments = 24, severity = 'ok', ariaLabel, tone }: { percent: number; segments?: number; severity?: Severity; ariaLabel: string; tone?: Tone }) {
  const lit = litSegments(percent, segments);
  const t = tone ?? severityTone(severity);
  return (
    <div className="seg-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-label={ariaLabel} style={{ '--tone': toneVar(t) } as CSSProperties}>
      {Array.from({ length: segments }, (_, i) => <i key={i} className={i < lit ? 'on' : ''} />)}
    </div>
  );
}

/** Fila de instrumento: nombre, barra segmentada, valor y texto de severidad (nunca solo color). */
export function MeterRow({ name, percent, severity, sub, ariaLabel }: { name: string; percent: number | null; severity: Severity; sub?: string; ariaLabel: string }) {
  if (percent === null) {
    return (
      <div className="meter-row">
        <span className="name">{name}</span>
        <div className="seg-bar" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} />)}</div>
        <span className="val muted">—</span>
        <span className="meter-sub">Sin dato</span>
      </div>
    );
  }
  return (
    <div className="meter-row">
      <span className="name">{name}</span>
      <SegBar percent={percent} severity={severity} ariaLabel={ariaLabel} />
      <span className="val">{Math.round(percent)}%</span>
      <span className="meter-sub row" style={{ gap: 6 }}>
        {severity !== 'ok' && <Icon name="alert" size={12} style={{ color: toneVar(severityTone(severity)) }} />}
        {SEVERITY_TEXT[severity]}{sub ? ` · ${sub}` : ''}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ Sparkline ------------------------------------------------------------------ */

export function Sparkline({ values, width = 120, height = 36, ariaLabel }: { values: number[]; width?: number; height?: number; ariaLabel: string }) {
  const pts = sparkPoints(values, width, height, 4);
  if (pts.length === 0) return null;
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const last = pts[pts.length - 1] ?? [0, 0];
  const first = pts[0] ?? [0, 0];
  const area = `${line} L ${last[0]} ${height} L ${first[0]} ${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={ariaLabel} className="chart-svg" style={{ width, height }}>
      <path d={area} style={{ fill: 'var(--accent)', opacity: 0.1 }} />
      <path d={line} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--accent)' }} />
      <circle cx={last[0]} cy={last[1]} r={4} style={{ fill: 'var(--accent)', stroke: 'var(--panel)' }} strokeWidth={2} />
    </svg>
  );
}

/* ------------------------------------------------------------------ Columnas apiladas ------------------------------------------------------------------ */

/** `texture`: relleno rayado a 45° como canal secundario (accesibilidad: daltonismo, impresión). */
export interface ColSeries { key: string; name: string; color: string; texture?: boolean }
export interface ColDatum { label: string; tipLabel: string; values: Record<string, number> }

/** Path de rectángulo con las dos esquinas superiores redondeadas (extremo de datos 4 px, base cuadrada). */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M ${x} ${y + h} V ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} V ${y + h} Z`;
}

export function StackedColumns({ data, series, height = 200, yLabel, ariaLabel, formatValue = (n: number) => String(n) }: { data: ColDatum[]; series: ColSeries[]; height?: number; yLabel: string; ariaLabel: string; formatValue?: (n: number) => string }) {
  const tip = useChartTip();
  const [table, setTable] = useState(false);
  const uid = useId();
  const W = 640, padL = 36, padR = 8, padT = 22, padB = 24;
  const H = height;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const totals = data.map((d) => series.reduce((a, s) => a + (d.values[s.key] ?? 0), 0));
  const max = niceMax(Math.max(...totals, 1));
  const slot = data.length > 0 ? innerW / data.length : innerW;
  const bw = Math.min(24, slot * 0.62);
  const ticks = [0, max / 2, max];
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 8 }}>
        {series.length >= 2 ? (
          <div className="legend" aria-label="Leyenda">
            {series.map((s) => <span key={s.key} className="k"><i className={`sw${s.texture ? ' hatch' : ''}`} style={{ '--c': s.color } as CSSProperties} />{s.name}</span>)}
          </div>
        ) : <span className="muted" style={{ fontSize: '.8rem' }}>{series[0]?.name}</span>}
        <button type="button" className="btn ghost sm" onClick={() => setTable((t) => !t)} aria-pressed={table}><Icon name={table ? 'chart' : 'list'} size={14} />{table ? 'Ver gráfica' : 'Ver tabla'}</button>
      </div>
      {table ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <caption className="sr-only">{ariaLabel}</caption>
            <thead><tr><th>Periodo</th>{series.map((s) => <th key={s.key} className="num">{s.name}</th>)}</tr></thead>
            <tbody>{data.map((d, i) => <tr key={i}><td>{d.tipLabel}</td>{series.map((s) => <td key={s.key} className="num">{formatValue(d.values[s.key] ?? 0)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={ariaLabel} onPointerLeave={tip.hide}>
          <title>{ariaLabel}</title>
          <defs>
            {series.filter((s) => s.texture).map((s) => (
              <pattern key={s.key} id={`${uid}-${s.key}`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={6} height={6} style={{ fill: s.color, opacity: 0.28 }} />
                <rect width={2.6} height={6} style={{ fill: s.color }} />
              </pattern>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--line)' }} strokeWidth={1} />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end">{formatValue(Math.round(t))}</text>
            </g>
          ))}
          <text x={padL - 8} y={10} textAnchor="end" style={{ fontSize: 10 }}>{yLabel}</text>
          {data.map((d, i) => {
            const cx = padL + slot * i + slot / 2;
            const x = cx - bw / 2;
            let acc = 0;
            const tipNode = (
              <div>
                <div className="lbl">{d.tipLabel}</div>
                {series.map((s) => (
                  <div key={s.key} className="row" style={{ gap: 8, marginTop: 4 }}>
                    <i className={`sw${s.texture ? ' hatch' : ''}`} style={{ '--c': s.color, width: 14, height: 8, display: 'inline-block' } as CSSProperties} />
                    <b>{formatValue(d.values[s.key] ?? 0)}</b><span className="lbl">{s.name}</span>
                  </div>
                ))}
              </div>
            );
            const segs = series.filter((s) => (d.values[s.key] ?? 0) > 0);
            return (
              <g key={i}>
                {segs.map((s, si) => {
                  const v = d.values[s.key] ?? 0;
                  const h = (v / max) * innerH;
                  const y0 = padT + innerH - ((acc + v) / max) * innerH;
                  acc += v;
                  const isTop = si === segs.length - 1;
                  const gap = si === 0 ? 0 : 2; // 2 px de superficie entre segmentos
                  const hh = Math.max(1, h - gap);
                  const fill = s.texture ? `url(#${uid}-${s.key})` : s.color;
                  return isTop
                    ? <path key={s.key} d={topRounded(x, y0, bw, hh, 4)} style={{ fill }} className="mark" />
                    : <rect key={s.key} x={x} y={y0 + gap} width={bw} height={hh} style={{ fill }} className="mark" />;
                })}
                <rect
                  x={padL + slot * i} y={padT} width={slot} height={innerH} fill="transparent" tabIndex={0}
                  aria-label={`${d.tipLabel}: ${series.map((s) => `${s.name} ${d.values[s.key] ?? 0}`).join(', ')}`}
                  onPointerMove={(e) => tip.showAtEvent(e, tipNode)} onFocus={(e) => tip.showAtEl(e.currentTarget, tipNode)} onBlur={tip.hide}
                  style={{ outline: 'none' }}
                />
                {(data.length <= 8 || i % 2 === 0 || i === data.length - 1) && <text x={cx} y={H - 6} textAnchor="middle">{d.label}</text>}
              </g>
            );
          })}
        </svg>
      )}
      {tip.view}
    </div>
  );
}

/* ------------------------------------------------------------------ Mapa de calor 7×24 ------------------------------------------------------------------ */

export const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAY_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export function Heatmap({ matrix, ariaLabel }: { matrix: number[][]; ariaLabel: string }) {
  const tip = useChartTip();
  const max = matrixMax(matrix);
  const cw = 26, ch = 24, padL = 38, padT = 18;
  const W = padL + cw * 24, H = padT + ch * 7 + 4;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={ariaLabel} onPointerLeave={tip.hide}>
        {Array.from({ length: 24 }, (_, h) => h % 3 === 0 && <text key={h} x={padL + h * cw + cw / 2} y={11} textAnchor="middle">{String(h).padStart(2, '0')}</text>)}
        {matrix.map((row, d) => (
          <g key={d}>
            <text x={padL - 8} y={padT + d * ch + ch / 2 + 4} textAnchor="end">{DAY_LABELS[d]}</text>
            {row.map((v, h) => {
              const lvl = heatLevel(v, max);
              const text = `${DAY_LONG[d]} ${String(h).padStart(2, '0')}:00 · ${v} ${v === 1 ? 'run' : 'runs'}`;
              const node = <div><b>{v}</b> <span className="lbl">{v === 1 ? 'run' : 'runs'}</span><div className="lbl">{DAY_LONG[d]} {String(h).padStart(2, '0')}:00</div></div>;
              return (
                <rect key={h} className="heat-cell" x={padL + h * cw} y={padT + d * ch} width={cw} height={ch} rx={5} tabIndex={0} aria-label={text}
                  style={{ fill: `var(--heat-${lvl})` }} onPointerMove={(e) => tip.showAtEvent(e, node)} onFocus={(e) => tip.showAtEl(e.currentTarget, node)} onBlur={tip.hide} />
              );
            })}
          </g>
        ))}
      </svg>
      <div className="heat-legend" style={{ marginTop: 8 }}>
        <span>Menos</span>
        {[0, 1, 2, 3, 4].map((l) => <i key={l} style={{ background: `var(--heat-${l})` }} />)}
        <span>Más (máx. {max})</span>
      </div>
      {tip.view}
    </div>
  );
}

/* ------------------------------------------------------------------ Franja de distribución (barra apilada horizontal) ------------------------------------------------------------------ */

export interface StripPart { key: string; label: string; value: number; tone: Tone }

export function StatusStrip({ parts, ariaLabel }: { parts: StripPart[]; ariaLabel: string }) {
  const tip = useChartTip();
  const total = parts.reduce((a, p) => a + p.value, 0);
  const W = 400, H = 14;
  let x = 0;
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={ariaLabel} onPointerLeave={tip.hide} preserveAspectRatio="none" style={{ height: 14 }}>
        {total === 0 && <rect x={0} y={0} width={W} height={H} rx={4} style={{ fill: 'var(--track)' }} />}
        {visible.map((p, i) => {
          const w = (p.value / total) * W;
          const x0 = x;
          x += w;
          const gap = i === visible.length - 1 ? 0 : 2;
          const node = <div><b>{p.value}</b> <span className="lbl">{p.label}</span></div>;
          return <rect key={p.key} className="mark" x={x0} y={0} width={Math.max(1, w - gap)} height={H} rx={3} tabIndex={0} aria-label={`${p.label}: ${p.value}`} style={{ fill: toneVar(p.tone), outline: 'none' }} onPointerMove={(e) => tip.showAtEvent(e, node)} onFocus={(e) => tip.showAtEl(e.currentTarget, node)} onBlur={tip.hide} />;
        })}
      </svg>
      <div className="legend" style={{ marginTop: 10 }}>
        {parts.map((p) => <span key={p.key} className="k"><i className="sw" style={{ '--c': toneVar(p.tone) } as CSSProperties} />{p.label} <b className="num" style={{ color: 'var(--text)' }}>{p.value}</b></span>)}
      </div>
      {tip.view}
    </div>
  );
}
