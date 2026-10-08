import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { TimelineEvent } from '@mc/contracts';
import { Icon } from './Icon.tsx';
import { timelineKindInfo, toneVar } from '../lib/status.ts';
import { formatDateTime, formatTime } from '../lib/format.ts';

export function Timeline({ events, currentId, dimAfter, live }: { events: TimelineEvent[]; currentId?: string; dimAfter?: number; live?: boolean }) {
  const seen = useRef<Set<string>>(new Set());
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
    seen.current = new Set(events.map((e) => e.id));
  }, [events]);
  if (events.length === 0) return <p className="muted">Todavía no hay eventos.</p>;
  return (
    <ol className="timeline" aria-live={live ? 'polite' : undefined} aria-label="Línea de tiempo de la misión">
      {events.map((e, i) => {
        const k = timelineKindInfo(e.kind);
        const isNew = live && !first.current && !seen.current.has(e.id);
        const dim = dimAfter !== undefined && i > dimAfter;
        return (
          <li key={e.id} className={`tl-item${isNew ? ' new' : ''}${dim ? ' dim' : ''}`} aria-current={currentId === e.id ? 'step' : undefined} style={{ '--tone': toneVar(k.tone) } as CSSProperties}>
            <span className="tl-dot"><Icon name={k.icon} size={15} /></span>
            <div>
              <div className="tl-head">
                <strong>{e.summary}</strong>
                <span className="chip" style={{ padding: '0 8px' }}>{k.label}</span>
                <time className="tl-time" dateTime={e.at} title={formatDateTime(e.at)}>{formatTime(e.at)}</time>
              </div>
              {e.actorName && <div className="muted" style={{ fontSize: '.78rem' }}>{e.actorType === 'agent' ? 'Agente' : e.actorType === 'user' ? 'Tú' : 'Sistema'} · {e.actorName}</div>}
              {e.body && <div className="tl-body">{e.body}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
