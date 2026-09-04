@echo off
rem START-SCRAPERS.cmd - the one button: bring the whole acquisition loop up on this laptop.
rem   1. SSH tunnel to the box's Postgres (localhost:5433)
rem   2. seed any MISSING lane Chrome profile from the shared debug profile. This runs BEFORE the
rem      debug Chrome starts, because a running Chrome holds its cookie jar open and the copy
rem      fails with PermissionError. A cold profile is a BLOCKED profile: measured 4 Sep 2026, a
rem      brand-new profile got 403 "Just a moment..." from itprice and never cleared it, and the
rem      same profile seeded from D:\netzspec-chrome-profile got 200 and the price list. No-op
rem      once the profiles exist, so running this file twice costs nothing.
rem   3. the DEBUG Chrome (DevTools on 9222, profile D:\netzspec-chrome-profile) - for
rem      scraper\images.py and ad-hoc "worker.py fetch" ONLY. No acquisition worker uses it: that
rem      Chrome serves exactly ONE playwright client per start and the second one hangs for 180 s.
rem   4. the supervisor (nightshift.ps1): plans the queue, runs the watchdog, one worker per
rem      source EACH WITH ITS OWN CHROME (D:\netzspec-chrome-profile-<slug>), applies, recomputes
rem      completeness, writes runs\nightshift\latest-summary.md
rem   5. the sentinel (sentinel.py --loop --heal): every 3 minutes checks that all of the above is
rem      physically alive and restarts what died, killing a wedged lane together with ITS OWN
rem      Chrome; writes runs\nightshift\SENTINEL.md and ALERT.md
rem Safe to run twice: the tunnel and Chrome check their ports, the seed skips profiles that
rem exist, and the supervisor and the sentinel each hold a lock file the live instance touches
rem every minute.
cd /d D:\Project\netzspec-api
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "scraper\tools\start-tunnel.ps1"
python3.11 scraper\tools\sentinel.py --seed-profiles provantage,router-switch,itprice,meraki
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "scraper\tools\start-chrome-debug.ps1"
start "netzspec supervisor" /min powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "D:\Project\netzspec-api\scraper\tools\nightshift.ps1"
start "netzspec sentinel" /min python3.11 -u scraper\tools\sentinel.py --loop 180 --heal
echo Scrapers started. Status: runs\nightshift\SENTINEL.md (alive?)  runs\nightshift\watchdog.md (yield)  runs\nightshift\latest-summary.md
