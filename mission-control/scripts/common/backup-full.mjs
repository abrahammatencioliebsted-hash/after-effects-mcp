#!/usr/bin/env node
// Mission Control — copia de seguridad COMPLETA de una instancia de Paperclip.
//
// Una copia útil necesita TODO esto (docs: Paperclip doc/DATABASE.md "Backup/restore requires both the database metadata and the
// local master key file; either artifact alone is insufficient"):
//   · volcado lógico .sql.gz        (lo crea `paperclipai db:backup --json -d <dataDir>`; el servidor y su Postgres embebido deben estar ARRIBA)
//   · secrets/master.key y secrets/decision-signing.key
//   · .env de la instancia (PAPERCLIP_AGENT_JWT_SECRET, PAPERCLIP_TOOL_ACTION_SIGNING_SECRET)
//   · config.json · data/storage (adjuntos) · workspaces/ · companies/ · projects/ (si existen) · context.json (perfiles del cliente CLI)
//
// Uso:
//   node backup-full.mjs [--data-dir <PAPERCLIP_HOME>] [--instance default] [--out <carpeta>] [--paperclipai "<comando>"]
//                        [--skip-db] [--include-run-logs] [--dry-run]
// Por defecto: --data-dir = $PAPERCLIP_HOME o ~/.paperclip · --out = ./mc-backups
// El archivo resultante (mc-backup-<instancia>-<UTC>.tar.gz) CONTIENE SECRETOS: guárdalo cifrado y fuera del equipo.
// No imprime ni escribe valores de secretos; el MANIFEST.json solo lleva nombres de archivo y hashes.
//
// Verificado en Linux (Node 24.21, paperclipai@2026.1005.0): docs/evidencias/restauracion-lab.md. NO verificado en Windows/macOS.

import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, copyFileSync, chmodSync, readdirSync, readFileSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, hostname, platform, tmpdir } from 'node:os';
import { join, resolve, relative, basename, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---- Versiones fijadas (cambiar aquí) ------------------------------------------------------------------
const PAPERCLIP_VERSION = '2026.1005.0';
const POR_DEFECTO_PAPERCLIPAI = `npx -y paperclipai@${PAPERCLIP_VERSION}`;

const AYUDA = `Uso: node backup-full.mjs [--data-dir <dir>] [--instance <id>] [--out <carpeta>] [--paperclipai "<comando>"] [--skip-db] [--include-run-logs] [--dry-run]

  --data-dir <dir>      Raíz de datos de Paperclip (PAPERCLIP_HOME). Por defecto $PAPERCLIP_HOME o ~/.paperclip.
  --instance <id>       Id de instancia (por defecto "default").
  --out <carpeta>       Dónde dejar el archivo (por defecto ./mc-backups).
  --paperclipai <cmd>   Comando para db:backup. Por defecto "paperclipai" si está en el PATH; si no, "${POR_DEFECTO_PAPERCLIPAI}".
  --skip-db             No ejecutar db:backup: usar el volcado más reciente que ya exista en data/backups.
  --include-run-logs    Incluir data/run-logs (puede ser grande).
  --dry-run             Mostrar el plan sin ejecutar nada.`;

function log(m) { console.log(m); }
function fail(m, c = 1) { console.error(`ERROR: ${m}`); process.exit(c); }

function parse(argv) {
  const o = { instance: 'default', out: resolve('mc-backups') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const v = () => { if (i + 1 >= argv.length) fail(`falta el valor de ${a}`); return argv[++i]; };
    if (a === '--data-dir') o.dataDir = resolve(v());
    else if (a === '--instance') o.instance = v();
    else if (a === '--out') o.out = resolve(v());
    else if (a === '--paperclipai') o.cmd = v();
    else if (a === '--skip-db') o.skipDb = true;
    else if (a === '--include-run-logs') o.runLogs = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--help' || a === '-h') { log(AYUDA); process.exit(0); }
    else fail(`argumento desconocido: ${a}\n\n${AYUDA}`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(o.instance)) fail('--instance solo admite letras, números, "_" y "-".');
  o.dataDir ??= resolve(process.env.PAPERCLIP_HOME || join(homedir(), '.paperclip'));
  return o;
}

function utcStamp(d = new Date()) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }

function sha256File(p) {
  return new Promise((ok, ko) => {
    const h = createHash('sha256'); const s = createReadStream(p);
    s.on('data', (c) => h.update(c)); s.on('end', () => ok(h.digest('hex'))); s.on('error', ko);
  });
}

function enPath(bin) {
  const r = spawnSync(platform() === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  return r.status === 0;
}

function ejecutar(cmdLinea, args, opciones = {}) {
  const partes = cmdLinea.split(/\s+/).filter(Boolean);
  const bin = partes[0]; const resto = [...partes.slice(1), ...args];
  log(`> ${[bin, ...resto].join(' ')}`);
  return spawnSync(bin, resto, { encoding: 'utf8', shell: platform() === 'win32', maxBuffer: 64 * 1024 * 1024, ...opciones });
}

function extraerJson(texto) {
  const limpio = texto.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  const m = limpio.match(/\{\s*"backupFile"[\s\S]*?\n\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}


// Puerto REAL del Postgres embebido (el servidor sube al siguiente libre si 54329 está ocupado y NO lo guarda en config.json;
// `paperclipai db:backup` conecta al puerto de config.json o 54329: podría volcar OTRA base). Ver hallazgo F4 en docs/04-runbooks.
function puertoPgReal(inst) {
  try {
    let texto = '';
    if (platform() === 'win32') {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | ForEach-Object { $_.CommandLine }"], { encoding: 'utf8' });
      texto = r.stdout || '';
    } else {
      const r = spawnSync('ps', ['-ax', '-o', 'command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      texto = r.stdout || '';
    }
    const norm = (x) => x.replace(/\\/g, '/').replace(/"/g, '').toLowerCase();
    const aguja = norm(join(inst, 'db'));
    for (const linea of texto.split('\n')) {
      if (!/postgres/i.test(linea) || !/\s-D\s/.test(linea)) continue;
      if (!norm(linea).includes(aguja)) continue;
      const m = linea.match(/\s-p\s+(\d+)/);
      if (m) return Number(m[1]);
    }
  } catch { /* sin información */ }
  return null;
}
function puertoPgConfigurado(inst) {
  try {
    const c = JSON.parse(readFileSync(join(inst, 'config.json'), 'utf8'));
    return Number(c?.database?.embeddedPostgresPort ?? 54329);
  } catch { return 54329; }
}

function ultimoVolcado(dir) {
  if (!existsSync(dir)) return null;
  const l = readdirSync(dir).filter((f) => /\.sql\.gz$/.test(f)).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((x, y) => y.t - x.t);
  return l.length ? join(dir, l[0].f) : null;
}

async function main() {
  const o = parse(process.argv.slice(2));
  const inst = join(o.dataDir, 'instances', o.instance);
  log('== Mission Control · copia completa de Paperclip ==');
  log(`Raíz de datos : ${o.dataDir}`);
  log(`Instancia     : ${o.instance} (${inst})`);
  if (!existsSync(inst)) fail(`no existe ${inst}. Revisa --data-dir / --instance.`);

  // Elementos a incluir (relativos a --data-dir). Se omiten los que no existen.
  const candidatos = [
    `instances/${o.instance}/secrets`,
    `instances/${o.instance}/.env`,
    `instances/${o.instance}/config.json`,
    `instances/${o.instance}/data/storage`,
    `instances/${o.instance}/workspaces`,
    `instances/${o.instance}/companies`,
    `instances/${o.instance}/projects`,
    ...(o.runLogs ? [`instances/${o.instance}/data/run-logs`] : []),
    'context.json',
  ];
  const presentes = candidatos.filter((r) => existsSync(join(o.dataDir, r)));
  const ausentes = candidatos.filter((r) => !presentes.includes(r));
  log(`Se incluirán  : ${presentes.join(', ')}`);
  if (ausentes.length) log(`No existen (se omiten): ${ausentes.join(', ')}`);
  for (const imprescindible of [`instances/${o.instance}/secrets`, `instances/${o.instance}/.env`]) {
    if (!presentes.includes(imprescindible)) fail(`falta ${imprescindible}: sin él la copia no serviría para restaurar.`);
  }

  const cmd = o.cmd ?? (enPath('paperclipai') ? 'paperclipai' : POR_DEFECTO_PAPERCLIPAI);
  const dirVolcados = join(inst, 'data', 'backups');
  if (o.dryRun) {
    log(`\n[--dry-run] Se ejecutaría: ${o.skipDb ? '(sin db:backup; último volcado de ' + dirVolcados + ')' : `${cmd} db:backup --json -d ${o.dataDir}`}`);
    log(`[--dry-run] Se crearía : ${join(o.out, `mc-backup-${o.instance}-${utcStamp()}.tar.gz`)}`);
    return;
  }

  // 1) Volcado lógico
  let volcado;
  if (o.skipDb) {
    volcado = ultimoVolcado(dirVolcados);
    if (!volcado) fail(`--skip-db pero no hay .sql.gz en ${dirVolcados}`);
    log(`Usando volcado existente: ${volcado}`);
  } else {
    const env = { ...process.env, PAPERCLIP_INSTANCE_ID: o.instance };
    const real = puertoPgReal(inst); const conf = puertoPgConfigurado(inst);
    if (real === null) log(`AVISO: no se encontró el proceso postgres de esta instancia; si el servidor está parado, db:backup fallará.`);
    else if (real !== conf && !process.env.DATABASE_URL) {
      env.DATABASE_URL = `postgres://paperclip:paperclip@127.0.0.1:${real}/paperclip`;
      log(`AVISO (F4): el Postgres embebido de esta instancia escucha en ${real}, pero config.json dice ${conf}: db:backup conectaría a OTRA base. Se fuerza DATABASE_URL=postgres://paperclip:***@127.0.0.1:${real}/paperclip solo para este comando.`);
    } else log(`Puerto del Postgres embebido: ${real} (coincide con la configuración).`);
    const r = ejecutar(cmd, ['db:backup', '--json', '-d', o.dataDir], { env });
    if (r.status !== 0) fail(`db:backup falló (código ${r.status}). ¿El servidor de Paperclip está ARRIBA? El Postgres embebido solo existe mientras corre.\n${(r.stderr || '').slice(-600)}\n${(r.stdout || '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').slice(-600)}`);
    const j = extraerJson(r.stdout || '');
    if (!j?.backupFile) fail('db:backup terminó pero no se pudo leer el JSON de salida (backupFile).');
    volcado = j.backupFile;
    log(`Volcado creado: ${volcado} (${j.sizeBytes} bytes)`);
  }
  if (!existsSync(volcado)) fail(`no existe el volcado ${volcado}`);

  // 2) Preparar MANIFEST y (si hace falta) copiar el volcado a una carpeta temporal
  mkdirSync(o.out, { recursive: true });
  const stage = mkdtempSync(join(tmpdir(), 'mc-backup-'));
  try {
    const relDump = relative(o.dataDir, volcado);
    const dentro = !relDump.startsWith('..') && !isAbsolute(relDump);
    const entradas = [...presentes];
    let dumpEnArchivo;
    if (dentro) { dumpEnArchivo = relDump.split(sep).join('/'); if (!entradas.includes(dumpEnArchivo)) entradas.push(dumpEnArchivo); }
    else { mkdirSync(join(stage, 'dump'), { recursive: true }); copyFileSync(volcado, join(stage, 'dump', basename(volcado))); dumpEnArchivo = `dump/${basename(volcado)}`; }
    const manifiesto = {
      formato: 'mc-backup-v1',
      creadoUtc: new Date().toISOString(),
      equipo: hostname(), sistema: platform(),
      paperclipVersionFijada: PAPERCLIP_VERSION,
      instancia: o.instance,
      volcado: { ruta: dumpEnArchivo, bytes: statSync(volcado).size, sha256: await sha256File(volcado) },
      entradas, // rutas relativas a la raíz de datos
      nota: 'Contiene secrets/master.key y .env: tratar como secreto. Restaurar con scripts/common/restore-files.mjs y restore-db.mjs.',
    };
    writeFileSync(join(stage, 'MANIFEST.json'), JSON.stringify(manifiesto, null, 2));

    // 3) tar.gz  (tar viene en Windows 10 1803+ como bsdtar, en macOS y en Linux)
    const salida = join(o.out, `mc-backup-${o.instance}-${utcStamp()}.tar.gz`);
    const args = ['-czf', salida, '-C', stage, 'MANIFEST.json'];
    if (!dentro) args.push('dump');
    args.push('-C', o.dataDir, ...entradas);
    log(`> tar ${args.join(' ')}`);
    const t = spawnSync('tar', args, { encoding: 'utf8' });
    if (t.status !== 0) fail(`tar falló (código ${t.status}): ${t.stderr}`);
    if (platform() !== 'win32') { try { chmodSync(salida, 0o600); } catch { /* mejor esfuerzo */ } }

    // 4) Verificación rápida: listar el archivo y comprobar lo imprescindible
    const l = spawnSync('tar', ['-tzf', salida], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const listado = (l.stdout || '').split('\n').filter(Boolean);
    const tiene = (fragmento) => listado.some((x) => x.includes(fragmento));
    const requisitos = { 'MANIFEST.json': tiene('MANIFEST.json'), 'volcado .sql.gz': listado.some((x) => x.endsWith('.sql.gz')), 'secrets/master.key': tiene('secrets/master.key'), 'secrets/decision-signing.key': tiene('secrets/decision-signing.key') || !existsSync(join(inst, 'secrets', 'decision-signing.key')), '.env': tiene('/.env') };
    for (const [k, v] of Object.entries(requisitos)) log(`  ${v ? 'OK   ' : 'FALTA'} ${k}`);
    if (Object.values(requisitos).some((v) => !v)) fail('el archivo creado no contiene todo lo imprescindible.');
    log(`\nArchivo       : ${salida}`);
    log(`Tamaño        : ${statSync(salida).size} bytes · ${listado.length} entradas`);
    log(`SHA-256       : ${await sha256File(salida)}`);
    log('AVISO: este archivo contiene la master.key y el .env. Guárdalo cifrado y fuera del equipo (nunca en el repositorio).');
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(`ERROR inesperado: ${e?.stack ?? e}`); process.exit(1); });
