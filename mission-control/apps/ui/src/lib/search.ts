// Búsqueda global: agentes, misiones y vistas. Pura y determinista.

export interface SearchItem {
  kind: 'agente' | 'mision' | 'vista';
  id: string;
  title: string;
  subtitle?: string;
  /** Texto adicional buscable */
  keywords?: string;
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Puntaje de coincidencia; 0 = sin coincidencia. Prioriza prefijo y coincidencia en el título. */
export function scoreMatch(query: string, item: SearchItem): number {
  const q = norm(query.trim());
  if (!q) return 0;
  const title = norm(item.title);
  const sub = norm(item.subtitle ?? '');
  const kw = norm(item.keywords ?? '');
  let best = 0;
  if (title === q) best = 100;
  else if (title.startsWith(q)) best = 80;
  else if (title.split(/[\s\-_/]+/).some((w) => w.startsWith(q))) best = 65;
  else if (title.includes(q)) best = 50;
  else if (sub.includes(q)) best = 30;
  else if (kw.includes(q)) best = 20;
  if (best === 0) {
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every((w) => `${title} ${sub} ${kw}`.includes(w))) best = 15;
  }
  return best;
}

export function rankSearch(query: string, items: SearchItem[], limit = 8): SearchItem[] {
  return items
    .map((item) => ({ item, score: scoreMatch(query, item) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'es'))
    .slice(0, limit)
    .map((r) => r.item);
}
