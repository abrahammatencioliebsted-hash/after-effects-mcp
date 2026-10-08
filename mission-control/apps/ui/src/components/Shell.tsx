import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';
import { Button } from './ui.tsx';
import { useApp } from '../state/AppContext.tsx';
import { go, useDebounced, useResource } from '../state/hooks.ts';
import { api } from '../lib/api.ts';
import { rankSearch } from '../lib/search.ts';
import type { SearchItem } from '../lib/search.ts';
import type { MissionSummary } from '@mc/contracts';
import { missionStatusInfo } from '../lib/status.ts';

export interface NavItem { id: string; label: string; icon: string; hint: string; group: number }

export const NAV: NavItem[] = [
  { id: 'cockpit', label: 'Cockpit', icon: 'gauge', hint: 'Instrumentos y estado general', group: 0 },
  { id: 'misiones', label: 'Misiones', icon: 'target', hint: 'Lanzar, aprobar y seguir misiones', group: 0 },
  { id: 'agentes', label: 'Agentes', icon: 'city', hint: 'Ciudad de agentes y actividad', group: 0 },
  { id: 'docs', label: 'Docs', icon: 'doc', hint: 'Informes y notas', group: 0 },
  { id: 'schedule', label: 'Schedule', icon: 'calendar', hint: 'Rutinas programadas', group: 0 },
  { id: 'salud', label: 'Salud', icon: 'heart', hint: 'Equipos, Hermes y comandos', group: 0 },
  { id: 'catalogo', label: 'Catálogo', icon: 'layers', hint: 'Capacidades y compatibilidad', group: 1 },
  { id: 'ideas', label: 'Ideas', icon: 'bulb', hint: 'Registro de elecciones', group: 1 },
  { id: 'ajustes', label: 'Ajustes', icon: 'settings', hint: 'Temas, layouts y modelos', group: 2 },
  { id: 'guia', label: 'Guía', icon: 'book', hint: 'Cómo usar cada pestaña', group: 2 },
  { id: 'proximamente', label: 'Próximamente', icon: 'rocket', hint: 'Lo que aún no está', group: 2 },
];

export function Brand({ compact }: { compact?: boolean }) {
  return (
    <a className="brand" href="#/cockpit" aria-label="Mission Control, ir al Cockpit">
      <span className="brand-mark"><Icon name="gauge" size={20} /></span>
      {!compact && <div>Mission Control<small>cabina de agentes</small></div>}
    </a>
  );
}

export function Nav({ current, pending }: { current: string; pending: number }) {
  const { local } = useApp();
  const iconOnly = local.layout === 'rail-icon';
  let lastGroup = -1;
  return (
    <nav className="nav" aria-label="Navegación principal">
      <Brand />
      <ul className="nav-list">
        {NAV.map((n) => {
          const sep = lastGroup !== -1 && n.group !== lastGroup;
          lastGroup = n.group;
          return (
            <Fragment key={n.id}>
              {sep && <li className="nav-sep" role="separator" aria-hidden="true" />}
              <li style={{ display: 'contents' }}>
                <a className="nav-link" href={`#/${n.id}`} aria-current={current === n.id ? 'page' : undefined} title={iconOnly ? `${n.label} · ${n.hint}` : n.hint}>
                  <Icon name={n.icon} size={19} />
                  <span className="label">{n.label}</span>
                  {n.id === 'misiones' && pending > 0 && <span className="nav-badge" aria-label={`${pending} pendientes de aprobación`}>{pending}</span>}
                </a>
              </li>
            </Fragment>
          );
        })}
      </ul>
      <div className="nav-foot">Hecho para operar, no para adornar.<br />v0.1 · hito 1</div>
    </nav>
  );
}

function SearchBox() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q.trim(), 220);
  const missions = useResource(() => (dq ? api.missions({ q: dq, limit: 6 }) : Promise.resolve({ items: [] as MissionSummary[] })), [dq]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const results = useMemo(() => {
    const items: SearchItem[] = [
      ...(app.agents.data ?? []).map((a): SearchItem => ({ kind: 'agente', id: a.id, title: a.name, subtitle: `${a.role} · ${a.modelLabel ?? ''}`, keywords: a.shortName })),
      ...(missions.data?.items ?? []).map((m): SearchItem => ({ kind: 'mision', id: m.id, title: m.title, subtitle: `${m.identifier} · ${missionStatusInfo(m.status).label}`, keywords: m.assigneeName ?? '' })),
      ...NAV.map((n): SearchItem => ({ kind: 'vista', id: n.id, title: n.label, subtitle: n.hint })),
    ];
    // Las misiones ya vienen filtradas por el BFF: se les da el puntaje igualmente para ordenarlas.
    return rankSearch(q, items, 9);
  }, [q, app.agents.data, missions.data]);

  const choose = (it: SearchItem) => {
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    if (it.kind === 'agente') go('agentes', it.id);
    else if (it.kind === 'mision') go('misiones', it.id);
    else go(it.id);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { const it = results[active]; if (it) { e.preventDefault(); choose(it); } }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  };

  const showPop = open && q.trim().length > 0;
  return (
    <div className="search" role="search">
      <Icon name="search" size={18} />
      <input
        ref={inputRef} className="search-input" type="search" placeholder="Buscar agentes, misiones o vistas…" aria-label="Búsqueda global"
        role="combobox" aria-expanded={showPop} aria-controls="search-list" aria-autocomplete="list" aria-activedescendant={showPop && results[active] ? `sr-${active}` : undefined}
        value={q} onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKey}
      />
      <kbd aria-hidden="true">/</kbd>
      {showPop && (
        <div className="search-pop" id="search-list" role="listbox" aria-label="Resultados">
          {results.length === 0 && <div className="muted" style={{ padding: 12 }}>Sin resultados para «{q}».</div>}
          {results.map((it, i) => (
            <button key={`${it.kind}-${it.id}`} id={`sr-${i}`} type="button" role="option" aria-selected={i === active} className="search-item" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(it)} onMouseEnter={() => setActive(i)}>
              <Icon name={it.kind === 'agente' ? 'user' : it.kind === 'mision' ? 'target' : 'arrow-right'} size={16} />
              <span className="grow"><strong>{it.title}</strong>{it.subtitle && <span className="muted" style={{ display: 'block', fontSize: '.78rem' }}>{it.subtitle}</span>}</span>
              <span className="kind">{it.kind === 'agente' ? 'Agente' : it.kind === 'mision' ? 'Misión' : 'Vista'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const app = useApp();
  const demo = app.mock || app.health.data?.bff.mode === 'demo';
  const dark = document.documentElement.getAttribute('data-scheme') !== 'light';
  const streamTxt = app.stream === 'open' ? 'En vivo' : app.stream === 'mock' ? 'Sin flujo (simulado)' : app.stream === 'reconnecting' ? 'Reconectando…' : 'Conectando…';
  return (
    <header className="header">
      <div className="brand-head"><Brand compact /></div>
      <SearchBox />
      <div className="row right" style={{ gap: 8 }}>
        <span className="pill hide-sm" title="Estado del flujo de eventos en tiempo real">
          <span className={`live-dot ${app.stream === 'open' ? 'on' : 'warn'}`} />{streamTxt}
        </span>
        <span className="pill hide-sm" title={demo ? 'Backend simulado' : 'Conectado a Paperclip'}>
          <Icon name={demo ? 'flask' : 'plug'} size={14} />{demo ? 'Demo' : 'Paperclip'}
        </span>
        {app.local.theme !== 'propio' && (
          <Button variant="ghost" iconOnly icon={dark ? 'sun' : 'moon'} aria-label={dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'} onClick={() => app.setLocal({ ...app.local, scheme: dark ? 'light' : 'dark' })} />
        )}
        <Button variant="primary" icon="plus" onClick={() => app.openWizard()}><span className="hide-sm">Nueva misión</span><span className="sr-only">Nueva misión</span></Button>
      </div>
    </header>
  );
}

export function Banners() {
  const app = useApp();
  const demo = app.mock || app.health.data?.bff.mode === 'demo';
  return (
    <div className="banners">
      {demo && (
        <div className="banner sim" role="status">
          <Icon name="flask" size={18} />
          <b>DATOS SIMULADOS</b>
          <span className="t2">{app.mock ? 'Modo ?mock=1: datos de ejemplo en el navegador, no hay BFF ni Paperclip.' : 'El backend está en modo demo: nada de lo que ves ocurrió en tus equipos.'}</span>
        </div>
      )}
      {app.degraded.bff && !app.mock && (
        <div className="banner degraded" role="alert">
          <Icon name="alert" size={18} />
          <b>SIN CONEXIÓN CON EL BFF</b>
          <span className="t2">No se alcanza <code>/api/mc</code>. Arranca el BFF en el puerto 3300 o usa <code>?mock=1</code>.</span>
          <Button size="sm" className="right" icon="refresh" onClick={app.health.reload}>Reintentar</Button>
        </div>
      )}
      {app.degraded.paperclipBaseUrl && (
        <div className="banner degraded" role="alert">
          <Icon name="alert" size={18} />
          <b>MODO DEGRADADO</b>
          <span className="t2">Paperclip no responde en <code>{app.degraded.paperclipBaseUrl}</code>. Se muestran los últimos datos conocidos y las acciones pueden fallar.</span>
        </div>
      )}
    </div>
  );
}
