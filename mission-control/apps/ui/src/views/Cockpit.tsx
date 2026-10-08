import { useState } from 'react';
import { api } from '../lib/api.ts';
import { ArcGauge, Sparkline, StackedColumns, StatusStrip } from '../components/charts.tsx';
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHead, ProvenanceList, Segmented } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { SystemCue, SystemStatus } from '../components/System.tsx';
import { useApp } from '../state/AppContext.tsx';
import { go, useResource } from '../state/hooks.ts';
import { formatCents, formatDuration, formatTokens, pct, totalTokens, truncate } from '../lib/format.ts';
import { agentStateInfo, missionStatusInfo, platformLabel, MISSION_STATUSES } from '../lib/status.ts';
import type { Severity } from '../lib/status.ts';
import type { AgentSummary } from '@mc/contracts';

const DAYS = ['7', '14', '30'] as const;

export function successSeverity(p: number): Severity {
  return p >= 90 ? 'ok' : p >= 70 ? 'warn' : 'crit';
}

function AgentChip({ a, boss }: { a: AgentSummary; boss?: boolean }) {
  const st = agentStateInfo(a.state);
  return (
    <a className={`agent-chip${boss ? ' boss' : ''}`} href={`#/agentes/${encodeURIComponent(a.id)}`} aria-label={`${a.name}, ${st.label}, ${Math.round(a.workloadShare)}% de la carga`}>
      <span className="nm"><Icon name={boss ? 'sparkle' : 'user'} size={16} />{a.name}{boss && <span className="chip" style={{ marginLeft: 'auto' }}>Jefe</span>}</span>
      <span className="row" style={{ gap: 8 }}><Badge info={st} /><span className="muted" style={{ fontSize: '.78rem' }}>{platformLabel(a.platform)}</span></span>
      <span className="row between" style={{ fontSize: '.8rem' }}><span className="muted">Carga</span><b className="num">{Math.round(a.workloadShare)}%</b></span>
      <span className="hbar"><i style={{ width: `${Math.min(100, a.workloadShare * 2.5)}%` }} /></span>
    </a>
  );
}

export function CockpitView() {
  const app = useApp();
  const [days, setDays] = useState<(typeof DAYS)[number]>('14');
  const ov = useResource(() => api.overview(Number(days)), [days, app.live.missions, app.live.agents]);
  const agents = app.agents.data ?? [];
  const o = ov.data;
  const boss = agents.find((a) => a.isBoss);
  const top = [...agents].filter((a) => !a.isBoss).sort((a, b) => b.workloadShare - a.workloadShare).slice(0, 4);
  const byWork = [...agents].sort((a, b) => b.workloadShare - a.workloadShare);
  const maxWork = Math.max(1, ...byWork.map((a) => a.workloadShare));
  const maxDur = Math.max(1, ...agents.map((a) => a.avgDurationSec));
  const greeting = app.settings.data?.ownerName ? `Hola, ${app.settings.data.ownerName}` : 'Hola';

  return (
    <>
      <PageHead
        eyebrow={greeting}
        title="Cockpit"
        sub="Tu equipo de agentes de un vistazo: resultados, carga y capacidad del sistema."
        actions={
          <>
            <Segmented<(typeof DAYS)[number]> label="Ventana de tiempo" value={days} onChange={setDays} options={DAYS.map((d) => ({ value: d, label: `${d} d` }))} />
            <Button icon="user" onClick={() => app.setAgentWizardOpen(true)}>Añadir agente</Button>
            <Button variant="primary" icon="plus" onClick={() => app.openWizard()}>Nueva misión</Button>
          </>
        }
      />

      {ov.error && !o && <ErrorState error={ov.error} onRetry={ov.reload} what="el resumen" />}
      {ov.loading && <Loading rows={4} label="Cargando instrumentos…" />}

      {o && (
        <div className={`stack${ov.reloading ? ' reloading' : ''}`} style={{ gap: 16 }}>
          <section aria-label="Cuadro de instrumentos" className="cluster">
            <Card className="instrument" title="Tasa de éxito" sub={`Runs con éxito · últimos ${days} días`}>
              <ArcGauge value={o.successRatePercent} display={`${Math.round(o.successRatePercent)}%`} label="Éxito" severity={successSeverity(o.successRatePercent)} ariaLabel={`Tasa de éxito: ${Math.round(o.successRatePercent)} por ciento`} sub={successSeverity(o.successRatePercent) === 'ok' ? 'Normal' : successSeverity(o.successRatePercent) === 'warn' ? 'Atención: revisa reintentos' : 'Crítico: muchos runs fallan'} />
            </Card>
            <Card className="instrument" title="Misiones totales" sub="Todas las misiones registradas">
              <div className="hero num" style={{ marginBottom: 16 }}>{o.missions.total}<span className="unit">misiones</span></div>
              <StatusStrip ariaLabel="Distribución de misiones por estado" parts={MISSION_STATUSES.map((s) => ({ key: s, label: missionStatusInfo(s).label, value: o.missions.byStatus[s] ?? 0, tone: missionStatusInfo(s).tone }))} />
            </Card>
            <Card className="instrument" title="Duración media" sub="Tiempo medio de una misión">
              <div className="hero num" style={{ marginBottom: 12 }}>{formatDuration(o.avgMissionDurationSec)}</div>
              <div className="row between" style={{ marginTop: 12 }}>
                <div><div className="muted" style={{ fontSize: '.78rem' }}>Runs por día</div>
                  <Sparkline values={o.runActivity.map((d) => d.succeeded + d.failed + d.other)} width={180} height={44} ariaLabel={`Runs por día, ${o.runActivity.length} días, de ${o.runActivity[0] ? o.runActivity[0].succeeded + o.runActivity[0].failed + o.runActivity[0].other : 0} a ${(() => { const l = o.runActivity[o.runActivity.length - 1]; return l ? l.succeeded + l.failed + l.other : 0; })()}`} /></div>
                <div className="stat" style={{ textAlign: 'right' }}><span className="v">{o.agents.working}</span><span className="l">de {o.agents.total} agentes<br />trabajando</span></div>
              </div>
            </Card>
          </section>

          <div className="grid split">
            <SystemStatus />
            <Card title="Misiones" sub="Resumen de la operación" right={<Button size="sm" variant="ghost" onClick={() => go('misiones')}>Abrir tablero</Button>}>
              <div className="grid c2" style={{ gap: 16 }}>
                <div className="stat"><span className="v">{o.missions.byStatus.delivered}</span><span className="l"><Icon name="check" size={13} /> Completadas</span></div>
                <div className="stat"><span className="v">{o.missions.retrying}</span><span className="l"><Icon name="refresh" size={13} /> Reintentando</span></div>
                <div className="stat"><span className="v">{o.missions.deployed}</span><span className="l"><Icon name="activity" size={13} /> Desplegadas</span></div>
                <div className="stat"><span className="v" style={{ color: o.pendingApprovals ? 'var(--accent)' : undefined }}>{o.pendingApprovals}</span><span className="l"><Icon name="clock" size={13} /> Esperan tu aprobación</span></div>
              </div>
              {o.pendingApprovals > 0 && <Button variant="primary" size="sm" style={{ marginTop: 16 }} icon="clipboard" onClick={() => go('misiones', undefined, { filter: 'aprobacion' })}>Revisar planes pendientes</Button>}
            </Card>
          </div>

          <Card title="Orquestación de agentes" sub="El agente jefe arriba; abajo, los cuatro más activos con su carga de trabajo">
            {agents.length === 0 ? <Empty icon="users" title="Aún no hay agentes" action={<Button variant="primary" onClick={() => app.setAgentWizardOpen(true)}>Añadir el primero</Button>}>Crea un agente para empezar a delegar misiones.</Empty> : (
              <div className="orchestra">
                {boss && <div className="orch-boss"><AgentChip a={boss} boss /></div>}
                <div className="orch-kids" aria-label="Agentes más activos">
                  {top.map((a) => <AgentChip key={a.id} a={a} />)}
                </div>
              </div>
            )}
          </Card>

          <div className="grid c2">
            <Card title="Distribución de carga" sub="Parte de los runs que ejecutó cada agente">
              {byWork.length === 0 ? <Empty title="Sin actividad">Aún no hay runs.</Empty> : (
                <div role="list">
                  {byWork.map((a) => (
                    <div key={a.id} className="hbar-row" role="listitem" aria-label={`${a.name}: ${Math.round(a.workloadShare)}%`}>
                      <span className="nm" title={a.name}>{a.name}</span>
                      <span className="hbar"><i style={{ width: `${(a.workloadShare / maxWork) * 100}%` }} /></span>
                      <span className="v">{Math.round(a.workloadShare)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Duración media de respuesta" sub="Tiempo medio por run, por agente">
              {agents.length === 0 ? <Empty title="Sin datos" /> : (
                <div role="list">
                  {[...agents].sort((a, b) => b.avgDurationSec - a.avgDurationSec).map((a) => (
                    <div key={a.id} className="hbar-row" role="listitem" aria-label={`${a.name}: ${formatDuration(a.avgDurationSec)}`}>
                      <span className="nm" title={a.name}>{a.name}</span>
                      <span className="hbar"><i style={{ width: `${(a.avgDurationSec / maxDur) * 100}%` }} /></span>
                      <span className="v">{formatDuration(a.avgDurationSec)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="grid split">
            <Card title="Actividad de runs" sub={`Éxitos, fallos y otros por día · últimos ${days} días`}>
              <StackedColumns
                yLabel="runs"
                ariaLabel={`Runs por día durante ${o.runActivity.length} días`}
                series={[{ key: 'succeeded', name: 'Éxito', color: 'var(--accent)' }, { key: 'failed', name: 'Fallo', color: 'var(--crit)', texture: true }, { key: 'other', name: 'Otros', color: 'var(--text-3)' }]}
                data={o.runActivity.map((d) => ({ label: d.date.slice(8) + '/' + d.date.slice(5, 7), tipLabel: d.date, values: { succeeded: d.succeeded, failed: d.failed, other: d.other } }))}
              />
            </Card>
            <Card title="Modelos en uso" sub="Qué modelo corre cada agente">
              {o.modelsInUse.length === 0 ? <Empty title="Sin modelos">Nadie ha informado modelo todavía.</Empty> : (
                <div className="stack" style={{ gap: 12 }}>
                  {o.modelsInUse.map((m) => (
                    <div key={m.modelLabel} className="row between"><span className="mono" style={{ fontSize: '.88rem' }}>{m.modelLabel}</span><span className="chip">{m.agentCount} {m.agentCount === 1 ? 'agente' : 'agentes'}</span></div>
                  ))}
                  <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
                  <div className="row between"><span className="muted">Tokens (ventana)</span><b className="num">{formatTokens(totalTokens(o.tokens))}</b></div>
                  <div className="row between"><span className="muted">Gasto estimado</span><b className="num">{formatCents(o.tokens.estimatedCents)}</b></div>
                  <div>
                    <div className="row between" style={{ fontSize: '.82rem', marginBottom: 6 }}><span className="muted">Presupuesto del mes</span><b className="num">{Math.round(o.budget.utilizationPercent)}%</b></div>
                    <span className="hbar"><i style={{ width: `${Math.min(100, o.budget.utilizationPercent)}%`, background: o.budget.utilizationPercent > 85 ? 'var(--crit)' : undefined }} /></span>
                    <div className="muted" style={{ fontSize: '.76rem', marginTop: 4 }}>{formatCents(o.budget.monthSpendCents)} de {formatCents(o.budget.monthBudgetCents)}{o.budget.incidents ? ` · ${o.budget.incidents} incidentes` : ''}</div>
                  </div>
                </div>
              )}
            </Card>
          </div>

          <SystemCue />

          <Card title="Procedencia de los datos" sub="Qué es real, qué es simulado y qué está pendiente">
            {app.health.data ? <ProvenanceList notes={app.health.data.notes} /> : <span className="muted">Sin información de salud todavía.</span>}
          </Card>
        </div>
      )}
    </>
  );
}
