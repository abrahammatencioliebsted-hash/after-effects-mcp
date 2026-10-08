import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { configFromEnv, startServer } from '../dist/index.js';
import { CATALOG_DIR, FIXTURE, heartbeatBody } from './helpers.mjs';

test('configFromEnv: valores por defecto y validación', () => {
  const c = configFromEnv({});
  assert.equal(c.mode, 'demo');
  assert.equal(c.port, 3300);
  assert.equal(c.paperclipUrl, 'http://127.0.0.1:3100');
  assert.equal(c.host, '127.0.0.1');
  assert.throws(() => configFromEnv({ MC_BACKEND: 'otro' }), /MC_BACKEND inválido/);
  assert.throws(() => configFromEnv({ MC_PORT: 'abc' }), /MC_PORT inválido/);
  assert.equal(configFromEnv({ MC_BACKEND: 'paperclip', MC_NODE_AGENT_TOKEN: 't' }).nodeAgentToken, 't');
});

test('servidor real en puerto 0: banner en mayúsculas, UI estática con respaldo SPA, latido por loopback y SSE', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-bff-'));
  const ui = join(dir, 'ui');
  mkdirSync(join(ui, 'assets'), { recursive: true });
  writeFileSync(join(ui, 'index.html'), '<!doctype html><title>MC</title><div id="root"></div>');
  writeFileSync(join(ui, 'assets', 'app.js'), 'console.log("ok")');
  const lines = [];
  const srv = await startServer(
    configFromEnv({ MC_PORT: '0', MC_DATA_DIR: join(dir, 'data'), MC_CATALOG_PATH: CATALOG_DIR, MC_ELECTIONS_FILE: FIXTURE, MC_STATIC_DIR: ui }),
    (l) => lines.push(l),
  );
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    assert.ok(lines.some((l) => l.includes('MODO: DEMO')), 'el banner muestra el modo en mayúsculas');
    assert.ok(lines.some((l) => l.includes('DATOS SIMULADOS')));
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /<div id="root">/);
    const spa = await fetch(`${base}/missions/DEMO-3`);
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /<div id="root">/);
    const asset = await fetch(`${base}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /console\.log/);
    const nf = await fetch(`${base}/api/mc/no-existe`);
    assert.equal(nf.status, 404);
    assert.equal((await nf.json()).code, 'not_found');

    const hb = await fetch(`${base}/api/mc/machines/mac/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(heartbeatBody('mac', { os: 'macos' })) });
    assert.equal(hb.status, 200, 'loopback real sin token');
    const health = await (await fetch(`${base}/api/mc/health`)).json();
    assert.ok(health.notes.some((n) => /loopback/.test(n.note)));

    const ac = new AbortController();
    const res = await fetch(`${base}/api/mc/events`, { signal: ac.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.ok(first.includes(': conectado'));
    ac.abort();
  } finally {
    await srv.close();
  }
});
