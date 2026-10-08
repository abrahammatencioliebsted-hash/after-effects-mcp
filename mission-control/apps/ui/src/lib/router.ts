// Router mínimo basado en hash (#/ruta?clave=valor). Funciona con base './' y servido por el BFF.

export interface Route {
  /** Primer segmento (vista) */
  view: string;
  /** Segundos segmentos: id de misión/agente, etc. */
  id?: string;
  query: Record<string, string>;
}

export const VIEWS = ['cockpit', 'misiones', 'agentes', 'docs', 'schedule', 'salud', 'catalogo', 'ideas', 'ajustes', 'guia', 'proximamente'] as const;
export type ViewId = (typeof VIEWS)[number];

export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean).map((s) => safeDecode(s));
  const first = segs[0] ?? 'cockpit';
  const view = (VIEWS as readonly string[]).includes(first) ? first : 'cockpit';
  const query: Record<string, string> = {};
  if (queryPart) {
    for (const [k, v] of new URLSearchParams(queryPart)) query[k] = v;
  }
  const route: Route = { view, query };
  if (segs[1]) route.id = segs[1];
  return route;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function buildHash(view: string, id?: string, query?: Record<string, string | undefined>): string {
  let h = `#/${view}`;
  if (id) h += `/${encodeURIComponent(id)}`;
  const q = new URLSearchParams();
  if (query) for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${h}?${qs}` : h;
}
