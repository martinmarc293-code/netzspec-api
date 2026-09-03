@echo off
rem START-SCRAPERS.cmd - the one button: bring the whole acquisition loop up on this laptop.
rem   1. SSH tunnel to the box's Postgres (localhost:5433)
rem   2. the scraper Chrome (DevTools on 9222, own profile on D:)
rem   3. the supervisor (nightshift.ps1): plans the queue, runs one worker per source, applies,
rem      recomputes completeness, writes runs\nightshift\latest-summary.md
rem   4. the sentinel (sentinel.py --loop --heal): every 3 minutes checks that all of the above is
rem      physically alive and restarts what died; writes runs\nightshift\SENTINEL.md and ALERT.md
rem Every step is idempotent: running this twice starts nothing twice.
cd /d D:\Project\netzspec-api
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "scraper\tools\start-tunnel.ps1"
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "scraper\tools\start-chrome-debug.ps1"
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "if (-not (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*-File*nightshift.ps1*' })) { Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -WindowStyle Hidden -File D:\Project\netzspec-api\scraper\tools\nightshift.ps1' -WindowStyle Hidden }"
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "if (-not (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*sentinel.py*--loop*' })) { Start-Process python3.11 -ArgumentList '-u scraper/tools/sentinel.py --loop 180 --heal' -WorkingDirectory D:\Project\netzspec-api -WindowStyle Hidden -RedirectStandardOutput runs\nightshift\sentinel.out -RedirectStandardError runs\nightshift\sentinel.err }"
echo Scrapers started. Status files: runs\nightshift\SENTINEL.md (alive?), runs\nightshift\watchdog.md (yield), runs\nightshift\latest-summary.md
timeout /t 8 >nul
