import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AllowedCommand, MachineHeartbeat } from '@mc/contracts';
import type { Config } from './config.js';
import { CommandError, runAllowedCommand } from './commands.js';
import type { Logger } from './log.js';
import { VERSION } from './version.js';

export interface ServerDeps {
  cfg: Config;
  log: Logger;
  commands: AllowedCommand[];
  /** Último latido (o una muestra nueva si aún no hay). */
  getSnapshot: () => Promise<MachineHeartbeat>;
}

/** Comparación en tiempo constante: se comparan hashes SHA-256 de igual longitud. */
export function tokenMatches(expected: string, provided: string): boolean {
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  return timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), 'cache-control': 'no-store' });
  res.end(data);
}

async function readBody(req: IncomingMessage, limit = 4096): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > limit) throw Object.assign(new Error('Cuerpo demasiado grande.'), { status: 413 });
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createAgentServer(deps: ServerDeps): Server {
  const { cfg, log, commands } = deps;
  const startedAt = Date.now();

  const authorize = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!cfg.token) {
      sendJson(res, 503, { ok: false, error: 'Rutas protegidas deshabilitadas: MC_NODE_AGENT_TOKEN no está configurado.' });
      return false;
    }
    const header = req.headers.authorization ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m || !tokenMatches(cfg.token, m[1]!.trim())) {
      res.setHeader('www-authenticate', 'Bearer');
      sendJson(res, 401, { ok: false, error: 'No autorizado: falta o es inválido el token Bearer.' });
      return false;
    }
    return true;
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';

    if (path === '/health' && method === 'GET') {
      return sendJson(res, 200, { ok: true, machineId: cfg.machineId, version: VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
    }
    if (path === '/commands' && method === 'GET') {
      if (!authorize(req, res)) return;
      return sendJson(res, 200, commands);
    }
    if (path === '/snapshot' && method === 'GET') {
      if (!authorize(req, res)) return;
      return sendJson(res, 200, await deps.getSnapshot());
    }
    const cm = /^\/commands\/([^/]+)$/.exec(path);
    if (cm && method === 'POST') {
      if (!authorize(req, res)) return;
      let id: string;
      try {
        id = decodeURIComponent(cm[1]!);
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Id de comando inválido.' });
      }
      let confirm = false;
      const raw = await readBody(req);
      if (raw.trim() !== '') {
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return sendJson(res, 400, { ok: false, error: 'El cuerpo debe ser JSON: {"confirm": true|false}.' });
        }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          return sendJson(res, 400, { ok: false, error: 'El cuerpo debe ser un objeto JSON.' });
        }
        const c = (body as Record<string, unknown>).confirm;
        if (c !== undefined && typeof c !== 'boolean') return sendJson(res, 400, { ok: false, error: '"confirm" debe ser booleano.' });
        confirm = c === true;
      }
      try {
        log.info('Ejecutando comando permitido', { commandId: id, confirm });
        const result = await runAllowedCommand(id, { confirm }, commands);
        log.info('Comando terminado', { commandId: id, ok: result.ok, exitCode: result.exitCode, durationMs: result.durationMs });
        return sendJson(res, 200, result);
      } catch (err) {
        if (err instanceof CommandError) {
          log.warn('Comando rechazado', { commandId: id, code: err.code });
          return sendJson(res, err.status, { ok: false, error: err.message, code: err.code });
        }
        throw err;
      }
    }
    sendJson(res, 404, { ok: false, error: 'Ruta no encontrada.' });
  };

  return createServer((req, res) => {
    handler(req, res).catch((err: Error & { status?: number }) => {
      const status = err.status ?? 500;
      if (status >= 500) log.error('Error en la petición', { path: req.url, error: err.message });
      if (!res.headersSent) sendJson(res, status, { ok: false, error: status === 500 ? 'Error interno.' : err.message });
      else res.end();
    });
  });
}

export function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
  });
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
