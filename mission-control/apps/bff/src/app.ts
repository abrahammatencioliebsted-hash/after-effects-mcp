import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import type { MachineHeartbeat, McEvent, MissionStatus } from '@mc/contracts';
import type { McBackend } from './backends/types.js';
import { CatalogService } from './catalog.js';
import { openDb, type Db } from './db.js';
import { HttpError, badRequest, conflict, notFound, unauthorized } from './errors.js';
import { loadIdeas } from './ideas.js';
import { MachineRegistry } from './machines.js';
import { isAllowedHost, isAllowedOrigin } from './net.js';
import { SettingsStore } from './settings.js';
import { EventBus, formatSse } from './sse.js';
import { isMissionStatus } from './status.js';
import { asRecord, clampLimit, envKeyForMachine, iso } from './util.js';
import { optNote, reqNote, validateAgentCreate, validateDocCreate, validateMissionCreate } from './validate.js';

export interface Services {
  db: Db;
  settings: SettingsStore;
  machines: MachineRegistry;
  catalog: CatalogService;
}

export function buildServices(opts: { dataDir?: string | ':memory:'; catalogDir?: string; modelPricesFile?: string; now?: () => number; allowedHosts?: Iterable<string> } = {}): Services {
  const db = openDb(opts.dataDir ?? ':memory:');
  return {
    db,
    settings: new SettingsStore(db, opts.modelPricesFile ? { modelPricesFile: opts.modelPricesFile } : {}),
    machines: new MachineRegistry(db, { ...(opts.now ? { now: opts.now } : {}), ...(opts.allowedHosts ? { allowedHosts: opts.allowedHosts } : {}) }),
    catalog: new CatalogService(opts.catalogDir ?? join(import.meta.dirname, '../../../packages/catalog/catalog')),
  };
}

export interface AppOptions {
  backend: McBackend;
  services: Services;
  /** Ruta del Registro de elecciones (solo lectura). */
  electionsFile?: string;
  /** Token compartido con los node-agent. */
  nodeAgentToken?: string;
  /** Nombres de host (sin puerto) con los que el operador abre el panel además de loopback, IPs literales y *.ts.net (MC_ALLOWED_HOSTS). */
  allowedHosts?: Iterable<string>;
  /** Tamaño máximo del cuerpo JSON (2 MiB por defecto). */
  maxBodyBytes?: number;
  /** Intervalo del latido SSE (25 s por defecto; las pruebas lo acortan). */
  sseHeartbeatMs?: number;
  /** Cada cuánto se revisan las transiciones de estado de los equipos (15 s por defecto). */
  machineWatchMs?: number;
  /** Carpeta de la UI compilada; si existe `index.html` se sirve con respaldo SPA. */
  staticDir?: string;
  /** Para pruebas: dirección remota de la petición. */
  getRemoteAddress?: (c: Context) => string | undefined;
  fetchImpl?: typeof fetch;
  quiet?: boolean;
}

export type McApp = Hono & { bus: EventBus; close(): void };

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function bearerOf(c: Context): string | undefined {
  const h = c.req.header('authorization');
  const m = h ? /^Bearer\s+(.+)$/i.exec(h.trim()) : null;
  return m?.[1];
}

async function json(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  // Un cuerpo no vacío exige JSON explícito: así una petición "simple" cross-origin (text/plain, sin preflight) no puede mutar nada.
  const ct = c.req.header('content-type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(ct)) throw new HttpError(415, 'unsupported_media_type', 'El cuerpo debe enviarse con Content-Type: application/json');
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('El cuerpo no es JSON válido');
  }
}

export function createApp(opts: AppOptions): McApp {
  const { backend, services } = opts;
  const { db, settings, machines, catalog } = services;
  const bus = new EventBus();
  const unsubBackend = backend.subscribe((e) => bus.emit(e));
  const inflight = new Map<string, Promise<unknown>>();
  const sseMs = opts.sseHeartbeatMs ?? 25_000;
  const watch = setInterval(() => {
    for (const t of machines.detectTransitions()) bus.emit({ type: 'machine.changed', machineId: t.machineId, status: t.status, at: iso(Date.now()) });
  }, opts.machineWatchMs ?? 15_000);
  watch.unref();

  const app = new Hono() as McApp;
  const api = new Hono();
  const allowedHosts = new Set([...(opts.allowedHosts ?? [])].map((h) => h.toLowerCase()));
  const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const hostOf = (c: Context): string | undefined => {
    const h = c.req.header('host');
    if (h) return h;
    try {
      return new URL(c.req.url).host || undefined;
    } catch {
      return undefined;
    }
  };

  // Cuerpo acotado (413) antes de leer nada.
  api.use(
    '*',
    bodyLimit({
      maxSize: opts.maxBodyBytes ?? 2 * 1024 * 1024,
      onError: (c) => c.json({ error: 'Cuerpo demasiado grande (máximo 2 MiB)', code: 'payload_too_large' }, 413),
    }),
  );

  // Defensa frente a navegadores ajenos: Host conocido (anti DNS rebinding), Origin del propio panel y JSON explícito en mutaciones.
  // Un latido con el token correcto de node-agent viene de un proceso, no de un navegador, y queda exento.
  api.use('*', async (c, next) => {
    const given = bearerOf(c);
    if (given && opts.nodeAgentToken && constantTimeEqual(given, opts.nodeAgentToken)) return next();
    const host = hostOf(c);
    if (!isAllowedHost(host, allowedHosts)) {
      throw new HttpError(403, 'forbidden_host', `Host no permitido (${host ?? 'ausente'}): abre el panel por localhost, una IP, un nombre *.ts.net o añade el nombre a MC_ALLOWED_HOSTS`);
    }
    if (MUTATING.has(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin && origin !== 'null' && !isAllowedOrigin(origin, host, allowedHosts)) {
        throw new HttpError(403, 'forbidden_origin', `Origin no permitido (${origin}): las mutaciones solo se aceptan desde el propio panel`);
      }
      if (origin === 'null') throw new HttpError(403, 'forbidden_origin', 'Origin opaco (null) no permitido');
      const site = c.req.header('sec-fetch-site');
      if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'forbidden_origin', `Petición ${site} de otro sitio no permitida`);
    }
    return next();
  });

  const remoteAddr = (c: Context): string | undefined => {
    if (opts.getRemoteAddress) return opts.getRemoteAddress(c);
    const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
    return env?.incoming?.socket?.remoteAddress;
  };

  // ------------------------------------------------------------- salud y resumen
  api.get('/health', async (c) => {
    const report = await backend.health();
    if (!opts.nodeAgentToken && backend.mode === 'demo') {
      report.notes.push({ component: 'Latidos de node-agent', state: 'pendiente', note: 'Sin MC_NODE_AGENT_TOKEN: los latidos solo se aceptan desde loopback (127.0.0.1 / ::1).' });
    }
    return c.json(report);
  });

  api.get('/overview', async (c) => {
    const days = clampLimit(c.req.query('days'), 14, 90);
    return c.json(await backend.overview(days));
  });

  // ------------------------------------------------------------- misiones
  api.get('/missions', async (c) => {
    const rawStatus = c.req.query('status');
    let status: MissionStatus[] | undefined;
    if (rawStatus) {
      status = rawStatus.split(',').map((s) => s.trim()).filter(Boolean) as MissionStatus[];
      const bad = status.find((s) => !isMissionStatus(s));
      if (bad) throw badRequest(`status inválido: ${bad}`);
    }
    const scope = c.req.query('scope');
    if (scope && !['trabajo', 'proyectos', 'personal'].includes(scope)) throw badRequest(`scope inválido: ${scope}`);
    const q = c.req.query('q');
    const cursor = c.req.query('cursor');
    return c.json(
      await backend.listMissions({
        ...(status ? { status } : {}),
        ...(scope ? { scope } : {}),
        ...(q ? { q } : {}),
        limit: clampLimit(c.req.query('limit'), 50, 200),
        ...(cursor ? { cursor } : {}),
      }),
    );
  });

  api.post('/missions', async (c) => {
    const req = validateMissionCreate(await json(c));
    const key = c.req.header('idempotency-key')?.trim();
    if (!key) return c.json(await backend.createMission(req), 201);
    if (key.length > 200) throw badRequest('Idempotency-Key demasiado larga');
    const fullKey = `${backend.mode}:missions:${key}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(req)).digest('hex');
    const prior = inflight.get(fullKey);
    if (prior) await prior.catch(() => undefined);
    const stored = db.prepare('SELECT response_json, created_at FROM idempotency WHERE key = ?').get(fullKey) as { response_json: string; created_at: number } | undefined;
    if (stored && Date.now() - stored.created_at < 24 * 3_600_000) {
      const s = JSON.parse(stored.response_json) as { fingerprint: string; missionId: string };
      if (s.fingerprint !== fingerprint) throw new HttpError(409, 'idempotency_key_conflict', 'Idempotency-Key ya usada con otro cuerpo', { code: 'idempotency_key_conflict', missionId: s.missionId });
      c.header('Idempotent-Replayed', 'true');
      return c.json(await backend.getMission(s.missionId), 200);
    }
    const run = (async () => {
      const detail = await backend.createMission(req, { idempotencyKey: key });
      db.prepare('INSERT OR REPLACE INTO idempotency(key, response_json, created_at) VALUES(?,?,?)').run(fullKey, JSON.stringify({ fingerprint, missionId: detail.id }), Date.now());
      return detail;
    })();
    inflight.set(fullKey, run);
    try {
      return c.json(await run, 201);
    } finally {
      inflight.delete(fullKey);
      db.prepare('DELETE FROM idempotency WHERE created_at < ?').run(Date.now() - 24 * 3_600_000);
    }
  });

  api.get('/missions/:id', async (c) => c.json(await backend.getMission(c.req.param('id'))));
  api.post('/missions/:id/plan/approve', async (c) => c.json(await backend.approvePlan(c.req.param('id'), optNote(await json(c)))));
  api.post('/missions/:id/plan/reject', async (c) => c.json(await backend.rejectPlan(c.req.param('id'), reqNote(await json(c)))));
  api.post('/missions/:id/accept', async (c) => c.json(await backend.acceptMission(c.req.param('id'), optNote(await json(c)))));
  api.post('/missions/:id/request-changes', async (c) => c.json(await backend.requestChanges(c.req.param('id'), reqNote(await json(c)))));
  api.post('/missions/:id/rerun', async (c) => c.json(await backend.rerunMission(c.req.param('id'), optNote(await json(c)))));
  api.post('/missions/:id/stop', async (c) => c.json(await backend.stopMission(c.req.param('id'), optNote(await json(c)))));
  api.get('/missions/:id/replay', async (c) => c.json(await backend.replay(c.req.param('id'))));

  // ------------------------------------------------------------- agentes
  api.get('/agents', async (c) => c.json(await backend.listAgents(clampLimit(c.req.query('days'), 14, 90))));
  api.post('/agents', async (c) => c.json(await backend.createAgent(validateAgentCreate(await json(c))), 201));
  api.delete('/agents/:id', async (c) => c.json(await backend.deleteAgent(c.req.param('id'))));
  api.get('/agents/:id/runs', async (c) => c.json(await backend.listAgentRuns(c.req.param('id'), clampLimit(c.req.query('limit'), 50, 200))));

  // ------------------------------------------------------------- equipos
  api.get('/machines', async (c) => c.json(await backend.listMachines()));

  api.post('/machines/:id/heartbeat', async (c) => {
    const token = opts.nodeAgentToken;
    if (token) {
      const given = bearerOf(c);
      if (!given || !constantTimeEqual(given, token)) throw unauthorized();
    } else if (backend.mode === 'paperclip') {
      throw unauthorized('MC_NODE_AGENT_TOKEN no está configurado en el BFF; los latidos están desactivados');
    } else {
      const addr = remoteAddr(c);
      if (!addr || !LOOPBACK.has(addr)) throw unauthorized('Sin MC_NODE_AGENT_TOKEN solo se aceptan latidos desde loopback');
    }
    const id = c.req.param('id');
    const r = machines.heartbeat(id, await json(c), allowedHosts);
    if (r.changed) bus.emit({ type: 'machine.changed', machineId: id, status: r.changed.to, at: iso(Date.now()) });
    return c.json({ ok: true, nextIntervalSec: 30 });
  });

  const DEMO_COMMANDS = [
    { id: 'hermes-status', label: 'Estado de Hermes', description: 'Simulado: consulta el estado del gateway de Hermes.', argv: ['hermes', 'gateway', 'status'], requiresConfirmation: true, timeoutSec: 20 },
    { id: 'disk-report', label: 'Informe de disco', description: 'Simulado: espacio libre por unidad.', argv: ['df', '-h'], requiresConfirmation: true, timeoutSec: 20 },
  ];

  api.get('/machines/:id/commands', async (c) => {
    const id = c.req.param('id');
    if (!machines.get(id)) throw notFound('Equipo', id);
    return c.json(backend.mode === 'demo' ? DEMO_COMMANDS : machines.commandsFor(id));
  });

  api.post('/machines/:id/commands/:commandId', async (c) => {
    const id = c.req.param('id');
    const cmd = c.req.param('commandId');
    if (!machines.get(id)) throw notFound('Equipo', id);
    const body = asRecord(await json(c));
    if (body.confirm !== true) throw badRequest('Se requiere { "confirm": true }');
    if (backend.mode === 'demo') {
      if (!DEMO_COMMANDS.some((x) => x.id === cmd)) throw notFound('Comando', cmd);
      return c.json({ ok: true, stdout: `simulado: ${cmd} en ${id}`, stderr: '', exitCode: 0, durationMs: 42 });
    }
    if (!machines.get(id)!.allowedCommandIds.includes(cmd)) throw notFound('Comando permitido', cmd);
    const url = process.env[`MC_NODE_AGENT_URL_${envKeyForMachine(id)}`];
    if (!url || !opts.nodeAgentToken) throw new HttpError(501, 'invalid_request', `No hay URL de node-agent para ${id} (MC_NODE_AGENT_URL_${envKeyForMachine(id)}) o falta MC_NODE_AGENT_TOKEN`);
    const doFetch = opts.fetchImpl ?? fetch;
    try {
      const res = await doFetch(`${url.replace(/\/+$/, '')}/commands/${encodeURIComponent(cmd)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.nodeAgentToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await res.json()) as unknown;
      return c.json(data, res.ok ? 200 : 502);
    } catch (err) {
      throw new HttpError(503, 'hermes_unreachable', `No se pudo contactar al node-agent de ${id}`, { reason: (err as Error).message });
    }
  });

  // ------------------------------------------------------------- catálogo e ideas
  api.get('/catalog', async (c) => {
    const f: Record<string, string> = {};
    for (const k of ['tipo', 'equipo', 'ejecutor', 'estado'] as const) {
      const v = c.req.query(k);
      if (v) f[k] = v;
    }
    return c.json(await catalog.list(f));
  });
  api.get('/catalog/validate', async (c) => c.json(await catalog.validate()));
  api.get('/catalog/match', async (c) => {
    const caps = (c.req.query('capabilities') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!caps.length) throw badRequest('capabilities es obligatorio (ids separados por coma)');
    const [agents, ms] = await Promise.all([backend.listAgents(14), backend.listMachines()]);
    return c.json({ candidates: await catalog.match(caps, agents, ms, c.req.query('scope') || undefined) });
  });

  api.get('/ideas', async (c) => {
    const vault = Object.values(settings.get().vaultPaths)[0];
    const file = opts.electionsFile || vault?.electionsFile;
    const ideas = await loadIdeas(file);
    if (!ideas.length) return c.json(ideas);
    const missions = await backend.listMissions({ limit: 200 }).catch(() => ({ items: [] }));
    const byIdea = new Map(missions.items.filter((m) => m.ideaId).map((m) => [m.ideaId!, m.id]));
    return c.json(ideas.map((i) => (byIdea.has(i.id) ? { ...i, missionId: byIdea.get(i.id)! } : i)));
  });

  // ------------------------------------------------------------- docs, agenda, actividad
  api.get('/docs', async (c) => {
    const missionId = c.req.query('missionId');
    const q = c.req.query('q');
    return c.json(await backend.listDocs({ ...(missionId ? { missionId } : {}), ...(q ? { q } : {}) }));
  });
  api.get('/docs/:id', async (c) => c.json(await backend.getDoc(c.req.param('id'))));
  api.post('/docs', async (c) => c.json(await backend.createDoc(validateDocCreate(await json(c))), 201));

  api.get('/schedule', async (c) => c.json(await backend.listSchedule()));
  api.post('/schedule/:id/run-now', async (c) => c.json(await backend.runRoutineNow(c.req.param('id'))));

  api.get('/activity', async (c) => {
    const cursor = c.req.query('cursor');
    return c.json(await backend.listActivity({ limit: clampLimit(c.req.query('limit'), 50, 200), ...(cursor ? { cursor } : {}) }));
  });

  api.get('/settings', (c) => c.json(settings.get()));
  api.put('/settings', async (c) => c.json(settings.put(await json(c))));

  // ------------------------------------------------------------- SSE
  api.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      await stream.write(': conectado\n\n');
      let open = true;
      const send = (e: McEvent): void => {
        if (!open) return;
        const { event, data } = formatSse(e);
        void stream.writeSSE({ event, data }).catch(() => {
          open = false;
        });
      };
      const unsub = bus.subscribe(send);
      const hb = setInterval(() => send({ type: 'heartbeat', at: iso(Date.now()) }), sseMs);
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          open = false;
          clearInterval(hb);
          unsub();
          resolve();
        });
      });
    }),
  );

  app.route('/api/mc', api);
  app.all('/api/*', (c) => c.json({ error: 'Ruta no encontrada', code: 'not_found' }, 404));

  // ------------------------------------------------------------- UI estática
  if (opts.staticDir && existsSync(join(opts.staticDir, 'index.html'))) {
    const rel = relative(process.cwd(), opts.staticDir) || '.';
    app.use('/*', serveStatic({ root: rel }));
    app.get('*', serveStatic({ path: join(rel, 'index.html') }));
  }

  app.onError((err, c) => {
    let he: HttpError | undefined;
    if (err instanceof HttpError) he = err;
    else he = backend.mapError?.(err);
    if (!he) {
      if (!opts.quiet) console.error('[mc-bff] error interno:', err);
      he = new HttpError(500, 'internal', 'Error interno del BFF');
    }
    return c.json(he.toApiError(), he.status as 400);
  });

  app.bus = bus;
  app.close = () => {
    clearInterval(watch);
    unsubBackend();
  };
  return app;
}
