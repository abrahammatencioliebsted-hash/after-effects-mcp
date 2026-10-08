import type { ReactNode } from 'react';
import { parseMarkdown } from '../lib/markdown.ts';
import type { Block, Inline } from '../lib/markdown.ts';

function inline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return n.v;
      case 'strong': return <strong key={i}>{inline(n.c)}</strong>;
      case 'em': return <em key={i}>{inline(n.c)}</em>;
      case 'code': return <code key={i}>{n.v}</code>;
      case 'link': return <a key={i} href={n.href} target="_blank" rel="noreferrer noopener">{inline(n.c)}</a>;
    }
  });
}

function block(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'h': {
      const Tag = `h${Math.min(6, b.level + 0)}` as 'h1';
      return <Tag key={i}>{inline(b.c)}</Tag>;
    }
    case 'p': return <p key={i}>{inline(b.c)}</p>;
    case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
    case 'ol': return <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
    case 'quote': return <blockquote key={i}>{inline(b.c)}</blockquote>;
    case 'code': return <pre key={i}><code>{b.v}</code></pre>;
    case 'hr': return <hr key={i} />;
    case 'table': return (
      <table key={i}>
        <thead><tr>{b.head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
        <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
      </table>
    );
  }
}

/** Renderiza Markdown como elementos React (nunca HTML crudo). */
export function Markdown({ source }: { source: string }) {
  return <div className="md">{parseMarkdown(source).map(block)}</div>;
}
