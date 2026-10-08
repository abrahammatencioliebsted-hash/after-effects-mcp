import { useMemo, useState } from 'react';
import type { Idea } from '@mc/contracts';
import { api } from '../lib/api.ts';
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHead, Segmented } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { useApp } from '../state/AppContext.tsx';
import { go, useResource } from '../state/hooks.ts';
import { formatDate, truncate } from '../lib/format.ts';
import type { Tone } from '../lib/status.ts';

const ESTADO: Record<Idea['estado'], { label: string; tone: Tone; icon: string }> = {
  'sin-decision': { label: 'Sin decisión tuya', tone: 'warn', icon: 'clock' },
  elegida: { label: 'Elegida', tone: 'ok', icon: 'check' },
  modificada: { label: 'Modificada', tone: 'info', icon: 'edit' },
  aplazada: { label: 'Aplazada', tone: 'muted', icon: 'pause' },
  descartada: { label: 'Descartada', tone: 'muted', icon: 'x' },
};

export function ideaToPrefill(i: Idea): { title: string; objective: string; ideaId: string } {
  return {
    title: truncate(i.idea, 90),
    objective: `${i.idea}\n\nOrigen: Registro de elecciones, idea ${i.id} (${i.fecha}). Decisión registrada: ${i.decision}.${i.razonLiteral ? `\nRazón literal: ${i.razonLiteral}` : ''}`,
    ideaId: i.id,
  };
}

export function IdeasView() {
  const app = useApp();
  const list = useResource(() => api.ideas(), []);
  const [f, setF] = useState<'todas' | Idea['estado']>('todas');
  const items = useMemo(() => (list.data ?? []).filter((i) => f === 'todas' || i.estado === f), [list.data, f]);
  return (
    <>
      <PageHead title="Ideas" sub="Registro de elecciones, de solo lectura. Ninguna idea se convierte en misión sola: tú decides cuándo." />
      <div className="banner info" style={{ borderRadius: 12, border: '1px solid var(--accent-line)', marginBottom: 16 }}>
        <Icon name="lock" size={18} /><span>MC nunca escribe en el Registro de elecciones. «Convertir en misión» solo abre el asistente con los datos pre-llenados; no se crea nada hasta que lances la misión.</span>
      </div>
      <div style={{ marginBottom: 16 }}>
        <Segmented<typeof f> label="Filtrar por decisión" value={f} onChange={setF} options={[{ value: 'todas', label: 'Todas' }, { value: 'sin-decision', label: 'Sin decisión' }, { value: 'elegida', label: 'Elegidas' }, { value: 'aplazada', label: 'Aplazadas' }, { value: 'descartada', label: 'Descartadas' }]} />
      </div>
      {list.loading && <Loading rows={4} />}
      {list.error && !list.data && <ErrorState error={list.error} onRetry={list.reload} what="las ideas" />}
      {list.data && items.length === 0 && <Card><Empty icon="bulb" title="Sin ideas en esta vista">{list.data.length === 0 ? 'No se encontró el Registro de elecciones o está vacío (MC_ELECTIONS_FILE).' : 'Ninguna idea tiene esa decisión.'}</Empty></Card>}
      <div className="grid auto" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(360px,1fr))' }}>
        {items.map((i) => {
          const e = ESTADO[i.estado];
          return (
            <Card key={i.id} className="" title={<span className="row" style={{ gap: 10 }}><span className="mono muted">{i.id}</span></span>} right={<Badge tone={e.tone} icon={e.icon}>{e.label}</Badge>}>
              <div className="stack" style={{ gap: 12 }}>
                <p style={{ fontWeight: 600 }}>{i.idea}</p>
                <dl className="kv">
                  <dt>Fecha</dt><dd>{formatDate(i.fecha)}</dd>
                  <dt>Decisión</dt><dd>{i.decision}</dd>
                  {i.razonLiteral && <><dt>Razón</dt><dd>«{i.razonLiteral}»</dd></>}
                  {i.dondeLoDijiste && <><dt>Dónde</dt><dd>{i.dondeLoDijiste}</dd></>}
                  {i.cambioProximaRonda && <><dt>Próxima ronda</dt><dd>{i.cambioProximaRonda}</dd></>}
                </dl>
                <div className="row wrap" style={{ gap: 8 }}>
                  <Button variant="primary" size="sm" icon="rocket" onClick={() => app.openWizard(ideaToPrefill(i))}>Convertir en misión</Button>
                  {i.missionId && <Button size="sm" icon="target" onClick={() => go('misiones', i.missionId)}>Ver misión creada</Button>}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
