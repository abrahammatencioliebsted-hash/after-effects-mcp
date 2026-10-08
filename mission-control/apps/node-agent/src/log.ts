/** Registro JSON-lines a stdout: {t, level, msg, ...campos}. Nunca debe recibir el token. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const RESERVED = new Set(['t', 'level', 'msg']);

export function createLogger(write: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (RESERVED.has(k)) continue;
      // Defensa en profundidad: ningún campo con nombre de secreto llega al log.
      if (/token|secret|password|authorization/i.test(k)) continue;
      extra[k] = v;
    }
    write(JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export const nullLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
