import { isIP } from 'node:net';
import { badRequest } from './errors.js';

/** Nombres que un navegador usa para el propio equipo. */
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function stripBrackets(h: string): string {
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

/** Lista separada por comas (MC_ALLOWED_HOSTS) → conjunto en minúsculas. */
export function parseHostList(v: string | undefined): Set<string> {
  return new Set(
    (v ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Loopback, redes privadas (RFC 1918), tailnet (100.64.0.0/10) y ULA IPv6. Excluye link-local (169.254/16, fe80::) a propósito. */
export function isPrivateOrTailnetIp(ip: string): boolean {
  const bare = stripBrackets(ip).toLowerCase();
  const v = isIP(bare);
  if (v === 4) {
    const [a, b] = bare.split('.').map(Number) as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) {
    if (bare === '::1') return true;
    if (bare.startsWith('fd') || bare.startsWith('fc')) return true;
    if (bare.startsWith('::ffff:')) return isPrivateOrTailnetIp(bare.slice(7));
    return false;
  }
  return false;
}

/**
 * Host aceptable para peticiones de navegador (defensa frente a DNS rebinding): el nombre con el que el operador abre el panel.
 * Se aceptan loopback, cualquier IP literal (un ataque de rebinding llega con el dominio del atacante, no con una IP),
 * los nombres MagicDNS de Tailscale (*.ts.net) y la lista del operador (MC_ALLOWED_HOSTS).
 */
export function isAllowedHost(hostHeader: string | undefined, allowed: ReadonlySet<string> = new Set()): boolean {
  if (!hostHeader) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader.trim()}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hostname) return false;
  if (LOOPBACK_NAMES.has(hostname)) return true;
  if (isIP(stripBrackets(hostname)) !== 0) return true;
  if (hostname.endsWith('.ts.net')) return true;
  return allowed.has(hostname);
}

/** `Origin` compatible con el host de la petición (mismo origen) o con la lista del operador. */
export function isAllowedOrigin(origin: string, hostHeader: string | undefined, allowed: ReadonlySet<string> = new Set()): boolean {
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.protocol !== 'http:' && o.protocol !== 'https:') return false;
  const hostname = o.hostname.toLowerCase();
  if (hostHeader) {
    try {
      const h = new URL(`http://${hostHeader.trim()}`);
      if (h.host.toLowerCase() === o.host.toLowerCase()) return true;
    } catch {
      /* host inválido: se decide por la lista */
    }
  }
  return allowed.has(hostname);
}

export function isLoopbackUrl(raw: string): boolean {
  try {
    const h = new URL(raw).hostname.toLowerCase();
    return LOOPBACK_NAMES.has(h) || h.startsWith('127.') || stripBrackets(h) === '::1';
  } catch {
    return false;
  }
}

/**
 * Valida la URL del API server de Hermes que llega en un latido (o se usa como destino de sondeo):
 * http(s), sin credenciales, sin query ni fragmento, y destino loopback, red privada, tailnet, *.ts.net o MC_ALLOWED_HOSTS.
 * Evita que un latido manipulado convierta al BFF en un sondeador (SSRF) o envíe la clave de Hermes de un equipo a otro servidor.
 */
export function validateHermesBaseUrl(raw: unknown, allowed: ReadonlySet<string> = new Set()): string {
  if (typeof raw !== 'string' || !raw.trim()) throw badRequest('hermes.apiServer.baseUrl debe ser una URL http(s)');
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw badRequest(`hermes.apiServer.baseUrl no es una URL válida: "${raw.trim().slice(0, 80)}"`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw badRequest('hermes.apiServer.baseUrl debe usar http o https');
  if (u.username || u.password) throw badRequest('hermes.apiServer.baseUrl no puede llevar credenciales');
  if (u.search || u.hash) throw badRequest('hermes.apiServer.baseUrl no admite query ni fragmento');
  const hostname = u.hostname.toLowerCase();
  const bare = stripBrackets(hostname);
  const ok = LOOPBACK_NAMES.has(hostname) || (isIP(bare) !== 0 ? isPrivateOrTailnetIp(bare) : hostname.endsWith('.ts.net') || allowed.has(hostname));
  if (!ok) {
    throw badRequest(`hermes.apiServer.baseUrl apunta a un destino no permitido (${hostname}): solo loopback, redes privadas, la tailnet (100.64.0.0/10, *.ts.net) o los nombres de MC_ALLOWED_HOSTS`);
  }
  return raw.trim().replace(/\/+$/, '');
}
