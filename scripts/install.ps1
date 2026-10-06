<#
.SYNOPSIS
  Couch Launcher installer for Windows. Per user, no administrator rights.

.DESCRIPTION
  1. Copies the executable to %LOCALAPPDATA%\couch-launcher\couch-launcher.exe
  2. Creates the config file and sets the Jellyfin URL and API key
  3. Registers the service to start at sign-in (HKCU Run key) and starts it now
  4. Creates a "Couch Launcher" shortcut that opens the UI in a full-screen Edge app window
  5. Prints the manual steps to add that shortcut to Steam for Big Picture
  6. Runs `couch-launcher doctor` and prints its report
  Steam's own files are never touched.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -JellyfinUrl http://192.168.1.20:8096
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [string]$Binary = "",
  [string]$JellyfinUrl = "",
  [switch]$DryRun,
  [switch]$Yes,
  [int]$Port = 7744
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $env:LOCALAPPDATA) { $env:LOCALAPPDATA = Join-Path $HOME "AppData\Local" }
if (-not $env:APPDATA) { $env:APPDATA = Join-Path $HOME "AppData\Roaming" }
$InstallDir = Join-Path $env:LOCALAPPDATA "couch-launcher"
$Exe = Join-Path $InstallDir "couch-launcher.exe"
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RunName = "CouchLauncher"
$Url = "http://127.0.0.1:$Port/"

function Step([int]$n, [string]$text) { Write-Host ""; Write-Host "[$n/6] $text" }
function Note([string]$text) { Write-Host "  $text" }
function Run([string]$description, [scriptblock]$action) {
  Write-Host "  > $description"
  if (-not $DryRun) { & $action }
}

# The executable is a GUI-subsystem program (no console window at sign-in), so its output is
# captured through redirected files rather than the console.
function Invoke-Launcher([string[]]$Arguments) {
  $out = [System.IO.Path]::GetTempFileName()
  $err = [System.IO.Path]::GetTempFileName()
  try {
    $p = Start-Process -FilePath $Exe -ArgumentList $Arguments -Wait -PassThru -NoNewWindow `
      -RedirectStandardOutput $out -RedirectStandardError $err
    $text = (Get-Content -Raw -Path $out)
    if ($p.ExitCode -ne 0 -and $Arguments[0] -ne "doctor") { throw "couch-launcher $($Arguments -join ' ') failed: $(Get-Content -Raw $err)" }
    return $text
  } finally {
    Remove-Item -Force $out, $err -ErrorAction SilentlyContinue
  }
}

if ($DryRun) { Write-Host "Dry run: printing every step, changing nothing." }

if (-not $Binary) {
  foreach ($c in @((Join-Path $ScriptDir "couch-launcher-windows-x64.exe"), (Join-Path $ScriptDir "..\out\windows\couch-launcher-windows-x64.exe"))) {
    if (Test-Path $c) { $Binary = $c; break }
  }
}

Step 1 "Copy the executable to $Exe"
if (-not $Binary) {
  if (-not $DryRun) { throw "couch-launcher-windows-x64.exe not found next to this script; pass -Binary PATH" }
  $Binary = "couch-launcher-windows-x64.exe"
}
Run "New-Item -ItemType Directory -Force $InstallDir" { New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null }
Run "Stop a running copy, then Copy-Item $Binary $Exe" {
  Get-Process -Name "couch-launcher" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Copy-Item -Force -Path $Binary -Destination $Exe
}

Step 2 "Create the config file and set the Jellyfin URL and API key"
if (-not $JellyfinUrl -and -not $DryRun -and -not $Yes) {
  $JellyfinUrl = Read-Host "  Jellyfin server URL (e.g. http://192.168.1.20:8096, blank to skip)"
}
if ($JellyfinUrl -and -not $env:COUCH_JELLYFIN_API_KEY -and -not $DryRun -and -not $Yes) {
  $secure = Read-Host "  Jellyfin API key (Dashboard > API Keys)" -AsSecureString
  $env:COUCH_JELLYFIN_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if ($JellyfinUrl) {
  # The key travels in an environment variable, never on the command line.
  Run "$Exe configure --jellyfin-url $JellyfinUrl" { Invoke-Launcher @("configure", "--jellyfin-url", $JellyfinUrl) | Out-Null }
} else {
  Run "$Exe configure" { Invoke-Launcher @("configure") | Out-Null }
  Note "No Jellyfin URL given: add url and api_key to $env:APPDATA\couch-launcher\config.toml later."
}

Step 3 "Start the service at sign-in (HKCU Run key, no administrator rights) and start it now"
$RunValue = '"' + $Exe + '" serve'
Run "Set $RunKey\$RunName = $RunValue" {
  New-ItemProperty -Path $RunKey -Name $RunName -Value $RunValue -PropertyType String -Force | Out-Null
}
Run "Start-Process $Exe serve" { Start-Process -FilePath $Exe -ArgumentList "serve" -WindowStyle Hidden }

Step 4 "Create the Couch Launcher shortcut (full-screen Edge app window)"
$Desktop = [Environment]::GetFolderPath("Desktop")
if (-not $Desktop) { $Desktop = Join-Path $HOME "Desktop" }
$Programs = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$Lnks = @((Join-Path $Desktop "Couch Launcher.lnk"), (Join-Path $Programs "Couch Launcher.lnk"))
if ($DryRun) {
  Note "Target: msedge.exe --app=$Url --user-data-dir=$InstallDir\browser --start-fullscreen ..."
  foreach ($l in $Lnks) { Write-Host "  > Create shortcut $l" }
} else {
  $kiosk = (Invoke-Launcher @("kiosk-command", "--port", "$Port")) | ConvertFrom-Json
  $argLine = ($kiosk.args | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join " "
  $shell = New-Object -ComObject WScript.Shell
  foreach ($l in $Lnks) {
    Write-Host "  > Create shortcut $l"
    $s = $shell.CreateShortcut($l)
    $s.TargetPath = $kiosk.cmd
    $s.Arguments = $argLine
    $s.Description = "Couch Launcher"
    $s.Save()
  }
  Note "Target: $($kiosk.cmd) $argLine"
}

Step 5 "Add the shortcut to Steam for Big Picture (by hand: this script never edits Steam's files)"
Write-Host @"
  In Steam: Games > Add a Non-Steam Game to My Library > Browse... and choose
    $($Lnks[1])
  (or msedge.exe with the arguments shown above), then rename the entry "Couch Launcher".
  Also add Jellyfin Desktop as a non-Steam game and keep "Jellyfin" in its name; the launcher
  starts it through Steam when you press Play on a movie or episode.
  Big Picture uses the controller directly; no Steam Input layout is needed on Windows.
"@

Step 6 "Check the installation (couch-launcher doctor)"
if ($DryRun) {
  Write-Host "  > $Exe doctor"
} else {
  Start-Sleep -Seconds 2
  Invoke-Launcher @("doctor") | Write-Host
  $report = Join-Path $InstallDir "doctor.txt"
  if (Test-Path $report) { Note "Report saved to $report" }
}
Write-Host ""
Write-Host "Done."
