<#
.SYNOPSIS
  Mission Control: instalar Paperclip DENTRO de WSL2 (ruta recomendada en Windows) con el instalador gestionado y el servicio systemd de usuario.

.DESCRIPTION
  Paperclip NO soporta oficialmente Windows nativo para su instalación gestionada ni su servicio (docs: macOS, Linux o WSL2;
  'paperclipai service' devuelve "no soportado" en win32). Este script imprime SIEMPRE los comandos del lado WSL y solo los
  ejecuta con -Yes (o --yes). Con -DryRun (o --dry-run) imprime el plan aunque se pase -Yes. No contiene secretos.

  Lado WSL (bash): comprueba systemd y Node >= 24.11 -> descarga install.sh + .sha256 y verifica -> instala la versión FIJADA
  sin onboarding -> onboard --yes [--bind tailnet] --install-service -> service install --enable-linger -> estado y /api/health.

.PARAMETER Distro        Nombre de la distro WSL (por defecto Ubuntu).
.PARAMETER Version       Versión exacta de paperclipai (por defecto la fijada abajo).
.PARAMETER Bind          '' (loopback, por defecto) o 'tailnet' (solo si Tailscale ya está arriba DENTRO de WSL2 y la config no existe).
.PARAMETER Yes           Ejecuta de verdad. También se acepta --yes.
.PARAMETER DryRun        Solo imprime. También se acepta --dry-run.

.NOTES
  Estado de verificación: sintaxis analizada con el parser de PowerShell 7.5.3 en Linux. NO ejecutado en Windows ni con WSL.
  Ver docs/04-runbooks/windows.md (sección 2).
#>
[CmdletBinding()]
param(
  [string]$Distro = 'Ubuntu',
  [string]$Version = '2026.1005.0',          # ---- versión fijada de Paperclip (cambiar aquí) ----
  [ValidateSet('', 'tailnet')][string]$Bind = '',
  [switch]$Yes,
  [switch]$DryRun,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Rest -contains '--yes') { $Yes = $true }
if ($Rest -contains '--dry-run') { $DryRun = $true }
$Exec = $Yes -and -not $DryRun

$InstallerUrl = 'https://paperclip.ing/install.sh'

function Say([string]$m) { Write-Host "== $m" }

Say "Mission Control: instalar Paperclip $Version en WSL2 (distro '$Distro')"
if (-not $Exec) { Say 'MODO PLAN: no se ejecuta nada (añade -Yes para ejecutar).' }

# --- 1) WSL disponible y distro presente ---------------------------------------------------------------
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
  Write-Host '+ wsl --install -d Ubuntu      (PowerShell como administrador; pide reiniciar)'
  throw 'wsl.exe no está disponible. Instala WSL2 con el comando anterior, reinicia y vuelve a ejecutar este script.'
}
$prevEnc = [Console]::OutputEncoding
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::Unicode   # 'wsl -l' escribe en UTF-16
  $distros = @(& wsl.exe -l -q 2>$null | ForEach-Object { ($_ -replace "`0", '').Trim() } | Where-Object { $_ })
} finally { [Console]::OutputEncoding = $prevEnc }
Say ("Distros WSL: " + ($distros -join ', '))
if ($distros -notcontains $Distro) { throw "No existe la distro '$Distro'. Instálala con: wsl --install -d $Distro" }

# --- 2) Script del lado WSL (bash). Se imprime y, con -Yes, se ejecuta ----------------------------------
$bindArg = ''
if ($Bind -eq 'tailnet') { $bindArg = '--bind tailnet' }
$bash = @'
set -euo pipefail
PAPERCLIP_VERSION='__VERSION__'
INSTALLER_URL='__URL__'
echo "== systemd (PID 1): $(ps -p 1 -o comm=)"
if [ "$(ps -p 1 -o comm=)" != "systemd" ]; then
  echo 'ERROR: systemd no está activo en esta distro. En WSL: sudo sh -c "printf \"[boot]\nsystemd=true\n\" > /etc/wsl.conf"; luego en PowerShell: wsl --shutdown' >&2
  exit 3
fi
if command -v node >/dev/null 2>&1; then
  echo "== node: $(node -v)"
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<24||(a===24&&b<11)) { console.error("Node < 24.11.0"); process.exit(4) }'
else
  echo '== node no está instalado: install.sh intentará instalarlo y puede pedir sudo (ejecuta este script en una terminal interactiva la primera vez)'
fi
mkdir -p "$HOME/mc-install" && cd "$HOME/mc-install"
curl -fsSLO "$INSTALLER_URL"
curl -fsSLO "$INSTALLER_URL.sha256"
sha256sum -c install.sh.sha256
bash install.sh --version "$PAPERCLIP_VERSION" --no-prompt --no-onboard
export PATH="$HOME/.local/bin:$PATH"
paperclipai --version
paperclipai onboard --yes __BIND__ --install-service
paperclipai service install --enable-linger || echo 'AVISO: si pidió autorización, ejecuta a mano: sudo loginctl enable-linger "$USER"'
paperclipai service status --json
sleep 8
PORT="$(sed -n 's/.*"port": *\([0-9]*\).*/\1/p' "$HOME/.paperclip/instances/default/runtime-info.json" | head -1)"
echo "== GET http://127.0.0.1:${PORT:-3100}/api/health"
curl -s "http://127.0.0.1:${PORT:-3100}/api/health"; echo
'@
$bash = $bash.Replace('__VERSION__', $Version).Replace('__URL__', $InstallerUrl).Replace('__BIND__', $bindArg)
$bash = $bash -replace "`r`n", "`n"

Write-Host ''
Write-Host '---- comandos del lado WSL (bash) ----'
Write-Host $bash
Write-Host '---- fin ----'
Write-Host ''

# --- 3) Ejecución (solo con -Yes) ------------------------------------------------------------------------
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("mc-paperclip-wsl-" + [guid]::NewGuid().ToString('n') + '.sh')
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmp, $bash, $utf8NoBom)
try {
  $winPath = $tmp
  Write-Host "+ wsl -d $Distro -- wslpath -u `"$winPath`""
  $wslPath = (& wsl.exe -d $Distro -- wslpath -u $winPath).Trim()
  Write-Host "+ wsl -d $Distro -- bash -lc `"bash '$wslPath'`""
  if ($Exec) {
    $global:LASTEXITCODE = 0
    & wsl.exe -d $Distro -- bash -lc "bash '$wslPath'"
    if ($LASTEXITCODE -ne 0) { throw "El lado WSL terminó con código $LASTEXITCODE (3 = falta systemd, 4 = Node < 24.11)." }
  }
} finally {
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}

Write-Host @'

Siguientes pasos y avisos (docs/04-runbooks/windows.md):
  * Paperclip en WSL2 escucha en el loopback de WSL2. Un Hermes NATIVO en Windows queda en 127.0.0.1 de Windows: para Paperclip eso es
    "HTTP remoto" (denegado por defecto). Opciones: (a) Hermes del principal DENTRO de WSL2 (loopback); (b) HTTPS delante de Hermes;
    (c) networkingMode=mirrored en %USERPROFILE%\.wslconfig (Windows 11 22H2+) y wsl --shutdown, y comprobarlo (no verificado aquí).
  * WSL2 se apaga si no hay procesos: el servicio systemd de usuario + linger lo mantiene, pero comprueba que sobrevive a 'wsl --shutdown' + reinicio.
'@
