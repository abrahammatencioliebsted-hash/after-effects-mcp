// Generación del informe Markdown a partir de las filas que registra lab/fallos.test.mjs. Sin E/S: pura y testeable.

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export const VEREDICTOS = ['cubre', 'parcial', 'no cubre'];

/**
 * Una fila: { id, titulo, configuracion, resultado (string), veredicto, significado,
 *             inicioUtc, finUtc, segundos, raw (objeto JSON), notas (string[]) }
 */
export function renderTable(rows) {
  const head = '| # | Escenario | Configuración | Resultado observado | Veredicto | Qué significa para Mission Control |\n| --- | --- | --- | --- | --- | --- |';
  const body = rows.map((r) => `| ${r.id} | ${esc(r.titulo)} | ${esc(r.configuracion)} | ${esc(r.resultado)} | **${esc(r.veredicto)}** | ${esc(r.significado)} |`);
  return [head, ...body].join('\n');
}

export function renderScenario(r, { truncate = 6000 } = {}) {
  const json = JSON.stringify(r.raw ?? {}, null, 2);
  const shown = json.length > truncate ? `${json.slice(0, truncate)}\n… (${json.length - truncate} caracteres omitidos; ver JSON completo en tests/lab/.runtime/)` : json;
  return [
    `### ${r.id}. ${r.titulo}`,
    '',
    `- Inicio (UTC): \`${r.inicioUtc}\` · Fin (UTC): \`${r.finUtc}\` · Duración del escenario: ${r.segundos ?? '?'} s`,
    `- Configuración: ${r.configuracion}`,
    `- Resultado: ${r.resultado}`,
    `- Veredicto: **${r.veredicto}** — ${r.significado}`,
    ...(r.notas?.length ? ['- Notas:', ...r.notas.map((n) => `  - ${n}`)] : []),
    '',
    '<details><summary>JSON bruto (extractos)</summary>',
    '',
    '```json',
    shown,
    '```',
    '',
    '</details>',
    '',
  ].join('\n');
}

export function renderReport({ env, rows, generatedUtc, noDemuestra }) {
  const lines = [
    '# Fallos del adaptador `hermes_gateway` contra el mock de Hermes',
    '',
    `Generado automáticamente por \`tests/lab/fallos.test.mjs\` (\`pnpm --filter @mc/tests test:lab\`) · ${generatedUtc} UTC.`,
    '',
    '> Todo lo de aquí es observado **[H]** en vivo contra el Paperclip real y el adaptador real `hermes_gateway`; el ejecutor remoto es el **mock** (`@mc/hermes-mock`), no un Hermes real.',
    '',
    '## Entorno',
    '',
    ...Object.entries(env).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Resumen por escenario',
    '',
    renderTable(rows),
    '',
    '## Detalle por escenario',
    '',
    ...rows.map((r) => renderScenario(r)),
    '## Qué NO demuestra',
    '',
    ...noDemuestra.map((l) => `- ${l}`),
    '',
  ];
  return lines.join('\n');
}
