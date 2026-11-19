$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = 'http://127.0.0.1:7373'

function Test-WifiDetection {
  try {
    $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2
    return $health.ok -eq $true
  } catch {
    return $false
  }
}

if (Test-WifiDetection) {
  Start-Process $url
  exit 0
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js was not found.' -ForegroundColor Red
  Write-Host 'Install Node.js 20 or newer from https://nodejs.org and try again.'
  Read-Host 'Press Enter to close'
  exit 1
}

Write-Host 'Starting Wifi Detection...' -ForegroundColor Cyan
Start-Process -FilePath $node.Source -ArgumentList 'server.mjs' -WorkingDirectory $root

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 400
  if (Test-WifiDetection) {
    Start-Process $url
    Write-Host "Opened $url" -ForegroundColor Green
    exit 0
  }
}

Write-Host "The server did not answer at $url. Check the server console for errors." -ForegroundColor Yellow
Read-Host 'Press Enter to close'
exit 1
