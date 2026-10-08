import { useState } from 'react';
import type { RoutineSummary } from '@mc/contracts';
import { api } from '../lib/api.ts';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Loading, PageHead } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { useApp } from '../state/AppContext.tsx';
import { useResource } from '../state/hooks.ts';
import { describeCron, formatDateTime, relativeTime } from '../lib/format.ts';

export function ScheduleView() {
  const app = useApp();
  const list = useResource(() => api.schedule(), [app.live.activity]);
  const [target, setTarget] = useState<RoutineSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.runRoutineNow(target.id);
      app.toast('ok', `«${target.title}» se lanzó ahora.`);
      app.bump('missions'); app.bump('activity');
      list.reload();
      setTarget(null);
    } catch (e) {
      app.toast('crit', e instanceof Error ? e.message : 'No se pudo ejecutar la rutina.');
    } finally { setBusy(false); }
  };
  const items = list.data ?? [];
  return (
    <>
      <PageHead title="Schedule" sub="Rutinas programadas de Paperclip. Puedes ejecutarlas al instante; las del cron de Hermes son de solo lectura en este hito." />
      {list.loading && <Loading rows={4} />}
      {list.error && !list.data && <ErrorState error={list.error} onRetry={list.reload} what="las rutinas" />}
      {list.data && items.length === 0 && <Card><Empty icon="calendar" title="No hay rutinas">Pídele al agente jefe una rutina («cada mañana, un resumen de misiones pendientes») y aparecerá aquí.</Empty></Card>}
      {items.length > 0 && (
        <Card flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Rutina</th><th>Cuándo</th><th>Responsable</th><th>Estado</th><th>Próxima</th><th>Última</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.title}</strong><div className="muted" style={{ fontSize: '.76rem' }}>{r.source === 'paperclip' ? 'Paperclip' : 'Cron de Hermes · solo lectura'}</div></td>
                    <td><div>{describeCron(r.schedule)}</div><code className="muted" style={{ fontSize: '.74rem' }}>{r.schedule}</code></td>
                    <td>{r.assigneeName ?? <span className="muted">—</span>}</td>
                    <td><Badge tone={r.status === 'active' ? 'ok' : r.status === 'paused' ? 'warn' : 'muted'} icon={r.status === 'active' ? 'play' : r.status === 'paused' ? 'pause' : 'x'}>{r.status === 'active' ? 'Activa' : r.status === 'paused' ? 'En pausa' : 'Archivada'}</Badge></td>
                    <td title={formatDateTime(r.nextRunAt)}>{r.nextRunAt ? relativeTime(r.nextRunAt) : <span className="muted">—</span>}</td>
                    <td title={formatDateTime(r.lastRunAt)}>{r.lastRunAt ? relativeTime(r.lastRunAt) : <span className="muted">Nunca</span>}</td>
                    <td className="num"><Button size="sm" icon="play" disabled={!r.canRunNow} title={r.canRunNow ? undefined : 'Esta rutina no se puede ejecutar desde aquí'} onClick={() => setTarget(r)}>Ejecutar ahora</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="muted" style={{ marginTop: 16, fontSize: '.84rem' }}><Icon name="info" size={13} /> Eliminar rutinas aún no está en el contrato del BFF; por ahora se pausan o archivan desde Paperclip.</p>
      <ConfirmDialog open={target !== null} title="Ejecutar la rutina ahora" body={<>Se lanzará <strong>{target?.title}</strong> de inmediato, fuera de su horario. Puede consumir tokens.</>} confirmLabel="Ejecutar ahora" busy={busy} onConfirm={run} onCancel={() => setTarget(null)} />
    </>
  );
}
