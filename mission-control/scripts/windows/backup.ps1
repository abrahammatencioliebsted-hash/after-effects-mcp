<#
.SYNOPSIS
  Mission Control: copia de seguridad COMPLETA de Paperclip desde Windows (envuelve scripts\common\backup-full.mjs).

.DESCRIPTION
  -Target wsl    (por defecto) Paperclip vive DENTRO de WSL2: ejecuta backup-full.mjs con el Node de la distro sobre ~/.paperclip.
  -Target native Paperclip nativo en Windows (ruta no soportada oficialmente): ejecuta el .mjs con node.exe sobre %USERPROFILE%\.paperclip.
  El servidor de Paperclip debe estar ARRIBA (el Postgres embebido solo existe entonces). El archivo resultante contiene secretos:
  se deja en -Out (por defecto %USERPROFILE%\mc-backups); guárdalo cifrado y fuera del equipo.
  No es destructivo: no requiere -Yes. -DryRun solo imprime el plan.

.NOTES
  Estado de verificación: sintaxis analizada con el parser de PowerShell 7.5.3 en Linux; backup-full.mjs SÍ se ejecutó en Linux
  (docs/evidencias/restauracion-lab.md). El wrapper NO se ejecutó en Windows.
#>
[CmdletBinding()]
param(
  [ValidateSet('wsl', 'native')][string]$Target = 'wsl',
  [string]$Distro = 'Ubuntu',
  [string]$Instance = 'default',
  [string]$DataDir = '',
  [string]$Out = (Join-Path $env:USERPROFILE 'mc-backups'),
  [switch]$SkipDb,
  [switch]$DryRun,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Rest -contains '--dry-run') { $DryRun = $true }
$script = (Resolve-Path (Join-Path $PSScriptRoot '..\common\backup-full.mjs')).Path
foreach ($p in @($script, $Out)) { if ($p.Contains("'")) { throw "La ruta contiene un apóstrofo, no soportado: $p" } }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Write-Host "== Mission Control: copia completa de Paperclip (Target=$Target)"

if ($Target -eq 'native') {
  if (-not $DataDir) { $DataDir = Join-Path $env:USERPROFILE '.paperclip' }
  $args2 = @($script, '--data-dir', $DataDir, '--instance', $Instance, '--out', $Out)
  if ($SkipDb) { $args2 += '--skip-db' }
  Write-Host "+ node $($args2 -join ' ')"
  if (-not $DryRun) { $global:LASTEXITCODE = 0; & node @args2; if ($LASTEXITCODE -ne 0) { throw "backup-full.mjs terminó con código $LASTEXITCODE" } }
  return
}

# --- WSL ---
$scriptW = (& wsl.exe -d $Distro -- wslpath -u $script).Trim()
$outW = (& wsl.exe -d $Distro -- wslpath -u $Out).Trim()
$dataArg = if ($DataDir) { "'" + $DataDir + "'" } else { '"$HOME/.paperclip"' }
$cmd = "node '$scriptW' --data-dir $dataArg --instance '$Instance' --out '$outW'"
if ($SkipDb) { $cmd += ' --skip-db' }
Write-Host "+ wsl -d $Distro -- bash -lc `"$cmd`""
if (-not $DryRun) { $global:LASTEXITCODE = 0; & wsl.exe -d $Distro -- bash -lc $cmd; if ($LASTEXITCODE -ne 0) { throw "backup-full.mjs (WSL) terminó con código $LASTEXITCODE" } }
Write-Host "Archivo(s) en $Out"
