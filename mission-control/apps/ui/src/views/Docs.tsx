import { useState } from 'react';
import { api } from '../lib/api.ts';
import { Badge, Button, Card, Empty, ErrorState, Field, Loading, Modal, PageHead } from '../components/ui.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Icon } from '../components/Icon.tsx';
import { useApp } from '../state/AppContext.tsx';
import { go, useDebounced, useResource } from '../state/hooks.ts';
import type { Route } from '../lib/router.ts';
import { formatDateTime, relativeTime } from '../lib/format.ts';

function NoteDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const app = useApp();
  const [title, setTitle] = useState('');
  const [md, setMd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = title.trim().length > 0 && md.trim().length > 0;
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await api.createDoc({ title: title.trim(), markdown: md });
      app.toast('ok', 'Nota guardada en Docs.');
      setTitle(''); setMd('');
      onSaved(d.id);
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar.'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} wide icon="edit" title="Escribir una nota"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" icon="check" loading={busy} disabled={!valid} onClick={save}>Guardar nota</Button></>}>
      <div className="stack">
        <Field label="Título">{(id) => <input id={id} className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />}</Field>
        <Field label="Contenido (Markdown)" hint="Admite títulos, listas, citas, código y tablas.">{(id) => <textarea id={id} className="textarea" style={{ minHeight: 240 }} value={md} onChange={(e) => setMd(e.target.value)} />}</Field>
        {md.trim() && <details><summary className="muted" style={{ cursor: 'pointer' }}>Vista previa</summary><div className="card tight" style={{ marginTop: 8 }}><Markdown source={md} /></div></details>}
        {err && <div className="state-error" role="alert"><Icon name="alert" size={20} /><div>{err}</div></div>}
      </div>
    </Modal>
  );
}

function Reader({ id }: { id: string }) {
  const doc = useResource(() => api.doc(id), [id]);
  if (doc.loading) return <Card><Loading rows={5} /></Card>;
  if (doc.error && !doc.data) return <Card><ErrorState error={doc.error} onRetry={doc.reload} what="el documento" /></Card>;
  if (!doc.data) return null;
  const s = doc.data.summary;
  return (
    <Card>
      <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
        <Badge plain icon={s.authorType === 'agent' ? 'sparkle' : 'user'}>{s.authorName}</Badge>
        <Badge plain>{s.source === 'mc-note' ? 'Nota propia' : s.source === 'paperclip-comment' ? 'Comentario largo' : 'Documento de misión'}</Badge>
        {s.missionIdentifier && <a className="chip" href={`#/misiones/${encodeURIComponent(s.missionId ?? '')}`}><Icon name="target" size={13} /> {s.missionIdentifier}</a>}
        <span className="muted" style={{ fontSize: '.82rem' }}>{formatDateTime(s.createdAt)} · {s.wordCount} palabras</span>
      </div>
      <Markdown source={doc.data.markdown} />
    </Card>
  );
}

export function DocsView({ route }: { route: Route }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [note, setNote] = useState(false);
  const list = useResource(() => api.docs(dq ? { q: dq } : {}), [dq, app.live.missions]);
  const docs = list.data ?? [];
  return (
    <>
      <PageHead title="Docs" sub="Los informes largos de los agentes viven aquí, no en el chat: así no se come tu contexto ni tus tokens."
        actions={<Button variant="primary" icon="edit" onClick={() => setNote(true)}>Escribir nota</Button>} />
      <div className="docs-layout">
        <div className="stack">
          <div className="search" style={{ maxWidth: 'none' }}>
            <Icon name="search" size={16} style={{ top: 12 }} />
            <input className="search-input" style={{ paddingRight: 12 }} placeholder="Buscar en documentos" aria-label="Buscar documentos" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {list.loading && <Loading rows={4} />}
          {list.error && !list.data && <ErrorState error={list.error} onRetry={list.reload} what="los documentos" />}
          {list.data && docs.length === 0 && <Card><Empty icon="doc" title={dq ? 'Sin coincidencias' : 'Todavía no hay documentos'} action={!dq ? <Button icon="edit" onClick={() => setNote(true)}>Escribir la primera nota</Button> : undefined}>{dq ? `Ningún documento contiene «${dq}».` : 'Cuando una misión termine, su informe aparecerá aquí. También puedes guardar notas propias.'}</Empty></Card>}
          {docs.map((d) => (
            <button key={d.id} type="button" className="doc-item" aria-current={route.id === d.id} onClick={() => go('docs', d.id)}>
              <span className="row between" style={{ gap: 8 }}><strong>{d.title}</strong><Icon name={d.authorType === 'agent' ? 'sparkle' : 'user'} size={14} /></span>
              <span className="ex">{d.excerpt}</span>
              <span className="muted" style={{ fontSize: '.76rem' }}>{d.authorName} · {relativeTime(d.createdAt)}{d.missionIdentifier ? ` · ${d.missionIdentifier}` : ''}</span>
            </button>
          ))}
        </div>
        <div>
          {route.id ? <Reader id={route.id} /> : <Card><Empty icon="book" title="Elige un documento">Selecciona uno de la lista para leerlo aquí.</Empty></Card>}
        </div>
      </div>
      <NoteDialog open={note} onClose={() => setNote(false)} onSaved={(id) => { setNote(false); list.reload(); go('docs', id); }} />
    </>
  );
}
