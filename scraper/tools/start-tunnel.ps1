# Keeps the SSH tunnel to the box's Postgres alive (localhost:5433 -> 127.0.0.1:5432 on the box).
# Every local tool (workers, ingest, tests) talks to the database through this port.
#
#   powershell -ExecutionPolicy Bypass -File scraper\tools\start-tunnel.ps1            start if not running
#   powershell -ExecutionPolicy Bypass -File scraper\tools\start-tunnel.ps1 -Install   scheduled task at logon
param([switch]$Install)
if ($Install) {
  $action = "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\start-tunnel.ps1`""
  schtasks /Create /F /SC ONLOGON /TN "netzspec-pg-tunnel" /TR $action /RL LIMITED | Out-Null
  Write-Host "scheduled task netzspec-pg-tunnel registered (runs at logon)"
  exit 0
}
$listening = Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue
if ($listening) { Write-Host "tunnel already listening on 5433"; exit 0 }
$bash = @("C:\Program Files\Git\bin\bash.exe", "$env:ProgramFiles\Git\usr\bin\bash.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$script = "/d/tmp/pg-tunnel.sh"
if (-not (Test-Path "D:\tmp\pg-tunnel.sh")) {
  New-Item -ItemType Directory -Force -Path "D:\tmp" | Out-Null
  @'
#!/usr/bin/env bash
while true; do
  ssh -i "$HOME/.ssh/dubaifix_hetzner" -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -N -L 5433:127.0.0.1:5432 root@77.42.72.81
  sleep 5
done
'@ | Set-Content "D:\tmp\pg-tunnel.sh" -Encoding ascii
}
Start-Process -FilePath $bash -ArgumentList '-lc', "`"$script`"" -WindowStyle Hidden
Start-Sleep -Seconds 6
if (Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue) { Write-Host "tunnel up on 5433" } else { Write-Error "tunnel did not come up"; exit 1 }
