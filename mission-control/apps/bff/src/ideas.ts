import { readFile } from 'node:fs/promises';
import type { Idea } from '@mc/contracts';

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Divide una fila de tabla Markdown respetando `\|`. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  const t = line.trim();
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (ch === '\\' && t[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  if (t.startsWith('|')) cells.shift();
  if (t.endsWith('|') && !t.endsWith('\\|')) cells.pop();
  return cells.map((c) => c.trim());
}

const isEmpty = (s: string | undefined): boolean => !s || /^[—–-]+$/.test(s.trim()) || /^_?\(?vac[ií]o\)?_?$/i.test(s.trim());

export function estadoFromDecision(decision: string): Idea['estado'] {
  const d = norm(decision);
  if (d.includes('sin decision')) return 'sin-decision';
  if (d.includes('descart')) return 'descartada';
  if (d.includes('aplaz')) return 'aplazada';
  if (d.includes('modific')) return 'modificada';
  if (d.includes('eleg') || d.includes('acept') || d.includes('aprob')) return 'elegida';
  return 'sin-decision';
}

/**
 * Parsea la tabla Fecha | ID | Idea | Decisión | Tu razón | Dónde | Qué cambia del Registro de elecciones.
 * Solo lee texto; nunca escribe.
 */
export function parseIdeas(markdown: string): Idea[] {
  const lines = markdown.split(/\r?\n/);
  const out: Idea[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.includes('|')) {
      const head = splitRow(line).map(norm);
      const idxId = head.indexOf('id');
      const idxIdea = head.indexOf('idea');
      const idxDec = head.findIndex((h) => h.startsWith('decision'));
      if (idxId >= 0 && idxIdea >= 0 && idxDec >= 0) {
        const idxFecha = head.findIndex((h) => h.startsWith('fecha'));
        const idxRazon = head.findIndex((h) => h.startsWith('tu razon') || h.startsWith('razon'));
        const idxDonde = head.findIndex((h) => h.startsWith('donde'));
        const idxCambia = head.findIndex((h) => h.startsWith('que cambia'));
        i += 1;
        if (i < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i]!)) i += 1;
        while (i < lines.length && lines[i]!.includes('|')) {
          const c = splitRow(lines[i]!);
          const id = c[idxId] ?? '';
          if (id) {
            const decision = c[idxDec] ?? '';
            const idea: Idea = {
              id,
              fecha: idxFecha >= 0 ? (c[idxFecha] ?? '') : '',
              idea: c[idxIdea] ?? '',
              decision,
              estado: estadoFromDecision(decision),
            };
            const razon = idxRazon >= 0 ? c[idxRazon] : undefined;
            const donde = idxDonde >= 0 ? c[idxDonde] : undefined;
            const cambia = idxCambia >= 0 ? c[idxCambia] : undefined;
            if (!isEmpty(razon)) idea.razonLiteral = razon!;
            if (!isEmpty(donde)) idea.dondeLoDijiste = donde!;
            if (!isEmpty(cambia)) idea.cambioProximaRonda = cambia!;
            out.push(idea);
          }
          i += 1;
        }
        continue;
      }
    }
    i += 1;
  }
  return out;
}

export async function loadIdeas(file: string | undefined): Promise<Idea[]> {
  if (!file) return [];
  try {
    return parseIdeas(await readFile(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
