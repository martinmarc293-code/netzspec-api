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
rem THE THROTTLE, and why it is these numbers. Decided from measurement on 5 Sep 2026 after the
rem monitoring session changed it from 20/40 and I objected on politeness grounds. The objection was
rem reasonable a priori and the evidence did not support it:
rem
rem   politeness_ms = 2000 on every Cisco lane. THAT is the governor - one request per two seconds,
rem   so at most ~1,800 fetches an hour however short the cycle is. The cycle length only decides
rem   how much of that ceiling gets used, not what the ceiling is.
rem
rem   Measured over the preceding 9 hours: 80 fetches, peak 43 in one hour, and ZERO refused by the
rem   host (no 401/403/405/429/503). That is about 2% of the politeness ceiling.
rem
rem A 20-minute cycle left the lane idle roughly 16 minutes in 20, which from outside is genuinely
rem hard to tell from a broken lane - that is a real cost, and it is what prompted the change. Five
rem minutes removes the idle without moving the number that actually protects cisco.com. Observed
rem cycle time is already ~14 minutes now that the queue has work, so the sleep mostly means "re-plan
rem promptly" rather than "run more often".
rem
rem WHAT WOULD CHANGE THIS: any refusal at all. The brand watchdog alarms on a single blocked answer
rem (not a threshold), so if cisco.com starts declining, that shows up as an alarm rather than as a
rem number nobody is watching. Raise politeness_ms first, not the cycle.
cd /d "%~dp0"
echo Starting the Cisco 24/7 loop from %CD%
echo   log:      runs\brands\cisco\cisco.log
echo   coverage: runs\brands\cisco\watchdog.md
echo.
python3.11 -u scraper\brands\run_brand.py --brand cisco --cycle-minutes 5 --max-tasks 60
echo.
echo The loop exited. Read the log above for the reason - a supervisor lock refusal means one is
echo already running, which is not an error.
pause
