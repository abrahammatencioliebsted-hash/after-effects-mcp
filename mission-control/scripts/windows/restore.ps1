<#
.SYNOPSIS
  Mission Control: restaurar Paperclip desde una copia de backup-full.mjs (restaura archivos + base + verificación).

.DESCRIPTION
  DESTRUCTIVO: sobrescribe tablas y claves de la instancia. Sin -Yes (o con -DryRun) solo imprime el plan.
  -Target wsl    (por defecto) delega en scripts/common/restore-managed.sh dentro de WSL2 (servicio systemd de usuario).
  -Target native Paperclip nativo en Windows (no soportado oficialmente): para y arranca la tarea programada -TaskName y usa los .mjs.
  Secuencia: parar servidor -> restore-files.mjs -> arrancar -> restore-db.mjs (motor JS; no necesita psql) -> reiniciar -> verify-restore.mjs.
  Hay un ensayo completo en Linux en docs/evidencias/restauracion-lab.md; en Windows hazlo primero en un directorio de prueba (V10/V11).

.NOTES
  Estado de verificación: sintaxis analizada con el parser de PowerShell 7.5.3 en Linux. NO ejecutado en Windows.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [ValidateSet('wsl', 'native')][string]$Target = 'wsl',
  [string]$Distro = 'Ubuntu',
  [string]$Instance = 'default',
  [string]$DataDir = '',
  [string]$TaskName = 'PaperclipAI',
  [switch]$IncludeConfig,
  [switch]$Yes,
  [switch]$DryRun,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Rest -contains '--yes') { $Yes = $true }
if ($Rest -contains '--dry-run') { $DryRun = $true }
$Exec = $Yes -and -not $DryRun
$Archive = (Resolve-Path -LiteralPath $Archive).Path
$common = (Resolve-Path (Join-Path $PSScriptRoot '..\common')).Path
foreach ($p in @($Archive, $common)) { if ($p.Contains("'")) { throw "La ruta contiene un apóstrofo, no soportado: $p" } }
function Say([string]$m) { Write-Host "== $m" }
Say "Mission Control: restaurar Paperclip (Target=$Target)"
if (-not $Exec) { Say 'MODO PLAN: no se ejecuta nada (añade -Yes para ejecutar).' }

if ($Target -eq 'wsl') {
  $commonW = (& wsl.exe -d $Distro -- wslpath -u $common).Trim()
  $archiveW = (& wsl.exe -d $Distro -- wslpath -u $Archive).Trim()
  $cmd = "bash '$commonW/restore-managed.sh' --archive '$archiveW' --instance '$Instance'"
  if ($DataDir) { $cmd += " --data-dir '$DataDir'" }
  if ($IncludeConfig) { $cmd += ' --include-config' }
  if ($Exec) { $cmd += ' --yes' }
  Write-Host "+ wsl -d $Distro -- bash -lc `"$cmd`""
  $global:LASTEXITCODE = 0
  & wsl.exe -d $Distro -- bash -lc $cmd
  if ($LASTEXITCODE -ne 0) { throw "restore-managed.sh terminó con código $LASTEXITCODE" }
  return
}

# --- native ---
if (-not $DataDir) { $DataDir = Join-Path $env:USERPROFILE '.paperclip' }
$inst = Join-Path $DataDir "instances\$Instance"
function Wait-Health([int]$Seconds) {
  $ri = Join-Path $inst 'runtime-info.json'
  for ($i = 0; $i -lt ($Seconds / 2); $i++) {
    Start-Sleep -Seconds 2
    if (Test-Path -LiteralPath $ri) {
      $port = (Get-Content -Raw -LiteralPath $ri | ConvertFrom-Json).port
      try { $h = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 3; if ($h.status -eq 'ok') { return $port } } catch { }
    }
  }
  throw "Paperclip no respondió /api/health en $Seconds s"
}
function Get-PgPort {
  $procs = Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object { $_.CommandLine -like "*$inst*db*" }
  foreach ($p in $procs) { if ($p.CommandLine -match '-p\s+(\d+)') { return [int]$Matches[1] } }
  return 54329
}
function Step([string]$display, [scriptblock]$block) { Write-Host "+ $display"; if ($Exec) { $global:LASTEXITCODE = 0; & $block; if ($LASTEXITCODE -ne 0) { throw "Falló: $display (código $LASTEXITCODE)" } } }

Step "Stop-ScheduledTask -TaskName '$TaskName'" { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; $global:LASTEXITCODE = 0 }
if ($Exec) {
  Start-Sleep -Seconds 3
  $left = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'paperclipai' }
  if ($left) { throw ("Siguen procesos de Paperclip: PID " + (($left | ForEach-Object { $_.ProcessId }) -join ', ') + '. Páralos y repite.') }
}
$filesArgs = @("$common\restore-files.mjs", '--archive', $Archive, '--data-dir', $DataDir, '--instance', $Instance, '--yes')
if ($IncludeConfig) { $filesArgs += '--include-config' }
Step "node $($filesArgs -join ' ')" { & node @filesArgs }
Step "Start-ScheduledTask -TaskName '$TaskName'" { Start-ScheduledTask -TaskName $TaskName }
$apiPort = 3100
if ($Exec) { $apiPort = Wait-Health 90; Say "Paperclip arriba en el puerto $apiPort" }
$pgPort = 54329; $dump = "<último .sql.gz de $inst\data\backups>"
if ($Exec) {
  $pgPort = Get-PgPort
  $dump = (Get-ChildItem -LiteralPath (Join-Path $inst 'data\backups') -Filter *.sql.gz | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
  Say "Puerto PG: $pgPort · volcado: $dump"
}
$dbArgs = @("$common\restore-db.mjs", '--dump', $dump, '--db-url', "postgres://paperclip:paperclip@127.0.0.1:$pgPort/paperclip", '--yes')
Step "node $($dbArgs -join ' ')" { & node @dbArgs }
Step "Stop-ScheduledTask / Start-ScheduledTask -TaskName '$TaskName'" { Stop-ScheduledTask -TaskName $TaskName; Start-Sleep -Seconds 5; Start-ScheduledTask -TaskName $TaskName; $global:LASTEXITCODE = 0 }
if ($Exec) { $apiPort = Wait-Health 90 }
$vArgs = @("$common\verify-restore.mjs", '--api', "http://127.0.0.1:$apiPort/api", '--db-url', "postgres://paperclip:paperclip@127.0.0.1:$pgPort/paperclip", '--master-key-file', (Join-Path $inst 'secrets\master.key'))
Step "node $($vArgs -join ' ')" { & node @vArgs }
