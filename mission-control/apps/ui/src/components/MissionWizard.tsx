import { useEffect, useMemo, useRef, useState } from 'react';
import type { FinishPolicy, MissionCreateRequest, Priority, ReportLength, TeamMode } from '@mc/contracts';
import { BLANK, validateStep } from '../lib/wizard.ts';
import type { Draft } from '../lib/wizard.ts';
import { Button, Field, Modal, Segmented } from './ui.tsx';
import { Icon } from './Icon.tsx';
import { api } from '../lib/api.ts';
import { localInputToIso, plural } from '../lib/format.ts';
import { priorityInfo, platformLabel, agentStateInfo } from '../lib/status.ts';
import { useApp } from '../state/AppContext.tsx';
import { go, useResource } from '../state/hooks.ts';

const STEPS = ['Misión', 'Equipo', 'Límites', 'Revisar y lanzar'] as const;

export function MissionWizard() {
  const app = useApp();
  const { wizard } = app;
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const idemKey = useRef<string>('');
  const catalog = useResource(() => api.catalog(), [], wizard.open && d.teamMode === 'rules');

  useEffect(() => {
    if (!wizard.open) return;
    idemKey.current = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
    setStep(0);
    setErrors({});
    setSubmitError(null);
    setD({
      ...BLANK,
      title: wizard.prefill?.title ?? '',
      objective: wizard.prefill?.objective ?? '',
      bossAgentId: app.settings.data?.bossAgentId ?? app.agents.data?.find((a) => a.isBoss)?.id ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.open]);

  const agents = app.agents.data ?? [];
  const boss = agents.find((a) => a.id === d.bossAgentId);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const next = () => {
    const e = validateStep(step, d);
    setErrors(e);
    if (Object.keys(e).length === 0) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = async () => {
    for (let s = 0; s < 3; s++) {
      const e = validateStep(s, d);
      if (Object.keys(e).length) { setErrors(e); setStep(s); return; }
    }
    setBusy(true);
    setSubmitError(null);
    const target = localInputToIso(d.targetDate);
    const body: MissionCreateRequest = {
      title: d.title.trim(),
      objective: d.objective.trim(),
      priority: d.priority,
      ...(target ? { targetDate: target } : {}),
      team: { mode: d.teamMode, agentIds: d.teamMode === 'manual' ? d.agentIds : [], ...(d.teamMode === 'boss' ? { bossAgentId: d.bossAgentId } : {}) },
      limits: { maxMinutes: d.maxMinutes, maxSteps: d.maxSteps, reportLength: d.reportLength },
      finish: d.finish,
      ...(d.capabilities.length ? { requiredCapabilities: d.capabilities } : {}),
      scope: d.scope,
      ...(wizard.prefill?.ideaId ? { ideaId: wizard.prefill.ideaId } : {}),
    };
    try {
      const created = await api.createMission(body, idemKey.current);
      app.toast('ok', `Misión ${created.identifier} creada${created.approvalPending ? ': espera tu aprobación del plan' : ''}.`);
      app.closeWizard();
      go('misiones', created.id);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'No se pudo crear la misión.');
    } finally {
      setBusy(false);
    }
  };

  const summary = useMemo(() => {
    const names = d.agentIds.map((id) => agents.find((a) => a.id === id)?.name ?? id);
    return names;
  }, [d.agentIds, agents]);

  return (
    <Modal
      open={wizard.open}
      onClose={app.closeWizard}
      wide
      icon="rocket"
      title={wizard.prefill?.ideaId ? `Nueva misión · desde la idea ${wizard.prefill.ideaId}` : 'Nueva misión'}
      footer={
        <>
          {step > 0 && <Button variant="ghost" icon="chevron-left" onClick={() => setStep((s) => s - 1)} disabled={busy}>Atrás</Button>}
          <span className="grow" />
          <Button variant="ghost" onClick={app.closeWizard} disabled={busy}>Cancelar</Button>
          {step < STEPS.length - 1 ? <Button variant="primary" onClick={next}>Continuar</Button> : <Button variant="primary" icon="rocket" loading={busy} onClick={submit}>Lanzar misión</Button>}
        </>
      }
    >
      <ol className="wizard-steps" aria-label="Pasos del asistente" style={{ listStyle: 'none', padding: 0, margin: '0 0 24px' }}>
        {STEPS.map((s, i) => (
          <li key={s} className={`wstep ${i === step ? 'on' : i < step ? 'done' : ''}`} aria-current={i === step ? 'step' : undefined}>
            <span className="n">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>{s}
          </li>
        ))}
      </ol>

      {wizard.prefill?.ideaId && (
        <div className="banner info" style={{ margin: '0 0 16px', borderRadius: 12, border: '1px solid var(--accent-line)' }}>
          <Icon name="bulb" size={18} /><span>Pre-llenada desde la idea <b>{wizard.prefill.ideaId}</b> del Registro de elecciones. Revisa todo: nada se crea hasta que pulses «Lanzar misión».</span>
        </div>
      )}

      {step === 0 && (
        <div className="form-grid">
          <Field label="Título" error={errors.title} full>
            {(id) => <input id={id} className="input" value={d.title} onChange={(e) => set('title', e.target.value)} aria-invalid={Boolean(errors.title)} placeholder="Ej.: Frustraciones al trabajar con varios agentes" autoFocus />}
          </Field>
          <Field label="Objetivo" error={errors.objective} hint="Qué debe entregar el equipo y cómo sabrás que está bien." full>
            {(id) => <textarea id={id} className="textarea" value={d.objective} onChange={(e) => set('objective', e.target.value)} aria-invalid={Boolean(errors.objective)} />}
          </Field>
          <div className="field">
            <span className="lbl">Prioridad</span>
            <Segmented<Priority> label="Prioridad" value={d.priority} onChange={(v) => set('priority', v)} options={(['low', 'medium', 'high', 'critical'] as Priority[]).map((p) => ({ value: p, label: priorityInfo(p).label }))} />
          </div>
          <Field label="Fecha objetivo (opcional)" hint="Se guarda con tu zona horaria.">
            {(id) => <input id={id} type="datetime-local" className="input" value={d.targetDate} onChange={(e) => set('targetDate', e.target.value)} />}
          </Field>
          <div className="field full">
            <span className="lbl">Ámbito</span>
            <Segmented<Draft['scope']> label="Ámbito" value={d.scope} onChange={(v) => set('scope', v)} options={[{ value: 'trabajo', label: 'Trabajo' }, { value: 'proyectos', label: 'Proyectos' }, { value: 'personal', label: 'Personal' }]} />
            <span className="hint">Trabajo, proyectos y personal nunca se mezclan en una misma misión.</span>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="stack" style={{ gap: 16 }}>
          <div role="radiogroup" aria-label="Cómo se arma el equipo" className="grid c3">
            {([
              ['boss', 'El jefe elige', 'El agente jefe propone qué especialistas necesita y tú apruebas el plan.', 'sparkle'],
              ['manual', 'Equipo manual', 'Eliges tú qué agentes trabajan la misión.', 'users'],
              ['rules', 'Por reglas del catálogo', 'Capacidades requeridas → ejecutores compatibles → equipo con menos carga.', 'layers'],
            ] as Array<[TeamMode, string, string, string]>).map(([mode, label, hint, icon]) => (
              <button key={mode} type="button" role="radio" aria-checked={d.teamMode === mode} className="choice" onClick={() => set('teamMode', mode)}>
                <Icon name={icon} size={20} className="ico" /><span><strong>{label}</strong><small>{hint}</small></span>
              </button>
            ))}
          </div>
          {errors.team && <div className="err" role="alert" style={{ color: 'var(--crit)' }}>{errors.team}</div>}
          {d.teamMode === 'boss' && (
            <Field label="Agente jefe" hint="Debe tener un modelo con herramientas.">
              {(id) => (
                <select id={id} className="select" value={d.bossAgentId} onChange={(e) => set('bossAgentId', e.target.value)}>
                  <option value="">— elegir —</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isBoss ? ' (jefe)' : ''} · {platformLabel(a.platform)}</option>)}
                </select>
              )}
            </Field>
          )}
          {d.teamMode === 'manual' && (
            <div className="pick-grid" role="group" aria-label="Agentes del equipo">
              {agents.map((a) => (
                <label key={a.id} className="pick">
                  <input type="checkbox" checked={d.agentIds.includes(a.id)} onChange={(e) => set('agentIds', e.target.checked ? [...d.agentIds, a.id] : d.agentIds.filter((x) => x !== a.id))} />
                  <span><strong>{a.name}</strong><span className="muted" style={{ display: 'block', fontSize: '.78rem' }}>{agentStateInfo(a.state).label} · {a.shortName}</span></span>
                </label>
              ))}
              {agents.length === 0 && <span className="muted">No hay agentes cargados.</span>}
            </div>
          )}
          {d.teamMode === 'rules' && (
            <div className="field">
              <span className="lbl">Capacidades requeridas</span>
              {catalog.loading ? <span className="muted">Cargando catálogo…</span> : (
                <div className="pick-grid" role="group" aria-label="Capacidades requeridas">
                  {(catalog.data ?? []).map((c) => (
                    <label key={c.id} className="pick">
                      <input type="checkbox" checked={d.capabilities.includes(c.id)} onChange={(e) => set('capabilities', e.target.checked ? [...d.capabilities, c.id] : d.capabilities.filter((x) => x !== c.id))} />
                      <span><strong>{c.nombre}</strong><span className="muted" style={{ display: 'block', fontSize: '.78rem' }}>{c.tipo}</span></span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="form-grid">
          <div className="field">
            <span className="lbl">Tope de tiempo</span>
            <Segmented<string> label="Tope de tiempo" value={String(d.maxMinutes)} onChange={(v) => set('maxMinutes', Number(v))} options={[{ value: '30', label: '30 min' }, { value: '60', label: '1 h' }, { value: '120', label: '2 h' }, { value: '240', label: '4 h' }]} />
          </div>
          <Field label="Minutos (exacto)" error={errors.maxMinutes}>
            {(id) => <input id={id} type="number" min={5} max={720} className="input" value={d.maxMinutes} onChange={(e) => set('maxMinutes', Number(e.target.value))} aria-invalid={Boolean(errors.maxMinutes)} />}
          </Field>
          <Field label="Pasos máximos del plan" error={errors.maxSteps} hint="Más pasos = más tokens.">
            {(id) => <input id={id} type="number" min={1} max={12} className="input" value={d.maxSteps} onChange={(e) => set('maxSteps', Number(e.target.value))} aria-invalid={Boolean(errors.maxSteps)} />}
          </Field>
          <div className="field">
            <span className="lbl">Longitud del informe</span>
            <Segmented<ReportLength> label="Longitud del informe" value={d.reportLength} onChange={(v) => set('reportLength', v)} options={[{ value: 'short', label: 'Corto' }, { value: 'medium', label: 'Medio' }, { value: 'long', label: 'Largo' }]} />
          </div>
          <div className="field full">
            <span className="lbl">Al terminar el equipo…</span>
            <div role="radiogroup" aria-label="Al terminar" className="grid c2">
              <button type="button" role="radio" aria-checked={d.finish === 'review_first'} className="choice" onClick={() => set('finish', 'review_first')}><Icon name="eye" size={20} className="ico" /><span><strong>Mandarme los resultados a revisión</strong><small>Nada se cierra sin tu aceptación (recomendado).</small></span></button>
              <button type="button" role="radio" aria-checked={d.finish === 'deliver'} className="choice" onClick={() => set('finish', 'deliver')}><Icon name="check" size={20} className="ico" /><span><strong>Marcar como entregada directamente</strong><small>El resultado pasa a Docs sin revisión humana.</small></span></button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="stack" style={{ gap: 16 }}>
          <div className="card tight" style={{ background: 'var(--panel-2)' }}>
            <div className="eyebrow">Resumen</div>
            <h3 style={{ margin: '4px 0 8px' }}>{d.title}</h3>
            <p className="t2" style={{ whiteSpace: 'pre-wrap' }}>{d.objective}</p>
            <dl className="kv" style={{ marginTop: 16 }}>
              <dt>Prioridad</dt><dd>{priorityInfo(d.priority).label}</dd>
              <dt>Ámbito</dt><dd style={{ textTransform: 'capitalize' }}>{d.scope}</dd>
              <dt>Fecha objetivo</dt><dd>{d.targetDate ? new Date(d.targetDate).toLocaleString('es') : 'Sin fecha'}</dd>
              <dt>Equipo</dt>
              <dd>{d.teamMode === 'boss' ? `El jefe elige (${boss?.name ?? 'sin jefe'})` : d.teamMode === 'manual' ? `Manual: ${summary.join(', ')}` : `Por reglas (${d.capabilities.length} ${plural(d.capabilities.length, 'capacidad', 'capacidades')})`}</dd>
              <dt>Límites</dt><dd>{d.maxMinutes} min · {d.maxSteps} {plural(d.maxSteps, 'paso', 'pasos')} · informe {d.reportLength === 'short' ? 'corto' : d.reportLength === 'long' ? 'largo' : 'medio'}</dd>
              <dt>Al terminar</dt><dd>{d.finish === 'review_first' ? 'Revisión humana antes de entregar' : 'Entrega directa'}</dd>
            </dl>
          </div>
          <p className="muted" style={{ fontSize: '.86rem' }}>Se creará la misión en Briefing con un plan propuesto. No empieza a trabajar hasta que apruebes el plan.</p>
          {submitError && <div className="state-error" role="alert"><Icon name="alert" size={20} /><div>{submitError}</div></div>}
        </div>
      )}
    </Modal>
  );
}
