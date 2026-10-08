#!/usr/bin/env node
// Mission Control — restaurar un volcado .sql.gz de Paperclip en su PostgreSQL embebido.
//
// Paperclip NO trae un comando `db:restore`. Este script llama a la función que sí exporta el paquete
// instalado `@paperclipai/db`: `runDatabaseRestore({ connectionString, backupFile, connectTimeoutSeconds })`.
// Esa función prueba primero `psql` (PAPERCLIP_PSQL_PATH o el del PATH) y, si no existe o falla, repite el
// volcado sentencia a sentencia con el driver `postgres` (usa los marcadores `-- paperclip statement breakpoint`).
// Por eso NO hace falta instalar psql. Fuente: packages/db/src/backup-lib.ts (runDatabaseRestore).
//
// Uso:
//   node restore-db.mjs --dump <archivo.sql.gz> --db-url postgres://paperclip:paperclip@127.0.0.1:54329/paperclip \
//        [--paperclip-db-path <carpeta de @paperclipai/db>] [--yes] [--dry-run] [--allow-remote-host]
//
// DESTRUCTIVO: el volcado hace DROP TABLE ... CASCADE por tabla y recrea los datos. Sin --yes solo muestra el plan.
// Sin secretos en este archivo: la contraseña de --db-url se oculta al imprimir.
//
// Verificado aquí (Linux, Node 24.21, paperclipai@2026.1005.0): ver docs/evidencias/restauracion-lab.md.
// NO verificado en Windows ni en macOS.

import { existsSync, readFileSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { homedir, platform } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// ---- Versiones fijadas (cambiar aquí, no en el cuerpo) -------------------------------------------------
const PAPERCLIP_VERSION_ESPERADA = '2026.1005.0';
const NODE_MINIMO = [24, 11, 0];

const AYUDA = `Uso: node restore-db.mjs --dump <archivo.sql.gz> --db-url <postgres://usuario:clave@127.0.0.1:PUERTO/paperclip> [opciones]

Opciones:
  --dump <archivo>            Volcado .sql.gz (o .sql) creado por "paperclipai db:backup".
  --db-url <url>              Cadena de conexión del PostgreSQL embebido de la instancia DESTINO (servidor arriba).
  --paperclip-db-path <dir>   Carpeta del paquete @paperclipai/db. Si falta se busca en: variable MC_PAPERCLIP_DB_PATH,
                              $(npm root -g)/paperclipai/node_modules/@paperclipai/db,
                              ~/.paperclip/cli/current/node_modules/@paperclipai/db y ~/.npm/_npx/*/node_modules/@paperclipai/db.
  --yes                       Confirma el paso destructivo (sin él solo se muestra el plan y se sale con código 2).
  --dry-run                   Muestra el plan y las comprobaciones; no toca la base.
  --allow-remote-host         Permite un host distinto de 127.0.0.1/localhost (no recomendado).
  --no-psql                   Fuerza el motor JavaScript (ignora cualquier psql instalado). Es lo normal en un equipo sin psql.
  --psql <ruta>               Usa ese psql (equivale a PAPERCLIP_PSQL_PATH).
  --timeout <s>               Segundos de espera de conexión (por defecto 5).
  --help                      Esta ayuda.

Códigos de salida: 0 correcto · 1 error · 2 falta --yes (plan mostrado).`;

function log(msg) { console.log(msg); }
function fail(msg, code = 1) { console.error(`ERROR: ${msg}`); process.exit(code); }

function parseArgs(argv) {
  const o = { yes: false, dryRun: false, allowRemote: false, timeout: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) fail(`falta el valor de ${a}`); return argv[++i]; };
    switch (a) {
      case '--dump': o.dump = val(); break;
      case '--db-url': o.dbUrl = val(); break;
      case '--paperclip-db-path': o.dbPath = val(); break;
      case '--timeout': o.timeout = Number(val()); break;
      case '--yes': case '-y': o.yes = true; break;
      case '--dry-run': o.dryRun = true; break;
      case '--allow-remote-host': o.allowRemote = true; break;
      case '--no-psql': o.noPsql = true; break;
      case '--psql': o.psql = val(); break;
      case '--help': case '-h': log(AYUDA); process.exit(0); break;
      default: fail(`argumento desconocido: ${a}\n\n${AYUDA}`);
    }
  }
  return o;
}

function maskUrl(u) {
  try { const x = new URL(u); if (x.password) x.password = '***'; return x.toString(); } catch { return '<URL inválida>'; }
}

function checkNode() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < NODE_MINIMO[0] || (maj === NODE_MINIMO[0] && min < NODE_MINIMO[1])) {
    fail(`Node ${process.versions.node} es menor que ${NODE_MINIMO.join('.')}; Paperclip exige Node >= ${NODE_MINIMO.join('.')}.`);
  }
}

function candidatos(opts) {
  const lista = [];
  if (opts.dbPath) lista.push(['--paperclip-db-path', resolve(opts.dbPath)]);
  if (process.env.MC_PAPERCLIP_DB_PATH) lista.push(['MC_PAPERCLIP_DB_PATH', resolve(process.env.MC_PAPERCLIP_DB_PATH)]);
  try {
    const npm = platform() === 'win32' ? 'npm.cmd' : 'npm';
    const raiz = execFileSync(npm, ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: platform() === 'win32' }).trim();
    if (raiz) lista.push(['npm root -g', join(raiz, 'paperclipai', 'node_modules', '@paperclipai', 'db')]);
  } catch { /* npm no disponible: se ignora */ }
  lista.push(['~/.paperclip/cli/current', join(homedir(), '.paperclip', 'cli', 'current', 'node_modules', '@paperclipai', 'db')]);
  lista.push(['~/.paperclip/cli/current (anidado)', join(homedir(), '.paperclip', 'cli', 'current', 'node_modules', 'paperclipai', 'node_modules', '@paperclipai', 'db')]);
  const npx = join(homedir(), '.npm', '_npx');
  if (existsSync(npx)) {
    for (const d of readdirSync(npx)) lista.push([`caché npx (${d})`, join(npx, d, 'node_modules', '@paperclipai', 'db')]);
  }
  return lista;
}

function localizarPaquete(opts) {
  const intentos = [];
  for (const [origen, ruta] of candidatos(opts)) {
    const entrada = join(ruta, 'dist', 'index.js');
    intentos.push(`  - ${origen}: ${ruta} ${existsSync(entrada) ? '(ENCONTRADO)' : '(no existe)'}`);
    if (existsSync(entrada)) return { origen, ruta, entrada, intentos };
  }
  fail(`no se encontró @paperclipai/db. Probado:\n${intentos.join('\n')}\nIndica la carpeta con --paperclip-db-path o MC_PAPERCLIP_DB_PATH.`);
}

async function inspeccionarDump(ruta) {
  const tam = statSync(ruta).size;
  const gz = ruta.endsWith('.gz');
  const flujo = gz ? createReadStream(ruta).pipe(createGunzip()) : createReadStream(ruta);
  let bytes = 0, marcadores = 0, primeras = '', resto = '', cola = '';
  for await (const trozo of flujo) {
    bytes += trozo.length;
    const s = resto + trozo.toString('utf8');
    const lineas = s.split('\n');
    resto = lineas.pop() ?? ''; // la última línea puede venir partida entre trozos
    for (const l of lineas) if (l.startsWith('-- paperclip statement breakpoint')) marcadores++;
    if (primeras.length < 400) primeras += s.slice(0, 400 - primeras.length);
    cola = (cola + s).slice(-600);
  }
  if (resto.startsWith('-- paperclip statement breakpoint')) marcadores++;
  cola = (cola + resto).slice(-600);
  // El motor JS cierra con "COMMIT;" seguido de un marcador; pg_dump termina en COMMIT;/fin de archivo.
  const terminaEnCommit = /COMMIT;\s*(--[^\n]*\s*)*$/.test(cola);
  return { tam, bytes, marcadores, primeras, terminaEnCommit };
}

function psqlDisponible() {
  const bin = process.env.PAPERCLIP_PSQL_PATH || 'psql';
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: false });
  if (r.error || r.status !== 0) return { bin, ok: false };
  return { bin, ok: true, version: r.stdout.trim() };
}

async function resumenTablas(rutaDb, url) {
  // Cuenta filas de tablas clave con el driver `postgres` que ya trae @paperclipai/db. Mejor esfuerzo.
  try {
    const req = createRequire(join(rutaDb, 'package.json'));
    const mod = req('postgres');
    const postgres = mod.default ?? mod;
    const sql = postgres(url, { max: 1, connect_timeout: 5 });
    const salida = {};
    for (const t of ['companies', 'agents', 'issues', 'company_secrets', 'heartbeat_runs']) {
      try { salida[t] = Number((await sql.unsafe(`SELECT count(*)::int AS n FROM "public"."${t}"`))[0].n); }
      catch (e) { salida[t] = `error: ${e.message}`; }
    }
    await sql.end();
    return salida;
  } catch (e) {
    return { aviso: `no se pudo contar filas: ${e.message}` };
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  checkNode();
  if (!opts.dump) fail(`falta --dump\n\n${AYUDA}`);
  if (!opts.dbUrl) fail(`falta --db-url\n\n${AYUDA}`);
  const dump = resolve(opts.dump);
  if (!existsSync(dump)) fail(`no existe el volcado: ${dump}`);

  let url;
  try { url = new URL(opts.dbUrl); } catch { fail('--db-url no es una URL válida'); }
  if (!/^postgres(ql)?:$/.test(url.protocol)) fail('--db-url debe empezar por postgres:// o postgresql://');
  const hostLocal = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  if (!hostLocal && !opts.allowRemote) {
    fail(`el host ${url.hostname} no es local. Un volcado hace DROP TABLE; usa --allow-remote-host solo si estás seguro.`);
  }

  log('== Mission Control · restaurar base de Paperclip ==');
  log(`Node            : ${process.version} (${platform()})`);
  log(`Versión Paperclip esperada del paquete: ${PAPERCLIP_VERSION_ESPERADA}`);
  log(`Volcado         : ${dump} (${statSync(dump).size} bytes)`);
  log(`Destino         : ${maskUrl(opts.dbUrl)}`);

  const pkg = localizarPaquete(opts);
  log(`Paquete db      : ${pkg.ruta}  [origen: ${pkg.origen}]`);
  try {
    const v = JSON.parse(readFileSync(join(pkg.ruta, 'package.json'), 'utf8')).version;
    log(`Versión @paperclipai/db: ${v}${v === PAPERCLIP_VERSION_ESPERADA ? '' : `  (AVISO: se esperaba ${PAPERCLIP_VERSION_ESPERADA}; el volcado debe ser de la misma versión o anterior)`}`);
  } catch { /* sin package.json legible */ }

  const info = await inspeccionarDump(dump);
  log(`Volcado descomprimido: ${info.bytes} bytes · ${info.marcadores} marcadores "statement breakpoint"`);
  log(`Cabecera        : ${info.primeras.split('\n').slice(0, 2).join(' | ')}`);
  log(info.terminaEnCommit ? 'Cierre          : termina en COMMIT (volcado completo)' : 'AVISO: el volcado no termina en COMMIT; puede estar truncado. No continúes sin revisarlo.');

  if (opts.noPsql) process.env.PAPERCLIP_PSQL_PATH = join(homedir(), '.mc-psql-inexistente'); // fuerza el respaldo JS
  else if (opts.psql) process.env.PAPERCLIP_PSQL_PATH = opts.psql;
  const ps = psqlDisponible();
  log(ps.ok ? `psql            : ${ps.bin} (${ps.version}) — se usará primero` : `psql            : "${ps.bin}" no disponible — runDatabaseRestore usará el motor JavaScript (driver postgres) con los marcadores`);
  log('Comando equivalente manual: gunzip -c <dump> | psql "<db-url>" --set=ON_ERROR_STOP=1 --quiet --no-psqlrc');

  if (opts.dryRun) { log('\n[--dry-run] No se tocó nada.'); return; }
  if (!opts.yes) {
    log('\nPASO DESTRUCTIVO: sobrescribe las tablas de la base destino. Vuelve a ejecutar con --yes para confirmar.');
    process.exit(2);
  }

  const modulo = await import(pathToFileURL(pkg.entrada).href);
  if (typeof modulo.runDatabaseRestore !== 'function') {
    fail(`${pkg.entrada} no exporta runDatabaseRestore (exporta: ${Object.keys(modulo).filter((k) => /Database|backup/i.test(k)).join(', ') || 'nada relacionado'}).`);
  }
  log(`\n> runDatabaseRestore({ connectionString: ${maskUrl(opts.dbUrl)}, backupFile: ${basename(dump)}, connectTimeoutSeconds: ${opts.timeout} })`);
  const t0 = Date.now();
  try {
    await modulo.runDatabaseRestore({ connectionString: opts.dbUrl, backupFile: dump, connectTimeoutSeconds: opts.timeout });
  } catch (e) {
    console.error(`ERROR: la restauración falló: ${e?.message ?? e}`);
    process.exit(1);
  }
  const seg = ((Date.now() - t0) / 1000).toFixed(1);
  log(`Restauración terminada en ${seg} s.`);
  const filas = await resumenTablas(pkg.ruta, opts.dbUrl);
  log('Filas tras restaurar: ' + JSON.stringify(filas));
  log('\nSiguiente paso: reiniciar el servidor de Paperclip y comprobar /api/health, /api/companies y los secretos (ver docs/04-runbooks/actualizar-y-restaurar.md).');
}

main().catch((e) => { console.error(`ERROR inesperado: ${e?.stack ?? e}`); process.exit(1); });
