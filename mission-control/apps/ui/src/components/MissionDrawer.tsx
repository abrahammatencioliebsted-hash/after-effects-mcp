import { useEffect, useMemo, useRef, useState } from 'react';
import type { MissionDetail } from '@mc/contracts';
import { Badge, Button, ConfirmDialog, Empty, ErrorState, KV, Loading, Modal, ProvenanceList, Tabs } from './ui.tsx';
import { Timeline } from './Timeline.tsx';
import { Icon } from './Icon.tsx';
import { Markdown } from './Markdown.tsx';
import { api } from '../lib/api.ts';
import { formatCents, formatDate, formatDateTime, formatDuration, formatTokens, timeZoneLabel, totalTokens, costStatusLabel } from '../lib/format.ts';
import { availableActions } from '../lib/actions.ts';
import type { MissionAction } from '../lib/actions.ts';
import { agentStateInfo, missionStatusInfo, platformLabel, priorityInfo, runStatusInfo, scopeLabel } from '../lib/status.ts';
import { useApp } from '../state/AppContext.tsx';
import { go, useResource } from '../state/hooks.ts';

type Tab = 'resumen' | 'mensajes' | 'runs' | 'replay';

const ACTION_COPY: Record<MissionAction, { label: string; icon: string; title: string; body: string; confirm: string; note?: 'required' | 'optional'; danger?: boolean; primary?: boolean }> = {
  approve: { label: 'Aprobar plan', icon: 'check', title: 'Aprobar el plan', body: 'Los agentes empezarán a trabajar siguiendo este plan y dentro de los límites de la misión.', confirm: 'Aprobar y arrancar', note: 'optional', primary: true },
  reject: { label: 'Rechazar plan', icon: 'x', title: 'Rechazar el plan', body: 'La misión vuelve a Briefing. Cuéntale al jefe qué cambiarías.', confirm: 'Rechazar plan', note: 'required' },
  accept: { label: 'Aceptar resultados', icon: 'check', title: 'Aceptar los resultados', body: 'La misión pasa a Entregada y el informe queda en Docs.', confirm: 'Aceptar y entregar', note: 'optional', primary: true },
  changes: { label: 'Pedir cambios', icon: 'edit', title: 'Pedir cambios', body: 'La misión vuelve a En curso con tu comentario para el agente.', confirm: 'Enviar cambios', note: 'required' },
  rerun: { label: 'Reejecutar', icon: 'refresh', title: 'Reejecutar la misión', body: 'Se lanza un nuevo run bajo demanda. Cuenta como reintento y consume tokens.', confirm: 'Reejecutar', note: 'optional' },
  stop: { label: 'Detener misión', icon: 'pause', title: 'Detener la misión', body: 'Se cancelan los runs activos y la misión queda como Cancelada. No se puede deshacer.', confirm: 'Detener misión', note: 'optional', danger: true },
};

function ReplayPanel({ id }: { id: string }) {
  const replay = useResource(() => api.replay(id), [id]);
  const events = replay.data?.events ?? [];
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => { setIdx(0); setPlaying(false); }, [id, events.length]);
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setIdx((i) => {
        if (i >= events.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 900 / speed);
    return () => clearInterval(timer.current);
  }, [playing, speed, events.length]);

  if (replay.loading) return <Loading rows={3} />;
  if (replay.error && !replay.data) return <ErrorState error={replay.error} onRetry={replay.reload} what="el replay" />;
  if (events.length === 0) return <Empty icon="history" title="Sin eventos para reproducir">Esta misión aún no tiene historial.</Empty>;
  const cur = events[idx];
  const t0 = new Date(events[0]?.at ?? 0).getTime();
  const elapsed = cur ? Math.max(0, Math.round((new Date(cur.at).getTime() - t0) / 1000)) : 0;
  const visible = events.slice(0, idx + 1);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="replay-bar">
        <Button iconOnly icon={playing ? 'pause' : 'play'} variant="primary" aria-label={playing ? 'Pausar replay' : 'Reproducir replay'} onClick={() => { if (idx >= events.length - 1) setIdx(0); setPlaying((p) => !p); }} />
        <div className="grow">
          <input type="range" min={0} max={events.length - 1} value={idx} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} aria-label="Posición del replay" aria-valuetext={`Evento ${idx + 1} de ${events.length}: ${cur?.summary ?? ''}`} />
          <div className="row between muted" style={{ fontSize: '.78rem' }}><span>Evento {idx + 1} de {events.length}</span><span className="num">T+{formatDuration(elapsed)}</span></div>
        </div>
        <select className="select" style={{ width: 84 }} aria-label="Velocidad" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
        </select>
      </div>
      <Timeline events={visible} currentId={cur?.id ?? ''} />
      {cur?.raw !== undefined && (
        <details><summary className="muted" style={{ cursor: 'pointer' }}>Datos crudos del evento</summary><pre className="cmd-out">{JSON.stringify(cur.raw, null, 2)}</pre></details>
      )}
    </div>
  );
}

export function MissionDrawer({ id, tab: tabParam }: { id: string; tab?: string | undefined }) {
  const app = useApp();
  const detail = useResource(() => api.mission(id), [id, app.live.missions]);
  const [tab, setTab] = useState<Tab>((['resumen', 'mensajes', 'runs', 'replay'] as string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'resumen');
  const [onlyMsgs, setOnlyMsgs] = useState(false);
  const [pending, setPending] = useState<MissionAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<MissionDetail | null>(null);
  useEffect(() => { setLocal(null); }, [id, detail.data]);
  useEffect(() => { if (tabParam && (['resumen', 'mensajes', 'runs', 'replay'] as string[]).includes(tabParam)) setTab(tabParam as Tab); }, [tabParam, id]);
  const m = local ?? detail.data;

  const actions = useMemo(() => (m ? availableActions(m) : []), [m]);
  const close = () => go('misiones');

  const run = async (note: string) => {
    if (!pending || !m) return;
    setBusy(true);
    try {
      let next: MissionDetail;
      switch (pending) {
        case 'approve': next = await api.approvePlan(m.id, note || undefined); break;
        case 'reject': next = await api.rejectPlan(m.id, note); break;
        case 'accept': next = await api.acceptMission(m.id, note || undefined); break;
        case 'changes': next = await api.requestChanges(m.id, note); break;
        case 'rerun': next = await api.rerunMission(m.id, note || undefined); break;
        case 'stop': next = await api.stopMission(m.id, note || undefined); break;
      }
      setLocal(next);
      app.toast('ok', `${ACTION_COPY[pending].label}: hecho (${next.identifier}).`);
      app.bump('missions');
      app.bump('agents');
      setPending(null);
    } catch (e) {
      app.toast('crit', e instanceof Error ? e.message : 'La acción falló.');
    } finally {
      setBusy(false);
    }
  };

  const copy = pending ? ACTION_COPY[pending] : null;
  const st = m ? missionStatusInfo(m.status) : null;
  const msgs = m ? m.timeline.filter((e) => !onlyMsgs || e.kind === 'message') : [];

  return (
    <Modal
      open
      variant="drawer"
      onClose={close}
      icon="target"
      title={m ? <span>{m.title} <span className="muted mono" style={{ fontSize: '.8rem', fontWeight: 500 }}>{m.identifier}</span></span> : 'Misión'}
      footer={m && actions.length > 0 ? (
        <>
          {actions.map((a) => {
            const c = ACTION_COPY[a];
            return <Button key={a} variant={c.primary ? 'primary' : c.danger ? 'danger' : 'default'} icon={c.icon} onClick={() => setPending(a)}>{c.label}</Button>;
          })}
        </>
      ) : undefined}
    >
      {detail.loading && <Loading rows={5} />}
      {detail.error && !m && <ErrorState error={detail.error} onRetry={detail.reload} what="la misión" />}
      {m && st && (
        <div className={`stack${detail.reloading ? ' reloading' : ''}`} style={{ gap: 16 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <Badge info={st} />
            <Badge info={priorityInfo(m.priority)} />
            <Badge plain>{scopeLabel(m.scope)}</Badge>
            {m.approvalPending && <Badge tone="warn" icon="clock">Espera tu aprobación</Badge>}
            {m.retryCount > 0 && <Badge tone="warn" icon="refresh">{m.retryCount} {m.retryCount === 1 ? 'reintento' : 'reintentos'}</Badge>}
            {m.ideaId && <Badge plain icon="bulb">Idea {m.ideaId}</Badge>}
          </div>
          <Tabs<Tab> label="Secciones de la misión" value={tab} onChange={setTab} tabs={[
            { id: 'resumen', label: 'Plan y acciones', icon: 'clipboard' },
            { id: 'mensajes', label: 'Mensajes', icon: 'chat', count: m.timeline.length },
            { id: 'runs', label: 'Runs', icon: 'activity', count: m.runs.length },
            { id: 'replay', label: 'Replay', icon: 'history' },
          ]} />

          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
            {tab === 'resumen' && (
              <div className="stack" style={{ gap: 20 }}>
                <section><h3 style={{ fontSize: '.95rem', marginBottom: 6 }}>Objetivo</h3><p className="t2" style={{ whiteSpace: 'pre-wrap' }}>{m.objective}</p></section>
                <section aria-label="Plan">
                  <h3 style={{ fontSize: '.95rem', marginBottom: 8 }}>Plan {m.plan && <Badge tone={m.plan.status === 'approved' ? 'ok' : m.plan.status === 'rejected' ? 'crit' : 'warn'}>{m.plan.status === 'approved' ? 'Aprobado' : m.plan.status === 'rejected' ? 'Rechazado' : 'Pendiente de aprobación'}</Badge>}</h3>
                  {m.plan ? (
                    <div className="card tight" style={{ background: 'var(--panel-2)' }}>
                      <p className="t2" style={{ marginBottom: 12 }}>{m.plan.rationale}</p>
                      <ol style={{ margin: 0, paddingLeft: 20 }} className="stack">
                        {m.plan.steps.map((s) => (
                          <li key={s.order}><strong>{s.title}</strong><div className="muted" style={{ fontSize: '.82rem' }}>{[s.agentName, s.machineId, s.minutes ? `${s.minutes} min` : ''].filter(Boolean).join(' · ')}</div></li>
                        ))}
                      </ol>
                      <div className="muted" style={{ fontSize: '.78rem', marginTop: 12 }}>Propuesto por {m.plan.proposedBy.name} ({m.plan.proposedBy.type === 'agent' ? 'agente' : 'reglas del catálogo'}) · {formatDateTime(m.plan.proposedAt)}</div>
                    </div>
                  ) : <p className="muted">Sin plan: la misión fue cancelada antes de proponerlo.</p>}
                </section>
                {m.result && (
                  <section aria-label="Resultado"><h3 style={{ fontSize: '.95rem', marginBottom: 8 }}>Resultado de {m.result.agentName}</h3><div className="card tight" style={{ background: 'var(--panel-2)' }}><Markdown source={m.result.body} /></div></section>
                )}
                <section>
                  <h3 style={{ fontSize: '.95rem', marginBottom: 8 }}>Datos</h3>
                  <KV items={[
                    ['Responsable', m.assigneeName ?? 'Sin asignar'],
                    ['Equipo físico', m.machineId ?? '—'],
                    ['Plataforma · modelo', `${platformLabel(m.platform)} · ${m.modelLabel ?? 'sin modelo'}`],
                    ['Creada', formatDateTime(m.createdAt)],
                    ['Fecha objetivo', m.targetDate ? formatDate(m.targetDate) : 'Sin fecha'],
                    ['Duración de runs', formatDuration(m.durationSec)],
                    ['Tokens', `${formatTokens(totalTokens(m.tokens))} (${formatTokens(m.tokens.input)} entrada · ${formatTokens(m.tokens.output)} salida)`],
                    ['Coste', `${formatCents(m.tokens.estimatedCents)} · ${costStatusLabel(m.tokens.costStatus)}`],
                    ['Límites', `${m.limits.maxMinutes} min · ${m.limits.maxSteps} pasos · informe ${m.limits.reportLength === 'short' ? 'corto' : m.limits.reportLength === 'long' ? 'largo' : 'medio'}`],
                    ['Al terminar', m.finish === 'review_first' ? 'Revisión humana' : 'Entrega directa'],
                    ['Subtareas', m.childCount ? `${m.childDoneCount} de ${m.childCount} hechas` : 'Ninguna'],
                  ]} />
                </section>
                {m.documents.length > 0 && (
                  <section><h3 style={{ fontSize: '.95rem', marginBottom: 8 }}>Documentos</h3>
                    <div className="stack" style={{ gap: 8 }}>{m.documents.map((d) => <a key={d.id} href={`#/docs/${encodeURIComponent(d.id)}`} className="chip"><Icon name="doc" size={14} /> {d.title}</a>)}</div></section>
                )}
                <section><h3 style={{ fontSize: '.95rem', marginBottom: 8 }}>Procedencia</h3><ProvenanceList notes={m.provenance} /></section>
              </div>
            )}

            {tab === 'mensajes' && (
              <div className="stack">
                <div className="row between wrap">
                  <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={onlyMsgs} onChange={(e) => setOnlyMsgs(e.target.checked)} /> Solo mensajes entre agentes</label>
                  <span className="muted" style={{ fontSize: '.78rem' }}>Horas en tu zona ({timeZoneLabel(new Date())}) · se actualiza en vivo</span>
                </div>
                <Timeline events={msgs} live />
              </div>
            )}

            {tab === 'runs' && (
              m.runs.length === 0 ? <Empty icon="activity" title="Aún no hay runs">Cuando apruebes el plan, cada ejecución aparecerá aquí.</Empty> : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead><tr><th>Agente</th><th>Estado</th><th>Origen</th><th className="num">Duración</th><th className="num">Tokens</th></tr></thead>
                    <tbody>
                      {m.runs.map((r) => (
                        <tr key={r.id}>
                          <td><strong>{r.agentName}</strong><div className="muted" style={{ fontSize: '.76rem' }}>{r.modelLabel ?? r.adapterType ?? ''}</div></td>
                          <td><Badge info={runStatusInfo(r.status)} />{r.error && <div className="muted" style={{ fontSize: '.76rem', marginTop: 4, color: 'var(--crit)' }}>{r.error}</div>}</td>
                          <td className="muted">{r.source === 'assignment' ? 'Asignación' : r.source === 'on_demand' ? 'Bajo demanda' : r.source === 'automation' ? 'Automatización' : r.source === 'timer' ? 'Temporizador' : '—'}</td>
                          <td className="num">{formatDuration(r.durationSec)}</td>
                          <td className="num">{formatTokens(totalTokens(r.tokens))}<div className="muted" style={{ fontSize: '.72rem' }}>{formatCents(r.tokens.estimatedCents)}</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {tab === 'replay' && <ReplayPanel id={m.id} />}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={copy?.title ?? ''}
        body={copy?.body ?? ''}
        confirmLabel={copy?.confirm ?? 'Confirmar'}
        danger={Boolean(copy?.danger)}
        {...(copy?.note ? { noteLabel: 'Nota para el agente', noteRequired: copy.note === 'required' } : {})}
        busy={busy}
        onConfirm={run}
        onCancel={() => setPending(null)}
      />
    </Modal>
  );
}

export { agentStateInfo };
