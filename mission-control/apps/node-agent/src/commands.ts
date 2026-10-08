import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { AllowedCommand } from '@mc/contracts';
import { ConfigError, type Config } from './config.js';
import { VERSION } from './version.js';

export const MAX_OUTPUT_BYTES = 64 * 1024;

export type CommandErrorCode = 'not_found' | 'confirmation_required';

export class CommandError extends Error {
  readonly code: CommandErrorCode;
  /** Código HTTP sugerido para la capa de servidor. */
  readonly status: number;
  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    this.status = code === 'not_found' ? 404 : 428;
  }
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Lista permitida por defecto. `argv[0]` es el ejecutable; el resto son argumentos fijos.
 * Las variantes por plataforma se eligen aquí, en tiempo de ejecución, nunca por entrada del usuario.
 */
export function defaultAllowedCommands(
  cfg: Pick<Config, 'hermesBin'> = { hermesBin: 'hermes' },
  platform: NodeJS.Platform = process.platform,
): AllowedCommand[] {
  const diskArgv =
    platform === 'win32'
      ? ['powershell', '-NoProfile', '-Command', 'Get-PSDrive -PSProvider FileSystem']
      : ['df', '-h'];
  return [
    {
      id: 'hermes-version',
      label: 'Versión de Hermes',
      description: 'Ejecuta `hermes --version` para comprobar la instalación.',
      argv: [cfg.hermesBin, '--version'],
      requiresConfirmation: true,
      timeoutSec: 10,
    },
    {
      id: 'hermes-gateway-status',
      label: 'Estado del gateway de Hermes',
      description: 'Ejecuta `hermes gateway status` (solo lectura).',
      argv: [cfg.hermesBin, 'gateway', 'status'],
      requiresConfirmation: true,
      timeoutSec: 15,
    },
    {
      id: 'hermes-profile-list',
      label: 'Perfiles de Hermes',
      description: 'Ejecuta `hermes profile list` (solo lectura).',
      argv: [cfg.hermesBin, 'profile', 'list'],
      requiresConfirmation: true,
      timeoutSec: 15,
    },
    {
      id: 'disk-usage',
      label: 'Uso de disco',
      description:
        platform === 'win32' ? 'Lista las unidades con Get-PSDrive (PowerShell).' : 'Muestra el uso de disco con `df -h`.',
      argv: diskArgv,
      requiresConfirmation: true,
      timeoutSec: 15,
    },
    {
      id: 'node-agent-version',
      label: 'Versión del node-agent',
      description: 'Imprime la versión del node-agent y de Node.js.',
      argv: [process.execPath, '-p', JSON.stringify(`mc-node-agent ${VERSION} (node ${process.version})`)],
      requiresConfirmation: true,
      timeoutSec: 10,
    },
  ];
}

function validateCommand(raw: unknown, index: number): AllowedCommand {
  const where = `Comando #${index + 1} del archivo de comandos permitidos`;
  if (typeof raw !== 'object' || raw === null) throw new ConfigError([`${where}: debe ser un objeto.`]);
  const c = raw as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof c.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(c.id)) problems.push(`${where}: "id" debe ser minúsculas/números/guiones.`);
  if (typeof c.label !== 'string' || !c.label) problems.push(`${where}: falta "label".`);
  if (typeof c.description !== 'string') problems.push(`${where}: falta "description".`);
  if (!Array.isArray(c.argv) || c.argv.length === 0 || !c.argv.every((a) => typeof a === 'string' && a !== ''))
    problems.push(`${where}: "argv" debe ser una lista no vacía de textos (ejecutable + argumentos fijos).`);
  if (typeof c.requiresConfirmation !== 'boolean') problems.push(`${where}: "requiresConfirmation" debe ser booleano.`);
  if (typeof c.timeoutSec !== 'number' || !(c.timeoutSec > 0 && c.timeoutSec <= 3600)) problems.push(`${where}: "timeoutSec" debe estar entre 1 y 3600.`);
  if (problems.length) throw new ConfigError(problems);
  return {
    id: c.id as string,
    label: c.label as string,
    description: c.description as string,
    argv: [...(c.argv as string[])],
    requiresConfirmation: c.requiresConfirmation as boolean,
    timeoutSec: c.timeoutSec as number,
  };
}

/** Carga MC_ALLOWED_COMMANDS_FILE si existe en la config; si no, la lista por defecto. */
export async function loadAllowedCommands(cfg: Pick<Config, 'hermesBin' | 'allowedCommandsFile'>): Promise<AllowedCommand[]> {
  if (!cfg.allowedCommandsFile) return defaultAllowedCommands(cfg);
  let text: string;
  try {
    text = await readFile(cfg.allowedCommandsFile, 'utf8');
  } catch (err) {
    throw new ConfigError([`No se pudo leer MC_ALLOWED_COMMANDS_FILE (${cfg.allowedCommandsFile}): ${(err as Error).message}`]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError([`MC_ALLOWED_COMMANDS_FILE no es JSON válido: ${(err as Error).message}`]);
  }
  if (!Array.isArray(parsed)) throw new ConfigError(['MC_ALLOWED_COMMANDS_FILE debe contener un arreglo JSON de AllowedCommand.']);
  const list = parsed.map(validateCommand);
  const ids = new Set<string>();
  for (const c of list) {
    if (ids.has(c.id)) throw new ConfigError([`Id de comando duplicado en MC_ALLOWED_COMMANDS_FILE: "${c.id}".`]);
    ids.add(c.id);
  }
  return list;
}

function truncate(text: string): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= MAX_OUTPUT_BYTES) return text;
  return buf.subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + '\n[... salida truncada a 64 KB ...]';
}

/**
 * Ejecuta un comando de la lista permitida. Solo recibe el id y `confirm`: el argv es siempre el declarado,
 * sin interpolar nada del usuario y sin shell (execFile).
 */
export function runAllowedCommand(
  id: string,
  opts: { confirm?: boolean } = {},
  commands: AllowedCommand[] = defaultAllowedCommands(),
): Promise<CommandResult> {
  const cmd = commands.find((c) => c.id === id);
  if (!cmd) return Promise.reject(new CommandError('not_found', `Comando no permitido o inexistente: "${id}".`));
  if (cmd.requiresConfirmation && opts.confirm !== true) {
    return Promise.reject(new CommandError('confirmation_required', `El comando "${id}" requiere confirmación (confirm: true).`));
  }
  const [file, ...args] = cmd.argv;
  if (!file) return Promise.reject(new CommandError('not_found', `El comando "${id}" no tiene ejecutable.`));
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: cmd.timeoutSec * 1000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - started;
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        let exitCode = 0;
        let errText = String(stderr ?? '');
        if (e) {
          exitCode = typeof e.code === 'number' ? e.code : -1;
          if (e.killed) errText += `\n[tiempo de espera agotado: ${cmd.timeoutSec} s]`;
          else if (typeof e.code === 'string') errText += `\n[${e.code}: ${e.message}]`;
        }
        resolve({ ok: !e, stdout: truncate(String(stdout ?? '')), stderr: truncate(errText.trim()), exitCode, durationMs });
      },
    );
  });
}
