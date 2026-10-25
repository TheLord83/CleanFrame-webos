<#
.SYNOPSIS
  Install CleanFrame (launcher) and the CleanFrame Hub (configuration server) on a
  rooted LG TV running webOS 6 or newer, from Windows.

.DESCRIPTION
  Same flow as tools/install.sh: detect -> check -> plan -> confirm -> install ->
  verify -> report. Nothing is changed before the confirmation.

  What it cannot do: the rooting itself needs a person with the remote control
  (see docs/INSTALL.md). Everything after that is handled here.

  Requires OpenSSH client (ssh, scp - part of Windows 10/11) and a checkout of this
  repository (the hub files and the IPK come from it). PowerShell 5.1 or 7+.

.EXAMPLE
  .\tools\install.ps1 -Tv 192.168.1.50
  .\tools\install.ps1 -Tv 192.168.1.50 -DryRun
  .\tools\install.ps1 -Tv 192.168.1.50 -Lang de -Ipk .\dist\cleanframe_all.ipk
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Tv,
  [string]$Ipk,
  [ValidateSet('en', 'de')][string]$Lang = 'en',
  [switch]$DryRun,
  [switch]$Yes,
  [switch]$NoLauncher,
  [switch]$NoHub,
  [switch]$Root,
  [switch]$NoRoot,
  [switch]$Info,
  [string]$SshKey
)

$ErrorActionPreference = 'Stop'
$AppIdDefault = 'com.blackpearl.cleanframe'
# The switch -Root must stay a switch: the repo root gets its own variable.
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Tools = Join-Path $RepoRoot 'tools'

# ---- texts -------------------------------------------------------------------
$Text = @{
  en = @{
    need_tv       = 'usage: install.ps1 -Tv <ip> [-Lang de] [-DryRun]'
    detect        = '==> Looking for the TV'
    tv_off        = '    port 22 closed. TV in standby? Wake it by hand (network standby must be on).'
    tv_on         = '    TV answers (SSH open)'
    check         = '==> Checking prerequisites'
    no_ssh        = 'ERROR: cannot ssh root@{0}. Is the TV rooted and the key installed? See docs/INSTALL.md'
    node_ok       = '    node {0}'
    no_node       = 'ERROR: node missing on the TV or too old (found: {0}, need: 8+)'
    glass_ok      = '    Glasshouse answers ({0}:8080)'
    no_glass      = 'ERROR: Glasshouse does not answer on port 8080 - without it no IPK can be installed.'
    plan          = '==> Plan'
    plan_launcher = '    install the launcher IPK: {0}'
    plan_hub      = '    set up the hub: /var/lib/cleanframe, autostart, port 8484'
    ask           = 'Proceed? [Y/n]'
    aborted       = 'Aborted, nothing changed.'
    launcher      = '==> Installing the launcher'
    hub           = '==> Setting up the hub'
    verify        = '==> Verifying'
    ok_health     = '    hub answers: {0}'
    fail_health   = 'ERROR: hub does not answer on port 8484'
    ok_app        = '    launcher is in the app list: {0} {1}'
    fail_app      = 'ERROR: install reported, but {0} is missing from the app list'
    no_ipk        = 'ERROR: no IPK found. Build one on Linux (tools/build-ipk.py) and pass -Ipk <file>.'
    report        = '==> Result'
    dry           = '(dry run: nothing was changed)'
    need_ssh      = 'ERROR: ssh/scp not found. Install the OpenSSH client (Windows optional feature).'
    need_python   = 'ERROR: python3 not found. Rooting and the network search use the upstream Python tools.'
    find          = '==> Looking for a TV on the network'
    find_one      = '    found: {0}'
    find_many     = '    several candidates - pick one with -Tv <ip>:'
    find_none     = 'ERROR: no LG TV found. Awake? Same network? See docs/TROUBLESHOOTING.md'
    info          = '==> State of the TV'
    root_check    = '==> Checking root'
    root_ok       = '    root: yes, SSH answers'
    root_missing  = '    root: no, no root shell answers'
    root_offer    = 'Root it now? On a stock TV nothing can be installed without root - the app installer needs it. Afterwards the launcher runs without root, the hub does not. [Y/n]'
    root_declined = '    without root: hub skipped, launcher only'
    root_no_root  = '    -NoRoot given: hub skipped'
    root_no_tty   = '    no terminal to ask: hub skipped. Pass -Root to root first.'
    glass_ok_install = '    Glasshouse answers on port 8080: installing works without a root shell'
    nothing_without_root = 'ERROR: without root nothing can be installed - no root shell (22) and no Glasshouse (8080). Start again with -Root.'
    root_stage    = '==> Rooting (SlopBro)'
    root_skip     = '    already rooted, SSH works'
    root_pair     = '    A pairing prompt will appear on the TV - accept it with the remote.'
    root_wait     = '    waiting for the root shell (Telnet 23) ...'
    root_timeout  = 'ERROR: no root shell. Check the SlopBro output above.'
    root_setup    = '==> Installing the SSH key, closing Telnet, blocking updates'
    key_missing   = 'ERROR: public key not found: {0} (pass -SshKey)'
  }
  de = @{
    need_tv       = 'Aufruf: install.ps1 -Tv <ip> [-Lang de] [-DryRun]'
    detect        = '==> Fernseher suchen'
    tv_off        = '    Port 22 zu. Fernseher im Standby? Von Hand wecken (Netzwerk-Standby muss an sein).'
    tv_on         = '    Fernseher antwortet (SSH offen)'
    check         = '==> Voraussetzungen pruefen'
    no_ssh        = 'FEHLER: SSH auf root@{0} nicht moeglich. Ist der Fernseher gerootet und der Schluessel hinterlegt? Siehe docs/INSTALL.md'
    node_ok       = '    node {0}'
    no_node       = 'FEHLER: node fehlt auf dem Fernseher oder ist zu alt (gefunden: {0}, gebraucht: 8+)'
    glass_ok      = '    Glasshouse antwortet ({0}:8080)'
    no_glass      = 'FEHLER: Glasshouse antwortet nicht auf Port 8080 - ohne Glasshouse laesst sich kein IPK installieren.'
    plan          = '==> Vorhaben'
    plan_launcher = '    Launcher als IPK installieren: {0}'
    plan_hub      = '    Hub einrichten: /var/lib/cleanframe, Autostart, Port 8484'
    ask           = 'Ausfuehren? [J/n]'
    aborted       = 'Abgebrochen, nichts veraendert.'
    launcher      = '==> Launcher installieren'
    hub           = '==> Hub einrichten'
    verify        = '==> Nachpruefen'
    ok_health     = '    Hub antwortet: {0}'
    fail_health   = 'FEHLER: Hub antwortet nicht auf Port 8484'
    ok_app        = '    Launcher haengt im Katalog: {0} {1}'
    fail_app      = 'FEHLER: Installation gemeldet, aber {0} fehlt im Katalog'
    no_ipk        = 'FEHLER: kein IPK gefunden. Auf Linux bauen (tools/build-ipk.py) und -Ipk <Datei> angeben.'
    report        = '==> Ergebnis'
    dry           = '(Probelauf: nichts wurde veraendert)'
    need_ssh      = 'FEHLER: ssh/scp nicht gefunden. OpenSSH-Client als Windows-Feature nachinstallieren.'
    need_python   = 'FEHLER: python3 nicht gefunden. Rooten und Netzweite Suche nutzen die Python-Werkzeuge.'
    find          = '==> Fernseher im Netz suchen'
    find_one      = '    gefunden: {0}'
    find_many     = '    mehrere Kandidaten - mit -Tv <ip> auswaehlen:'
    find_none     = 'FEHLER: kein LG-Fernseher gefunden. Wach? Gleiches Netz? Siehe docs/TROUBLESHOOTING.md'
    info          = '==> Zustand des Fernsehers'
    root_check    = '==> Root pruefen'
    root_ok       = '    root: ja, SSH antwortet'
    root_missing  = '    root: nein, es antwortet keine Root-Shell'
    root_offer    = 'Jetzt rooten? Auf einem unveraenderten Fernseher laesst sich ohne root gar nichts installieren - der App-Installer braucht es. Danach laeuft der Launcher ohne root, der Hub nicht. [J/n]'
    root_declined = '    ohne root: Hub wird uebersprungen, Launcher wird installiert'
    root_no_root  = '    -NoRoot gesetzt: Hub wird uebersprungen'
    root_no_tty   = '    keine Eingabe moeglich: Hub wird uebersprungen. Mit -Root wird vorher gerootet.'
    glass_ok_install = '    Glasshouse antwortet auf Port 8080: installieren geht auch ohne root-Shell'
    nothing_without_root = 'FEHLER: ohne root laesst sich nichts installieren - keine Root-Shell (22) und kein Glasshouse (8080). Mit -Root neu starten.'
    root_stage    = '==> Rooten (SlopBro)'
    root_skip     = '    schon gerootet, SSH funktioniert'
    root_pair     = '    Gleich erscheint am Fernseher ein Kopplungsdialog - mit der Fernbedienung bestaetigen.'
    root_wait     = '    warte auf die Root-Shell (Telnet 23) ...'
    root_timeout  = 'FEHLER: keine Root-Shell bekommen. SlopBro-Ausgabe oben pruefen.'
    root_setup    = '==> SSH-Schluessel setzen, Telnet schliessen, Updates sperren'
    key_missing   = 'FEHLER: oeffentlicher Schluessel fehlt: {0} (mit -SshKey angeben)'
  }
}

function T {
  # $Args is an automatic variable in PowerShell - do not name a parameter that way.
  param([string]$Key, [object[]]$Vals = @())
  $s = $Text[$Lang][$Key]
  if ($null -eq $s) { return $Key }
  if ($Vals.Count -gt 0) { return ($s -f $Vals) }
  return $s
}
function Say { param([string]$Message) Write-Host $Message }
function Fail { param([string]$Message) Write-Error $Message; exit 1 }

# ---- 0. tools present --------------------------------------------------------
foreach ($tool in 'ssh', 'scp') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail (T 'need_ssh') }
}
# Rooting uses the upstream tools, and those are Python (SlopBro has no other
# implementation). Same for discovery, so a Windows box needs Python 3 on PATH.
function Get-Python {
  foreach ($candidate in 'python3', 'python') {
    $found = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
  }
  return $null
}

$Python = Get-Python

# ---- 0. find the TV when no address was given --------------------------------
if (-not $Tv) {
  if (-not $Python) { Fail (T 'need_python') }
  Say (T 'find')
  $json = & $Python (Join-Path $Tools 'discover.py') --json 2>$null | Out-String
  $found = $null
  try { $found = ($json | ConvertFrom-Json).hosts } catch { $found = $null }
  $count = if ($found) { @($found).Count } else { 0 }
  if ($count -eq 0) { Fail (T 'find_none') }
  if ($count -eq 1) {
    $Tv = @($found)[0].ip
    Say (T 'find_one' @($Tv))
  } else {
    Say (T 'find_many')
    foreach ($host in $found) {
      Say ("      {0,-15} {1}" -f $host.ip, ($host.name + ' ' + $host.model).Trim())
    }
    exit 2
  }
}

$sshBase = @('-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', "root@$Tv")

function Test-Port {
  param([int]$Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync($Tv, $Port)
    return ($task.Wait(3000) -and $client.Connected)
  } catch { return $false } finally { $client.Dispose() }
}

# ---- state / root ------------------------------------------------------------
if ($Info) {
  Say (T 'info')
  if (Test-Port 22) {
    & ssh @sshBase 'echo model: $(grep -o "\"modelName\"[^,]*" /var/run/nyx/os_info.json | head -1); echo webos: $(grep -o "\"webos_name\"[^,]*" /var/run/nyx/os_info.json | head -1); echo node: $(/usr/bin/node -v)'
    Say ("    rooted: yes")
  } else {
    Say ("    rooted: no")
  }
  exit 0
}

Say (T 'root_check')
$rooted = $false
if (Test-Port 22) {
  $uid = (& ssh @sshBase 'id -u' 2>$null | Out-String).Trim()
  if ($uid -eq '0') { $rooted = $true }
}

if ($rooted) {
  Say (T 'root_ok')
} else {
  Say (T 'root_missing')
  $rootNow = $false
  if ($NoRoot) {
    Say (T 'root_no_root')
    $NoHub = $true
  } elseif ($Root -or $Yes) {
    $rootNow = $true
  } elseif ([Console]::IsInputRedirected) {
    # No terminal to ask: never root on our own
    $NoHub = $true
    $noTty = $true
  } else {
    $answer = Read-Host (T 'root_offer')
    if ($answer -match '^(y|yes|j|ja)$') { $rootNow = $true }
  }
  if ($noTty) {
    Say (T 'root_no_tty')
  } elseif (-not $rootNow -and -not $NoRoot) {
    Say (T 'root_declined')
    $NoHub = $true
  }
  if ($rootNow) {
    Say (T 'root_stage')
    if (-not $Python) { Fail (T 'need_python') }
    # LOCALAPPDATA exists on Windows only; fall back so the script also runs on Linux/macOS
    $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME '.cache' }
    $SlopBro = Join-Path $base 'cleanframe/slopbro'
    if (-not (Test-Path (Join-Path $SlopBro 'slopbro.py'))) {
      Say ("    fetching SlopBro into $SlopBro")
      New-Item -ItemType Directory -Force -Path (Split-Path $SlopBro) | Out-Null
      & git clone --depth 1 https://github.com/throwaway96/slopbro.git $SlopBro
      if (-not (Test-Path (Join-Path $SlopBro 'slopbro.py'))) { Fail 'could not fetch SlopBro (git missing?)' }
    }
    Say (T 'root_pair')
    if ($DryRun) {
      Say ("    [dry run] $Python " + (Join-Path $SlopBro "slopbro.py") + " $Tv")
    } else {
      Push-Location $SlopBro
      try { & $Python 'slopbro.py' $Tv } finally { Pop-Location }
      Say (T 'root_wait')
      $up = $false
      foreach ($i in 1..60) {
        if ((Test-Port 23) -or (Test-Port 22)) { $up = $true; break }
        Start-Sleep -Seconds 3
      }
      if (-not $up) { Fail (T 'root_timeout') }
    }
    Say (T 'root_setup')
    if (-not $SshKey) {
      foreach ($candidate in (Join-Path $HOME '.ssh\lgtv.pub'), (Join-Path $HOME '.ssh\id_ed25519.pub'), (Join-Path $HOME '.ssh\id_rsa.pub')) {
        if (Test-Path $candidate) { $SshKey = $candidate; break }
      }
    }
    if (-not $SshKey -or -not (Test-Path $SshKey)) { Fail (T 'key_missing' @('~/.ssh/lgtv.pub')) }
    $argv = @((Join-Path $Tools 'tvsetup.py'), '--tv', $Tv, '--key', $SshKey)
    if ($DryRun) { $argv += '--dry-run' }
    & $Python @argv
    if ($LASTEXITCODE -ne 0) { Fail 'SSH key or Telnet step failed' }
  }
}

# Without root the only way in is an already installed Glasshouse. If that does not
# answer either, there is nothing to install.
if (-not $rooted -and -not $rootNow) {
  $glass = $false
  try {
    $resp = Invoke-WebRequest -Uri "http://$($Tv):8080/api/apps" -TimeoutSec 6 -UseBasicParsing
    if ($resp.Content -match 'installed') { $glass = $true }
  } catch { }
  if ($glass) { Say (T 'glass_ok_install') } else { Fail (T 'nothing_without_root') }
}

# ---- IPK ---------------------------------------------------------------------
if (-not $NoLauncher) {
  if (-not $Ipk) {
    foreach ($candidate in (Join-Path $RepoRoot 'dist\cleanframe_all.ipk'), (Join-Path $RepoRoot 'ipk\cleanframe_all.ipk')) {
      if (Test-Path $candidate) { $Ipk = $candidate; break }
    }
  }
  if (-not $Ipk -or -not (Test-Path $Ipk)) { Fail (T 'no_ipk') }
}

# ---- 1. detect ---------------------------------------------------------------
Say (T 'detect')
if (-not (Test-Port 22)) {
  Say (T 'tv_off')
  if ($DryRun) { Say ''; Say (T 'dry'); exit 0 }
  Fail (T 'no_ssh' @($Tv))
}
Say (T 'tv_on')

# ---- 2. check ----------------------------------------------------------------
Say (T 'check')
$nodeRaw = & ssh @sshBase '/usr/bin/node -v' 2>$null
if ($LASTEXITCODE -ne 0 -or -not $nodeRaw) { Fail (T 'no_ssh' @($Tv)) }
$nodeVer = ($nodeRaw -join '').Trim().TrimStart('v')
$major = 0
if (-not [int]::TryParse(($nodeVer -split '\.')[0], [ref]$major) -or $major -lt 8) {
  Fail (T 'no_node' @($nodeVer))
}
Say (T 'node_ok' @($nodeVer))

try {
  $glass = Invoke-RestMethod -Uri "http://$Tv`:8080/api/apps" -TimeoutSec 8
} catch { Fail (T 'no_glass') }
Say (T 'glass_ok' @($Tv))

# ---- 3. plan -----------------------------------------------------------------
Say (T 'plan')
if (-not $NoLauncher) { Say (T 'plan_launcher' @($Ipk)) }
if (-not $NoHub) { Say (T 'plan_hub') }

if ($DryRun) { Say ''; Say (T 'dry'); exit 0 }

# ---- 4. confirm --------------------------------------------------------------
if (-not $Yes) {
  $answer = Read-Host (T 'ask')
  if ($answer -match '^(n|no|nein)$') { Say (T 'aborted'); exit 0 }
}

# ---- 5. install --------------------------------------------------------------
if (-not $NoLauncher) {
  Say (T 'launcher')
  # Upload through Glasshouse's own installer - the same path the Homebrew Channel
  # uses. luna-send does not work from the webOS shell on 6.5.
  $bytes = [System.IO.File]::ReadAllBytes($Ipk)
  Invoke-RestMethod -Method Post -Uri "http://$Tv`:8080/api/apps/install/sideload" `
    -ContentType 'application/json' -Body '{"enabled":true}' -TimeoutSec 30 | Out-Null
  $job = Invoke-RestMethod -Method Post -Uri "http://$Tv`:8080/api/apps/install/upload" `
    -ContentType 'application/octet-stream' -Body $bytes -TimeoutSec 900
  $jobId = $job.install.jobId
  if (-not $jobId) { Fail ('upload rejected: ' + ($job | ConvertTo-Json -Compress)) }
  $deadline = (Get-Date).AddMinutes(5)
  $confirmed = $false
  $state = '?'
  while ((Get-Date) -lt $deadline) {
    $status = Invoke-RestMethod -Uri "http://$Tv`:8080/api/apps/install/status" -TimeoutSec 20
    $state = $status.state
    if ($state -eq 'awaiting-confirm' -and -not $confirmed) {
      Invoke-RestMethod -Method Post -Uri "http://$Tv`:8080/api/apps/install/confirm" `
        -ContentType 'application/json' -Body (@{ jobId = $jobId } | ConvertTo-Json) -TimeoutSec 30 | Out-Null
      $confirmed = $true
    } elseif ($state -in @('installed', 'done')) { break }
    elseif ($state -in @('failed', 'error', 'cancelled')) { Fail ('install failed: ' + ($status | ConvertTo-Json -Compress)) }
    Start-Sleep -Seconds 3
  }
  Invoke-RestMethod -Method Post -Uri "http://$Tv`:8080/api/apps/install/sideload" `
    -ContentType 'application/json' -Body '{"enabled":false}' -TimeoutSec 20 | Out-Null
}

if (-not $NoHub) {
  Say (T 'hub')
  # scp needs forward slashes on the remote side
  & ssh @sshBase 'mkdir -p /var/lib/cleanframe/lib /var/lib/cleanframe/assets /var/lib/webosbrew/init.d'
  & scp -q -o StrictHostKeyChecking=no (Join-Path $RepoRoot 'web\server.js') "root@$($Tv):/var/lib/cleanframe/server.js"
  # scp expands no wildcards by itself - the file list has to come from PowerShell.
  $libFiles = Get-ChildItem -Path (Join-Path $RepoRoot 'web\lib') -Filter '*.js' | ForEach-Object { $_.FullName }
  # -Include only works together with a wildcard path
  $assetFiles = @(
    Get-ChildItem -Path (Join-Path $RepoRoot 'web\assets\*') -Include '*.html', '*.json' -File |
      ForEach-Object { $_.FullName }
  )
  if ($assetFiles.Count -eq 0) { Fail 'ERROR: no hub assets found under web/assets' }
  & scp -q -o StrictHostKeyChecking=no $libFiles "root@$($Tv):/var/lib/cleanframe/lib/"
  & scp -q -o StrictHostKeyChecking=no $assetFiles "root@$($Tv):/var/lib/cleanframe/assets/"
  & scp -r -q -o StrictHostKeyChecking=no (Join-Path $RepoRoot 'web\assets\icons') "root@$($Tv):/var/lib/cleanframe/assets/"
  # Language files live in their own directory; without them the interface shows keys.
  & scp -r -q -o StrictHostKeyChecking=no (Join-Path $RepoRoot 'web\assets\lang') "root@$($Tv):/var/lib/cleanframe/assets/"
  & scp -q -o StrictHostKeyChecking=no (Join-Path $RepoRoot 'web\cleanframectl') "root@$($Tv):/var/lib/cleanframe/cleanframectl"
  & scp -q -o StrictHostKeyChecking=no (Join-Path $RepoRoot 'web\init.d\52-cleanframe') "root@$($Tv):/var/lib/webosbrew/init.d/52-cleanframe"
  & ssh @sshBase 'chmod +x /var/lib/cleanframe/cleanframectl /var/lib/webosbrew/init.d/52-cleanframe; /var/lib/cleanframe/cleanframectl restart'
}

# ---- 6. verify ---------------------------------------------------------------
Say (T 'verify')
$health = $null
foreach ($i in 1..15) {
  try {
    $health = Invoke-RestMethod -Uri "http://$Tv`:8484/api/health" -TimeoutSec 6
    if ($health.ok) { break }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $health -or -not $health.ok) { Fail (T 'fail_health') }
Say (T 'ok_health' @(($health | ConvertTo-Json -Compress).Substring(0, [Math]::Min(120, ($health | ConvertTo-Json -Compress).Length))))

if (-not $NoLauncher) {
  $apps = (Invoke-RestMethod -Uri "http://$Tv`:8080/api/apps" -TimeoutSec 15).installed
  $mine = $apps | Where-Object { $_.id -eq $AppIdDefault } | Select-Object -First 1
  if (-not $mine) { Fail (T 'fail_app' @($AppIdDefault)) }
  Say (T 'ok_app' @($AppIdDefault, $mine.version))

  # Installing replaces the app folder, so start it and wait for a picture: that is
  # the difference between "installed" and "on screen".
  Invoke-RestMethod -Method Post -Uri "http://$Tv`:8080/api/control" -ContentType 'application/json' `
    -Body (@{ action = 'launchApp'; value = $AppIdDefault } | ConvertTo-Json) -TimeoutSec 20 | Out-Null
  $shot = $null
  foreach ($i in 1..20) {
    try {
      Invoke-WebRequest -Uri "http://$Tv`:8484/api/tv/snapshot" -TimeoutSec 8 -OutFile ([System.IO.Path]::GetTempFileName()) | Out-Null
      $shot = 200; break
    } catch { Start-Sleep -Seconds 1 }
  }
  if ($shot -eq 200) { Say '    launcher is on screen (live picture available)' }
  else { Say '    note: launcher started, but no live picture yet - open it on the TV' }
}

# ---- 7. report ---------------------------------------------------------------
Say ''
Say (T 'report')
Say ("    interface: http://$Tv`:8484/")
Say ("    app id:    $AppIdDefault")
