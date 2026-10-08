<#
.SYNOPSIS
  Mission Control: registrar el node-agent como tarea programada (Task Scheduler) al iniciar sesión en Windows.

.DESCRIPTION
  El token NO va en la tarea ni en este script: un lanzador (%USERPROFILE%\.mc\node-agent\run.ps1) lo lee de un archivo con ACL
  restringida, exporta las variables MC_* y ejecuta node en un bucle con espera (si node muere, se relanza a los 5 s).
  Cada comando se imprime antes de ejecutarse. Sin -Yes (o con -DryRun) solo imprime el plan. También se aceptan --yes / --dry-run.

  Prerrequisitos: Node 24 LTS instalado; agente compilado (pnpm --filter @mc/node-agent build -> apps\node-agent\dist\main.js);
  token creado:  New-Item -ItemType Directory -Force "$env:USERPROFILE\.mc\node-agent"; node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | Set-Content -NoNewline "$env:USERPROFILE\.mc\node-agent\token"

.NOTES
  Estado de verificación: sintaxis analizada con el parser de PowerShell 7.5.3 en Linux. NO ejecutado en Windows.
  Equivalentes con schtasks: schtasks /Query /TN "MC Node Agent" /V /FO LIST · schtasks /Run /TN "MC Node Agent" · schtasks /Delete /TN "MC Node Agent" /F
  Si 'hermes' es un .cmd, execFile no lo ejecuta: este script fija MC_HERMES_BIN a un .exe si lo encuentra.
#>
[CmdletBinding()]
param(
  [string]$MachineId,
  [string]$BffUrl = '',
  [string]$TokenFile = (Join-Path $env:USERPROFILE '.mc\node-agent\token'),
  [string]$HermesUrl = 'http://127.0.0.1:8642',
  [string]$NodeExe = '',
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$TaskName = 'MC Node Agent',
  [switch]$Uninstall,
  [switch]$Yes,
  [switch]$DryRun,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Rest -contains '--yes') { $Yes = $true }
if ($Rest -contains '--dry-run') { $DryRun = $true }
if ($Rest -contains '--uninstall') { $Uninstall = $true }
$Exec = $Yes -and -not $DryRun
function Say([string]$m) { Write-Host "== $m" }

if ($Uninstall) {
  Say "Desinstalar la tarea '$TaskName'"
  Write-Host "+ Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
  if ($Exec) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue }
  return
}

if (-not $MachineId) { throw 'Falta -MachineId (por ejemplo win-principal, win-laptop-1).' }
if (-not $NodeExe) { $n = Get-Command node.exe -ErrorAction SilentlyContinue; if ($n) { $NodeExe = $n.Source } }
if (-not $NodeExe) { throw 'No se encontró node.exe (instala Node 24 LTS o pasa -NodeExe).' }
$main = Join-Path $RepoDir 'apps\node-agent\dist\main.js'
$mcHome = Join-Path $env:USERPROFILE '.mc\node-agent'
$launcher = Join-Path $mcHome 'run.ps1'

Say "Mission Control: node-agent como tarea programada (machine-id=$MachineId)"
if (-not $Exec) { Say 'MODO PLAN: no se ejecuta nada (añade -Yes para ejecutar).' }
if (-not (Test-Path -LiteralPath $main)) { Write-Warning "No existe $main. Compila antes: pnpm --filter @mc/node-agent build" }
if ($BffUrl -and -not (Test-Path -LiteralPath $TokenFile)) { Write-Warning "Con -BffUrl hace falta el token en $TokenFile (ver ayuda del script)."; if ($Exec) { throw 'Falta el archivo de token.' } }

$hermesBin = ''
$h = Get-Command hermes -ErrorAction SilentlyContinue
if ($h -and $h.Source -match '\.exe$') { $hermesBin = $h.Source } elseif ($h) { Write-Warning "hermes es '$($h.Source)' (no .exe): execFile no ejecuta .cmd/.bat sin shell; define MC_HERMES_BIN con la ruta de un .exe." }

# Lanzador: bucle con espera; el token se lee del archivo en cada arranque.
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("`$ErrorActionPreference = 'Continue'")
$lines.Add("`$env:MC_MACHINE_ID = '$MachineId'")
$lines.Add("`$env:MC_HERMES_URL = '$HermesUrl'")
if ($BffUrl) { $lines.Add("`$env:MC_BFF_URL = '$BffUrl'") }
if ($hermesBin) { $lines.Add("`$env:MC_HERMES_BIN = '$hermesBin'") }
$lines.Add("if (Test-Path -LiteralPath '$TokenFile') { `$env:MC_NODE_AGENT_TOKEN = (Get-Content -Raw -LiteralPath '$TokenFile').Trim() }")
$lines.Add("while (`$true) {")
$lines.Add("  & '$NodeExe' '$main'")
$lines.Add("  Start-Sleep -Seconds 5")
$lines.Add("}")

Write-Host "+ New-Item -ItemType Directory -Force '$mcHome'"
Write-Host "+ escribir $launcher (lanzador; contenido a continuación, sin el token)"
$lines | ForEach-Object { Write-Host "    $_" }
Write-Host "+ icacls `"$mcHome`" /inheritance:r /grant:r `"$($env:USERNAME):(OI)(CI)F`""
$arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
Write-Host "+ Register-ScheduledTask -TaskName '$TaskName' -Action (powershell.exe $arg) -Trigger (AtLogOn $env:USERNAME) -Settings (RestartCount 999, 1 min, sin límite de tiempo) -RunLevel Limited -Force"
Write-Host "+ Start-ScheduledTask -TaskName '$TaskName'"
if ($Exec) {
  New-Item -ItemType Directory -Force -Path $mcHome | Out-Null
  [System.IO.File]::WriteAllLines($launcher, $lines, (New-Object System.Text.UTF8Encoding($false)))
  & icacls.exe $mcHome /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 4
  Write-Host '+ GET http://127.0.0.1:3400/health'
  try { Invoke-RestMethod -Uri 'http://127.0.0.1:3400/health' -TimeoutSec 8 | ConvertTo-Json -Compress } catch { Write-Host "AVISO: /health no responde todavía: $($_.Exception.Message)" }
}
Write-Host "Quitar: .\install-node-agent.ps1 -Uninstall -Yes   ·   Estado: schtasks /Query /TN `"$TaskName`" /V /FO LIST"
