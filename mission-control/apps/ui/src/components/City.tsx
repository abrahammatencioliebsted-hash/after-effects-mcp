// Ciudad isométrica 2D (SVG): una torre por agente. Trabajando = acento con pulso; disponible = tono cálido; pausado/error = gris/rojo apagado.
import type { AgentSummary } from '@mc/contracts';
import { cityLayout, isoProject, towerHeight } from '../lib/chart.ts';
import { agentStateInfo } from '../lib/status.ts';

const TW = 230, TH = 115;
const DX = 40, DY = 20; // media huella de la torre
const PX = 68, PY = 34; // media huella de la losa

function labelW(a: AgentSummary): number {
  return Math.max(a.shortName.length * 7.4, agentStateInfo(a.state).label.length * 6) + 22;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function windows(a: AgentSummary, cx: number, cy: number, h: number) {
  const rows = Math.max(3, Math.floor(h / 16));
  const out: Array<{ pts: string; lit: boolean; key: string }> = [];
  const seed = hash(a.id);
  const litRatio = a.state === 'working' ? 0.75 : a.state === 'available' ? 0.3 : 0.05;
  for (let side = 0; side < 2; side++) {
    // cara izquierda: de (cx-DX, cy) a (cx, cy+DY); derecha: de (cx, cy+DY) a (cx+DX, cy)
    const x0 = side === 0 ? cx - DX : cx;
    const y0 = side === 0 ? cy : cy + DY;
    const x1 = side === 0 ? cx : cx + DX;
    const y1 = side === 0 ? cy + DY : cy;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 3; c++) {
        const u0 = 0.14 + c * 0.28, u1 = u0 + 0.16;
        const v0 = (r + 0.25) / rows * 0.9 + 0.05, v1 = v0 + 0.55 / rows * 0.9;
        const P = (u: number, v: number) => `${(x0 + (x1 - x0) * u).toFixed(1)},${(y0 + (y1 - y0) * u - v * h).toFixed(1)}`;
        const bit = ((seed >>> ((r * 3 + c + side * 7) % 28)) & 7) / 7;
        out.push({ key: `${side}-${r}-${c}`, pts: `${P(u0, v0)} ${P(u1, v0)} ${P(u1, v1)} ${P(u0, v1)}`, lit: bit < litRatio });
      }
    }
  }
  return out;
}

export function City({ agents, selectedId, onSelect }: { agents: AgentSummary[]; selectedId?: string | undefined; onSelect: (id: string) => void }) {
  const sorted = [...agents].sort((a, b) => Number(b.isBoss) - Number(a.isBoss) || b.workloadShare - a.workloadShare);
  const cells = cityLayout(sorted.length);
  const placed = sorted.map((a, i) => {
    const [gx, gy] = cells[i] ?? [0, 0];
    const p = isoProject(gx, gy, TW, TH);
    return { a, gx, gy, cx: p.x, cy: p.y, h: towerHeight(a.workloadShare, a.isBoss) };
  });
  const minX = Math.min(...placed.map((p) => p.cx - PX)) - 16;
  const maxX = Math.max(...placed.map((p) => p.cx + PX)) + 16;
  const minY = Math.min(...placed.map((p) => p.cy - p.h - 34)) - 8;
  const maxY = Math.max(...placed.map((p) => p.cy + PY + 44)) + 8;
  const order = [...placed].sort((p, q) => p.gx + p.gy - (q.gx + q.gy) || p.gx - q.gx);
  const cols = Math.ceil(Math.sqrt(Math.max(1, sorted.length)));
  const rowsN = Math.ceil(sorted.length / cols);

  return (
    <svg className="city-svg" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} role="group" aria-label={`Ciudad de agentes: ${agents.length} torres`}>
      {/* calles */}
      {Array.from({ length: cols + 1 }, (_, i) => { const a = isoProject(i - 0.5, -0.5, TW, TH), b = isoProject(i - 0.5, rowsN - 0.5, TW, TH); return <line key={`c${i}`} className="road" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />; })}
      {Array.from({ length: rowsN + 1 }, (_, i) => { const a = isoProject(-0.5, i - 0.5, TW, TH), b = isoProject(cols - 0.5, i - 0.5, TW, TH); return <line key={`r${i}`} className="road" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />; })}
      {order.map(({ a, cx, cy, h }) => {
        const st = agentStateInfo(a.state);
        const top = cy - h;
        const wins = windows(a, cx, cy, h);
        const label = `${a.name}: ${st.label}. ${Math.round(a.workloadShare)}% de la carga. Abrir ficha`;
        return (
          <g key={a.id} className={`tower ${a.state}${a.id === selectedId ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={label} aria-pressed={a.id === selectedId}
            onClick={() => onSelect(a.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(a.id); } }}>
            <title>{`${a.name} · ${st.label}`}</title>
            <polygon className="ground" points={`${cx - PX},${cy} ${cx},${cy + PY} ${cx + PX},${cy} ${cx},${cy - PY}`} />
            {a.state === 'working' && <>
              <ellipse className="glow" cx={cx} cy={cy} rx={PX - 8} ry={PY - 4} style={{ fill: 'var(--accent-soft)' }} />
              <ellipse className="pulse" cx={cx} cy={cy} rx={DX + 8} ry={DY + 4} />
              <ellipse className="pulse b" cx={cx} cy={cy} rx={DX + 8} ry={DY + 4} />
            </>}
            <polygon className="face-l" points={`${cx - DX},${cy} ${cx},${cy + DY} ${cx},${cy + DY - h} ${cx - DX},${cy - h}`} />
            <polygon className="face-r" points={`${cx},${cy + DY} ${cx + DX},${cy} ${cx + DX},${cy - h} ${cx},${cy + DY - h}`} />
            {wins.map((w) => <polygon key={w.key} className={`win${w.lit ? ' lit' : ''}`} points={w.pts} />)}
            <polygon className="face-t" points={`${cx - DX},${top} ${cx},${top - DY} ${cx + DX},${top} ${cx},${top + DY}`} />
            {a.isBoss && <><line x1={cx} y1={top} x2={cx} y2={top - 26} style={{ stroke: 'var(--text-2)' }} strokeWidth={2} /><circle cx={cx} cy={top - 28} r={4} style={{ fill: a.state === 'working' ? 'var(--accent)' : 'var(--text-2)', stroke: 'var(--panel)' }} strokeWidth={2} /></>}
          </g>
        );
      })}
      {/* Etiquetas al final para que ninguna torre las tape */}
      {order.map(({ a, cx, cy }) => (
        <g key={`l-${a.id}`} className={`tower-label ${a.state}`} aria-hidden="true" style={{ pointerEvents: 'none' }}>
          <rect x={cx - labelW(a) / 2} y={cy + PY + 2} width={labelW(a)} height={34} rx={8} style={{ fill: 'var(--panel)', opacity: 0.88, stroke: 'var(--line-strong)' }} />
          <text x={cx} y={cy + PY + 18}>{a.shortName}</text>
          <text className="sub" x={cx} y={cy + PY + 31}>{agentStateInfo(a.state).label}</text>
        </g>
      ))}
    </svg>
  );
}
