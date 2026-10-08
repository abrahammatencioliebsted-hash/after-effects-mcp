import { useEffect, useState } from 'react';
import { Card, Empty, ErrorState, Loading, Badge } from './ui.tsx';
import { MeterRow } from './charts.tsx';
import { Icon } from './Icon.tsx';
import { api } from '../lib/api.ts';
import { machineMetrics, worstSeverity, DEFAULT_THRESHOLDS } from '../lib/metrics.ts';
import { machineStatusInfo, SEVERITY_TEXT, severityTone } from '../lib/status.ts';
import { useApp } from '../state/AppContext.tsx';
import { useResource } from '../state/hooks.ts';
import { relativeTime } from '../lib/format.ts';

/** Estado del sistema: selector de equipo + medidores segmentados. */
export function SystemStatus({ title = 'Estado del sistema', sub }: { title?: string; sub?: string }) {
  const app = useApp();
  const machines = useResource(() => api.machines(), [app.live.machines]);
  const [sel, setSel] = useState<string>('');
  const list = machines.data ?? [];
  useEffect(() => { if (!sel && list[0]) setSel((list.find((m) => m.status === 'online') ?? list[0]).id); }, [list, sel]);
  const m = list.find((x) => x.id === sel);
  const thresholds = app.settings.data?.healthThresholds ?? DEFAULT_THRESHOLDS;

  return (
    <Card title={title} sub={sub ?? 'Un vistazo a la carga antes de lanzar trabajo pesado'} right={
      list.length > 1 ? (
        <div className="seg" role="group" aria-label="Equipo">
          {list.map((x) => <button key={x.id} type="button" aria-pressed={x.id === sel} onClick={() => setSel(x.id)}>{x.name.replace('Windows ', 'Win ')}</button>)}
        </div>
      ) : undefined
    }>
      {machines.loading && <Loading rows={3} />}
      {machines.error && !machines.data && <ErrorState error={machines.error} onRetry={machines.reload} what="los equipos" />}
      {machines.data && list.length === 0 && <Empty icon="server" title="Aún no hay equipos">Cuando un node-agent envíe su primer latido aparecerá aquí.</Empty>}
      {m && (
        <div className="stack" style={{ gap: 20 }}>
          <div className="row between wrap">
            <div className="row"><Badge info={machineStatusInfo(m.status)} /><span className="muted">{m.role}</span></div>
            <span className="muted" style={{ fontSize: '.8rem' }}>Último latido {relativeTime(m.lastSeenAt)}</span>
          </div>
          {machineMetrics(m, thresholds).map((x) => (
            <MeterRow key={x.key} name={x.name} percent={x.percent} severity={x.severity} {...(x.sub ? { sub: x.sub } : {})} ariaLabel={`${x.name} de ${m.name}: ${x.percent === null ? 'sin dato' : Math.round(x.percent) + '%'}`} />
          ))}
          <p className="muted" style={{ fontSize: '.78rem' }}>Alertas desde CPU {thresholds.cpuPercent}% · RAM {thresholds.memPercent}% · Disco {thresholds.diskPercent}%. La barra nunca depende solo del color: lleva el texto «Normal / Atención / Crítico».</p>
        </div>
      )}
    </Card>
  );
}

/** Señal de seguridad compacta (se repite en varias vistas): todas las máquinas en una fila. */
export function SystemCue() {
  const app = useApp();
  const machines = useResource(() => api.machines(), [app.live.machines]);
  const thresholds = app.settings.data?.healthThresholds ?? DEFAULT_THRESHOLDS;
  const list = (machines.data ?? []).filter((m) => m.health);
  if (!machines.data || list.length === 0) return null;
  return (
    <section className="card tight" aria-label="Capacidad de cómputo">
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <div className="row"><Icon name="cpu" size={18} /><strong>Capacidad de cómputo</strong></div>
        <a href="#/salud" className="muted" style={{ fontSize: '.82rem' }}>Ver Salud</a>
      </div>
      <div className="grid auto" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))' }}>
        {list.map((m) => {
          const metrics = machineMetrics(m, thresholds);
          const worst = worstSeverity(metrics);
          return (
            <div key={m.id} className="stack" style={{ gap: 8 }}>
              <div className="row between"><strong style={{ fontSize: '.88rem' }}>{m.name}</strong><Badge tone={severityTone(worst)} icon={worst === 'ok' ? 'check' : 'alert'}>{SEVERITY_TEXT[worst]}</Badge></div>
              {metrics.filter((x) => x.key !== 'gpu').map((x) => (
                <div key={x.key} className="row" style={{ gap: 8 }}>
                  <span className="muted" style={{ width: 44, fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase' }}>{x.name}</span>
                  <div className="grow" style={{ minWidth: 0 }}><MiniBar percent={x.percent ?? 0} severity={x.severity} label={`${x.name} ${m.name}`} /></div>
                  <span className="num" style={{ width: 40, textAlign: 'right', fontWeight: 650 }}>{x.percent === null ? '—' : `${Math.round(x.percent)}%`}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

import { SegBar } from './charts.tsx';
import type { Severity } from '../lib/status.ts';
function MiniBar({ percent, severity, label }: { percent: number; severity: Severity; label: string }) {
  return <SegBar percent={percent} segments={16} severity={severity} ariaLabel={`${label}: ${Math.round(percent)}%`} />;
}
