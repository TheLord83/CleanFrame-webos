<#
.SYNOPSIS
  Install CleanFrame (the launcher) on an LG TV, and optionally the hub next to it.

.DESCRIPTION
  The launcher is an IPK: this script hands it to Glasshouse on port 8080, the same door the
  Homebrew Channel uses. No SSH, no root, nothing to be root for.

  The hub (the settings page) is a node process on the TV and needs root, so it is installed
  over SSH - and only when you do not pass -LauncherOnly.

  Rooting is not part of this script. See docs/ROOTING.md.

  STATUS: experimental. Written and run against exactly one TV (43NANO779PA, webOS 6.5)
  on Linux; the PowerShell side has never been through a full run on Windows. The manual
  paths in docs/INSTALL.md are the ones that have been seen to work.

.PARAMETER Tv
  Address of the TV. Without it the local network is searched for a host answering Glasshouse
  on port 8080.

.PARAMETER Ipk
  Use this IPK instead of building one from app/.

.PARAMETER LauncherOnly
  Only the launcher: no SSH, no hub.

.PARAMETER HubOnly
  Only the hub, for a launcher that is already installed.

.PARAMETER Info
  Report model, webOS, node and root state. Changes nothing.

.PARAMETER DryRun
  Find, check and print the plan. Changes nothing.

.PARAMETER Lang
  Prompt language: en (default) or de.

.EXAMPLE
  .\tools\install.ps1 -Tv 192.168.1.50

.EXAMPLE
  .\tools\install.ps1 -Tv 192.168.1.50 -LauncherOnly -Lang de

.EXAMPLE
  .\tools\install.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [string]$Tv,
  [string]$Ipk,
  [switch]$LauncherOnly,
  [switch]$HubOnly,
  [switch]$Info,
  [switch]$DryRun,
  [switch]$Yes,
  [ValidateSet('en', 'de')][string]$Lang = 'en'
)

$ErrorActionPreference = 'Stop'
# Not $Root: a parameter and a variable with the same name is a silent trap in PowerShell.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$AppId = 'com.blackpearl.cleanframe'

$M = @{
  en = @{
    find        = 'Looking for the TV on the network ...'
    found       = 'TV: {0}'
    find_none   = 'No TV answering on port 8080. Pass the address: -Tv <ip>. Glasshouse has to be running.'
    no_glass    = 'No Glasshouse on {0}. The app cannot be installed without it - install it first (see README, "What you need").'
    glass_ok    = 'Glasshouse answers ({0}:8080)'
    ipk_build   = 'Building the IPK from app/ ...'
    no_python   = 'python3 is missing. Install python3, or install the IPK by hand in Glasshouse (Apps, install from a file).'
    plan        = 'Plan: install {0} on {1}'
    plan_build  = 'Plan: build the IPK from app/, then install it on {0}'
    ask         = 'Continue? [Y/n] '
    aborted     = 'Aborted.'
    dry         = 'Dry run: nothing changed.'
    installed   = 'Installed: {0} {1}'
    verify_fail = 'The IPK reported success, but {0} is not in Glasshouse app list.'
    launched    = 'Started. The start page should be on the TV now.'
    launch_fail = 'Installed, but starting it did not work. Open CleanFrame from the app list.'
    hub_note    = 'Next: the settings (values on the start page, Home Assistant) need the hub, which needs SSH and root.'
    ssh_fail    = 'No SSH on {0}. The hub needs a rooted TV with SSH - see docs/ROOTING.md.'
    not_root    = 'SSH answers, but the session is not root (uid={0}). The hub writes to /var/lib and needs root. Rooting is not part of this script: see docs/ROOTING.md.'
    rooted      = 'SSH as root, uid={0}'
    no_node     = 'The TV has no usable node (found: {0}, need >= 8).'
    copy        = 'Copying the hub to /var/lib/cleanframe ...'
    autostart   = 'Setting up the autostart ...'
    start       = 'Starting the service ...'
    health_fail = 'The hub does not answer on port 8484.'
    hub_ready   = 'Hub is running: http://{0}:8484/   (API: /api/health, /api/config, /api/apps)'
    info        = 'State of the TV'
    hub_skipped = 'Hub skipped: it needs root, the launcher does not.'
  }
  de = @{
    find        = 'Suche den Fernseher im Netz ...'
    found       = 'Fernseher: {0}'
    find_none   = 'Kein Fernseher gefunden, der auf Port 8080 antwortet. Adresse angeben: -Tv <ip>, und Glasshouse muss laufen.'
    no_glass    = 'Auf {0} antwortet kein Glasshouse. Ohne Glasshouse laesst sich die App nicht installieren - installiere es zuerst.'
    glass_ok    = 'Glasshouse antwortet ({0}:8080)'
    ipk_build   = 'Baue das IPK aus app/ ...'
    no_python   = 'python3 fehlt. Entweder python3 installieren oder das IPK von Hand ueber Glasshouse installieren (Apps, install from a file).'
    plan        = 'Plan: {0} auf {1} installieren'
    plan_build  = 'Plan: IPK aus app/ bauen, dann auf {0} installieren'
    ask         = 'Weiter? [J/n] '
    aborted     = 'Abgebrochen.'
    dry         = 'Probelauf: nichts geaendert.'
    installed   = 'Installiert: {0} {1}'
    verify_fail = 'Das IPK wurde gemeldet, aber {0} steht nicht in der App-Liste von Glasshouse.'
    launched    = 'Gestartet. Die Startseite sollte jetzt auf dem Fernseher stehen.'
    launch_fail = 'Installiert, aber das Starten hat nicht geklappt. Oeffne CleanFrame in der App-Liste.'
    hub_note    = 'Tipp: die Einstellungen brauchen den Hub, und der braucht SSH und root.'
    ssh_fail    = 'Kein SSH auf {0}. Der Hub braucht eine gerootete Glotze mit SSH - siehe docs/ROOTING.md.'
    not_root    = 'SSH antwortet, aber die Sitzung ist nicht root (uid={0}). Der Hub schreibt nach /var/lib und braucht root. Rooten ist nicht Teil dieses Skripts: siehe docs/ROOTING.md.'
    rooted      = 'SSH als root, uid={0}'
    no_node     = 'Auf dem Fernseher fehlt ein brauchbares node (gefunden: {0}, gebraucht: >= 8).'
    copy        = 'Kopiere den Hub nach /var/lib/cleanframe ...'
    autostart   = 'Autostart einrichten ...'
    start       = 'Dienst starten ...'
    health_fail = 'Der Hub antwortet nicht auf Port 8484.'
    hub_ready   = 'Hub laeuft: http://{0}:8484/'
    info        = 'Zustand des Fernsehers'
    hub_skipped = 'Hub uebersprungen: er braucht root, der Launcher nicht.'
  }
}

function T {
  param([string]$Key, [object[]]$Vals = @())
  $text = $M[$Lang][$Key]
  if ($null -eq $text) { return "[$Key]" }
  if ($Vals.Count -gt 0) { return ($text -f $Vals) }
  return $text
}
function Say { param([string]$Message) Write-Host $Message }
function Fail { param([string]$Message) Write-Error $Message; exit 1 }

function Get-Python {
  foreach ($candidate in @('python3', 'python')) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  return $null
}

function Test-Glasshouse {
  param([string]$HostAddress)
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://${HostAddress}:8080/api/apps"
    return ($r.Content -match 'installed')
  } catch { return $false }
}

function Find-Tv {
  $client = New-Object System.Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromMilliseconds(1200)
  $prefix = $null
  try {
    $addr = (Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object { $_.IPAddress -notlike '127.*' } |
      Select-Object -First 1).IPAddress
    if ($addr) { $prefix = ($addr -replace '\.\d+$', '.') }
  } catch { }
  if (-not $prefix) { return $null }
  $tasks = @{}
  foreach ($i in 1..254) {
    $ip = "$prefix$i"
    try { $tasks[$ip] = $client.GetAsync("http://${ip}:8080/api/apps") } catch { }
  }
  $deadline = (Get-Date).AddMilliseconds(1800)
  $found = $null
  foreach ($ip in $tasks.Keys) {
    $remaining = ($deadline - (Get-Date)).TotalMilliseconds
    if ($remaining -lt 50) { break }
    try {
      if ($tasks[$ip].Wait([int]$remaining)) {
        $content = $tasks[$ip].Result.Content.ReadAsStringAsync().Result
        if ($content -match 'installed') { $found = $ip; break }
      }
    } catch { }
  }
  $client.Dispose()
  if ($found) { return $found }
  foreach ($line in (arp -a | Select-Object -Skip 3)) {
    if ($line -match '(\d+\.\d+\.\d+\.\d+)') {
      $ip = $Matches[1]
      if (Test-Glasshouse $ip) { return $ip }
    }
  }
  return $null
}

function Invoke-Ssh {
  param([string]$Command)
  $out = & ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 "root@$Tv" $Command 2>$null
  if ($null -eq $out) { return '' }
  return (($out | Out-String) -replace "`r", '').Trim()
}

if (-not $Tv) {
  Say (T find)
  $Tv = Find-Tv
  if (-not $Tv) { Fail (T find_none) }
}
Say ((T found) -f $Tv)

$python = Get-Python

if ($Info) {
  Say (T info)
  $launcherVersion = '?'
  $versionFile = Join-Path $RepoRoot 'VERSION'
  if (Test-Path $versionFile) { $launcherVersion = (Get-Content $versionFile -Raw).Trim() }
  Say ("    launcher: {0} (this repo)" -f $launcherVersion)
  if ($python) {
    & $python (Join-Path $PSScriptRoot 'tvinfo.py') $Tv 2>$null | ForEach-Object { Say "    $_" }
  }
  $uid = Invoke-Ssh 'id -u'
  if ($uid -eq '0') {
    Say '    root:     yes'
    Say ("    node:     {0}" -f (Invoke-Ssh '/usr/bin/node -v'))
  } else {
    Say '    root:     no (the launcher runs without it, the hub does not)'
  }
  exit 0
}

$doLauncher = -not $HubOnly
$doHub = -not $LauncherOnly

if ($doLauncher) {
  if (-not (Test-Glasshouse $Tv)) { Fail ((T no_glass) -f $Tv) }
  Say ((T glass_ok) -f $Tv)
  if ($Ipk) {
    $ipkPath = (Resolve-Path $Ipk).Path
    Say ((T plan) -f $ipkPath, $Tv)
  } else {
    if (-not $python) { Fail (T no_python) }
    $ipkPath = Join-Path $RepoRoot 'dist\cleanframe_all.ipk'
    Say ((T plan_build) -f $Tv)
  }
}

if ($doHub) {
  $uid = Invoke-Ssh 'id -u'
  if (-not $uid) { Say ((T ssh_fail) -f $Tv); $doHub = $false }
  elseif ($uid -ne '0') { Say ((T not_root) -f $uid); $doHub = $false }
  else { Say ((T rooted) -f $uid) }
}

if ($DryRun) { Say (T dry); exit 0 }

if (-not $Yes) {
  $answer = Read-Host (T ask)
  if ($answer -match '^(n|N|no|nein)') { Say (T aborted); exit 0 }
}

if ($doLauncher) {
  if (-not $Ipk) {
    Say (T ipk_build)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ipkPath) | Out-Null
    & $python (Join-Path $PSScriptRoot 'build-ipk.py') (Join-Path $RepoRoot 'app') $ipkPath
    if ($LASTEXITCODE -ne 0) { Fail 'IPK build failed' }
  }
  if (-not $python) { Fail (T no_python) }
  & $python (Join-Path $PSScriptRoot 'install-ipk.py') --tv $Tv --ipk $ipkPath
  if ($LASTEXITCODE -ne 0) { exit 1 }

  $apps = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "http://${Tv}:8080/api/apps"
  $appVersion = $null
  foreach ($app in ($apps.Content | ConvertFrom-Json).installed) {
    if ($app.id -eq $AppId) { $appVersion = $app.version; break }
  }
  if (-not $appVersion) { Fail ((T verify_fail) -f $AppId) }
  Say ((T installed) -f $AppId, $appVersion)

  try {
    $body = @{ action = 'launchApp'; value = $AppId } | ConvertTo-Json -Compress
    Invoke-WebRequest -UseBasicParsing -Method Post -ContentType 'application/json' `
      -Body $body -TimeoutSec 10 "http://${Tv}:8080/api/control" | Out-Null
    Say (T launched)
  } catch { Say (T launch_fail) }
}

if ($doHub) {
  $nodeVersion = Invoke-Ssh '/usr/bin/node -v'
  if (-not ($nodeVersion -match 'v(\d+)')) { Fail ((T no_node) -f $nodeVersion) }
  if ([int]$Matches[1] -lt 8) { Fail ((T no_node) -f $nodeVersion) }

  $web = Join-Path $RepoRoot 'web'
  Say (T copy)
  Invoke-Ssh 'mkdir -p /var/lib/cleanframe/lib /var/lib/cleanframe/assets' | Out-Null
  & scp -q -o StrictHostKeyChecking=no (Join-Path $web 'server.js') "root@${Tv}:/var/lib/cleanframe/server.js"
  & scp -q -o StrictHostKeyChecking=no (Join-Path $web 'lib\*.js') "root@${Tv}:/var/lib/cleanframe/lib/"
  & scp -q -o StrictHostKeyChecking=no (Join-Path $web 'assets\*.html') (Join-Path $web 'assets\*.json') "root@${Tv}:/var/lib/cleanframe/assets/"
  & scp -q -r -o StrictHostKeyChecking=no (Join-Path $web 'assets\icons') "root@${Tv}:/var/lib/cleanframe/assets/"
  & scp -q -r -o StrictHostKeyChecking=no (Join-Path $web 'assets\lang') "root@${Tv}:/var/lib/cleanframe/assets/"
  & scp -q -o StrictHostKeyChecking=no (Join-Path $web 'cleanframectl') "root@${Tv}:/var/lib/cleanframe/cleanframectl"
  Invoke-Ssh 'chmod +x /var/lib/cleanframe/cleanframectl' | Out-Null

  Say (T autostart)
  & scp -q -o StrictHostKeyChecking=no (Join-Path $web 'init.d\52-cleanframe') "root@${Tv}:/var/lib/webosbrew/init.d/52-cleanframe"
  Invoke-Ssh 'chmod +x /var/lib/webosbrew/init.d/52-cleanframe' | Out-Null

  Say (T start)
  Invoke-Ssh '/var/lib/cleanframe/cleanframectl restart' | Out-Null
  $healthy = $false
  for ($i = 0; $i -lt 20; $i++) {
    if ((Invoke-Ssh 'curl -sS -m 3 http://127.0.0.1:8484/api/health') -match '"ok":true') { $healthy = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $healthy) { Fail (T health_fail) }
  Say ((T hub_ready) -f $Tv)
} elseif ($doLauncher) {
  Say (T hub_note)
  Say (T hub_skipped)
}

exit 0
