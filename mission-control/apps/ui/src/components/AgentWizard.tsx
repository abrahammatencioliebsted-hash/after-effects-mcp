import { useEffect, useState } from 'react';
import type { AgentCreateRequest, Platform } from '@mc/contracts';
import { Button, ErrorState, Field, Loading, Modal } from './ui.tsx';
import { Icon } from './Icon.tsx';
import { api } from '../lib/api.ts';
import { ROLE_PRESETS, suggestShortName } from '../lib/roles.ts';
import type { RolePreset } from '../lib/roles.ts';
import { platformLabel } from '../lib/status.ts';
import { useApp } from '../state/AppContext.tsx';
import { go, useResource } from '../state/hooks.ts';

const STEPS = ['Rol', 'Resumen', 'Confirmar y desplegar'];
const PLATFORMS: Platform[] = ['hermes', 'claude', 'codex', 'grok', 'mimo'];

export function AgentWizard() {
  const app = useApp();
  const open = app.agentWizardOpen;
  const machines = useResource(() => api.machines(), [], open);
  const [step, setStep] = useState(0);
  const [preset, setPreset] = useState<RolePreset | null>(null);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [role, setRole] = useState('');
  const [platform, setPlatform] = useState<Platform>('hermes');
  const [machineId, setMachineId] = useState('');
  const [model, setModel] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0); setPreset(null); setName(''); setShortName(''); setRole(''); setPlatform('hermes'); setModel(app.agents.data?.[0]?.modelLabel ?? ''); setInstructions(''); setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { if (open && !machineId && machines.data?.[0]) setMachineId(machines.data[0].id); }, [open, machineId, machines.data]);

  const pick = (p: RolePreset) => {
    setPreset(p); setName(p.id === 'custom' ? '' : p.name); setShortName(p.shortName); setRole(p.role); setPlatform(p.platform); setInstructions(p.instructions);
  };
  const close = () => app.setAgentWizardOpen(false);
  const valid = name.trim().length >= 2 && role.trim().length >= 2 && Boolean(machineId);

  const deploy = async () => {
    setBusy(true); setError(null);
    const boss = app.agents.data?.find((a) => a.isBoss);
    const body: AgentCreateRequest = {
      name: name.trim(), shortName: shortName.trim() || suggestShortName(name), role: role.trim(), platform, machineId,
      ...(model.trim() ? { modelLabel: model.trim() } : {}),
      ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      ...(boss ? { reportsTo: boss.id } : {}),
    };
    try {
      const a = await api.createAgent(body);
      app.toast('ok', `${a.name} desplegado: ya aparece en la ciudad y puede recibir misiones.`);
      app.agents.reload();
      close();
      go('agentes', a.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el agente.');
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={close} wide icon="user" title="Añadir agente"
      footer={<>
        {step > 0 && <Button variant="ghost" icon="chevron-left" onClick={() => setStep(step - 1)} disabled={busy}>Atrás</Button>}
        <span className="grow" />
        <Button variant="ghost" onClick={close} disabled={busy}>Cancelar</Button>
        {step === 0 && <Button variant="primary" disabled={!preset} onClick={() => setStep(1)}>Continuar</Button>}
        {step === 1 && <Button variant="primary" disabled={!valid} onClick={() => setStep(2)}>Continuar</Button>}
        {step === 2 && <Button variant="primary" icon="rocket" loading={busy} onClick={deploy}>Confirmar y desplegar</Button>}
      </>}>
      <ol className="wizard-steps" style={{ listStyle: 'none', padding: 0, margin: '0 0 24px' }} aria-label="Pasos">
        {STEPS.map((s, i) => <li key={s} className={`wstep ${i === step ? 'on' : i < step ? 'done' : ''}`} aria-current={i === step ? 'step' : undefined}><span className="n">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>{s}</li>)}
      </ol>
      {step === 0 && (
        <div className="pick-grid" role="radiogroup" aria-label="Rol del agente" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
          {ROLE_PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={preset?.id === p.id} className="choice" onClick={() => pick(p)}>
              <Icon name={p.icon} size={20} className="ico" /><span><strong>{p.name}</strong><small>{p.role || 'Define tu propio rol'}</small></span>
            </button>
          ))}
        </div>
      )}
      {step === 1 && (
        <div className="form-grid">
          <Field label="Nombre">{(id) => <input id={id} className="input" value={name} onChange={(e) => { setName(e.target.value); if (!shortName) setShortName(suggestShortName(e.target.value)); }} autoFocus />}</Field>
          <Field label="Nombre corto" hint="Etiqueta de su torre en la ciudad.">{(id) => <input id={id} className="input" value={shortName} maxLength={14} onChange={(e) => setShortName(e.target.value)} />}</Field>
          <Field label="Rol" full>{(id) => <input id={id} className="input" value={role} onChange={(e) => setRole(e.target.value)} />}</Field>
          <Field label="Plataforma ejecutora">{(id) => <select id={id} className="select" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>{PLATFORMS.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}</select>}</Field>
          {machines.loading ? <div className="field"><span className="lbl">Equipo</span><Loading rows={1} label="Cargando los equipos…" /></div>
            : machines.error && !machines.data ? <div className="field full"><span className="lbl">Equipo</span><ErrorState error={machines.error} onRetry={machines.reload} what="los equipos" /></div>
            : <Field label="Equipo" hint={machines.data?.length === 0 ? 'No hay equipos registrados: instala node-agent en uno para poder desplegar agentes.' : undefined}>{(id) => <select id={id} className="select" value={machineId} onChange={(e) => setMachineId(e.target.value)}>{(machines.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}</Field>}
          <Field label="Modelo" hint="Por defecto, el mismo que los demás agentes.">{(id) => <input id={id} className="input" value={model} onChange={(e) => setModel(e.target.value)} list="models-dl" />}</Field>
          <datalist id="models-dl">{(app.settings.data?.modelPrices ?? []).map((m) => <option key={m.modelLabel} value={m.modelLabel} />)}</datalist>
          <Field label="Instrucciones estables" full>{(id) => <textarea id={id} className="textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} />}</Field>
        </div>
      )}
      {step === 2 && (
        <div className="stack">
          <div className="card tight" style={{ background: 'var(--panel-2)' }}>
            <h3>{name}</h3>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Nombre corto</dt><dd>{shortName || suggestShortName(name)}</dd><dt>Rol</dt><dd>{role}</dd>
              <dt>Plataforma</dt><dd>{platformLabel(platform)}</dd>
              <dt>Equipo</dt><dd>{machines.data?.find((m) => m.id === machineId)?.name ?? machineId}</dd>
              <dt>Modelo</dt><dd>{model || 'por defecto'}</dd>
            </dl>
          </div>
          <p className="muted" style={{ fontSize: '.86rem' }}>Se crea en Paperclip y aparece como una torre nueva. Quedará disponible para misiones al instante. Retirarlo es igual de rápido (se pausa y archiva, el historial se conserva).</p>
          {error && <div className="state-error" role="alert"><Icon name="alert" size={20} /><div>{error}</div></div>}
        </div>
      )}
    </Modal>
  );
}
