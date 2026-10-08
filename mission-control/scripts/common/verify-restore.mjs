#!/usr/bin/env node
// Mission Control — verificar una instancia de Paperclip recién restaurada (solo lectura).
//
// Comprueba por la API REST (modo local_trusted, loopback) que la empresa, el agente hermes_gateway (apiKey = secret_ref),
// los secretos y la tarea esperada existen, y —si das --db-url y --master-key-file— que los secretos cifrados
// (local_encrypted_v1, AES-256-GCM) SE DESCIFRAN con la master.key restaurada comparando el SHA-256 con el guardado en la
// base (nunca imprime el valor). Incluye un control negativo: con una clave aleatoria el descifrado debe fallar.
//
// Uso:
//   node verify-restore.mjs --api http://127.0.0.1:3102/api [--company-name "Mission Control — piloto"] \
//        [--issue <uuid> --issue-status done] [--secret-name HERMES_API_SERVER_KEY_LAB] \
//        [--db-url postgres://paperclip:paperclip@127.0.0.1:54330/paperclip --master-key-file <instancia>/secrets/master.key \
//         [--paperclip-db-path <dir de @paperclipai/db>]]
// Código de salida: 0 todo correcto · 1 algún fallo.
//
// Nota: en modo "authenticated" la API pide token de board (variable PAPERCLIP_API_KEY → cabecera Bearer); aquí se envía si existe.
// Verificado en Linux contra paperclipai@2026.1005.0 (docs/evidencias/restauracion-lab.md). NO verificado en Windows/macOS.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import { createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const AYUDA = `Uso: node verify-restore.mjs --api <URL/api> [--company-name <nombre>] [--issue <uuid> --issue-status <estado>]
        [--secret-name <NOMBRE>] [--db-url <postgres://…> --master-key-file <ruta> [--paperclip-db-path <dir>]] [--json]`;

function fail(m) { console.error(`ERROR: ${m}`); process.exit(1); }
function parse(argv) {
  const o = { api: 'http://127.0.0.1:3100/api', company: 'Mission Control — piloto', issueStatus: 'done', secretName: 'HERMES_API_SERVER_KEY_LAB' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const v = () => { if (i + 1 >= argv.length) fail(`falta el valor de ${a}`); return argv[++i]; };
    if (a === '--api') o.api = v().replace(/\/+$/, '');
    else if (a === '--company-name') o.company = v();
    else if (a === '--issue') o.issue = v();
    else if (a === '--issue-status') o.issueStatus = v();
    else if (a === '--secret-name') o.secretName = v();
    else if (a === '--db-url') o.dbUrl = v();
    else if (a === '--master-key-file') o.keyFile = v();
    else if (a === '--paperclip-db-path') o.dbPath = v();
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') { console.log(AYUDA); process.exit(0); }
    else fail(`argumento desconocido: ${a}\n${AYUDA}`);
  }
  return o;
}

const resultados = [];
function check(id, nombre, ok, detalle) {
  resultados.push({ id, nombre, ok: !!ok, detalle });
  if (!process.argv.includes('--json')) console.log(`${ok ? 'PASA ' : 'FALLA'}  ${id}  ${nombre} — ${detalle}`);
}

async function get(api, ruta) {
  const h = { accept: 'application/json' };
  if (process.env.PAPERCLIP_API_KEY) h.authorization = `Bearer ${process.env.PAPERCLIP_API_KEY}`;
  const r = await fetch(`${api}${ruta}`, { headers: h });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}

function decodificarClave(raw) {
  const t = raw.trim();
  if (/^[A-Fa-f0-9]{64}$/.test(t)) return Buffer.from(t, 'hex');
  const b = Buffer.from(t, 'base64'); if (b.length === 32) return b;
  if (Buffer.byteLength(t, 'utf8') === 32) return Buffer.from(t, 'utf8');
  return null;
}
function descifrar(clave, m) {
  const d = createDecipheriv('aes-256-gcm', clave, Buffer.from(m.iv, 'base64'));
  d.setAuthTag(Buffer.from(m.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(m.ciphertext, 'base64')), d.final()]).toString('utf8');
}
function sha(s) { return createHash('sha256').update(s).digest('hex'); }

function localizarPostgres(dbPath) {
  const cands = [];
  if (dbPath) cands.push(resolve(dbPath));
  if (process.env.MC_PAPERCLIP_DB_PATH) cands.push(resolve(process.env.MC_PAPERCLIP_DB_PATH));
  // Misma lista que restore-db.mjs: instalación global de npm (Windows nativo: `npm i -g paperclipai`), gestionada y cachés npx.
  try {
    const npm = platform() === 'win32' ? 'npm.cmd' : 'npm';
    const raiz = execFileSync(npm, ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: platform() === 'win32' }).trim();
    if (raiz) {
      cands.push(join(raiz, 'paperclipai', 'node_modules', '@paperclipai', 'db'));
      cands.push(join(raiz, '@paperclipai', 'db'));
    }
  } catch { /* npm no disponible: se ignora */ }
  cands.push(join(homedir(), '.paperclip', 'cli', 'current', 'node_modules', '@paperclipai', 'db'));
  cands.push(join(homedir(), '.paperclip', 'cli', 'current', 'node_modules', 'paperclipai', 'node_modules', '@paperclipai', 'db'));
  const cachesNpx = [join(homedir(), '.npm', '_npx')];
  if (platform() === 'win32' && process.env.LOCALAPPDATA) cachesNpx.push(join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'));
  for (const npx of cachesNpx) {
    if (!existsSync(npx)) continue;
    for (const d of readdirSync(npx)) cands.push(join(npx, d, 'node_modules', '@paperclipai', 'db'));
  }
  for (const c of cands) {
    if (existsSync(join(c, 'package.json'))) {
      try { const m = createRequire(join(c, 'package.json'))('postgres'); return m.default ?? m; } catch { /* siguiente */ }
    }
  }
  return null;
}

async function main() {
  const o = parse(process.argv.slice(2));
  const API = o.api;
  let h;
  try { h = await get(API, '/health'); } catch (e) { fail(`no se pudo conectar a ${API}: ${e.message}`); }
  check('H1', 'GET /health', h.status === 200 && h.body?.status === 'ok', `HTTP ${h.status}; status=${h.body?.status}; version=${h.body?.version}; authReady=${h.body?.authReady}; bootstrapStatus=${h.body?.bootstrapStatus}`);

  const cs = await get(API, '/companies');
  const lista = Array.isArray(cs.body) ? cs.body : [];
  const empresa = lista.find((c) => c.name === o.company);
  check('H2', `empresa "${o.company}" listada`, !!empresa, `HTTP ${cs.status}; ${lista.length} empresa(s): ${lista.map((c) => c.name).join(' | ') || '(ninguna)'}`);
  if (!empresa) return terminar(o);
  const cid = empresa.id;

  const ag = await get(API, `/companies/${cid}/agents`);
  const agentes = Array.isArray(ag.body) ? ag.body : [];
  const hg = agentes.filter((a) => a.adapterType === 'hermes_gateway');
  const todosRef = hg.length > 0 && hg.every((a) => a.adapterConfig?.apiKey?.type === 'secret_ref');
  check('H3', 'agente(s) hermes_gateway con apiKey.type === "secret_ref"', todosRef, hg.map((a) => `${a.name} [${a.status}] apiKey.type=${a.adapterConfig?.apiKey?.type}`).join(' ; ') || 'no hay agentes hermes_gateway');

  const se = await get(API, `/companies/${cid}/secrets`);
  const secretos = Array.isArray(se.body) ? se.body : [];
  const sec = secretos.find((s) => s.name === o.secretName);
  check('H4', `secreto ${o.secretName} listado`, !!sec, `${secretos.length} secreto(s): ${secretos.map((s) => s.name).join(' | ')}`);

  const ph = await get(API, `/companies/${cid}/secret-providers/health`);
  const le = (ph.body?.providers ?? []).find((p) => p.provider === 'local_encrypted');
  check('H5', 'secret-providers/health: local_encrypted ok con archivo de clave', le?.status === 'ok' && le?.details?.keyFilePath, `status=${le?.status}; keySource=${le?.details?.keySource}; keyFilePath=${le?.details?.keyFilePath}`);

  if (o.issue) {
    const is = await get(API, `/issues/${o.issue}`);
    check('H6', `tarea ${o.issue} en estado ${o.issueStatus}`, is.body?.status === o.issueStatus, `HTTP ${is.status}; ${is.body?.identifier}; status=${is.body?.status}; completedAt=${is.body?.completedAt}`);
  }

  if (o.dbUrl && o.keyFile) {
    const postgres = localizarPostgres(o.dbPath);
    if (!postgres) check('H7', 'descifrar secretos con master.key', false, 'no se encontró el driver postgres (usa --paperclip-db-path)');
    else {
      const clave = decodificarClave(readFileSync(o.keyFile, 'utf8'));
      if (!clave) check('H7', 'master.key válida', false, `formato inválido en ${o.keyFile}`);
      else {
        const sql = postgres(o.dbUrl, { max: 1, connect_timeout: 5 });
        try {
          const filas = await sql`
            SELECT s.name, v.version, v.material, v.value_sha256
            FROM company_secret_versions v JOIN company_secrets s ON s.id = v.secret_id
            WHERE s.company_id = ${cid} AND s.provider = 'local_encrypted' AND v.status = 'current'`;
          let ok = 0; const malos = [];
          for (const f of filas) {
            try { if (sha(descifrar(clave, f.material)) === f.value_sha256) ok++; else malos.push(`${f.name}: sha distinto`); }
            catch (e) { malos.push(`${f.name}: ${e.message.split('.')[0]}`); }
          }
          check('H7', 'secretos local_encrypted se descifran con la master.key restaurada (sha256 coincide)', filas.length > 0 && malos.length === 0, `${ok}/${filas.length} correctos${malos.length ? '; fallos: ' + malos.join(' ; ') : ''}`);
          let negativoFalla = 0;
          const mala = randomBytes(32);
          for (const f of filas) { try { descifrar(mala, f.material); } catch { negativoFalla++; } }
          check('H8', 'control negativo: con una clave aleatoria el descifrado FALLA', filas.length > 0 && negativoFalla === filas.length, `${negativoFalla}/${filas.length} fallaron como se esperaba`);
        } catch (e) {
          check('H7', 'descifrar secretos con master.key', false, `error de base: ${e.message}`);
        } finally { await sql.end(); }
      }
    }
  }
  terminar(o);
}

function terminar(o) {
  const malos = resultados.filter((r) => !r.ok).length;
  if (o.json) console.log(JSON.stringify({ ok: malos === 0, resultados }, null, 2));
  else console.log(`\nResumen: ${resultados.length - malos}/${resultados.length} comprobaciones correctas.`);
  process.exit(malos === 0 ? 0 : 1);
}

main().catch((e) => fail(e?.stack ?? String(e)));
