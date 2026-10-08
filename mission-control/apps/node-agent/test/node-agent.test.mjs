import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { loadConfig, ConfigError } from '../dist/config.js';
import { sampleHealth, parseNvidiaSmi } from '../dist/health.js';
import { checkHermes, parseProfiles } from '../dist/hermes.js';
import { runAllowedCommand, defaultAllowedCommands, loadAllowedCommands, CommandError } from '../dist/commands.js';
import { createAgentServer, listen, closeServer } from '../dist/server.js';
import { HeartbeatLoop, collectHeartbeat, nodeAgentUrl } from '../dist/heartbeat.js';
import { createLogger, nullLogger } from '../dist/log.js';

const TOKEN = 'token-de-prueba-123';

function baseCfg(over = {}) {
  return {
    machineId: 'test-machine',
    machineName: 'Prueba',
    machineOs: 'linux',
    hermesUrl: 'http://127.0.0.1:1',
    hermesBin: 'hermes-no-existe-xyz',
    heartbeatSec: 30,
    host: '127.0.0.1',
    port: 0,
    diskPath: '/',
    maxHeavyJobs: 1,
    token: TOKEN,
    ...over,
  };
}

function startHttp(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
const stop = (srv) => new Promise((r) => { srv.close(() => r()); srv.closeAllConnections?.(); });

function freeClosedPort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// ---------------- config ----------------

test('config: falta MC_MACHINE_ID y valores inválidos acumulan errores en español', () => {
  assert.throws(
    () => loadConfig({ MC_HEARTBEAT_SEC: '5', MC_NODE_AGENT_PORT: 'abc', MC_BFF_URL: 'ftp://x' }),
    (e) => {
      assert.ok(e instanceof ConfigError);
      const t = e.problems.join('\n');
      assert.match(t, /MC_MACHINE_ID es obligatorio/);
      assert.match(t, /MC_HEARTBEAT_SEC debe ser un entero >= 10/);
      assert.match(t, /MC_NODE_AGENT_PORT/);
      assert.match(t, /MC_BFF_URL no es una URL/);
      return true;
    },
  );
});

test('config: MC_BFF_URL exige MC_NODE_AGENT_TOKEN', () => {
  assert.throws(() => loadConfig({ MC_MACHINE_ID: 'a', MC_BFF_URL: 'http://127.0.0.1:3100' }), /MC_NODE_AGENT_TOKEN es obligatorio/);
});

test('config: valores por defecto y modo solo local', () => {
  const c = loadConfig({ MC_MACHINE_ID: 'win-principal' }, 'linux');
  assert.equal(c.bffUrl, undefined);
  assert.equal(c.hermesUrl, 'http://127.0.0.1:8642');
  assert.equal(c.hermesBin, 'hermes');
  assert.equal(c.heartbeatSec, 30);
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 3400);
  assert.equal(c.diskPath, '/');
  assert.equal(c.maxHeavyJobs, 1);
  assert.equal(c.machineOs, 'linux');
  assert.ok(c.machineName.length > 0);
  const w = loadConfig({ MC_MACHINE_ID: 'w', MC_BFF_URL: 'http://bff:3100/', MC_NODE_AGENT_TOKEN: 't' }, 'win32');
  assert.equal(w.diskPath, 'C:\\');
  assert.equal(w.machineOs, 'windows');
  assert.equal(w.bffUrl, 'http://bff:3100');
  assert.equal(loadConfig({ MC_MACHINE_ID: 'm' }, 'darwin').machineOs, 'macos');
});

// ---------------- health ----------------

test('sampleHealth devuelve números plausibles', async () => {
  const h = await sampleHealth(baseCfg(), nullLogger);
  assert.ok(h.cpuPercent >= 0 && h.cpuPercent <= 100, `cpu ${h.cpuPercent}`);
  assert.ok(h.memTotalBytes > 0);
  assert.ok(h.memUsedBytes >= 0 && h.memUsedBytes <= h.memTotalBytes);
  assert.ok(h.diskTotalBytes > 0 && h.diskUsedBytes <= h.diskTotalBytes);
  assert.ok(h.uptimeSec > 0);
  assert.ok(h.gpu === null || typeof h.gpu.name === 'string');
  assert.doesNotThrow(() => new Date(h.at).toISOString());
});

test('sampleHealth: disco inexistente no lanza y avisa', async () => {
  const lines = [];
  const h = await sampleHealth(baseCfg({ diskPath: '/ruta/que/no/existe/xyz' }), createLogger((l) => lines.push(l)));
  assert.equal(h.diskTotalBytes, 0);
  assert.equal(h.diskUsedBytes, 0);
  assert.ok(lines.some((l) => JSON.parse(l).level === 'warn'));
});

test('parseNvidiaSmi y parseProfiles', () => {
  const g = parseNvidiaSmi('NVIDIA GeForce RTX 4090, 1024, 24564, 37\n');
  assert.deepEqual(g, { name: 'NVIDIA GeForce RTX 4090', memUsedBytes: 1024 * 1048576, memTotalBytes: 24564 * 1048576, utilPercent: 37 });
  assert.equal(parseNvidiaSmi(''), null);
  assert.deepEqual(parseProfiles('Profile   Path\n------\n* default  /x\nmac-lab  /y\n'), ['default', 'mac-lab']);
});

// ---------------- hermes ----------------

test('checkHermes: API alcanzable (servidor falso) y binario ausente', async () => {
  const { srv, port } = await startHttp((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(req.url === '/health' ? '{"status":"ok"}' : '{}');
  });
  try {
    const s = await checkHermes({ hermesUrl: `http://127.0.0.1:${port}`, hermesBin: 'hermes-no-existe-xyz' });
    assert.equal(s.apiServer.reachable, true);
    assert.equal(s.apiServer.baseUrl, `http://127.0.0.1:${port}`);
    assert.ok(s.apiServer.lastCheckedAt);
    assert.equal(s.installed, false);
  } finally {
    await stop(srv);
  }
});

test('checkHermes: puerto cerrado => no alcanzable con error', async () => {
  const port = await freeClosedPort();
  const s = await checkHermes({ hermesUrl: `http://127.0.0.1:${port}`, hermesBin: 'hermes-no-existe-xyz' });
  assert.equal(s.apiServer.reachable, false);
  assert.ok(s.apiServer.error && s.apiServer.error.length > 0);
});

test('checkHermes: HTTP 500 se reporta como no alcanzable', async () => {
  const { srv, port } = await startHttp((_req, res) => { res.statusCode = 500; res.end('x'); });
  try {
    const s = await checkHermes({ hermesUrl: `http://127.0.0.1:${port}`, hermesBin: 'hermes-no-existe-xyz' });
    assert.equal(s.apiServer.reachable, false);
    assert.equal(s.apiServer.error, 'HTTP 500');
  } finally {
    await stop(srv);
  }
});

// ---------------- commands ----------------

test('runAllowedCommand: id desconocido => error 404; sin confirmar => error 428', async () => {
  await assert.rejects(runAllowedCommand('rm-rf', { confirm: true }), (e) => e instanceof CommandError && e.status === 404 && e.code === 'not_found');
  const cmds = [{ id: 'peligroso', label: 'x', description: 'x', argv: [process.execPath, '-p', '1'], requiresConfirmation: true, timeoutSec: 5 }];
  await assert.rejects(runAllowedCommand('peligroso', { confirm: false }, cmds), (e) => e instanceof CommandError && e.status === 428);
  const ok = await runAllowedCommand('peligroso', { confirm: true }, cmds);
  assert.equal(ok.ok, true);
});

test('runAllowedCommand: node-agent-version se ejecuta', async () => {
  await assert.rejects(runAllowedCommand('node-agent-version', {}), (e) => e instanceof CommandError && e.status === 428);
  const r = await runAllowedCommand('node-agent-version', { confirm: true });
  assert.equal(r.ok, true);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /mc-node-agent 0\.1\.0/);
  assert.ok(r.durationMs >= 0);
});

test('runAllowedCommand: trunca a 64 KB, respeta timeout y no usa shell', async () => {
  const cmds = [
    { id: 'grande', label: 'g', description: 'g', argv: [process.execPath, '-e', 'process.stdout.write("a".repeat(200000))'], requiresConfirmation: false, timeoutSec: 10 },
    { id: 'lento', label: 'l', description: 'l', argv: [process.execPath, '-e', 'setTimeout(()=>{},10000)'], requiresConfirmation: false, timeoutSec: 1 },
    { id: 'meta', label: 'm', description: 'm', argv: [process.execPath, '-p', '"a;echo INYECTADO"'], requiresConfirmation: false, timeoutSec: 5 },
  ];
  const big = await runAllowedCommand('grande', {}, cmds);
  assert.ok(big.stdout.length < 70 * 1024 && big.stdout.includes('truncada'));
  const slow = await runAllowedCommand('lento', {}, cmds);
  assert.equal(slow.ok, false);
  assert.match(slow.stderr, /tiempo de espera/);
  const meta = await runAllowedCommand('meta', {}, cmds);
  assert.equal(meta.stdout.trim(), 'a;echo INYECTADO');
});

test('nodeAgentUrl: solo con host no loopback; los cinco comandos exigen confirmación', async () => {
  assert.equal(nodeAgentUrl({ host: '127.0.0.1', port: 3400 }), undefined);
  assert.equal(nodeAgentUrl({ host: '0.0.0.0', port: 3400 }), undefined);
  assert.equal(nodeAgentUrl({ host: '100.64.1.2', port: 3400 }), 'http://100.64.1.2:3400');
  const hb = await collectHeartbeat(baseCfg({ host: '100.64.1.2', port: 3400, maxHeavyJobs: 2 }), [], nullLogger);
  assert.equal(hb.nodeAgentUrl, 'http://100.64.1.2:3400');
  assert.equal(hb.maxHeavyJobs, 2);
  assert.ok(defaultAllowedCommands().every((c) => c.requiresConfirmation === true));
});

test('lista permitida por defecto: ids y variantes por plataforma', () => {
  const ids = defaultAllowedCommands().map((c) => c.id);
  assert.deepEqual(ids, ['hermes-version', 'hermes-gateway-status', 'hermes-profile-list', 'disk-usage', 'node-agent-version']);
  assert.equal(defaultAllowedCommands({ hermesBin: 'hermes' }, 'win32').find((c) => c.id === 'disk-usage').argv[0], 'powershell');
  assert.deepEqual(defaultAllowedCommands({ hermesBin: 'hermes' }, 'darwin').find((c) => c.id === 'disk-usage').argv, ['df', '-h']);
});

test('loadAllowedCommands: valida el archivo JSON', async () => {
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'mc-na-'));
  const good = join(dir, 'good.json');
  const bad = join(dir, 'bad.json');
  await writeFile(good, JSON.stringify([{ id: 'eco', label: 'Eco', description: 'd', argv: ['echo', 'hola'], requiresConfirmation: false, timeoutSec: 5 }]));
  await writeFile(bad, JSON.stringify([{ id: 'MAL ID', argv: [] }]));
  const list = await loadAllowedCommands({ hermesBin: 'hermes', allowedCommandsFile: good });
  assert.equal(list[0].id, 'eco');
  await assert.rejects(loadAllowedCommands({ hermesBin: 'hermes', allowedCommandsFile: bad }), ConfigError);
  await assert.rejects(loadAllowedCommands({ hermesBin: 'hermes', allowedCommandsFile: join(dir, 'nada.json') }), ConfigError);
});

// ---------------- server ----------------

test('servidor: /health público; rutas protegidas 401 sin bearer y 200 con bearer; comandos', async () => {
  const cfg = baseCfg();
  const commands = defaultAllowedCommands(cfg);
  const lines = [];
  const server = createAgentServer({
    cfg, commands, log: createLogger((l) => lines.push(l)),
    getSnapshot: () => collectHeartbeat(cfg, commands, nullLogger),
  });
  const port = await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${TOKEN}` };
  try {
    const h = await fetch(`${base}/health`);
    assert.equal(h.status, 200);
    const hb = await h.json();
    assert.equal(hb.ok, true);
    assert.equal(hb.machineId, 'test-machine');
    assert.equal(typeof hb.uptimeSec, 'number');

    assert.equal((await fetch(`${base}/commands`)).status, 401);
    assert.equal((await fetch(`${base}/commands`, { headers: { authorization: 'Bearer incorrecto' } })).status, 401);
    assert.equal((await fetch(`${base}/snapshot`)).status, 401);
    assert.equal((await fetch(`${base}/commands/disk-usage`, { method: 'POST', body: '{}' })).status, 401);

    const cl = await fetch(`${base}/commands`, { headers: auth });
    assert.equal(cl.status, 200);
    assert.equal((await cl.json()).length, 5);

    const snap = await fetch(`${base}/snapshot`, { headers: auth });
    assert.equal(snap.status, 200);
    const s = await snap.json();
    assert.equal(s.machineId, 'test-machine');
    assert.ok(s.health.memTotalBytes > 0);

    assert.equal((await fetch(`${base}/commands/node-agent-version`, { method: 'POST', headers: auth, body: '{"confirm":false}' })).status, 428);
    const run = await fetch(`${base}/commands/node-agent-version`, { method: 'POST', headers: auth, body: '{"confirm":true}' });
    assert.equal(run.status, 200);
    assert.equal((await run.json()).ok, true);

    assert.equal((await fetch(`${base}/commands/hermes-profile-list`, { method: 'POST', headers: auth, body: '{"confirm":false}' })).status, 428);
    assert.equal((await fetch(`${base}/commands/no-existe`, { method: 'POST', headers: auth, body: '{"confirm":true}' })).status, 404);
    assert.equal((await fetch(`${base}/commands/disk-usage`, { method: 'POST', headers: auth, body: 'no-json' })).status, 400);
    assert.equal((await fetch(`${base}/otra`)).status, 404);
  } finally {
    await closeServer(server);
  }
  assert.ok(lines.length > 0);
  assert.ok(!lines.join('\n').includes(TOKEN), 'el token no debe aparecer en los logs');
});

test('servidor: sin token configurado las rutas protegidas responden 503', async () => {
  const cfg = baseCfg({ token: undefined });
  const server = createAgentServer({ cfg, commands: [], log: nullLogger, getSnapshot: async () => ({}) });
  const port = await listen(server, '127.0.0.1', 0);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/commands`)).status, 503);
  } finally {
    await closeServer(server);
  }
});

// ---------------- heartbeat ----------------

test('heartbeat: envía el payload del contrato y respeta nextIntervalSec', async () => {
  const received = [];
  const { srv, port } = await startHttp((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ url: req.url, method: req.method, auth: req.headers.authorization, body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true,"nextIntervalSec":45}');
    });
  });
  try {
    const cfg = baseCfg({ bffUrl: `http://127.0.0.1:${port}` });
    const commands = defaultAllowedCommands(cfg);
    const loop = new HeartbeatLoop({ cfg, log: nullLogger, collect: () => collectHeartbeat(cfg, commands, nullLogger) });
    const r = await loop.tick();
    assert.equal(r.ok, true);
    assert.equal(r.delayMs, 45_000);
    assert.equal(received.length, 1);
    const q = received[0];
    assert.equal(q.method, 'POST');
    assert.equal(q.url, '/api/mc/machines/test-machine/heartbeat');
    assert.equal(q.auth, `Bearer ${TOKEN}`);
    const b = q.body;
    for (const k of ['machineId', 'name', 'os', 'nodeAgentVersion', 'health', 'hermes', 'allowedCommandIds']) assert.ok(k in b, `falta ${k}`);
    assert.equal(b.machineId, 'test-machine');
    assert.equal(b.os, 'linux');
    assert.equal(b.nodeAgentVersion, '0.1.0');
    for (const k of ['at', 'cpuPercent', 'memUsedBytes', 'memTotalBytes', 'diskUsedBytes', 'diskTotalBytes', 'uptimeSec']) assert.ok(k in b.health, `falta health.${k}`);
    assert.equal(typeof b.hermes.installed, 'boolean');
    assert.equal(typeof b.hermes.apiServer.reachable, 'boolean');
    assert.deepEqual(b.allowedCommandIds, commands.map((c) => c.id));
    assert.equal(b.maxHeavyJobs, 1);
    assert.equal(b.activeHeavyJobs, 0);
    assert.ok(!('nodeAgentUrl' in b), 'en loopback no se envía nodeAgentUrl');
    assert.ok(loop.latest);
  } finally {
    await stop(srv);
  }
});

test('heartbeat: con HTTP 500 retrocede exponencialmente (tope 5 min) y se recupera', async () => {
  let status = 500;
  const { srv, port } = await startHttp((req, res) => {
    req.resume();
    req.on('end', () => { res.statusCode = status; res.end(status === 200 ? '{"ok":true}' : 'error'); });
  });
  try {
    const cfg = baseCfg({ bffUrl: `http://127.0.0.1:${port}`, heartbeatSec: 30 });
    const fake = { machineId: 'x', name: 'x', os: 'linux', nodeAgentVersion: '0.1.0', health: {}, hermes: {}, allowedCommandIds: [] };
    const loop = new HeartbeatLoop({ cfg, log: nullLogger, collect: async () => fake });
    const delays = [];
    for (let i = 0; i < 6; i++) {
      const r = await loop.tick();
      assert.equal(r.ok, false);
      assert.match(r.error, /HTTP 500/);
      delays.push(r.delayMs);
    }
    assert.deepEqual(delays, [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
    assert.equal(loop.consecutiveFailures, 6);
    status = 200;
    const ok = await loop.tick();
    assert.equal(ok.ok, true);
    assert.equal(ok.delayMs, 30_000);
    assert.equal(loop.consecutiveFailures, 0);
  } finally {
    await stop(srv);
  }
});

test('heartbeat: BFF caído no lanza; modo solo local no envía; start/stop', async () => {
  const port = await freeClosedPort();
  const fake = { machineId: 'x', name: 'x', os: 'linux', nodeAgentVersion: '0.1.0', health: {}, hermes: {}, allowedCommandIds: [] };
  const down = new HeartbeatLoop({ cfg: baseCfg({ bffUrl: `http://127.0.0.1:${port}` }), log: nullLogger, collect: async () => fake });
  const r = await down.tick();
  assert.equal(r.ok, false);

  let calls = 0;
  const local = new HeartbeatLoop({
    cfg: baseCfg(), log: nullLogger, intervalMs: 20,
    collect: async () => { calls++; return fake; },
    fetchImpl: async () => { throw new Error('no debe llamarse'); },
  });
  local.start();
  await new Promise((r2) => setTimeout(r2, 120));
  local.stop();
  const n = calls;
  assert.ok(n >= 2, `calls=${n}`);
  await new Promise((r2) => setTimeout(r2, 60));
  assert.equal(calls, n);
});
