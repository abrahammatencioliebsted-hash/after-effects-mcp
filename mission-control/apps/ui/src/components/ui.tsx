import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import { ApiRequestError } from '../lib/api.ts';
import type { StatusInfo, Tone } from '../lib/status.ts';
import { toneVar, provenanceInfo } from '../lib/status.ts';
import type { ProvenanceNote } from '@mc/contracts';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
  icon?: string;
  iconOnly?: boolean;
  loading?: boolean;
  solid?: boolean;
};

export function Button({ variant = 'default', size = 'md', icon, iconOnly, loading, solid, className = '', children, disabled, type = 'button', ...rest }: BtnProps) {
  const cls = ['btn', variant === 'default' ? '' : variant, size === 'sm' ? 'sm' : '', iconOnly ? 'icon' : '', solid ? 'solid' : '', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Icon name="refresh" size={16} className="spin" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  );
}

export function Badge({ info, tone, children, icon, plain, title }: { info?: StatusInfo; tone?: Tone; children?: ReactNode; icon?: string; plain?: boolean; title?: string }) {
  const t = tone ?? info?.tone ?? 'muted';
  const ic = icon ?? info?.icon;
  return (
    <span className={`badge${plain ? ' plain' : ''}`} style={{ '--tone': toneVar(t) } as CSSProperties} title={title}>
      {ic ? <Icon name={ic} size={13} /> : null}
      {children ?? info?.label}
    </span>
  );
}

export function ProvenanceBadge({ state }: { state: ProvenanceNote['state'] }) {
  return <Badge info={provenanceInfo(state)} />;
}

export function Card({ title, sub, right, children, className = '', flush, tight, id }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; flush?: boolean; tight?: boolean; id?: string }) {
  return (
    <section className={`card${flush ? ' flush' : ''}${tight ? ' tight' : ''} ${className}`} id={id}>
      {(title || right) && (
        <header className={`card-head${flush ? '' : ''}`} style={flush ? { padding: '16px 24px 0' } : undefined}>
          <div className="grow">
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {right && <div className="right">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHead({ title, sub, actions, eyebrow }: { title: string; sub?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children, full }: { label: string; hint?: ReactNode; error?: string | undefined; children: (id: string) => ReactNode; full?: boolean }) {
  const id = useId();
  return (
    <div className={`field${full ? ' full' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err" role="alert">{error}</span>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; icon?: string }>; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={15} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: Array<{ id: T; label: string; icon?: string; count?: number }>; label: string }) {
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    if (next) onChange(next.id);
    e.preventDefault();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" type="button" id={`tab-${t.id}`} aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={16} />}
          {t.label}
          {t.count !== undefined && <span className="chip" style={{ padding: '0 8px' }}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon = 'sparkle', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico"><Icon name={icon} size={26} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ rows = 3, label = 'Cargando…' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="stack">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: i === 0 ? 28 : 56, width: i === 0 ? '40%' : '100%' }} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Error de API: distingue Paperclip inaccesible (con la URL base) del BFF caído. */
export function ErrorState({ error, onRetry, what = 'los datos' }: { error: unknown; onRetry?: () => void; what?: string }) {
  const e = error instanceof ApiRequestError ? error : undefined;
  let title = `No se pudieron cargar ${what}`;
  let body: ReactNode = error instanceof Error ? error.message : String(error);
  if (e?.code === 'paperclip_unreachable') {
    title = 'Paperclip no responde';
    body = <>El BFF no logra hablar con Paperclip{e.paperclipBaseUrl ? <> en <code>{e.paperclipBaseUrl}</code></> : ''}. La UI está en modo degradado: los datos mostrados pueden estar desactualizados. Revisa que Paperclip esté corriendo.</>;
  } else if (e?.code === 'network') {
    title = 'No hay conexión con el BFF de Mission Control';
    body = <>La API <code>/api/mc</code> no responde. Arranca el BFF (puerto 3300) o abre la UI con <code>?mock=1</code> para ver datos simulados.</>;
  } else if (e?.code === 'hermes_unreachable') {
    title = 'Hermes no responde';
  }
  return (
    <div className="state-error" role="alert">
      <Icon name="alert" size={22} />
      <div className="grow">
        <strong>{title}</strong>
        <div className="t2" style={{ fontSize: '.9rem', marginTop: 4 }}>{body}</div>
        {onRetry && <Button size="sm" icon="refresh" onClick={onRetry} className="" style={{ marginTop: 12 }}>Reintentar</Button>}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, variant = 'modal', wide, icon }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; variant?: 'modal' | 'drawer'; wide?: boolean; icon?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`${variant === 'drawer' ? 'drawer' : ''}${wide ? ' wide' : ''}`}
      aria-labelledby={titleId}
      onClose={() => { if (open) onClose(); }}
      onMouseDown={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <>
          <div className="dlg-head">
            {icon && <Icon name={icon} size={20} />}
            <h2 id={titleId} className="grow">{title}</h2>
            <Button variant="ghost" iconOnly size="sm" icon="x" aria-label="Cerrar" onClick={onClose} />
          </div>
          <div className="dlg-body">{children}</div>
          {footer && <div className="dlg-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export interface ConfirmProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Si se define, muestra un cuadro de nota (obligatoria si noteRequired). */
  noteLabel?: string;
  noteRequired?: boolean;
  busy?: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, body, confirmLabel, danger, noteLabel, noteRequired, busy, onConfirm, onCancel }: ConfirmProps) {
  const [note, setNote] = useState('');
  useEffect(() => { if (open) setNote(''); }, [open]);
  const blocked = Boolean(noteRequired && !note.trim());
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      icon={danger ? 'alert' : 'check'}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button variant={danger ? 'danger' : 'primary'} solid={danger} loading={Boolean(busy)} disabled={blocked} onClick={() => onConfirm(note.trim())}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="stack">
        <div className="t2">{body}</div>
        {noteLabel && (
          <Field label={noteLabel + (noteRequired ? ' (obligatoria)' : ' (opcional)')}>
            {(id) => <textarea id={id} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        )}
      </div>
    </Modal>
  );
}

export function KV({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProvenanceList({ notes }: { notes: ProvenanceNote[] | undefined }) {
  if (!notes || notes.length === 0) return null;
  return (
    <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 10 }} aria-label="Procedencia de los datos">
      {notes.map((n, i) => (
        <li key={i} className="row" style={{ alignItems: 'flex-start' }}>
          <ProvenanceBadge state={n.state} />
          <div className="grow"><strong>{n.component}</strong><div className="t2" style={{ fontSize: '.86rem' }}>{n.note}</div></div>
        </li>
      ))}
    </ul>
  );
}
