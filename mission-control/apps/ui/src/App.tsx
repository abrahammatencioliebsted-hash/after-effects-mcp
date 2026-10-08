import { useEffect } from 'react';
import { AppProvider, useApp } from './state/AppContext.tsx';
import { useResource, useRoute } from './state/hooks.ts';
import { api } from './lib/api.ts';
import { Banners, Header, Nav } from './components/Shell.tsx';
import { MissionWizard } from './components/MissionWizard.tsx';
import { AgentWizard } from './components/AgentWizard.tsx';
import { Icon } from './components/Icon.tsx';
import { CockpitView } from './views/Cockpit.tsx';
import { MissionsView } from './views/Missions.tsx';
import { AgentsView } from './views/Agents.tsx';
import { DocsView } from './views/Docs.tsx';
import { ScheduleView } from './views/Schedule.tsx';
import { HealthView } from './views/Health.tsx';
import { CatalogView } from './views/Catalog.tsx';
import { IdeasView } from './views/Ideas.tsx';
import { SettingsView } from './views/Settings.tsx';
import { GuideView } from './views/Guide.tsx';
import { SoonView } from './views/Soon.tsx';
import { NAV } from './components/Shell.tsx';
import { toneVar } from './lib/status.ts';

function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className="toast" role="status" style={{ '--tone': toneVar(t.tone === 'ok' ? 'ok' : t.tone === 'crit' ? 'crit' : t.tone === 'warn' ? 'warn' : 'info') } as React.CSSProperties}>
          <Icon name={t.tone === 'ok' ? 'check' : t.tone === 'crit' ? 'alert' : 'info'} size={18} />
          <span className="grow">{t.text}</span>
          <button type="button" className="btn ghost sm icon" aria-label="Cerrar aviso" onClick={() => dismissToast(t.id)}><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

function Shell() {
  const app = useApp();
  const route = useRoute();
  const ov = useResource(() => api.overview(14), [app.live.missions]);
  const pending = ov.data?.pendingApprovals ?? 0;

  useEffect(() => {
    const nav = NAV.find((n) => n.id === route.view);
    document.title = `${nav?.label ?? 'Mission Control'} · Mission Control`;
  }, [route.view]);

  let view;
  switch (route.view) {
    case 'misiones': view = <MissionsView route={route} />; break;
    case 'agentes': view = <AgentsView route={route} />; break;
    case 'docs': view = <DocsView route={route} />; break;
    case 'schedule': view = <ScheduleView />; break;
    case 'salud': view = <HealthView />; break;
    case 'catalogo': view = <CatalogView />; break;
    case 'ideas': view = <IdeasView />; break;
    case 'ajustes': view = <SettingsView />; break;
    case 'guia': view = <GuideView />; break;
    case 'proximamente': view = <SoonView />; break;
    default: view = <CockpitView />;
  }

  return (
    <div className="app" data-layout={app.local.layout}>
      <a className="skip" href="#main">Saltar al contenido</a>
      <Nav current={route.view} pending={pending} />
      <Header />
      <Banners />
      <main className="main" id="main" tabIndex={-1} key={route.view}>{view}</main>
      <MissionWizard />
      <AgentWizard />
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
