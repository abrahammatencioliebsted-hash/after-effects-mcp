<#
.SYNOPSIS
  Mission Control: instalar Hermes Agent NATIVO en Windows, activar su API server y registrar el gateway como tarea de inicio de sesión.

.DESCRIPTION
  1) Si 'hermes' no existe, descarga el instalador oficial (install.ps1), imprime su SHA-256 y lo ejecuta FIJADO a un commit
     (-Commit) y sin interacción (-NonInteractive). El instalador de Hermes sí admite -Commit (verificado leyendo scripts/install.ps1).
  2) Asegura en <HERMES_HOME>\.env: API_SERVER_ENABLED, API_SERVER_HOST=127.0.0.1, API_SERVER_PORT y API_SERVER_KEY (generada
     con un generador criptográfico SOLO si no existe; NUNCA se imprime) y restringe la ACL del .env al usuario actual.
  3) 'hermes gateway install' (tarea programada Hermes_Gateway al iniciar sesión; sin administrador) y comprobación de /health.
  Sin -Yes (o con -DryRun) solo imprime el plan. También se aceptan --yes / --dry-run. No contiene secretos.

.PARAMETER Commit      Commit de Hermes a fijar (por defecto el verificado el 2026-10-07).
.PARAMETER HermesHome  Directorio de datos. Por defecto $env:HERMES_HOME o %LOCALAPPDATA%\hermes.
.PARAMETER Force       Ejecutar el instalador aunque 'hermes' ya exista.
.PARAMETER NoService   No ejecutar 'hermes gateway install'.

.NOTES
  Estado de verificación: sintaxis analizada con el parser de PowerShell 7.5.3 en Linux. NO ejecutado en Windows.
  El instalador (hermes-agent.nousresearch.com) no es alcanzable desde el entorno Cloud donde se escribió este script.
#>
[CmdletBinding()]
param(
  [string]$Commit = 'a28a5d03a9fa60418db5f44f3436fa2aa029c8f2',   # ---- commit fijado de Hermes (cambiar aquí) ----
  [string]$HermesHome = $(if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }),
  [int]$ApiPort = 8642,
  [switch]$Force,
  [switch]$NoService,
  [switch]$Yes,
  [switch]$DryRun,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Rest -contains '--yes') { $Yes = $true }
if ($Rest -contains '--dry-run') { $DryRun = $true }
$Exec = $Yes -and -not $DryRun
$InstallerUrl = 'https://hermes-agent.nousresearch.com/install.ps1'
$ApiHost = '127.0.0.1'

function Say([string]$m) { Write-Host "== $m" }
function NewHexKey { $b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); (($b | ForEach-Object { $_.ToString('x2') }) -join '') }

# Añade KEY=VALUE a un .env solo si la clave no existe. Con Value '@gen' genera una clave y no la imprime.
function Ensure-Env([string]$File, [string]$Key, [string]$Value) {
  $exists = (Test-Path -LiteralPath $File) -and ((Get-Content -LiteralPath $File -ErrorAction SilentlyContinue) -match ('^' + [regex]::Escape($Key) + '='))
  if ($exists) { Write-Host "  (ya existe $Key en $File; no se toca)"; return }
  if ($Value -eq '@gen') { Write-Host "+ añadir $Key=<generada, no se imprime> a $File"; $v = $null } else { Write-Host "+ añadir $Key=$Value a $File"; $v = $Value }
  if ($Exec) {
    if ($Value -eq '@gen') { $v = NewHexKey }
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($File, "$Key=$v`n", $enc)
  }
}

Say "Mission Control: Hermes nativo en Windows (HERMES_HOME=$HermesHome)"
if (-not $Exec) { Say 'MODO PLAN: no se ejecuta nada (añade -Yes para ejecutar).' }
if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'Se necesita PowerShell 5.1 o superior.' }

# --- 1) Instalador oficial fijado ----------------------------------------------------------------------
$hermes = Get-Command hermes -ErrorAction SilentlyContinue
if ($hermes -and -not $Force) {
  Say ("hermes ya instalado: " + $hermes.Source + " (usa -Force para reinstalar)")
} else {
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('mc-hermes-install-' + [guid]::NewGuid().ToString('n') + '.ps1')
  Write-Host "+ Invoke-WebRequest -Uri $InstallerUrl -OutFile $tmp"
  if ($Exec) {
    Invoke-WebRequest -Uri $InstallerUrl -OutFile $tmp
    Write-Host ("sha256 de install.ps1: " + (Get-FileHash -Algorithm SHA256 -LiteralPath $tmp).Hash.ToLowerInvariant() + "  (anótalo; Hermes no publica un hash independiente)")
    Say "Revisa $tmp antes de continuar si es la primera vez."
  }
  Write-Host "+ & ([scriptblock]::Create((Get-Content -Raw $tmp))) -NonInteractive -Commit $Commit -HermesHome '$HermesHome'"
  if ($Exec) {
    & ([scriptblock]::Create((Get-Content -Raw -LiteralPath $tmp))) -NonInteractive -Commit $Commit -HermesHome $HermesHome
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    # El instalador cambia el PATH de USUARIO; esta sesión aún no lo ve.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
  }
}

# --- 2) API server en .env -------------------------------------------------------------------------------
Say "Configurar el API server en $HermesHome\.env"
$envFile = Join-Path $HermesHome '.env'
if ($Exec) {
  New-Item -ItemType Directory -Force -Path $HermesHome | Out-Null
  if (-not (Test-Path -LiteralPath $envFile)) { New-Item -ItemType File -Path $envFile | Out-Null }
} else { Write-Host "+ New-Item -ItemType Directory -Force -Path $HermesHome ; crear $envFile si no existe" }
Ensure-Env $envFile 'API_SERVER_ENABLED' 'true'
Ensure-Env $envFile 'API_SERVER_HOST' $ApiHost
Ensure-Env $envFile 'API_SERVER_PORT' "$ApiPort"
Ensure-Env $envFile 'API_SERVER_KEY' '@gen'
Write-Host "+ icacls `"$envFile`" /inheritance:r /grant:r `"$($env:USERNAME):(F)`"     (solo tu usuario; caveat W9)"
if ($Exec) { & icacls.exe $envFile /inheritance:r /grant:r "$($env:USERNAME):(F)" | Out-Null }

Write-Host @"

Proveedor del modelo (NO lo escribe este script: son secretos y hay una decisión pendiente, P06):
  - MiMo: añade a $envFile las líneas XIAOMI_API_KEY=<tu clave> y XIAOMI_BASE_URL=<URL de tu plan>, y en config.yaml
    model.provider: xiaomi / model.default: <modelo>. RIESGO [F]: el Token Plan de MiMo prohíbe scripts automatizados;
    un ejecutor de Mission Control o un cron de Hermes con ese plan podría contar como tal. Decisión del usuario pendiente.
  - Alternativa: 'hermes model' (asistente interactivo).
"@

# --- 3) Gateway como tarea al iniciar sesión --------------------------------------------------------------
if (-not $NoService) {
  Write-Host '+ hermes gateway install'
  Write-Host '+ hermes gateway status'
  if ($Exec) {
    $global:LASTEXITCODE = 0
    & hermes gateway install
    if ($LASTEXITCODE -ne 0) { throw "hermes gateway install terminó con código $LASTEXITCODE" }
    & hermes gateway status
    Start-Sleep -Seconds 6
    Write-Host "+ GET http://${ApiHost}:${ApiPort}/health"
    try { (Invoke-RestMethod -Uri "http://${ApiHost}:${ApiPort}/health" -TimeoutSec 10 | ConvertTo-Json -Compress) } catch { Write-Host "AVISO: /health no responde todavía: $($_.Exception.Message)" }
    Write-Host 'Para validar la clave (sin imprimirla): ver docs/04-runbooks/windows.md §3.'
  }
  Write-Host 'Nota: Task Scheduler solo ve el lanzador; un gateway que muera después NO se reinicia solo (docs de Hermes): comprueba con "hermes gateway status".'
}
