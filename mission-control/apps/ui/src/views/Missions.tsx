import { Fragment, useMemo, useState } from 'react';
import type { MissionStatus, MissionSummary, Priority } from '@mc/contracts';
import { api } from '../lib/api.ts';
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHead, Segmented } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { StackedColumns } from '../components/charts.tsx';
import { SystemCue } from '../components/System.tsx';
import { MissionDrawer } from '../components/MissionDrawer.tsx';
import { useApp } from '../state/AppContext.tsx';
import { go, useDebounced, useResource } from '../state/hooks.ts';
import type { Route } from '../lib/router.ts';
import { formatDuration, formatTokens, relativeTime, totalTokens, plural } from '../lib/format.ts';
import { KANBAN_COLUMNS, comparePriority, missionStatusInfo, priorityInfo, scopeLabel } from '../lib/status.ts';

function MissionCard({ m }: { m: MissionSummary }) {
  const pr = priorityInfo(m.priority);
  const prog = m.childCount > 0 ? Math.round((m.childDoneCount / m.childCount) * 100) : null;
  return (
    <button type="button" className={`kcard${m.approvalPending ? ' pending' : ''}`} onClick={() => go('misiones', m.id)} aria-label={`${m.title}, ${m.identifier}, ${missionStatusInfo(m.status).label}${m.approvalPending ? ', espera aprobación' : ''}`}>
      <span className="row between" style={{ gap: 8 }}>
        <span className="mono muted" style={{ fontSize: '.74rem' }}>{m.identifier}</span>
        <Badge info={pr} />
      </span>
      <span className="title">{m.title}</span>
      {m.approvalPending && <Badge tone="warn" icon="clock">Aprobar plan</Badge>}
      {m.status === 'ongoing' && <span className={`progress${prog === null ? ' indet' : ''}`} aria-hidden="true"><i style={prog !== null ? { width: `${prog}%` } : undefined} /></span>}
      <span className="meta">
        {m.assigneeName && <span className="row" style={{ gap: 4 }}><Icon name="user" size={12} />{m.assigneeName}</span>}
        {m.durationSec > 0 && <span className="row" style={{ gap: 4 }}><Icon name="clock" size={12} />{formatDuration(m.durationSec)}</span>}
        {m.retryCount > 0 && <span className="row" style={{ gap: 4, color: 'var(--warn)' }}><Icon name="refresh" size={12} />{m.retryCount}</span>}
        {m.childCount > 0 && <span>{m.childDoneCount}/{m.childCount} pasos</span>}
        <span>{scopeLabel(m.scope)}</span>
      </span>
    </button>
  );
}

function LogRow({ m }: { m: MissionSummary }) {
  const [open, setOpen] = useState(false);
  const st = missionStatusInfo(m.status);
  return (
    <Fragment>
      <tr>
        <td><button type="button" className="expander" aria-expanded={open} aria-label={open ? `Ocultar detalle de ${m.identifier}` : `Ver detalle de ${m.identifier}`} onClick={() => setOpen((o) => !o)}><Icon name="chevron-right" size={16} /></button></td>
        <td className="mono muted">{m.identifier}</td>
        <td><button type="button" className="btn ghost sm" style={{ height: 'auto', padding: '2px 4px', fontWeight: 600, textAlign: 'left', whiteSpace: 'normal' }} onClick={() => go('misiones', m.id)}>{m.title}</button></td>
        <td><Badge info={st} /></td>
        <td>{m.assigneeName ?? <span className="muted">—</span>}</td>
        <td className="num">{formatDuration(m.durationSec)}</td>
        <td className="num">{formatTokens(totalTokens(m.tokens))}</td>
        <td className="muted">{relativeTime(m.createdAt)}</td>
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={8}>
            <div className="row wrap" style={{ gap: 24, alignItems: 'flex-start' }}>
              <dl className="kv grow" style={{ minWidth: 260 }}>
                <dt>Prioridad</dt><dd>{priorityInfo(m.priority).label}</dd>
                <dt>Ámbito</dt><dd>{scopeLabel(m.scope)}</dd>
                <dt>Equipo</dt><dd>{m.machineId ?? '—'}</dd>
                <dt>Modelo</dt><dd>{m.modelLabel ?? '—'}</dd>
                <dt>Reintentos</dt><dd>{m.retryCount}</dd>
                <dt>Progreso</dt><dd>{m.childCount ? `${m.childDoneCount} de ${m.childCount} pasos` : 'Sin subtareas'}</dd>
              </dl>
              <div className="row" style={{ gap: 8 }}>
                <Button size="sm" variant="primary" icon="arrow-right" onClick={() => go('misiones', m.id)}>Abrir misión</Button>
                <Button size="sm" icon="history" onClick={() => go('misiones', m.id, { tab: 'replay' })}>Replay</Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function MissionsView({ route }: { route: Route }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [scope, setScope] = useState<'all' | 'trabajo' | 'proyectos' | 'personal'>('all');
  const [prio, setPrio] = useState<'all' | Priority>('all');
  const [onlyPending, setOnlyPending] = useState(route.query.filter === 'aprobacion');
  const [days, setDays] = useState<'7' | '14' | '30'>('14');
  const list = useResource(() => api.missions({ ...(dq ? { q: dq } : {}), ...(scope !== 'all' ? { scope } : {}), limit: 200 }), [dq, scope, app.live.missions]);
  const ov = useResource(() => api.overview(Number(days)), [days, app.live.missions]);
  const items = useMemo(() => {
    let r = list.data?.items ?? [];
    if (prio !== 'all') r = r.filter((m) => m.priority === prio);
    if (onlyPending) r = r.filter((m) => m.approvalPending);
    return r;
  }, [list.data, prio, onlyPending]);

  const byCol = (s: MissionStatus) => items.filter((m) => m.status === s).sort((a, b) => comparePriority(a.priority, b.priority) || b.createdAt.localeCompare(a.createdAt));
  const others = items.filter((m) => m.status === 'blocked' || m.status === 'cancelled');
  const pendingCount = (list.data?.items ?? []).filter((m) => m.approvalPending).length;
  const totalDur = (list.data?.items ?? []).reduce((a, m) => a + m.durationSec, 0);
  const active = app.agents.data?.filter((a) => a.state === 'working').length ?? 0;
  const totalAgents = app.agents.data?.length ?? 0;
  const log = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <PageHead
        title="Misiones"
        sub="Lanza trabajo, aprueba planes, sigue a los agentes en vivo y acepta resultados."
        actions={<Button variant="primary" icon="plus" onClick={() => app.openWizard()}>Nueva misión</Button>}
      />

      <div className="grid c4" style={{ marginBottom: 16 }}>
        <Card tight><div className="stat"><span className="v" style={{ color: pendingCount ? 'var(--accent)' : undefined }}>{pendingCount}</span><span className="l"><Icon name="clock" size={13} /> Esperan tu aprobación</span></div></Card>
        <Card tight><div className="stat"><span className="v">{formatDuration(totalDur)}</span><span className="l"><Icon name="activity" size={13} /> Tiempo total de agentes</span></div></Card>
        <Card tight><div className="stat"><span className="v">{active}<span className="muted" style={{ fontSize: '1rem' }}> / {totalAgents}</span></span><span className="l"><Icon name="user" size={13} /> Agentes con misión activa</span></div></Card>
        <Card tight><div className="stat"><span className="v">{(list.data?.items ?? []).filter((m) => m.status === 'ongoing').length}</span><span className="l"><Icon name="target" size={13} /> Misiones en curso</span></div></Card>
      </div>

      <Card className="" title="Distribución de tareas en el tiempo" sub="Runs por día en la ventana elegida" right={<Segmented<'7' | '14' | '30'> label="Ventana" value={days} onChange={setDays} options={[{ value: '7', label: '7 d' }, { value: '14', label: '14 d' }, { value: '30', label: '30 d' }]} />}>
        {ov.loading ? <Loading rows={2} /> : ov.error && !ov.data ? <ErrorState error={ov.error} onRetry={ov.reload} what="la actividad" /> : ov.data ? (
          <StackedColumns yLabel="runs" ariaLabel={`Runs por día en ${days} días`} height={170}
            series={[{ key: 'succeeded', name: 'Éxito', color: 'var(--accent)' }, { key: 'failed', name: 'Fallo', color: 'var(--crit)', texture: true }, { key: 'other', name: 'Otros', color: 'var(--text-3)' }]}
            data={ov.data.runActivity.map((d) => ({ label: d.date.slice(8) + '/' + d.date.slice(5, 7), tipLabel: d.date, values: { succeeded: d.succeeded, failed: d.failed, other: d.other } }))} />
        ) : null}
      </Card>

      <div className="row wrap" style={{ margin: '24px 0 16px', gap: 12 }} role="search" aria-label="Filtros de misiones">
        <div className="search" style={{ maxWidth: 320 }}>
          <Icon name="search" size={16} style={{ top: 12 }} />
          <input className="search-input" style={{ paddingRight: 12 }} placeholder="Filtrar por título, id o agente" aria-label="Filtrar misiones" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented<typeof scope> label="Ámbito" value={scope} onChange={setScope} options={[{ value: 'all', label: 'Todo' }, { value: 'trabajo', label: 'Trabajo' }, { value: 'proyectos', label: 'Proyectos' }, { value: 'personal', label: 'Personal' }]} />
        <select className="select" style={{ width: 170 }} aria-label="Prioridad" value={prio} onChange={(e) => setPrio(e.target.value as typeof prio)}>
          <option value="all">Toda prioridad</option>
          {(['critical', 'high', 'medium', 'low'] as Priority[]).map((p) => <option key={p} value={p}>{priorityInfo(p).label}</option>)}
        </select>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Solo con plan pendiente</label>
      </div>

      {list.loading && <Loading rows={4} label="Cargando misiones…" />}
      {list.error && !list.data && <ErrorState error={list.error} onRetry={list.reload} what="las misiones" />}
      {list.data && (
        <div className={list.reloading ? 'reloading' : undefined}>
          {list.data.items.length === 0 ? (
            <Card><Empty icon="target" title="Aún no hay misiones" action={<Button variant="primary" icon="plus" onClick={() => app.openWizard()}>Lanzar la primera</Button>}>Define un objetivo y el equipo se encarga: tú apruebas el plan y aceptas el resultado.</Empty></Card>
          ) : (
            <>
              <div className="kanban" aria-label="Tablero de misiones">
                {KANBAN_COLUMNS.map((s) => {
                  const st = missionStatusInfo(s);
                  const col = byCol(s);
                  return (
                    <section key={s} className="kcol" aria-label={`${st.label}, ${col.length}`}>
                      <div className="kcol-head"><Icon name={st.icon} size={16} style={{ color: `var(--tone-${st.tone})` }} />{st.label}<span className="count">{col.length}</span></div>
                      {col.length === 0 && <p className="muted" style={{ fontSize: '.84rem', padding: '8px 6px' }}>{s === 'briefing' ? 'Sin planes por aprobar.' : s === 'ongoing' ? 'Nada en ejecución.' : s === 'review' ? 'Nada espera tu revisión.' : 'Aún no hay entregas.'}</p>}
                      {col.map((m) => <MissionCard key={m.id} m={m} />)}
                    </section>
                  );
                })}
              </div>
              {others.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary className="muted" style={{ cursor: 'pointer' }}>Bloqueadas y canceladas ({others.length})</summary>
                  <div className="grid auto" style={{ marginTop: 12 }}>{others.map((m) => <MissionCard key={m.id} m={m} />)}</div>
                </details>
              )}
              {items.length === 0 && <p className="muted" style={{ marginTop: 12 }}>Ninguna misión coincide con los filtros.</p>}

              <Card className="" title="Registro de misiones" sub={`${log.length} ${plural(log.length, 'misión', 'misiones')} · despliega una fila para ver el detalle o reproducirla`} flush>
                <div className="tbl-wrap" style={{ padding: '0 8px 8px' }}>
                  <table className="tbl">
                    <thead><tr><th style={{ width: 40 }}><span className="sr-only">Detalle</span></th><th>Id</th><th>Misión</th><th>Estado</th><th>Responsable</th><th className="num">Duración</th><th className="num">Tokens</th><th>Creada</th></tr></thead>
                    <tbody>{log.map((m) => <LogRow key={m.id} m={m} />)}</tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: 24 }}><SystemCue /></div>
      {route.id && <MissionDrawer id={route.id} tab={route.query.tab} />}
    </>
  );
}
