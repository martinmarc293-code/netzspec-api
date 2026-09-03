# Starts the operator's installed Google Chrome as a SEPARATE instance with its own profile
# and the DevTools port open, so scraper/worker.py --cdp can drive a real Chrome (real TLS
# fingerprint, real headers, persistent cookies) without touching the everyday browser.
#
#   powershell -ExecutionPolicy Bypass -File scraper\tools\start-chrome-debug.ps1
#
# Log into a site in this window once if it needs it; the profile persists on D: (C: is full).
$chrome = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Error "Google Chrome not found"; exit 1 }

$profile = "D:\netzspec-chrome-profile"
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$listening = Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue
if ($listening) { Write-Host "Chrome DevTools already listening on 9222"; exit 0 }

Start-Process -FilePath $chrome -ArgumentList @(
  "--remote-debugging-port=9222",
  "--user-data-dir=$profile",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--window-size=1400,1000",
  "about:blank"
)
Start-Sleep -Seconds 3
$ok = Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue
if ($ok) { Write-Host "Chrome started with DevTools on http://127.0.0.1:9222 (profile $profile)" } else { Write-Error "Chrome did not open port 9222"; exit 1 }
