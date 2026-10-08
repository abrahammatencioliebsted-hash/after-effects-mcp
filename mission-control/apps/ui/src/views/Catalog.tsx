import { Fragment, useMemo, useState } from 'react';
import type { Capability, CapabilityState, CapabilityType, Platform } from '@mc/contracts';
import { api } from '../lib/api.ts';
import { Badge, Button, Card, Empty, ErrorState, KV, Loading, PageHead } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { useApp } from '../state/AppContext.tsx';
import { useResource } from '../state/hooks.ts';
import { capabilityStateInfo, compatInfo, platformLabel } from '../lib/status.ts';
import { formatDate } from '../lib/format.ts';

const TYPES: CapabilityType[] = ['skill', 'mcp', 'plugin', 'api', 'conector', 'herramienta-local', 'navegador', 'automatizacion', 'modelo'];
const STATES: CapabilityState[] = ['descubierta', 'configurada', 'probada', 'pendiente', 'incompatible'];
const PLATFORMS: Platform[] = ['hermes', 'claude', 'codex', 'grok', 'mimo'];
const CONSUMO: Record<Capability['consumo'], string> = { local: 'Local', suscripcion: 'Suscripción', 'api-facturada': 'API facturada', 'sin-modelo': 'Sin modelo' };
const PROV: Record<Capability['procedencia'], string> = { C: 'Confirmado por ti', H: 'Comprobado', P: 'Plan histórico', F: 'Fuente externa', I: 'Inferencia', Pr: 'Propuesta' };

function Row({ c }: { c: Capability }) {
  const [open, setOpen] = useState(false);
  const st = capabilityStateInfo(c.estado);
  return (
    <Fragment>
      <tr>
        <td><button type="button" className="expander" aria-expanded={open} aria-label={`${open ? 'Ocultar' : 'Ver'} detalle de ${c.nombre}`} onClick={() => setOpen(!open)}><Icon name="chevron-right" size={16} /></button></td>
        <td><strong>{c.nombre}</strong><div className="mono muted" style={{ fontSize: '.74rem' }}>{c.id}</div></td>
        <td><Badge plain>{c.tipo}</Badge></td>
        <td><Badge info={st} /></td>
        <td>
          <div className="row wrap" style={{ gap: 6 }}>
            {Object.entries(c.compatibilidad).map(([p, s]) => s ? <Badge key={p} info={compatInfo(s)} title={`${platformLabel(p)}: ${compatInfo(s).long}`}>{platformLabel(p)} · {s}</Badge> : null)}
            {Object.keys(c.compatibilidad).length === 0 && <span className="muted">Sin evaluar</span>}
          </div>
        </td>
        <td className="muted">{c.equipos.length ? c.equipos.join(', ') : '—'}</td>
        <td>{CONSUMO[c.consumo]}</td>
        <td><span title={PROV[c.procedencia]} className="chip">{c.procedencia}</span></td>
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={8}>
            <div className="grid c2">
              <div className="stack">
                <p>{c.que_hace}</p>
                <KV items={[
                  ['Ejecutores', c.ejecutores.map(platformLabel).join(', ') || '—'],
                  ['Necesita', c.necesita.length ? c.necesita.join(' · ') : 'Nada especial'],
                  ['Contexto', c.contexto.join(', ')],
                  ['Lee', c.permisos.lectura.join(', ') || '—'],
                  ['Escribe', c.permisos.escritura.join(', ') || 'Nada'],
                  ['Versión', c.version ?? '—'],
                  ['Fuente', c.fuente ?? '—'],
                  ['Procedencia', `${c.procedencia} · ${PROV[c.procedencia]}`],
                ]} />
              </div>
              <div>
                <h4 style={{ fontSize: '.9rem', marginBottom: 8 }}>Evidencia</h4>
                {c.evidencia.length === 0 ? <p className="muted" style={{ fontSize: '.88rem' }}>Sin evidencia registrada: la capacidad no está «probada» hasta que haya una.</p> : (
                  <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 8 }}>
                    {c.evidencia.map((e, i) => <li key={i} className="card tight" style={{ background: 'var(--panel)' }}><strong>{formatDate(e.fecha)} · {e.donde}</strong><div className="t2" style={{ fontSize: '.86rem' }}>{e.resultado}</div>{e.referencia && <code className="muted" style={{ fontSize: '.74rem' }}>{e.referencia}</code>}</li>)}
                  </ul>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function CatalogView() {
  const app = useApp();
  const machines = useResource(() => api.machines(), []);
  const [tipo, setTipo] = useState('');
  const [equipo, setEquipo] = useState('');
  const [ejecutor, setEjecutor] = useState('');
  const [estado, setEstado] = useState('');
  const [q, setQ] = useState('');
  const list = useResource(() => api.catalog({ tipo, equipo, ejecutor, estado }), [tipo, equipo, ejecutor, estado]);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ ok: boolean; issues: Awaited<ReturnType<typeof api.validateCatalog>>['issues'] } | null>(null);
  const [vErr, setVErr] = useState<string | null>(null);

  const items = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (list.data ?? []).filter((c) => !n || `${c.nombre} ${c.id} ${c.que_hace}`.toLowerCase().includes(n));
  }, [list.data, q]);

  const validate = async () => {
    setValidating(true); setVErr(null);
    try { setValidation(await api.validateCatalog()); } catch (e) { setVErr(e instanceof Error ? e.message : 'No se pudo validar.'); } finally { setValidating(false); }
  };

  return (
    <>
      <PageHead title="Catálogo" sub="Qué puede hacer cada plataforma en cada equipo, con su estado y evidencia. Nada está «listo para usar» sin prueba."
        actions={<Button icon="check" loading={validating} onClick={validate}>Validar</Button>} />

      {(validation || vErr) && (
        <Card className="" title="Resultado de la validación" right={<Button size="sm" variant="ghost" iconOnly icon="x" aria-label="Cerrar resultado" onClick={() => { setValidation(null); setVErr(null); }} />}>
          {vErr ? <ErrorState error={new Error(vErr)} what="la validación" /> : validation && (
            <div className="stack">
              <Badge tone={validation.ok ? 'ok' : 'crit'} icon={validation.ok ? 'check' : 'alert'}>{validation.ok ? 'El catálogo cumple el esquema' : 'El catálogo tiene errores'}</Badge>
              {validation.issues.length === 0 ? <p className="muted">Sin avisos ni errores.</p> : (
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Gravedad</th><th>Capacidad</th><th>Ruta</th><th>Mensaje</th></tr></thead><tbody>
                  {validation.issues.map((i, k) => <tr key={k}><td><Badge tone={i.severity === 'error' ? 'crit' : 'warn'} icon={i.severity === 'error' ? 'x' : 'alert'}>{i.severity === 'error' ? 'Error' : 'Aviso'}</Badge></td><td className="mono">{i.capabilityId ?? '—'}</td><td className="mono muted">{i.path}</td><td>{i.message}</td></tr>)}
                </tbody></table></div>
              )}
            </div>
          )}
        </Card>
      )}

      <div className="row wrap" style={{ margin: '16px 0', gap: 12 }} role="search" aria-label="Filtros del catálogo">
        <div className="search" style={{ maxWidth: 280 }}><Icon name="search" size={16} style={{ top: 12 }} /><input className="search-input" style={{ paddingRight: 12 }} placeholder="Buscar capacidad" aria-label="Buscar capacidad" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="select" style={{ width: 170 }} aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos los tipos</option>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select className="select" style={{ width: 190 }} aria-label="Equipo" value={equipo} onChange={(e) => setEquipo(e.target.value)}><option value="">Todos los equipos</option>{(machines.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <select className="select" style={{ width: 210 }} aria-label="Ejecutor" value={ejecutor} onChange={(e) => setEjecutor(e.target.value)}><option value="">Todos los ejecutores</option>{PLATFORMS.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}</select>
        <select className="select" style={{ width: 170 }} aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todo estado</option>{STATES.map((s) => <option key={s} value={s}>{capabilityStateInfo(s).label}</option>)}</select>
        {(tipo || equipo || ejecutor || estado || q) && <Button variant="ghost" size="sm" icon="x" onClick={() => { setTipo(''); setEquipo(''); setEjecutor(''); setEstado(''); setQ(''); }}>Limpiar filtros</Button>}
      </div>

      <div className="legend" style={{ marginBottom: 12 }} aria-label="Leyenda de compatibilidad">
        {(['NC', 'FV', 'VL', 'PF'] as const).map((c) => <span key={c} className="k"><Badge info={compatInfo(c)}>{c}</Badge> {compatInfo(c).long}</span>)}
      </div>

      {list.loading && <Loading rows={5} />}
      {list.error && !list.data && <ErrorState error={list.error} onRetry={list.reload} what="el catálogo" />}
      {list.data && items.length === 0 && <Card><Empty icon="layers" title="Sin capacidades">{list.data.length === 0 && !tipo && !equipo && !ejecutor && !estado ? 'El catálogo YAML está vacío o el BFF no lo encontró (MC_CATALOG_PATH).' : 'Ninguna capacidad coincide con los filtros.'}</Empty></Card>}
      {items.length > 0 && (
        <Card flush>
          <div className={`tbl-wrap${list.reloading ? ' reloading' : ''}`}>
            <table className="tbl">
              <thead><tr><th style={{ width: 40 }}><span className="sr-only">Detalle</span></th><th>Capacidad</th><th>Tipo</th><th>Estado</th><th>Compatibilidad</th><th>Equipos</th><th>Consumo</th><th>Prov.</th></tr></thead>
              <tbody>{items.map((c) => <Row key={c.id} c={c} />)}</tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="muted" style={{ marginTop: 12, fontSize: '.8rem' }}>{items.length} de {list.data?.length ?? 0} capacidades · {app.mock ? 'datos simulados' : 'desde el catálogo YAML del BFF'}.</p>
    </>
  );
}
