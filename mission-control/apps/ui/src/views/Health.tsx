import { useState } from 'react';
import type { AllowedCommand, MachineSummary } from '@mc/contracts';
import { api, ApiRequestError } from '../lib/api.ts';
import type { CommandResult } from '../lib/api.ts';
import { MeterRow } from '../components/charts.tsx';
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, KV, Loading, Modal, PageHead, ProvenanceList } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { useApp } from '../state/AppContext.tsx';
import { useResource } from '../state/hooks.ts';
import { DEFAULT_THRESHOLDS, machineMetrics, worstSeverity } from '../lib/metrics.ts';
import { machineStatusInfo, SEVERITY_TEXT, severityTone } from '../lib/status.ts';
import { formatDateTime, formatUptime, relativeTime } from '../lib/format.ts';

function Commands({ machine }: { machine: MachineSummary }) {
  const app = useApp();
  const cmds = useResource(() => api.commands(machine.id), [machine.id]);
  const [pending, setPending] = useState<AllowedCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ cmd: AllowedCommand; res: CommandResult } | null>(null);
  const [simulated, setSimulated] = useState<{ cmd: AllowedCommand; message: string } | null>(null);
  const disabled = machine.status === 'offline' || machine.status === 'unknown';
  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await api.runCommand(machine.id, pending.id);
      setResult({ cmd: pending, res });
      setPending(null);
    } catch (e) {
      // 501 simulated_only: el BFF no tiene configurado el node-agent de ese equipo. No es una avería: se muestra el mensaje tal cual.
      if (e instanceof ApiRequestError && e.code === 'simulated_only') {
        setPending(null);
        setSimulated({ cmd: pending, message: e.message });
      } else {
        app.toast('crit', e instanceof Error ? e.message : 'El comando falló.');
      }
    } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <h3 style={{ fontSize: '.95rem' }}>Comandos permitidos</h3>
      {cmds.loading && <Loading rows={2} />}
      {cmds.error && !cmds.data && <ErrorState error={cmds.error} onRetry={cmds.reload} what="los comandos" />}
      {cmds.data && cmds.data.length === 0 && <p className="muted" style={{ fontSize: '.88rem' }}>Este equipo no declara comandos permitidos.</p>}
      <div className="stack" style={{ gap: 8 }}>
        {(cmds.data ?? []).map((c) => (
          <div key={c.id} className="row between" style={{ padding: '8px 12px', background: 'var(--panel-2)', borderRadius: 10, gap: 12 }}>
            <div className="grow"><strong style={{ fontSize: '.9rem' }}>{c.label}</strong><div className="muted" style={{ fontSize: '.78rem' }}>{c.description}</div></div>
            <Button size="sm" icon="terminal" disabled={disabled} title={disabled ? 'El equipo no está conectado' : undefined} onClick={() => setPending(c)}>Ejecutar</Button>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: '.76rem' }}><Icon name="lock" size={12} /> Solo comandos de la lista permitida, con argumentos fijos y confirmación. No hay terminal libre.</p>
      <ConfirmDialog open={pending !== null} danger={Boolean(pending?.id.includes('restart'))} title={`Ejecutar «${pending?.label ?? ''}»`}
        body={<><p>Se ejecutará en <strong>{machine.name}</strong> (tiempo máximo {pending?.timeoutSec} s):</p><pre className="cmd-out" style={{ marginTop: 8 }}>{pending?.argv.join(' ')}</pre><p style={{ marginTop: 8 }}>{pending?.description}</p></>}
        confirmLabel="Confirmar y ejecutar" busy={busy} onConfirm={run} onCancel={() => setPending(null)} />
      <Modal open={simulated !== null} onClose={() => setSimulated(null)} icon="flask" title={`No se ejecutó · ${simulated?.cmd.label ?? ''}`} footer={<Button variant="primary" onClick={() => setSimulated(null)}>Entendido</Button>}>
        <div className="stack">
          <Badge tone="warn" icon="flask">Solo simulado</Badge>
          <p>{simulated?.message}</p>
          <p className="muted" style={{ fontSize: '.86rem' }}>No es una avería: el BFF aún no tiene configurado el node-agent de este equipo, así que no hay dónde ejecutar el comando.</p>
        </div>
      </Modal>
      <Modal open={result !== null} onClose={() => setResult(null)} icon="terminal" title={`Resultado · ${result?.cmd.label ?? ''}`} footer={<Button variant="primary" onClick={() => setResult(null)}>Cerrar</Button>}>
        {result && (
          <div className="stack">
            <div className="row wrap" style={{ gap: 8 }}><Badge tone={result.res.ok ? 'ok' : 'crit'} icon={result.res.ok ? 'check' : 'alert'}>{result.res.ok ? 'Correcto' : 'Con error'}</Badge><Badge plain>código {result.res.exitCode}</Badge><Badge plain icon="clock">{result.res.durationMs} ms</Badge></div>
            <div><div className="eyebrow">stdout</div><pre className="cmd-out">{result.res.stdout || '(vacío)'}</pre></div>
            {result.res.stderr && <div><div className="eyebrow">stderr</div><pre className="cmd-out">{result.res.stderr}</pre></div>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function MachineCard({ m, open, onToggle }: { m: MachineSummary; open: boolean; onToggle: () => void }) {
  const app = useApp();
  const thresholds = app.settings.data?.healthThresholds ?? DEFAULT_THRESHOLDS;
  const metrics = machineMetrics(m, thresholds);
  const worst = worstSeverity(metrics);
  const st = machineStatusInfo(m.status);
  const h = m.hermes;
  return (
    <Card className="" title={<span className="row" style={{ gap: 10 }}><Icon name={m.os === 'macos' ? 'cube' : 'server'} size={18} />{m.name}</span>} sub={m.role} right={<Badge info={st} />}>
      <div className="stack" style={{ gap: 18 }}>
        {m.health ? metrics.map((x) => <MeterRow key={x.key} name={x.name} percent={x.percent} severity={x.severity} {...(x.sub ? { sub: x.sub } : {})} ariaLabel={`${x.name} de ${m.name}: ${Math.round(x.percent ?? 0)}%`} />) : <Empty icon="server" title="Sin lecturas">Este equipo no ha enviado latidos. Último contacto: {m.lastSeenAt ? relativeTime(m.lastSeenAt) : 'nunca'}.</Empty>}
        {m.health && <div className="row between muted" style={{ fontSize: '.8rem' }}><span>Estado global: <Badge tone={severityTone(worst)} icon={worst === 'ok' ? 'check' : 'alert'}>{SEVERITY_TEXT[worst]}</Badge></span><span>Activo {formatUptime(m.health.uptimeSec)}</span></div>}
        <KV items={[
          ['Sistema', m.os === 'windows' ? 'Windows' : m.os === 'macos' ? 'macOS' : 'Linux'],
          ['Último latido', m.lastSeenAt ? `${relativeTime(m.lastSeenAt)} · ${formatDateTime(m.lastSeenAt)}` : 'Nunca'],
          ['Agentes', m.agentIds.length],
          ['Trabajos pesados', `${m.activeHeavyJobs} de ${m.maxHeavyJobs}`],
        ]} />
        <div>
          <h3 style={{ fontSize: '.95rem', marginBottom: 8 }}>Hermes</h3>
          {h ? (
            <div className="row wrap" style={{ gap: 8 }}>
              <Badge tone={h.installed ? 'ok' : 'muted'} icon={h.installed ? 'check' : 'x'}>{h.installed ? `Instalado${h.version ? ` ${h.version}` : ''}` : 'No instalado'}</Badge>
              <Badge tone={h.apiServer.reachable ? 'ok' : 'crit'} icon={h.apiServer.reachable ? 'check' : 'alert'}>API {h.apiServer.reachable ? 'alcanzable' : 'sin respuesta'}</Badge>
              {h.profiles && h.profiles.length > 0 && <Badge plain>perfiles: {h.profiles.join(', ')}</Badge>}
              {h.apiServer.error && <span className="muted" style={{ fontSize: '.8rem' }}>{h.apiServer.error}</span>}
            </div>
          ) : <p className="muted" style={{ fontSize: '.88rem' }}>Sin información de Hermes.</p>}
        </div>
        <Button variant="ghost" icon={open ? 'chevron-down' : 'chevron-right'} onClick={onToggle} aria-expanded={open}>{open ? 'Ocultar comandos rápidos' : 'Comandos rápidos'}</Button>
        {open && <Commands machine={m} />}
      </div>
    </Card>
  );
}

export function HealthView() {
  const app = useApp();
  const machines = useResource(() => api.machines(), [app.live.machines]);
  const [open, setOpen] = useState<string | null>(null);
  const h = app.health.data;
  return (
    <>
      <PageHead title="Salud" sub="Equipos, Hermes y comandos rápidos. La carga de CPU, RAM y disco decide si es buen momento para trabajo pesado." />
      {machines.loading && <Loading rows={4} />}
      {machines.error && !machines.data && <ErrorState error={machines.error} onRetry={machines.reload} what="los equipos" />}
      {machines.data && machines.data.length === 0 && <Card><Empty icon="server" title="Aún no hay equipos">Instala node-agent en un equipo; su primer latido lo registrará aquí.</Empty></Card>}
      <div className={`machine-grid${machines.reloading ? ' reloading' : ''}`}>
        {(machines.data ?? []).map((m) => <MachineCard key={m.id} m={m} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} />)}
      </div>
      <div className="grid c2" style={{ marginTop: 16 }}>
        <Card title="Plano de control" sub="BFF, Paperclip y gateways de Hermes">
          {!h ? (app.health.error ? <ErrorState error={app.health.error} onRetry={app.health.reload} what="el informe de salud" /> : <Loading rows={3} />) : (
            <div className="stack">
              <KV items={[
                ['BFF', <span key="b" className="row" style={{ gap: 8 }}><Badge tone={h.bff.ok ? 'ok' : 'crit'} icon={h.bff.ok ? 'check' : 'alert'}>{h.bff.ok ? 'Sano' : 'Con problemas'}</Badge>v{h.bff.version} · modo {h.bff.mode === 'demo' ? 'demo (simulado)' : 'Paperclip'}</span>],
                ['Activo desde hace', formatUptime(h.bff.uptimeSec)],
                ['Paperclip', <span key="p" className="row wrap" style={{ gap: 8 }}><Badge tone={h.paperclip.reachable ? 'ok' : 'crit'} icon={h.paperclip.reachable ? 'check' : 'alert'}>{h.paperclip.reachable ? 'Alcanzable' : 'Sin respuesta'}</Badge><code>{h.paperclip.baseUrl}</code></span>],
                ['Versión de Paperclip', h.paperclip.version ?? '—'],
                ['Despliegue', h.paperclip.deploymentMode ?? '—'],
                ['Equipos en línea', h.machinesOnline],
                ['Catálogo', `${h.catalog.capabilities} capacidades · ${h.catalog.errors} errores · ${h.catalog.warnings} avisos`],
              ]} />
              {h.paperclip.error && <div className="state-error" role="alert"><Icon name="alert" size={18} /><div>{h.paperclip.error}</div></div>}
              <h3 style={{ fontSize: '.95rem' }}>Gateways de Hermes</h3>
              {h.hermesGateways.length === 0 ? <p className="muted">Sin gateways registrados.</p> : h.hermesGateways.map((g) => (
                <div key={g.machineId} className="row between" style={{ gap: 8 }}><span><strong>{g.machineId}</strong> <code className="muted" style={{ fontSize: '.76rem' }}>{g.baseUrl}</code></span><Badge tone={g.reachable ? 'ok' : 'crit'} icon={g.reachable ? 'check' : 'alert'}>{g.reachable ? 'Responde' : g.error ?? 'Sin respuesta'}</Badge></div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Procedencia" sub="Qué es real, qué es simulado y qué falta">
          {h ? <ProvenanceList notes={h.notes} /> : <Loading rows={3} />}
        </Card>
      </div>
    </>
  );
}
