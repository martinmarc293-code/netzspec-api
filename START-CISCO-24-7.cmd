@echo off
rem START-CISCO-24-7.cmd - the Cisco brand's acquisition loop, forever.
rem
rem Run it from THIS directory (D:\Project\netzspec-api-cisco). The tree matters: each brand runs
rem from its own worktree so one session's edit cannot change the code another session's running
rem worker imports next. See scraper/brands/README.md section 3.
rem
rem What it starts: ONE process, scraper/brands/run_brand.py --brand cisco. Every cycle it plans
rem the queue from the brand manifest, runs a bounded worker per enabled lane, and runs the brand
rem watchdog. Bounded on purpose - a worker that returns lets the next cycle re-plan, instead of a
rem lane working a day-old plan for a day.
rem
rem What stops a second one: a per-brand supervisor advisory lock. Running this twice is refused
rem with a message naming how to find the first, rather than quietly doubling every lane.
rem
rem To make it survive a reboot, put a shortcut to this file in:
rem   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
rem
rem To watch it:   type runs\brands\cisco\cisco.log
rem To stop it:    close the window, or Stop-Process on the python it started. The supervisor lock
rem                and every lane lock are released when the process dies - there is no stale lock
rem                file to clean up.
cd /d "%~dp0"
echo Starting the Cisco 24/7 loop from %CD%
echo   log:      runs\brands\cisco\cisco.log
echo   coverage: runs\brands\cisco\watchdog.md
echo.
python3.11 -u scraper\brands\run_brand.py --brand cisco --cycle-minutes 20 --max-tasks 40
echo.
echo The loop exited. Read the log above for the reason - a supervisor lock refusal means one is
echo already running, which is not an error.
pause
