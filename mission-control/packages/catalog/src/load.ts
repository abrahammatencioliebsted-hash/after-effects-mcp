import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Capability, CatalogValidationIssue } from '@mc/contracts';
import { findDuplicateIds, validateCapability, type CatalogIssue } from './validate.js';

export interface LoadedCatalog {
  capabilities: Capability[];
  issues: CatalogValidationIssue[];
}

/** Extrae las entradas crudas de un documento YAML: una capacidad, una lista, o `capabilities: [...]`. */
function extractEntries(doc: unknown): { entries: unknown[]; shape: string } | { error: string } {
  if (Array.isArray(doc)) return { entries: doc, shape: 'lista' };
  if (typeof doc === 'object' && doc !== null) {
    const o = doc as Record<string, unknown>;
    if ('capabilities' in o) {
      if (!Array.isArray(o.capabilities)) return { error: '«capabilities» debe ser una lista de capacidades.' };
      return { entries: o.capabilities, shape: 'capabilities' };
    }
    return { entries: [doc], shape: 'una' };
  }
  return { error: 'El archivo debe contener una capacidad, una lista, o «capabilities:» con una lista.' };
}

/**
 * Lee todos los `*.yaml`/`*.yml` de `dir` (orden alfabético), valida y devuelve las capacidades válidas.
 * Las entradas con errores se excluyen y quedan descritas en `issues`. Las advertencias no excluyen.
 */
export async function loadCatalog(dir: string): Promise<LoadedCatalog> {
  const issues: CatalogIssue[] = [];
  const capabilities: Capability[] = [];
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => /\.ya?ml$/i.test(n)).sort();
  } catch (e) {
    issues.push({
      path: '',
      severity: 'error',
      source: dir,
      message: `No se pudo leer la carpeta del catálogo: ${(e as Error).message}`,
    });
    return { capabilities, issues };
  }

  const candidates: Array<{ cap: Capability; source: string }> = [];
  for (const name of names) {
    const file = join(dir, name);
    let doc: unknown;
    try {
      doc = parse(await readFile(file, 'utf8'));
    } catch (e) {
      issues.push({ path: '', severity: 'error', source: name, message: `YAML inválido: ${(e as Error).message.split('\n')[0]}` });
      continue;
    }
    if (doc === null || doc === undefined) continue; // archivo vacío
    const ex = extractEntries(doc);
    if ('error' in ex) {
      issues.push({ path: '', severity: 'error', source: name, message: ex.error });
      continue;
    }
    ex.entries.forEach((raw, i) => {
      const source = ex.shape === 'una' ? name : `${name}[${i}]`;
      const found = validateCapability(raw, source) as CatalogIssue[];
      issues.push(...found);
      const hasErrors = found.some((x) => x.severity === 'error');
      if (!hasErrors) candidates.push({ cap: raw as Capability, source });
    });
  }

  // Unicidad: la primera definición se conserva; las repetidas se descartan con error.
  const dupes = findDuplicateIds(candidates.map((c) => ({ id: c.cap.id, source: c.source })));
  issues.push(...dupes);
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.cap.id)) continue;
    seen.add(c.cap.id);
    capabilities.push(c.cap);
  }
  return { capabilities, issues };
}
