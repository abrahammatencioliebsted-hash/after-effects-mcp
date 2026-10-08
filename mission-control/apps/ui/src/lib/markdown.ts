// Mini parser de Markdown (suficiente para informes de agentes). Sin HTML crudo: la UI renderiza el AST con React.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'hr' }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

/** Solo permite enlaces http(s), mailto y relativos; descarta javascript: y similares. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^(https?:|mailto:)/i.test(h)) return h;
  if (/^[#/.]/.test(h)) return h;
  return null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  while (i < src.length) {
    const ch = src[i] ?? '';
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] !== ' ') {
      const end = src.indexOf(ch, i + 1);
      if (end > i + 1 && src[end - 1] !== ' ') {
        flush();
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const close = src.indexOf('](', i + 1);
      const paren = close > 0 ? src.indexOf(')', close + 2) : -1;
      if (close > 0 && paren > close) {
        const href = safeHref(src.slice(close + 2, paren));
        if (href) {
          flush();
          out.push({ t: 'link', href, c: parseInline(src.slice(i + 1, close)) });
          i = paren + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) { i++; continue; }
    const fence = /^```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) { buf.push(lines[i] ?? ''); i++; }
      i++;
      blocks.push({ t: 'code', lang: fence[1] ?? '', v: buf.join('\n') });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ t: 'h', level: (h[1] ?? '#').length as 1 | 2 | 3 | 4 | 5 | 6, c: parseInline((h[2] ?? '').replace(/\s+#+\s*$/, '')) });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) { buf.push((lines[i] ?? '').replace(/^\s*>\s?/, '')); i++; }
      blocks.push({ t: 'quote', c: parseInline(buf.join(' ')) });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? '')) { items.push(parseInline((lines[i] ?? '').replace(/^\s*[-*+]\s+/, ''))); i++; }
      blocks.push({ t: 'ul', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] ?? '')) { items.push(parseInline((lines[i] ?? '').replace(/^\s*\d+[.)]\s+/, ''))); i++; }
      blocks.push({ t: 'ol', items });
      continue;
    }
    if (line.includes('|') && /^[\s:|-]*-[\s:|-]*$/.test(lines[i + 1] ?? '') && (lines[i + 1] ?? '').includes('|')) {
      const head = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim()) { rows.push(splitRow(lines[i] ?? '').map(parseInline)); i++; }
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() && !/^(#{1,6}\s|```|\s*>|\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(lines[i] ?? '')) { buf.push((lines[i] ?? '').trim()); i++; }
    if (buf.length === 0) { i++; continue; }
    blocks.push({ t: 'p', c: parseInline(buf.join(' ')) });
  }
  return blocks;
}

export function wordCount(src: string): number {
  return (src.match(/\S+/g) ?? []).length;
}
