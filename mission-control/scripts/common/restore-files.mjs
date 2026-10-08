#!/usr/bin/env node
// Mission Control — restaurar los ARCHIVOS (no la base) de una copia creada con backup-full.mjs.
//
// Pone en su sitio: secrets/ (master.key, decision-signing.key), .env, data/storage, workspaces, companies, projects, context.json
// y copia el volcado .sql.gz a <instancia>/data/backups/ para el paso siguiente (restore-db.mjs).
// config.json NO se sobrescribe salvo que pidas --include-config (la instancia nueva tiene sus propios puertos/rutas).
//
// Uso:
//   node restore-files.mjs --archive <mc-backup-….tar.gz> --data-dir <PAPERCLIP_HOME destino> [--instance default]
//                          [--include-config] [--yes] [--dry-run] [--force-running]
//
// DESTRUCTIVO (sobrescribe claves y .env del destino). Sin --yes solo muestra el plan (código 2).
// Se niega a actuar si el servidor de Paperclip de esa instancia está corriendo (runtime-info.json con PID vivo).
// Verificado en Linux: docs/evidencias/restauracion-lab.md. NO verificado en Windows/macOS.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, cpSync, chmodSync, statSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { platform, tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const AYUDA = `Uso: node restore-files.mjs --archive <archivo.tar.gz> --data-dir <dir destino> [--instance <id>] [--include-config] [--yes] [--dry-run] [--force-running]`;
function log(m) { console.log(m); }
function fail(m, c = 1) { console.error(`ERROR: ${m}`); process.exit(c); }

function parse(argv) {
  const o = { instance: 'default' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const v = () => { if (i + 1 >= argv.length) fail(`falta el valor de ${a}`); return argv[++i]; };
    if (a === '--archive') o.archive = resolve(v());
    else if (a === '--data-dir') o.dataDir = resolve(v());
    else if (a === '--instance') o.instance = v();
    else if (a === '--include-config') o.includeConfig = true;
    else if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--force-running') o.forceRunning = true;
    else if (a === '--help' || a === '-h') { log(AYUDA); process.exit(0); }
    else fail(`argumento desconocido: ${a}\n${AYUDA}`);
  }
  if (!o.archive) fail(`falta --archive\n${AYUDA}`);
  if (!o.dataDir) fail(`falta --data-dir\n${AYUDA}`);
  if (!/^[A-Za-z0-9_-]+$/.test(o.instance)) fail('--instance inválida');
  return o;
}

function sha256File(p) {
  return new Promise((ok, ko) => { const h = createHash('sha256'); const s = createReadStream(p); s.on('data', (c) => h.update(c)); s.on('end', () => ok(h.digest('hex'))); s.on('error', ko); });
}
function pidVivo(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

async function main() {
  const o = parse(process.argv.slice(2));
  if (!existsSync(o.archive)) fail(`no existe el archivo ${o.archive}`);
  const inst = join(o.dataDir, 'instances', o.instance);

  // 0) El servidor de destino debe estar parado
  const ri = join(inst, 'runtime-info.json');
  if (existsSync(ri)) {
    try {
      const { pid } = JSON.parse(readFileSync(ri, 'utf8'));
      if (pid && pidVivo(pid) && !o.forceRunning) fail(`el servidor de Paperclip de esta instancia parece estar corriendo (PID ${pid}). Páralo antes de restaurar claves y .env (o usa --force-running bajo tu responsabilidad).`);
    } catch { /* runtime-info ilegible: se ignora */ }
  }

  // 1) Extraer a una carpeta temporal privada
  const tmp = mkdtempSync(join(tmpdir(), 'mc-restore-'));
  try {
    const args = ['-xzf', o.archive, '-C', tmp];
    log(`> tar ${args.join(' ')}`);
    const t = spawnSync('tar', args, { encoding: 'utf8' });
    if (t.status !== 0) fail(`tar falló: ${t.stderr}`);
    const mf = join(tmp, 'MANIFEST.json');
    if (!existsSync(mf)) fail('el archivo no tiene MANIFEST.json (¿lo creó backup-full.mjs?).');
    const m = JSON.parse(readFileSync(mf, 'utf8'));
    log(`== Mission Control · restaurar archivos ==`);
    log(`Copia         : ${basename(o.archive)} (formato ${m.formato}, creada ${m.creadoUtc} en ${m.equipo}/${m.sistema})`);
    log(`Instancia origen "${m.instancia}" → destino "${o.instance}" en ${o.dataDir}`);

    // 2) Verificar el volcado contra el hash del manifiesto
    const dumpTmp = join(tmp, m.volcado.ruta);
    if (!existsSync(dumpTmp)) fail(`el volcado ${m.volcado.ruta} no está en el archivo`);
    const h = await sha256File(dumpTmp);
    if (h !== m.volcado.sha256) fail(`el volcado está corrupto (sha256 ${h} ≠ ${m.volcado.sha256})`);
    log(`Volcado       : ${m.volcado.ruta} (${m.volcado.bytes} bytes, sha256 coincide)`);

    // 3) Plan. Las rutas del archivo llevan "instances/<origen>/…": se reubican a la instancia destino.
    const reubicar = (rel) => rel.replace(new RegExp(`^instances/${m.instancia}/`), `instances/${o.instance}/`);
    const plan = [];
    for (const rel of m.entradas) {
      if (rel === m.volcado.ruta) continue;
      if (rel.endsWith('/config.json') && !o.includeConfig) { log(`  (se conserva el config.json del destino; usa --include-config para sobrescribirlo)`); continue; }
      plan.push({ de: join(tmp, rel), a: join(o.dataDir, reubicar(rel)), rel: reubicar(rel) });
    }
    const dumpDestino = join(inst, 'data', 'backups', basename(m.volcado.ruta));
    for (const p of plan) log(`  ${existsSync(p.a) ? 'SOBRESCRIBE' : 'crea       '} ${p.rel}`);
    log(`  ${existsSync(dumpDestino) ? 'SOBRESCRIBE' : 'crea       '} ${reubicar(`instances/${m.instancia}/data/backups/${basename(m.volcado.ruta)}`)}`);

    if (o.dryRun) { log('\n[--dry-run] No se tocó nada.'); return; }
    if (!o.yes) { log('\nPASO DESTRUCTIVO: vuelve a ejecutar con --yes para aplicar el plan.'); process.exit(2); }

    // 4) Aplicar
    for (const p of plan) {
      mkdirSync(dirname(p.a), { recursive: true });
      cpSync(p.de, p.a, { recursive: true, force: true, preserveTimestamps: true });
      log(`  copiado ${p.rel}`);
    }
    mkdirSync(dirname(dumpDestino), { recursive: true });
    cpSync(dumpTmp, dumpDestino, { force: true });
    if (platform() !== 'win32') {
      for (const f of ['secrets/master.key', 'secrets/decision-signing.key', '.env']) { try { chmodSync(join(inst, f), 0o600); } catch { /* puede no existir */ } }
      try { chmodSync(join(inst, 'secrets'), 0o700); } catch { /* idem */ }
    } else {
      log('AVISO Windows: no se aplican permisos 0600; protege %USERPROFILE%\\.paperclip con ACL/BitLocker (caveat W9).');
    }
    log(`\nVolcado listo para restore-db.mjs: ${dumpDestino}`);
    log(`Tamaño: ${statSync(dumpDestino).size} bytes`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(`ERROR inesperado: ${e?.stack ?? e}`); process.exit(1); });
