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
  [switch]$NoHub
)

$ErrorActionPreference = 'Stop'
$AppIdDefault = 'com.blackpearl.cleanframe'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Tools = Join-Path $Root 'tools'

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
if (-not $Tv) { Say (T 'need_tv'); exit 2 }

$sshBase = @('-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', "root@$Tv")

function Test-Port {
  param([int]$Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync($Tv, $Port)
    return ($task.Wait(3000) -and $client.Connected)
  } catch { return $false } finally { $client.Dispose() }
}

# ---- IPK ---------------------------------------------------------------------
if (-not $NoLauncher) {
  if (-not $Ipk) {
    foreach ($candidate in (Join-Path $Root 'dist\cleanframe_all.ipk'), (Join-Path $Root 'ipk\cleanframe_all.ipk')) {
      if (Test-Path $candidate) { $Ipk = $candidate; break }
    }
  }
  if (-not $Ipk -or -not (Test-Path $Ipk)) { Fail (T 'no_ipk') }
}

# ---- 1. detect ---------------------------------------------------------------
Say (T 'detect')
if (-not (Test-Port 22)) {
  Say (T 'tv_off')
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
  & scp -q -o StrictHostKeyChecking=no (Join-Path $Root 'web\server.js') "root@$($Tv):/var/lib/cleanframe/server.js"
  # scp expands no wildcards by itself - the file list has to come from PowerShell.
  $libFiles = Get-ChildItem -Path (Join-Path $Root 'web\lib') -Filter '*.js' | ForEach-Object { $_.FullName }
  # -Include only works together with a wildcard path
  $assetFiles = @(
    Get-ChildItem -Path (Join-Path $Root 'web\assets\*') -Include '*.html', '*.json' -File |
      ForEach-Object { $_.FullName }
  )
  if ($assetFiles.Count -eq 0) { Fail 'ERROR: no hub assets found under web/assets' }
  & scp -q -o StrictHostKeyChecking=no $libFiles "root@$($Tv):/var/lib/cleanframe/lib/"
  & scp -q -o StrictHostKeyChecking=no $assetFiles "root@$($Tv):/var/lib/cleanframe/assets/"
  & scp -r -q -o StrictHostKeyChecking=no (Join-Path $Root 'web\assets\icons') "root@$($Tv):/var/lib/cleanframe/assets/"
  & scp -q -o StrictHostKeyChecking=no (Join-Path $Root 'web\cleanframectl') "root@$($Tv):/var/lib/cleanframe/cleanframectl"
  & scp -q -o StrictHostKeyChecking=no (Join-Path $Root 'web\init.d\52-cleanframe') "root@$($Tv):/var/lib/webosbrew/init.d/52-cleanframe"
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
