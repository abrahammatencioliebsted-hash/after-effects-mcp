<#
.SYNOPSIS
  Mission Control: comprobar / aplicar / revertir la versión de Paperclip desde Windows (siempre con copia completa antes).

.DESCRIPTION
  -Target wsl    (por defecto) instalación gestionada dentro de WSL2: delega en scripts/common/update-managed.sh.
  -Target native instalación global de npm (sin soporte oficial): 'paperclipai update' NO hace backup en este modo (update.ts:223-246),
                 así que este script ejecuta backup.ps1 antes; '--rollback' no existe en global-npm: un "rollback" es un update explícito
                 a la versión anterior con -To y -AllowDowngrade (pide --yes) y NO revierte migraciones: restaura la copia si hace falta.
  Sin -Yes (o con -DryRun) solo imprime el plan. -Check solo informa. No contiene secretos.

.EXAMPLE
  .\update.ps1 -Check
  .\update.ps1 -To 2026.1006.0 -Yes
  .\update.ps1 -Target native -To 2026.1005.0 -AllowDowngrade -Yes

.NOTES
  Estado de verificación: sintaxis analizada con el parser de PowerShell 7.5.3 en Linux. NO ejecutado en Windows; update/rollback no se probaron en ningún sistema.
#>
[CmdletBinding()]
param(
  [ValidateSet('wsl', 'native')][string]$Target = 'wsl',
  [string]$Distro = 'Ubuntu',
  [string]$To = '',
  [switch]$Check,
  [switch]$Rollback,
  [switch]$AllowDowngrade,
  [string]$TaskName = 'PaperclipAI',
  [switch]$Yes,
  [switch]$DryRun,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Rest -contains '--yes') { $Yes = $true }
if ($Rest -contains '--dry-run') { $DryRun = $true }
$Exec = $Yes -and -not $DryRun
$common = (Resolve-Path (Join-Path $PSScriptRoot '..\common')).Path
if ($common.Contains("'")) { throw "La ruta contiene un apóstrofo, no soportado: $common" }
if ($To -and $To -notmatch '^\d{4}\.\d+\.\d+(-[A-Za-z0-9.]+)?$') { throw '-To debe ser una versión exacta como 2026.1006.0' }
function Step([string]$display, [scriptblock]$block) { Write-Host "+ $display"; if ($Exec) { $global:LASTEXITCODE = 0; & $block; if ($LASTEXITCODE -ne 0) { throw "Falló: $display (código $LASTEXITCODE)" } } }

if ($Target -eq 'wsl') {
  $commonW = (& wsl.exe -d $Distro -- wslpath -u $common).Trim()
  $cmd = "bash '$commonW/update-managed.sh'"
  if ($Check) { $cmd += ' --check' }
  if ($Rollback) { $cmd += ' --rollback' }
  if ($To) { $cmd += " --to '$To'" }
  if ($Exec) { $cmd += ' --yes' }
  Write-Host "+ wsl -d $Distro -- bash -lc `"$cmd`""
  $global:LASTEXITCODE = 0
  & wsl.exe -d $Distro -- bash -lc $cmd
  return
}

# --- native (global-npm) ---
Write-Host '+ paperclipai --version'; & paperclipai --version
if ($Check -or (-not $To)) {
  Write-Host '+ paperclipai update --check --json'; & paperclipai update --check --json
  Write-Host '(código de salida 10 = hay actualización)'
  return
}
if ($Rollback) { throw "'--rollback' solo existe en instalaciones gestionadas. En global-npm usa -To <versión anterior> -AllowDowngrade." }
if (-not $Exec) { Write-Host '== MODO PLAN: no se ejecuta nada (añade -Yes para ejecutar).' }
Step "& '$PSScriptRoot\backup.ps1' -Target native" { & "$PSScriptRoot\backup.ps1" -Target native }
$upd = @('update', '--version', $To)
if ($AllowDowngrade) { $upd += '--yes' }
# global-npm: 'update' solo hace 'npm install -g' (no para, no reinicia, no valida: hallazgo F3). Se para la tarea ANTES para no pisar archivos en uso.
Step "Stop-ScheduledTask -TaskName '$TaskName'" { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; Start-Sleep -Seconds 5; $global:LASTEXITCODE = 0 }
Step "paperclipai $($upd -join ' ')" { & paperclipai @upd }
Step "Start-ScheduledTask -TaskName '$TaskName'" { Start-ScheduledTask -TaskName $TaskName; $global:LASTEXITCODE = 0 }
Step 'paperclipai --version' { & paperclipai --version }
Write-Host 'Comprueba /api/health (campo version) a mano: global-npm no valida. Si algo falla: restore.ps1 -Target native -Archive <copia> (docs/04-runbooks/actualizar-y-restaurar.md).'
