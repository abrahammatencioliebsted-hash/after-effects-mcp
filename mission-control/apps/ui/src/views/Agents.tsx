import { useState } from 'react';
import type { AgentSummary } from '@mc/contracts';
import { api } from '../lib/api.ts';
import { City } from '../components/City.tsx';
import { Heatmap, StackedColumns } from '../components/charts.tsx';
import { SystemCue } from '../components/System.tsx';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, KV, Loading, Modal, PageHead, Segmented } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { useApp } from '../state/AppContext.tsx';
import { go, useMediaQuery, useResource } from '../state/hooks.ts';
import type { Route } from '../lib/router.ts';
import { agentStateInfo, platformLabel, runStatusInfo } from '../lib/status.ts';
import { costStatusLabel, formatCents, formatDateTime, formatDuration, formatTime, formatTokens, plural, relativeTime, totalTokens, pct } from '../lib/format.ts';
import { normalizeHeatmap, sumByDay, sumByHour } from '../lib/chart.ts';
import { DAY_LABELS } from '../components/charts.tsx';

function AgentPanel({ a, onClose }: { a: AgentSummary; onClose?: (() => void) | undefined }) {
  const app = useApp();
  const runs = useResource(() => api.agentRuns(a.id, 8), [a.id, app.live.agents]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = agentStateInfo(a.state);
  const budgetPct = pct(a.spentMonthlyCents, a.budgetMonthlyCents);

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteAgent(a.id);
      app.toast('ok', `${a.name} retirado (pausado y archivado; su historial se conserva).`);
      app.bump('agents'); app.agents.reload();
      setConfirm(false);
      go('agentes');
    } catch (e) {
      app.toast('crit', e instanceof Error ? e.message : 'No se pudo retirar al agente.');
    } finally { setBusy(false); }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow">{a.isBoss ? 'Agente jefe' : 'Agente'}</div>
          <h2 style={{ fontSize: '1.3rem' }}>{a.name}</h2>
          <p className="t2" style={{ fontSize: '.9rem' }}>{a.role}</p>
        </div>
        {onClose && <Button variant="ghost" iconOnly size="sm" icon="x" aria-label="Cerrar ficha" onClick={onClose} />}
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <Badge info={st} />
        <Badge plain>{platformLabel(a.platform)}</Badge>
        {a.origin === 'demo' && <Badge tone="warn" icon="flask">Simulado</Badge>}
      </div>
      <KV items={[
        ['Equipo', a.machineId ?? '—'],
        ['Adaptador', a.adapterType ?? '—'],
        ['Modelo', a.modelLabel ?? 'sin modelo'],
        ['Esfuerzo', a.effort ?? '—'],
        ['Último run', a.lastRunAt ? `${relativeTime(a.lastRunAt)} · ${formatDateTime(a.lastRunAt)}` : 'Nunca'],
        ['Carga', `${Math.round(a.workloadShare)}% de los runs`],
        ['Duración media', formatDuration(a.avgDurationSec)],
        ['Runs', `${a.runsTotal} (${a.runsSucceeded} con éxito · ${a.runsFailed} fallidos)`],
        ['Tokens', `${formatTokens(totalTokens(a.tokens))} · ${formatCents(a.tokens.estimatedCents)} (${costStatusLabel(a.tokens.costStatus)})`],
      ]} />
      <div>
        <div className="row between" style={{ fontSize: '.82rem', marginBottom: 6 }}><span className="muted">Presupuesto mensual</span><b className="num">{formatCents(a.spentMonthlyCents)} / {formatCents(a.budgetMonthlyCents)}</b></div>
        <span className="hbar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(budgetPct)} aria-label="Presupuesto mensual consumido"><i style={{ width: `${budgetPct}%`, background: budgetPct > 85 ? 'var(--crit)' : undefined }} /></span>
      </div>
      <div>
        <h3 style={{ fontSize: '.95rem', marginBottom: 8 }}>Últimos runs</h3>
        {runs.loading ? <Loading rows={2} /> : runs.error && !runs.data ? <ErrorState error={runs.error} onRetry={runs.reload} what="los runs" /> : (runs.data ?? []).length === 0 ? <p className="muted" style={{ fontSize: '.88rem' }}>Este agente aún no ha ejecutado runs.</p> : (
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 8 }}>
            {(runs.data ?? []).map((r) => (
              <li key={r.id} className="row between" style={{ padding: '8px 12px', background: 'var(--panel-2)', borderRadius: 10, gap: 8 }}>
                <Badge info={runStatusInfo(r.status)} />
                <span className="muted num" style={{ fontSize: '.8rem' }}>{formatDuration(r.durationSec)}</span>
                <span className="muted" style={{ fontSize: '.78rem' }}>{r.startedAt ? formatTime(r.startedAt, undefined, false) : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <Button icon="chat" disabled title="El chat directo con el agente llega en la etapa E4">Chat llega en E4</Button>
        {!a.isBoss && <Button variant="danger" icon="trash" onClick={() => setConfirm(true)}>Retirar agente</Button>}
      </div>
      <p className="muted" style={{ fontSize: '.78rem' }}><Icon name="info" size={12} /> El chat con agentes (voz y texto) es una etapa posterior; hoy se les habla creando una misión.</p>
      <ConfirmDialog open={confirm} danger title={`Retirar a ${a.name}`} body="Se pausa y archiva en Paperclip. El historial de runs y misiones se conserva, pero el agente deja de recibir trabajo." confirmLabel="Retirar agente" busy={busy} onConfirm={remove} onCancel={() => setConfirm(false)} />
    </div>
  );
}

export function AgentsView({ route }: { route: Route }) {
  const app = useApp();
  const narrow = useMediaQuery('(max-width: 1100px)');
  const agents = app.agents.data ?? [];
  const selected = agents.find((a) => a.id === route.id);
  const ov = useResource(() => api.overview(14), [app.live.agents]);
  const act = useResource(() => api.activity({ limit: 30 }), [app.live.activity]);
  const [heatMode, setHeatMode] = useState<'grid' | 'hour' | 'day'>('grid');
  const counts = { working: 0, available: 0, other: 0 };
  for (const a of agents) { if (a.state === 'working') counts.working++; else if (a.state === 'available') counts.available++; else counts.other++; }
  const matrix = normalizeHeatmap(ov.data?.heatmap);
  const hasHeat = matrix.some((r) => r.some((v) => v > 0));

  return (
    <>
      <PageHead title="Agentes" sub="Una torre por agente. Pulso de acento = trabajando; tono cálido = disponible. Haz clic en una torre para ver su ficha."
        actions={<Button variant="primary" icon="plus" onClick={() => app.setAgentWizardOpen(true)}>Añadir agente</Button>} />
      {app.agents.loading && <Loading rows={4} />}
      {app.agents.error && !app.agents.data && <ErrorState error={app.agents.error} onRetry={app.agents.reload} what="los agentes" />}
      {app.agents.data && agents.length === 0 && <Card><Empty icon="city" title="La ciudad está vacía" action={<Button variant="primary" onClick={() => app.setAgentWizardOpen(true)}>Construir la primera torre</Button>}>Crea un agente y aparecerá como una torre; podrás asignarle misiones al instante.</Empty></Card>}
      {agents.length > 0 && (
        <div className="city-layout">
          <Card className="city" flush>
            <div className="city-legend" aria-label="Leyenda de la ciudad">
              <span className="row" style={{ gap: 8 }}><i className="dot-ind" style={{ '--tone': 'var(--tone-accent)' } as React.CSSProperties} /> <b>{counts.working}</b> trabajando (pulso)</span>
              <span className="row" style={{ gap: 8 }}><i className="dot-ind" style={{ '--tone': 'var(--tone-idle)' } as React.CSSProperties} /> <b>{counts.available}</b> disponibles</span>
              <span className="row" style={{ gap: 8 }}><i className="dot-ind" style={{ '--tone': 'var(--tone-muted)' } as React.CSSProperties} /> <b>{counts.other}</b> en pausa o con error</span>
            </div>
            <City agents={agents} selectedId={selected?.id} onSelect={(id) => go('agentes', id)} />
          </Card>
          {!narrow && (
            <aside className="side-panel" aria-label="Ficha del agente">
              <Card>
                {selected ? <AgentPanel a={selected} onClose={() => go('agentes')} /> : (
                  <div className="stack">
                    <div className="eyebrow">Resumen</div>
                    <h2 style={{ fontSize: '1.2rem' }}>{agents.length} {plural(agents.length, 'agente', 'agentes')}</h2>
                    <p className="t2" style={{ fontSize: '.9rem' }}>Selecciona una torre para ver su rol, modelo, carga y últimos runs. Con el teclado: Tab hasta la torre y Enter.</p>
                    <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 8 }}>
                      {agents.map((a) => <li key={a.id}><button type="button" className="agent-chip" style={{ width: '100%' }} onClick={() => go('agentes', a.id)}><span className="row between"><strong>{a.name}</strong><Badge info={agentStateInfo(a.state)} /></span></button></li>)}
                    </ul>
                  </div>
                )}
              </Card>
            </aside>
          )}
        </div>
      )}
      {narrow && selected && <Modal open variant="drawer" icon="user" title={selected.name} onClose={() => go('agentes')}><AgentPanel a={selected} /></Modal>}
      {route.id && app.agents.data && !selected && <p className="muted" role="status" style={{ marginTop: 12 }}>El agente «{route.id}» ya no existe.</p>}

      <div className="grid split" style={{ marginTop: 16 }}>
        <Card title="Mapa de calor de actividad" sub="Runs por hora y día de la semana (últimos 14 días)" right={
          <Segmented<typeof heatMode> label="Vista del mapa de calor" value={heatMode} onChange={setHeatMode} options={[{ value: 'grid', label: '7 × 24' }, { value: 'hour', label: '24 h' }, { value: 'day', label: '7 días' }]} />}>
          {ov.loading ? <Loading rows={3} /> : ov.error && !ov.data ? <ErrorState error={ov.error} onRetry={ov.reload} what="el mapa de calor" /> : !hasHeat ? <Empty icon="activity" title="Sin actividad registrada">Cuando los agentes ejecuten runs, verás aquí cuándo trabajan más.</Empty> : heatMode === 'grid' ? (
            <Heatmap matrix={matrix} ariaLabel="Mapa de calor de runs por hora y día de la semana" />
          ) : heatMode === 'hour' ? (
            <StackedColumns yLabel="runs" height={190} ariaLabel="Runs por hora del día" series={[{ key: 'v', name: 'Runs', color: 'var(--accent)' }]} data={sumByHour(matrix).map((v, h) => ({ label: String(h).padStart(2, '0'), tipLabel: `${String(h).padStart(2, '0')}:00`, values: { v } }))} />
          ) : (
            <StackedColumns yLabel="runs" height={190} ariaLabel="Runs por día de la semana" series={[{ key: 'v', name: 'Runs', color: 'var(--accent)' }]} data={sumByDay(matrix).map((v, d) => ({ label: DAY_LABELS[d] ?? '', tipLabel: DAY_LABELS[d] ?? '', values: { v } }))} />
          )}
        </Card>
        <Card title="Actividad reciente" sub="Registro de lo que hacen los agentes" flush>
          {act.loading ? <div style={{ padding: 24 }}><Loading rows={4} /></div> : act.error && !act.data ? <div style={{ padding: 24 }}><ErrorState error={act.error} onRetry={act.reload} what="la actividad" /></div> : (act.data?.items ?? []).length === 0 ? <Empty icon="history" title="Sin actividad">Aún no hay eventos registrados.</Empty> : (
            <ul className="stack" style={{ listStyle: 'none', padding: '0 24px 16px', margin: 0, gap: 0, maxHeight: 360, overflow: 'auto' }} aria-live="polite">
              {(act.data?.items ?? []).map((i) => (
                <li key={i.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <div className="row between" style={{ gap: 8 }}><strong style={{ fontSize: '.88rem' }}>{i.actorName}</strong><time className="muted num" style={{ fontSize: '.76rem' }} dateTime={i.at} title={formatDateTime(i.at)}>{formatTime(i.at, undefined, false)}</time></div>
                  <div className="t2" style={{ fontSize: '.86rem' }}>{i.summary}</div>
                  {(i.missionIdentifier || i.machineId) && <div className="muted" style={{ fontSize: '.74rem', marginTop: 2 }}>{[i.missionIdentifier, i.machineId].filter(Boolean).join(' · ')}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div style={{ marginTop: 16 }}><SystemCue /></div>
    </>
  );
}
