import { execFile } from 'node:child_process';
import type { MachineHermesStatus } from '@mc/contracts';
import type { Config } from './config.js';

function run(file: string, args: string[], timeoutMs: number): Promise<{ stdout: string; err: NodeJS.ErrnoException | null }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve({ stdout: String(stdout ?? ''), err: err as NodeJS.ErrnoException | null });
    });
  });
}

/** Extrae nombres de perfil de `hermes profile list` (mejor esfuerzo: la salida no es un contrato). */
export function parseProfiles(out: string): string[] {
  const names: string[] = [];
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[*>\s]+/, '');
    if (!line || !/^[A-Za-z0-9]/.test(line)) continue;
    const first = line.split(/\s+/)[0] ?? '';
    if (/^(profiles?|name|nombre)$/i.test(first)) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(first)) continue;
    if (!names.includes(first)) names.push(first);
  }
  return names;
}

async function probeApi(baseUrl: string): Promise<MachineHermesStatus['apiServer']> {
  const lastCheckedAt = new Date().toISOString();
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    // Se drena el cuerpo para liberar el socket.
    await res.arrayBuffer().catch(() => undefined);
    if (res.ok) return { reachable: true, baseUrl, lastCheckedAt };
    return { reachable: false, baseUrl, lastCheckedAt, error: `HTTP ${res.status}` };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const reason = e.name === 'TimeoutError' ? 'tiempo de espera agotado (3 s)' : (e.cause?.code ?? e.message);
    return { reachable: false, baseUrl, lastCheckedAt, error: String(reason) };
  }
}

export async function checkHermes(cfg: Pick<Config, 'hermesUrl' | 'hermesBin'>): Promise<MachineHermesStatus> {
  const [apiServer, ver] = await Promise.all([probeApi(cfg.hermesUrl), run(cfg.hermesBin, ['--version'], 5000)]);

  if (ver.err && ver.err.code === 'ENOENT') {
    return { installed: false, apiServer };
  }
  const status: MachineHermesStatus = { installed: true, apiServer };
  if (!ver.err) {
    const line = ver.stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '');
    if (line) status.version = line.slice(0, 120);
    const prof = await run(cfg.hermesBin, ['profile', 'list'], 5000);
    if (!prof.err) {
      const profiles = parseProfiles(prof.stdout);
      if (profiles.length > 0) status.profiles = profiles;
    }
  }
  return status;
}
