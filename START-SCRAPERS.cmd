@echo off
rem START-SCRAPERS.cmd - the one button: bring the whole acquisition loop up on this laptop.
rem   1. SSH tunnel to the box's Postgres (localhost:5433)
rem   2. the scraper Chrome (DevTools on 9222, own profile on D:)
rem   3. the supervisor (nightshift.ps1): plans the queue, runs the watchdog, one worker per
rem      source, applies, recomputes completeness, writes runs\nightshift\latest-summary.md
rem   4. the sentinel (sentinel.py --loop --heal): every 3 minutes checks that all of the above is
rem      physically alive and restarts what died; writes runs\nightshift\SENTINEL.md and ALERT.md
rem Safe to run twice: the tunnel and Chrome check their ports, the supervisor and the sentinel
rem each hold a lock file that the live instance touches every minute.
cd /d D:\Project\netzspec-api
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "scraper\tools\start-tunnel.ps1"
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "scraper\tools\start-chrome-debug.ps1"
start "netzspec supervisor" /min powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "D:\Project\netzspec-api\scraper\tools\nightshift.ps1"
start "netzspec sentinel" /min python3.11 -u scraper\tools\sentinel.py --loop 180 --heal
echo Scrapers started. Status: runs\nightshift\SENTINEL.md (alive?)  runs\nightshift\watchdog.md (yield)  runs\nightshift\latest-summary.md
