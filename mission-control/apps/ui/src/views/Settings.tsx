import { useEffect, useRef, useState } from 'react';
import type { SharedSettings } from '@mc/contracts';
import { api } from '../lib/api.ts';
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, Loading, PageHead } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { useApp } from '../state/AppContext.tsx';
import { DEFAULT_CUSTOM, DEFAULT_SETTINGS, LAYOUTS, TEXT_SIZES, THEMES, TYPOGRAPHY, checkCustomTheme, exportLocalSettings, importLocalSettings } from '../lib/theme.ts';
import type { LayoutId, LocalSettings, SchemePref, TextSize, ThemeId, TypographyId } from '../lib/theme.ts';

function LayoutPreview({ id }: { id: LayoutId }) {
  const b = (style: React.CSSProperties, k: string) => <b key={k} style={{ position: 'absolute', ...style }} />;
  const parts: Record<LayoutId, React.ReactNode[]> = {
    'rail-full': [b({ left: 0, top: 0, bottom: 0, width: '28%', opacity: 0.55 }, 'a'), b({ left: '32%', top: 6, right: 6, height: 8 }, 'b'), b({ left: '32%', top: 20, right: 6, bottom: 6, opacity: 0.25 }, 'c')],
    'rail-icon': [b({ left: 0, top: 0, bottom: 0, width: '10%', opacity: 0.55 }, 'a'), b({ left: '14%', top: 6, right: 6, height: 8 }, 'b'), b({ left: '14%', top: 20, right: 6, bottom: 6, opacity: 0.25 }, 'c')],
    'bottom-deck': [b({ left: 6, top: 6, right: 6, height: 8 }, 'b'), b({ left: 6, top: 20, right: 6, bottom: 18, opacity: 0.25 }, 'c'), b({ left: 6, right: 6, bottom: 4, height: 9, opacity: 0.55 }, 'a')],
    top: [b({ left: 6, top: 4, right: 6, height: 7 }, 'b'), b({ left: 6, top: 14, right: 6, height: 6, opacity: 0.55 }, 'a'), b({ left: 6, top: 24, right: 6, bottom: 6, opacity: 0.25 }, 'c')],
  };
  return <div className="layout-prev" aria-hidden="true">{parts[id]}</div>;
}

function Appearance() {
  const { local, setLocal } = useApp();
  const set = (patch: Partial<LocalSettings>) => setLocal({ ...local, ...patch });
  const check = checkCustomTheme(local.custom);
  const swatches: Record<ThemeId, string> = { ambar: 'linear-gradient(135deg,#17130e 0 55%,#ffb020 55%)', azul: 'linear-gradient(135deg,#101722 0 55%,#4c9aff 55%)', propio: `linear-gradient(135deg,${local.custom.bg} 0 55%,${local.custom.accent} 55%)` };
  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card title="Tema de color" sub="Se aplica al instante a toda la interfaz y se guarda en este navegador.">
        <div className="grid c3" role="group" aria-label="Tema de color">
          {THEMES.map((t) => (
            <button key={t.id} type="button" className="theme-card" aria-pressed={local.theme === t.id} onClick={() => set({ theme: t.id })}>
              <span className="swatch" style={{ '--sw': swatches[t.id] } as React.CSSProperties}><i /><i /><i /></span>
              <strong>{t.label}{local.theme === t.id && <Icon name="check" size={14} style={{ marginLeft: 6 }} />}</strong>
              <span className="muted" style={{ fontSize: '.8rem' }}>{t.hint}</span>
            </button>
          ))}
        </div>
        {local.theme === 'propio' && (
          <div className="stack" style={{ marginTop: 20 }}>
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
              <Field label="Acento">{(id) => <input id={id} type="color" className="input" value={local.custom.accent} onChange={(e) => set({ custom: { ...local.custom, accent: e.target.value } })} />}</Field>
              <Field label="Fondo">{(id) => <input id={id} type="color" className="input" value={local.custom.bg} onChange={(e) => set({ custom: { ...local.custom, bg: e.target.value } })} />}</Field>
              <Field label="Texto">{(id) => <input id={id} type="color" className="input" value={local.custom.ink} onChange={(e) => set({ custom: { ...local.custom, ink: e.target.value } })} />}</Field>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <Badge tone={check.inkOnBg >= 4.5 ? 'ok' : 'warn'} icon={check.inkOnBg >= 4.5 ? 'check' : 'alert'}>Texto/fondo {check.inkOnBg.toFixed(1)}:1</Badge>
              <Badge tone={check.accentOnBg >= 3 ? 'ok' : 'warn'} icon={check.accentOnBg >= 3 ? 'check' : 'alert'}>Acento/fondo {check.accentOnBg.toFixed(1)}:1</Badge>
              <Button size="sm" variant="ghost" onClick={() => set({ custom: DEFAULT_CUSTOM })}>Restablecer colores</Button>
            </div>
            {!check.ok && <div role="alert" className="state-error"><Icon name="alert" size={18} /><div>{check.messages.join(' ')} Puedes guardarlos, pero la lectura será difícil.</div></div>}
            <p className="muted" style={{ fontSize: '.8rem' }}>En el tema propio el modo claro/oscuro se deduce de la luminancia del fondo que elijas.</p>
          </div>
        )}
        <div className="field" style={{ marginTop: 20 }}>
          <span className="lbl">Modo</span>
          <div className="seg" role="group" aria-label="Modo claro u oscuro">
            {([['dark', 'Oscuro', 'moon'], ['light', 'Claro', 'sun'], ['auto', 'Automático', 'settings']] as Array<[SchemePref, string, string]>).map(([v, l, ic]) => (
              <button key={v} type="button" aria-pressed={local.scheme === v} disabled={local.theme === 'propio'} onClick={() => set({ scheme: v })}><Icon name={ic} size={14} />{l}</button>
            ))}
          </div>
          {local.theme === 'propio' && <span className="hint">Con el tema propio el modo lo marca el fondo.</span>}
        </div>
      </Card>

      <Card title="Layout de navegación" sub="Dónde vive el menú. Por debajo de 860 px se usa siempre la cubierta inferior.">
        <div className="grid c4" role="group" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" className="theme-card" aria-pressed={local.layout === l.id} onClick={() => set({ layout: l.id })}>
              <LayoutPreview id={l.id} />
              <strong>{l.label}</strong>
              <span className="muted" style={{ fontSize: '.78rem' }}>{l.hint}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Tipografía" sub="Presets de fuentes del sistema (sin descargas) y tamaño de texto.">
        <div className="grid c4" role="group" aria-label="Tipografía">
          {TYPOGRAPHY.map((t) => (
            <button key={t.id} type="button" className="theme-card" aria-pressed={local.typography === t.id} onClick={() => set({ typography: t.id as TypographyId })}>
              <span style={{ fontFamily: t.stack, fontSize: '1.6rem', fontWeight: 650 }}>Aa</span>
              <strong>{t.label}</strong>
              <span className="muted" style={{ fontSize: '.78rem', fontFamily: t.stack }}>{t.hint}</span>
            </button>
          ))}
        </div>
        <div className="field" style={{ marginTop: 20 }}>
          <span className="lbl">Tamaño del texto</span>
          <div className="seg" role="group" aria-label="Tamaño del texto">
            {TEXT_SIZES.map((s) => <button key={s.id} type="button" aria-pressed={local.textSize === s.id} onClick={() => set({ textSize: s.id as TextSize })}>{s.label}</button>)}
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Campos opcionales que el BFF puede añadir a SharedSettings (no están en el contrato todavía). */
type AgentDefaults = { maxDailyRuns?: number; maxDailyCostCents?: number; maxConcurrentRuns?: number };
type SharedExt = SharedSettings & { agentDefaults?: AgentDefaults; hermesSecretIds?: Record<string, string> };

function Shared() {
  const app = useApp();
  const remote = app.settings;
  const [draft, setDraft] = useState<SharedExt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (remote.data) setDraft(structuredClone(remote.data) as SharedExt); }, [remote.data]);
  if (remote.loading) return <Card title="Perfil y operación"><Loading rows={3} /></Card>;
  if (remote.error && !remote.data) return <Card title="Perfil y operación"><ErrorState error={remote.error} onRetry={remote.reload} what="los ajustes compartidos" /></Card>;
  if (!draft || !remote.data) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(remote.data);
  const patch = (p: Partial<SharedExt>) => setDraft({ ...draft, ...p });
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const invalid = draft.modelPrices.some((r) => !r.modelLabel.trim() || r.inputPerMTok < 0 || r.outputPerMTok < 0 || Number.isNaN(r.inputPerMTok) || Number.isNaN(r.outputPerMTok));
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.saveSettings({ ...draft, modelPrices: draft.modelPrices.map((r) => ({ ...r, modelLabel: r.modelLabel.trim() })) });
      app.toast('ok', 'Ajustes compartidos guardados.');
      remote.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron guardar los ajustes.'); } finally { setBusy(false); }
  };
  return (
    <Card title="Perfil y operación" sub="Se guardan en el BFF y los ve cualquier navegador."
      right={<><Button variant="ghost" disabled={!dirty} onClick={() => setDraft(structuredClone(remote.data!) as SharedExt)}>Descartar</Button><Button variant="primary" icon="check" loading={busy} disabled={!dirty || invalid} onClick={save}>Guardar cambios</Button></>}>
      <div className="stack" style={{ gap: 24 }}>
        <div className="form-grid">
          <Field label="Tu nombre">{(id) => <input id={id} className="input" value={draft.ownerName} onChange={(e) => patch({ ownerName: e.target.value })} />}</Field>
          <Field label="Agente jefe" hint="Coordina las misiones cuando el equipo es «el jefe elige».">{(id) => (
            <select id={id} className="select" value={draft.bossAgentId ?? ''} onChange={(e) => { const v = e.target.value; const { bossAgentId: _b, ...rest } = draft; setDraft(v ? { ...rest, bossAgentId: v } : rest); }}>
              <option value="">— sin definir —</option>
              {(app.agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.modelLabel ?? 'sin modelo'}</option>)}
            </select>
          )}</Field>
        </div>

        <div>
          <h3 style={{ fontSize: '.95rem', marginBottom: 4 }}>Umbrales de alerta de salud</h3>
          <p className="muted" style={{ fontSize: '.82rem', marginBottom: 12 }}>A partir de este porcentaje el medidor pasa a «Crítico» (y «Atención» 15 puntos antes).</p>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            {([['cpuPercent', 'CPU %'], ['memPercent', 'RAM %'], ['diskPercent', 'Disco %']] as const).map(([k, l]) => (
              <Field key={k} label={l}>{(id) => <input id={id} type="number" min={10} max={100} className="input" value={draft.healthThresholds[k]} onChange={(e) => patch({ healthThresholds: { ...draft.healthThresholds, [k]: Math.min(100, Math.max(10, num(e.target.value))) } })} />}</Field>
            ))}
          </div>
        </div>

        <div>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div><h3 style={{ fontSize: '.95rem' }}>Precios por modelo</h3><p className="muted" style={{ fontSize: '.82rem' }}>USD por millón de tokens. Sirven para estimar el consumo de runs sin precio informado (p. ej. hermes_gateway).</p></div>
            <Button size="sm" icon="plus" onClick={() => patch({ modelPrices: [...draft.modelPrices, { modelLabel: '', inputPerMTok: 0, outputPerMTok: 0 }] })}>Añadir modelo</Button>
          </div>
          {draft.modelPrices.length === 0 ? <p className="muted">Sin precios definidos: los runs sin precio se mostrarán como «sin precio».</p> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Modelo</th><th className="num">Entrada $/M</th><th className="num">Salida $/M</th><th><span className="sr-only">Quitar</span></th></tr></thead>
              <tbody>
                {draft.modelPrices.map((r, i) => {
                  const upd = (p: Partial<typeof r>) => patch({ modelPrices: draft.modelPrices.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                  return (
                    <tr key={i}>
                      <td><input className="input" aria-label={`Modelo ${i + 1}`} aria-invalid={!r.modelLabel.trim()} value={r.modelLabel} onChange={(e) => upd({ modelLabel: e.target.value })} placeholder="nombre-del-modelo" />{(r as { nota?: string }).nota && <div className="muted" style={{ fontSize: '.76rem', marginTop: 4 }}>{(r as { nota?: string }).nota}</div>}</td>
                      <td><input className="input" style={{ textAlign: 'right' }} type="number" min={0} step="0.01" aria-label={`Precio de entrada de ${r.modelLabel || 'modelo ' + (i + 1)}`} value={r.inputPerMTok} onChange={(e) => upd({ inputPerMTok: num(e.target.value) })} /></td>
                      <td><input className="input" style={{ textAlign: 'right' }} type="number" min={0} step="0.01" aria-label={`Precio de salida de ${r.modelLabel || 'modelo ' + (i + 1)}`} value={r.outputPerMTok} onChange={(e) => upd({ outputPerMTok: num(e.target.value) })} /></td>
                      <td className="num"><Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={`Quitar ${r.modelLabel || 'modelo ' + (i + 1)}`} onClick={() => patch({ modelPrices: draft.modelPrices.filter((_, j) => j !== i) })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
          {invalid && <p className="err" style={{ color: 'var(--crit)', fontSize: '.82rem', marginTop: 8 }} role="alert">Cada fila necesita un nombre y precios no negativos.</p>}
        </div>

        {draft.agentDefaults && (
          <div>
            <h3 style={{ fontSize: '.95rem', marginBottom: 4 }}>Topes por agente</h3>
            <p className="muted" style={{ fontSize: '.82rem', marginBottom: 12 }}>Límites que el BFF aplica por defecto a cada agente (0 = sin tope).</p>
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
              {([['maxDailyRuns', 'Runs por día'], ['maxDailyCostCents', 'Coste diario (centavos)'], ['maxConcurrentRuns', 'Runs simultáneos']] as const).map(([k, l]) => (
                <Field key={k} label={l}>{(id) => <input id={id} type="number" min={0} className="input" value={draft.agentDefaults?.[k] ?? 0} onChange={(e) => patch({ agentDefaults: { ...draft.agentDefaults, [k]: Math.max(0, num(e.target.value)) } })} />}</Field>
              ))}
            </div>
          </div>
        )}
        {draft.hermesSecretIds && (
          <div>
            <h3 style={{ fontSize: '.95rem', marginBottom: 8 }}>Secreto de Hermes por equipo (solo el id)</h3>
            {Object.keys(draft.hermesSecretIds).length === 0 ? <p className="muted" style={{ fontSize: '.88rem' }}>Ningún equipo tiene secreto asignado todavía. Las claves nunca se muestran: solo su id en Paperclip.</p> : (
              <dl className="kv">{Object.entries(draft.hermesSecretIds).map(([m, id]) => <div key={m} style={{ display: 'contents' }}><dt>{m}</dt><dd className="mono" style={{ fontSize: '.8rem' }}>{id}</dd></div>)}</dl>
            )}
          </div>
        )}

        <div>
          <h3 style={{ fontSize: '.95rem', marginBottom: 8 }}>Rutas de la bóveda (solo lectura)</h3>
          {Object.keys(draft.vaultPaths).length === 0 ? <p className="muted" style={{ fontSize: '.88rem' }}>Ninguna ruta configurada (se define con variables de entorno del BFF).</p> : (
            <dl className="kv">{Object.entries(draft.vaultPaths).map(([m, v]) => v ? <div key={m} style={{ display: 'contents' }}><dt>{m}</dt><dd className="mono" style={{ fontSize: '.8rem' }}>{v.vaultRoot} · {v.electionsFile}</dd></div> : null)}</dl>
          )}
        </div>
        {error && <div className="state-error" role="alert"><Icon name="alert" size={18} /><div>{error}</div></div>}
      </div>
    </Card>
  );
}

function LocalData() {
  const app = useApp();
  const [reset, setReset] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const exportJson = () => {
    const blob = new Blob([exportLocalSettings(app.local)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mission-control-ajustes.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importJson = async (f: File | undefined) => {
    if (!f) return;
    try {
      app.setLocal(importLocalSettings(await f.text()));
      app.toast('ok', 'Ajustes importados y aplicados.');
    } catch {
      app.toast('crit', 'El archivo no es un JSON de ajustes válido.');
    }
    if (file.current) file.current.value = '';
  };
  return (
    <Card title="Datos locales" sub="Tema, layout y tipografía viven solo en este navegador (localStorage). Expórtalos para llevarlos a otro equipo.">
      <div className="row wrap" style={{ gap: 8 }}>
        <Button icon="download" onClick={exportJson}>Exportar JSON</Button>
        <Button icon="upload" onClick={() => file.current?.click()}>Importar JSON</Button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => importJson(e.target.files?.[0])} aria-label="Archivo de ajustes a importar" />
        <Button variant="danger" icon="refresh" onClick={() => setReset(true)}>Restablecer valores</Button>
      </div>
      <ConfirmDialog open={reset} danger title="Restablecer ajustes locales" body="Vuelven el tema ámbar, el layout de riel completo y la tipografía del sistema. Los ajustes compartidos del BFF no cambian." confirmLabel="Restablecer" onConfirm={() => { app.setLocal({ ...DEFAULT_SETTINGS }); setReset(false); app.toast('ok', 'Ajustes locales restablecidos.'); }} onCancel={() => setReset(false)} />
    </Card>
  );
}

export function SettingsView() {
  return (
    <>
      <PageHead title="Ajustes" sub="Apariencia (solo en este navegador) y operación (compartida vía el BFF)." />
      <div className="stack" style={{ gap: 24 }}>
        <Appearance />
        <Shared />
        <LocalData />
      </div>
    </>
  );
}
