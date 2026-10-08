#!/usr/bin/env node
import { startHermesMock } from './index.js';

function usage(): string {
  return [
    'Uso: hermes-mock --key <clave> [--port 18642] [--complete-delay-ms 300]',
    '                  [--max-concurrent-runs 10] [--output-text "..."]',
    '',
    'Mock de Hermes (SIMULACION): no ejecuta modelo ni herramientas. Solo escucha en 127.0.0.1.',
    'La clave tambien puede venir de HERMES_MOCK_KEY.',
  ].join('\n');
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      out['help'] = 'true';
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) throw new Error(`Falta el valor de ${a}`);
        out[a.slice(2)] = v;
        i++;
      }
    } else {
      throw new Error(`Argumento no reconocido: ${a}`);
    }
  }
  return out;
}

function intArg(args: Record<string, string>, name: string): number | undefined {
  const raw = args[name];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} debe ser un entero >= 0`);
  return n;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args['help']) {
    console.log(usage());
    return;
  }
  const apiKey = args['key'] ?? process.env['HERMES_MOCK_KEY'];
  if (!apiKey) throw new Error('Falta --key <clave> (o HERMES_MOCK_KEY)');
  const port = intArg(args, 'port') ?? 18642;
  const completeDelayMs = intArg(args, 'complete-delay-ms');
  const maxConcurrentRuns = intArg(args, 'max-concurrent-runs');
  const handle = await startHermesMock({
    port,
    apiKey,
    ...(completeDelayMs !== undefined ? { completeDelayMs } : {}),
    ...(maxConcurrentRuns !== undefined ? { maxConcurrentRuns } : {}),
    ...(args['output-text'] !== undefined ? { outputText: args['output-text'] } : {}),
  });
  console.log(`Mock de Hermes (SIMULACION) escuchando en ${handle.url}`);
  console.log('Ctrl+C para cerrar.');
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void handle.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  console.error(usage());
  process.exit(1);
});
