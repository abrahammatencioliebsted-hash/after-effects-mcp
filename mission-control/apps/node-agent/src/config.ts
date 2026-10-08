import { hostname } from 'node:os';
import type { MachineOs } from '@mc/contracts';

export interface Config {
  /** Sin URL del BFF el agente corre en modo "solo local" (no envía latidos). */
  bffUrl?: string;
  token?: string;
  machineId: string;
  machineName: string;
  machineOs: MachineOs;
  hermesUrl: string;
  hermesBin: string;
  heartbeatSec: number;
  host: string;
  port: number;
  diskPath: string;
  allowedCommandsFile?: string;
  maxHeavyJobs: number;
}

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Configuración inválida del node-agent:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

function clean(env: Env, key: string): string | undefined {
  const v = env[key];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

function parseIntStrict(raw: string): number | undefined {
  return /^-?\d+$/.test(raw) ? Number(raw) : undefined;
}

export function detectOs(platform: NodeJS.Platform = process.platform): MachineOs {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

function validUrl(raw: string): URL | undefined {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : undefined;
  } catch {
    return undefined;
  }
}

/** Lee y valida la configuración desde variables de entorno. Acumula todos los problemas en un solo error. */
export function loadConfig(env: Env = process.env, platform: NodeJS.Platform = process.platform): Config {
  const problems: string[] = [];

  let bffUrl: string | undefined;
  const bffRaw = clean(env, 'MC_BFF_URL');
  if (bffRaw) {
    const u = validUrl(bffRaw);
    if (!u) problems.push(`MC_BFF_URL no es una URL http(s) válida: "${bffRaw}".`);
    else bffUrl = bffRaw.replace(/\/+$/, '');
  }

  const token = clean(env, 'MC_NODE_AGENT_TOKEN');
  if (bffUrl && !token) {
    problems.push('MC_NODE_AGENT_TOKEN es obligatorio cuando MC_BFF_URL está definido (el BFF exige Bearer en los latidos).');
  }

  const machineId = clean(env, 'MC_MACHINE_ID');
  if (!machineId) problems.push('MC_MACHINE_ID es obligatorio (por ejemplo "win-principal").');
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(machineId)) {
    problems.push(`MC_MACHINE_ID solo admite letras, números, ".", "_" y "-" (máx. 64): "${machineId}".`);
  }

  let machineOs = detectOs(platform);
  const osRaw = clean(env, 'MC_MACHINE_OS');
  if (osRaw) {
    if (osRaw === 'windows' || osRaw === 'macos' || osRaw === 'linux') machineOs = osRaw;
    else problems.push(`MC_MACHINE_OS debe ser windows, macos o linux: "${osRaw}".`);
  }

  const hermesUrlRaw = clean(env, 'MC_HERMES_URL') ?? 'http://127.0.0.1:8642';
  if (!validUrl(hermesUrlRaw)) problems.push(`MC_HERMES_URL no es una URL http(s) válida: "${hermesUrlRaw}".`);

  let heartbeatSec = 30;
  const hbRaw = clean(env, 'MC_HEARTBEAT_SEC');
  if (hbRaw !== undefined) {
    const n = parseIntStrict(hbRaw);
    if (n === undefined || n < 10) problems.push(`MC_HEARTBEAT_SEC debe ser un entero >= 10: "${hbRaw}".`);
    else heartbeatSec = n;
  }

  let port = 3400;
  const portRaw = clean(env, 'MC_NODE_AGENT_PORT');
  if (portRaw !== undefined) {
    const n = parseIntStrict(portRaw);
    if (n === undefined || n < 0 || n > 65535) problems.push(`MC_NODE_AGENT_PORT debe ser un entero entre 0 y 65535: "${portRaw}".`);
    else port = n;
  }

  let maxHeavyJobs = 1;
  const heavyRaw = clean(env, 'MC_MAX_HEAVY_JOBS');
  if (heavyRaw !== undefined) {
    const n = parseIntStrict(heavyRaw);
    if (n === undefined || n < 1) problems.push(`MC_MAX_HEAVY_JOBS debe ser un entero >= 1: "${heavyRaw}".`);
    else maxHeavyJobs = n;
  }

  const cfg: Config = {
    machineId: machineId ?? '',
    machineName: clean(env, 'MC_MACHINE_NAME') ?? hostname(),
    machineOs,
    hermesUrl: hermesUrlRaw.replace(/\/+$/, ''),
    hermesBin: clean(env, 'MC_HERMES_BIN') ?? 'hermes',
    heartbeatSec,
    host: clean(env, 'MC_NODE_AGENT_HOST') ?? '127.0.0.1',
    port,
    diskPath: clean(env, 'MC_DISK_PATH') ?? (platform === 'win32' ? 'C:\\' : '/'),
    maxHeavyJobs,
  };
  if (bffUrl) cfg.bffUrl = bffUrl;
  if (token) cfg.token = token;
  const cmdFile = clean(env, 'MC_ALLOWED_COMMANDS_FILE');
  if (cmdFile) cfg.allowedCommandsFile = cmdFile;

  if (problems.length > 0) throw new ConfigError(problems);
  return cfg;
}
