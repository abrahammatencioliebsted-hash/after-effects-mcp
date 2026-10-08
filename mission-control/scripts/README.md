# scripts/ — instalar, actualizar, respaldar y restaurar

Guías paso a paso: `docs/04-runbooks/` (Windows, macOS, segundo equipo, actualizar y restaurar, verificaciones en tus equipos).
Prueba de la restauración con salida literal: `docs/evidencias/restauracion-lab.md`.

## Reglas comunes de todos los scripts

- Mensajes en español. **Cada comando se imprime antes de ejecutarse** (línea que empieza por `+`).
- Los pasos que cambian el equipo o destruyen datos exigen **`--yes`** (PowerShell: `-Yes`, y también acepta `--yes`). Sin él solo imprimen el plan.
  **`--dry-run`** (`-DryRun`) imprime el plan aunque se pase `--yes`.
- Versiones fijadas en variables al principio de cada script (`PAPERCLIP_VERSION=2026.1005.0`, `HERMES_COMMIT=a28a5d03…`). Cámbialas allí, no en el cuerpo.
- **Sin secretos dentro.** Las claves se generan en tu equipo (`openssl rand` / generador criptográfico de .NET) y no se imprimen; el token del node-agent se lee de un archivo que tú creas.
- Requieren Node ≥ 24.11 solo los `.mjs` (los mismos que exige Paperclip).

## Matriz script × sistema × verificado aquí

"Verificado aquí" significa **qué se hizo realmente en el entorno Cloud (Linux, Node 24.21, paperclipai@2026.1005.0, PowerShell 7.5.3 solo para analizar sintaxis)**. Nada se ejecutó en Windows ni en macOS.

| Script | Linux/WSL2 | macOS | Windows nativo | Verificado aquí |
|---|:-:|:-:|:-:|---|
| `common/restore-db.mjs` | sí | sí | sí | **SÍ, ejecutado de verdad** contra un Paperclip real (motor JS, sin psql): restauró 2515 sentencias en 8,4 s y la verificación pasó 8/8. No ejecutado en Win/Mac. |
| `common/verify-restore.mjs` | sí | sí | sí | **SÍ, ejecutado de verdad** (8/8 comprobaciones, incluido el descifrado de secretos con `master.key` y el control negativo). |
| `common/backup-full.mjs` | sí | sí | sí (usa `tar.exe` de Windows 10 1803+) | **SÍ, ejecutado de verdad** sobre la instancia viva y sobre la restaurada (detectó el cambio de puerto 54329→54330). Rama de Windows (`powershell Get-CimInstance`, `tar.exe`) **no** ejecutada. |
| `common/restore-files.mjs` | sí | sí | sí | **SÍ, ejecutado** (plan, negativa sin `--yes`, aplicar) sobre un directorio de prueba; el restaurador de claves de la prueba principal se hizo con `cp`. Permisos `0600` no aplican en Windows. |
| `common/restore-managed.sh` | sí | sí | — | Solo `bash -n` y modo plan. La detección del puerto de PG se probó contra el proceso vivo. **No** contra un servicio launchd/systemd real. |
| `common/update-managed.sh` | sí | sí | — | Solo `bash -n` y modo plan con un `paperclipai` simulado. `update`/`--rollback` **no se probaron en ningún sistema**. |
| `macos/install-paperclip.sh` | (aviso si no es Darwin) | sí | — | Solo `bash -n`. No ejecutado en macOS. `paperclip.ing` no se descargó. |
| `macos/install-hermes.sh` | — | sí | — | `bash -n` + la lógica de `.env` (idempotente, clave generada y no impresa, modo 600) ejecutada en Linux con `hermes` simulado. El instalador oficial **no** (no alcanzable desde Cloud). |
| `macos/install-node-agent.sh` | — | sí | — | `bash -n` + generación real del lanzador y del plist (validado con `plistlib`) en Linux con `launchctl` simulado. `launchctl` real: no. |
| `macos/backup.sh`, `macos/restore.sh`, `macos/update.sh` | — | sí | — | Envoltorios finos de los comunes. Solo `bash -n` y modo plan. |
| `windows/install-paperclip-wsl2.ps1` | — | — | sí (+WSL2) | Solo análisis de sintaxis con el parser de PowerShell 7.5.3 en Linux. `wsl.exe` no existe aquí. |
| `windows/install-hermes.ps1` | — | — | sí | Sintaxis + la lógica de `.env` ejecutada con `pwsh` 7.5.3 en Linux (`hermes` e `icacls.exe` simulados). El instalador oficial no. |
| `windows/install-node-agent.ps1` | — | — | sí | Solo sintaxis. `Register-ScheduledTask` no existe fuera de Windows. |
| `windows/backup.ps1`, `restore.ps1`, `update.ps1` | — | — | sí | Solo sintaxis. |

Leyenda: **sí/—** = diseñado para ese sistema / no aplica. La columna final es lo único que cuenta como prueba.

## Uso rápido

```text
# Linux / WSL2 / macOS (bash)
node scripts/common/backup-full.mjs --out ~/mc-backups                         # copia completa (servidor arriba)
node scripts/common/restore-files.mjs --archive <copia.tar.gz> --data-dir ~/.paperclip --yes
node scripts/common/restore-db.mjs --dump <volcado.sql.gz> --db-url postgres://paperclip:paperclip@127.0.0.1:<puerto>/paperclip --no-psql --yes
node scripts/common/verify-restore.mjs --api http://127.0.0.1:<puerto>/api --db-url … --master-key-file <instancia>/secrets/master.key

# Todo el procedimiento gestionado en uno (macOS/Linux/WSL2)
bash scripts/macos/restore.sh --archive <copia.tar.gz> --yes

# Windows (PowerShell; si la política lo bloquea: Set-ExecutionPolicy -Scope Process Bypass)
.\scripts\windows\backup.ps1                       # Paperclip en WSL2 (por defecto)
.\scripts\windows\restore.ps1 -Archive <copia.tar.gz> -Yes
```

El puerto del Postgres embebido **no es siempre 54329**: si estaba ocupado, el servidor usa el siguiente libre y no lo guarda en `config.json`.
`backup-full.mjs` lo detecta y avisa; `restore-managed.sh` y `restore.ps1` lo leen del proceso `postgres -D <instancia>/db -p N`.
