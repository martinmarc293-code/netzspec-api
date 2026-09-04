# scraper/tools/nightshift.ps1 - the supervisor that keeps the acquisition loop running on the
# operator's machine, day and night, without anyone watching it.
#
#   powershell -ExecutionPolicy Bypass -File scraper\tools\nightshift.ps1              run until stopped
#   powershell -ExecutionPolicy Bypass -File scraper\tools\nightshift.ps1 -Once        one cycle, then exit
#   powershell -ExecutionPolicy Bypass -File scraper\tools\nightshift.ps1 -Install     register as a scheduled task at logon
#
# One cycle:
#   1. make sure the DEBUG Chrome is up (start-chrome-debug.ps1) - for the IMAGE LANE and ad-hoc
#      fetches only. The acquisition workers no longer touch it; see step 3.
#   2. top up the queue: thinnest parts first at every lookup source, then every open gap
#   3. run one worker per source, EACH WITH ITS OWN CHROME on its own profile
#
# ONE CHROME PER LANE (4 Sep 2026). Every worker used to attach to the one debug Chrome on
# --remote-debugging-port=9222. Measured on this machine: that Chrome accepts exactly ONE
# playwright connect_over_cdp client after a fresh start - the second and every later client hangs
# at <ws connecting> until the 180 s timeout and the worker dies, while /json/version keeps
# answering in 3 ms. With four lanes that meant three lanes dying every three minutes, and the
# sentinel reporting them "restarted" forever. Workers now run with --profile, which launches the
# installed Chrome against D:\netzspec-chrome-profile-<slug>. Costs, measured: about 500 MB of
# real system memory per lane Chrome and a process-tree working set near 1.0-1.2 GB after two
# fetches - hence the RAM guard below.
#   4. apply today's acquired pages: gate -> facts -> unmapped-label and unknown-SKU reports
#   4c. fetch a bounded batch of product images from the candidates step 4 recorded
#   5. write runs/nightshift/latest-summary.md - what landed, what is blocked, what needs a human
#   6. sleep, repeat
#
# Why a supervisor and not `worker.py --loop`: the loop needs three programs (planner, worker,
# applier) in the right order, and a stuck browser must not stall everything forever. Each step
# is a separate process with a timeout; a step that fails is logged and the cycle continues.
# One instance only (lock file); the machine's RAM is finite and two browsers once took it down.
param(
  [switch]$Once,
  [switch]$Install,
  [string]$Sources = "provantage,router-switch,itprice,meraki",
  [int]$TopUp = 300,
  [int]$SleepMinutes = 10,
  [int]$WorkMinutes = 5,
  [int]$ImageBatch = 40,
  # RAM guard. This laptop has 8 GB shared with the operator's own Chrome. Each LANE now runs its
  # own Chrome: measured 4 Sep 2026, free memory fell 1,586 -> 760 MB as two lane Chromes came up
  # and rose 758 -> 1,806 MB when both exited (about 500 MB of real memory each), and each tree's
  # working set peaked at 1.0-1.2 GB after two fetches. The old guard was 400 MB, set when four
  # lanes shared ONE browser; it would now start a Chrome the machine cannot hold. Refuse below
  # one Chrome plus slack, and let the next cycle start the lane instead.
  [int]$MinFreeMb = 1000
)
$ErrorActionPreference = "Continue"
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Repo
$LogDir = Join-Path $Repo "runs\nightshift"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Lock = Join-Path $LogDir "nightshift.lock"

function Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  $line | Tee-Object -FilePath (Join-Path $LogDir ((Get-Date -Format "yyyy-MM-dd") + ".log")) -Append
}

# NOTE: the parameter must not be called $args - that is PowerShell's automatic variable and a
# parameter of that name arrives empty ("argument is null"), which silently ran no step at all.
function Run-Step([string]$name, [string]$file, [string[]]$argv, [int]$timeoutMin) {
  Log "-> $name"
  $out = Join-Path $LogDir ("step-" + $name.Replace(" ", "-") + ".out")
  $p = Start-Process -FilePath $file -ArgumentList $argv -WorkingDirectory $Repo -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError ($out + ".err")
  if (-not $p.WaitForExit($timeoutMin * 60 * 1000)) {
    Log "   TIMEOUT after $timeoutMin min; killing $name"
    try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
    return $false
  }
  $tail = (Get-Content $out -Tail 3 -ErrorAction SilentlyContinue) -join " | "
  Log ("   exit {0}: {1}" -f $p.ExitCode, $tail)
  return ($p.ExitCode -eq 0)
}

if ($Install) {
  $action = "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\nightshift.ps1`""
  schtasks /Create /F /SC ONLOGON /TN "netzspec-nightshift" /TR $action /RL LIMITED | Out-Null
  Log "scheduled task netzspec-nightshift registered (runs at logon). Start it now with: schtasks /Run /TN netzspec-nightshift"
  exit 0
}

if (Test-Path $Lock) {
  $age = (Get-Date) - (Get-Item $Lock).LastWriteTime
  # the running instance touches the lock every minute; anything older than 10 min is a corpse
  if ($age.TotalMinutes -lt 10) { Log "another nightshift holds the lock ($([int]$age.TotalMinutes) min old); exiting"; exit 0 }
  Log "stale lock ($([int]$age.TotalMinutes) min); taking over"
}
Set-Content -Path $Lock -Value $PID

try {
  while ($true) {
    $cycleStart = Get-Date
    Log "===== cycle start (sources: $Sources)"
    (Get-Date) | Out-File $Lock

    # 1. the DEBUG browser - for step 4c (images) and ad-hoc fetches. No worker uses it.
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-chrome-debug.ps1") 2>&1 | ForEach-Object { Log "   chrome: $_" }

    # 2. plan
    foreach ($src in @("provantage", "router-switch", "itprice")) {
      $task = if ($src -eq "itprice") { "gpl" } else { "search" }
      Run-Step "queue $src" "node" @("node_modules/tsx/dist/cli.mjs", "src/pipeline/cli.ts", "queue", "--source", $src, "--task", $task, "--vendor", "cisco", "--class", "hardware", "--limit", "$TopUp") 10 | Out-Null
    }
    Run-Step "queue-gaps" "node" @("node_modules/tsx/dist/cli.mjs", "src/pipeline/cli.ts", "queue-gaps", "--limit", "2000") 10 | Out-Null
    # the data watchdog, ACTING: junk keys out of the queue before a worker spends a request on
    # them (the catalogue itself still carries enumeration noise), zero-yield/drift sources paused
    Run-Step "watchdog" "python3.11" @("-u", "scraper/tools/watchdog.py", "--act", "--expect", $Sources) 10 | Out-Null

    # 3. fetch until the queue is dry: ONE WORKER PER SOURCE in parallel, EACH WITH ITS OWN CHROME
    #    on its own profile (per-host politeness makes cross-host parallelism the only real
    #    throughput lever), with a stall detector: a worker whose heartbeat has not moved for 20
    #    minutes is killed - TOGETHER WITH ITS CHROME, because Stop-Process -Force is
    #    TerminateProcess and the worker gets no signal, so it cannot close its own browser, and
    #    an orphan Chrome holds the lane's profile LOCK against the next start. Its lease is
    #    reclaimed by the next cycle (worker.py re-leases leases older than 30 min).
    # Workers are LONG-LIVED: a worker runs until its queue is dry, and the sentinel restarts a
    # lane that went idle. The supervisor's part is only (a) start a worker for a source that has
    # none and (b) kill one whose heartbeat has gone quiet - whoever started it. The earlier form
    # waited up to 240 min for the workers to exit before it applied, recomputed or ran the
    # watchdog, so a 60-min back-off was resumed hours late and a day's pages were applied once
    # per shift (4 Sep 2026). Now every step below runs every cycle, about every 15 minutes.
    $procs = @{}
    foreach ($src in $Sources.Split(",")) {
      $running = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.Name -like "python*" -and $_.CommandLine -like ("*worker.py run --sources " + $src + " *") })
      $hb = Join-Path $Repo ("runs\heartbeat\" + $src + ".json")
      $hbAge = if (Test-Path $hb) { ((Get-Date) - (Get-Item $hb).LastWriteTime).TotalMinutes } else { 9999 }
      # This lane's OWN Chrome, matched on its own --user-data-dir and nothing else: never the
      # 9222 debug Chrome (no -<slug> suffix), never another lane, never the operator's browser.
      $laneProfile = "D:\netzspec-chrome-profile-" + $src
      $laneChrome = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "chrome.exe" -and $_.CommandLine -like ("*--user-data-dir=" + $laneProfile + "*") })
      if ($running.Count -gt 0 -and $hbAge -gt 20) {
        Log ("   STALL: {0} worker alive but its heartbeat is {1} min old; killing it and its {2} chrome.exe (the lease is reclaimed automatically)" -f $src, [int]$hbAge, $laneChrome.Count)
        foreach ($r in $running) { try { Stop-Process -Id $r.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
        foreach ($c in $laneChrome) { try { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
        Start-Sleep -Seconds 3
        $running = @()
        $laneChrome = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "chrome.exe" -and $_.CommandLine -like ("*--user-data-dir=" + $laneProfile + "*") })
      }
      if ($running.Count -gt 0) { continue }
      # No worker but a Chrome still on this lane's profile: an orphan holding the profile LOCK.
      # The next launch fails until it is gone, so clear it before starting.
      if ($laneChrome.Count -gt 0) {
        Log ("   ORPHAN: {0} has no worker but {1} chrome.exe on {2}; killing them (they hold the profile lock)" -f $src, $laneChrome.Count, $laneProfile)
        foreach ($c in $laneChrome) { try { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
        Start-Sleep -Seconds 3
      }
      # RAM guard: see $MinFreeMb at the top. A lane now costs its own Chrome, not a tab.
      $freeMb = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
      if ($freeMb -lt $MinFreeMb) { Log "   RAM: only $freeMb MB free (guard $MinFreeMb, a lane's Chrome needs about 500 MB); not starting a worker for $src this cycle"; continue }
      $wlog = Join-Path $LogDir ("worker-" + $src + ".out")
      # --profile, never --cdp: one Chrome per lane. See the header for what sharing one cost.
      $p = Start-Process -FilePath "python3.11" -ArgumentList @("-u", "scraper/worker.py", "run", "--sources", $src, "--profile") -WorkingDirectory $Repo -NoNewWindow -PassThru -RedirectStandardOutput $wlog -RedirectStandardError ($wlog + ".err")
      $procs[$src] = @{ proc = $p; log = $wlog }
      Start-Sleep -Seconds 5
    }
    Log ("   started {0} workers (others already running)" -f $procs.Count)
    # let the lanes work for a few minutes, touching the lock the sentinel watches
    $deadline = (Get-Date).AddMinutes($WorkMinutes)
    while ((Get-Date) -lt $deadline) {
      (Get-Date) | Out-File $Lock   # heartbeat of the supervisor itself
      Start-Sleep -Seconds 60
    }
    foreach ($src in $Sources.Split(",")) {
      $wlog = Join-Path $LogDir ("worker-" + $src + ".out")
      if (-not (Test-Path $wlog)) { continue }
      $done = (Select-String -Path $wlog -Pattern "^  done " -ErrorAction SilentlyContinue | Measure-Object).Count
      $blocked = (Select-String -Path $wlog -Pattern "^  (blocked|ERROR|pdf-fail)" -ErrorAction SilentlyContinue | Measure-Object).Count
      Log ("   worker {0}: done={1} blocked/errors={2} (since its log began)" -f $src, $done, $blocked)
    }

    # 4. apply today's acquisitions per source (a failed gate for one source must not block the rest)
    $today = Get-Date -Format "yyyy-MM-dd"
    foreach ($src in $Sources.Split(",")) {
      $dir = Join-Path $Repo ("runs\acquired\" + $src + "\" + $today)
      if (Test-Path $dir) { Run-Step "apply $src" "node" @("node_modules/tsx/dist/cli.mjs", "src/pipeline/cli.ts", "apply-acquired", "runs/acquired/$src/$today", "--commit") 60 | Out-Null }
    }

    # 4a. once a week (Sunday, first cycle after 02:00): the vendor sweeps that make the catalogue GROW -
    #     new EoL bulletins for every Cisco series, then new datasheets found on the family listings,
    #     extracted cache-only and applied through the gate. Each step is resumable and idempotent.
    $stamp = Join-Path $LogDir "weekly-sweep.stamp"
    $lastSweep = if (Test-Path $stamp) { (Get-Item $stamp).LastWriteTime } else { [datetime]::MinValue }
    if ((Get-Date).DayOfWeek -eq "Sunday" -and (Get-Date).Hour -ge 2 -and ((Get-Date) - $lastSweep).TotalDays -gt 5) {
      $sweepTag = Get-Date -Format "yyyy-MM-dd"
      $seriesFile = Join-Path $Repo "data\reference\cisco-series.json"
      if (Test-Path $seriesFile) {
        $entries = Get-Content $seriesFile -Raw | ConvertFrom-Json
        $series = ($entries | ForEach-Object { $_.series_slug } | Where-Object { $_ }) -join ","
        ($entries | ForEach-Object { $_.url } | Where-Object { $_ }) | Set-Content (Join-Path $Repo "runs\extract\series-urls.txt") -Encoding ascii
        if ($series) {
          Run-Step "sweep eol" "python3.11" @("-u", "scraper/run.py", "cisco-eol", "--series", $series, "--out", "runs/extract/cisco-eol-$sweepTag.json") 180 | Out-Null
          if (Test-Path (Join-Path $Repo "runs\extract\cisco-eol-$sweepTag.json")) { Run-Step "apply lifecycle" "node" @("node_modules/tsx/dist/cli.mjs", "src/pipeline/cli.ts", "apply-lifecycle", "runs/extract/cisco-eol-$sweepTag.json", "--commit") 60 | Out-Null }
        }
      }
      Run-Step "sweep datasheet listings" "python3.11" @("-u", "scraper/crawl_datasheet_listings.py", "--urls-file", "runs/extract/series-urls.txt", "--out", "runs/extract/datasheet-listings-$sweepTag.json") 180 | Out-Null
      Run-Step "extract new datasheets" "python3.11" @("-u", "scraper/run.py", "cisco-specs-deep", "--urls-file", "data/reference/all-datasheet-urls-full.txt", "--out", "runs/extract/cisco-deep-$sweepTag.json") 300 | Out-Null
      if (Test-Path (Join-Path $Repo "runs\extract\cisco-deep-$sweepTag.json")) { Run-Step "apply extract" "node" @("node_modules/tsx/dist/cli.mjs", "src/pipeline/cli.ts", "apply-extract", "runs/extract/cisco-deep-$sweepTag.json", "--commit", "--tag", "weekly-$sweepTag") 240 | Out-Null }
      (Get-Date) | Out-File $stamp
    }

    # 4c. the image lane: a BOUNDED batch of the candidates step 4 just recorded. Every part page
    #     the workers fetch prints an image URL and until 4 Sep 2026 all of it was thrown away for
    #     a non-vendor source, leaving 61,229 hardware parts with no picture. The batch is small on
    #     purpose: these are binary fetches through the same Chrome the workers share, and the lane
    #     paces itself at each source's own politeness. A failed step is logged and the cycle goes
    #     on, exactly like the applies above.
    Run-Step "images" "python3.11" @("-u", "scraper/images.py", "run", "--from-db", "--limit", "$ImageBatch", "--cdp", "http://127.0.0.1:9222") 30 | Out-Null

    # 4b. the gap ledger's input: recompute completeness for parts touched since the cycle began
    Run-Step "recompute-completeness" "node" @("node_modules/tsx/dist/cli.mjs", "src/pipeline/cli.ts", "recompute-completeness", "--since", $cycleStart.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")) 30 | Out-Null

    # 5. summary for the human (and for Claude): what needs judgment
    Run-Step "status" "node" @("node_modules/tsx/dist/cli.mjs", "src/pipeline/cli.ts", "queue-status") 5 | Out-Null
    $summary = @()
    $summary += "# nightshift summary - $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    $summary += ""
    $summary += "## queue"
    $summary += (Get-Content (Join-Path $LogDir "step-status.out") -ErrorAction SilentlyContinue)
    $summary += ""
    $summary += "## yield per source today (pages done vs pages with facts) - a source with pages but no facts is a BROKEN ADAPTER"
    foreach ($src in $Sources.Split(",")) {
      $dir = Join-Path $Repo ("runs\acquired\" + $src + "\" + $today)
      if (-not (Test-Path $dir)) { continue }
      $files = Get-ChildItem $dir -Filter "*.json"
      $withFacts = 0
      foreach ($f in $files) {
        try { $j = Get-Content $f.FullName -Raw | ConvertFrom-Json; if (($j.result.facts.Count -gt 0) -or ($j.result.others.Count -gt 0)) { $withFacts++ } } catch {}
      }
      $flag = if ($files.Count -ge 5 -and $withFacts -eq 0) { "   <<< ZERO YIELD: check the adapter" } else { "" }
      $summary += ("- {0}: {1} pages, {2} with facts{3}" -f $src, $files.Count, $withFacts, $flag)
    }
    $summary += ""
    $summary += "## gates and applies (last lines)"
    foreach ($src in $Sources.Split(",")) {
      $f = Join-Path $LogDir ("step-apply-" + $src + ".out")
      if (Test-Path $f) { $summary += "### $src"; $summary += (Get-Content $f -Tail 8) }
    }
    $summary += ""
    $summary += "## images (this cycle's bounded batch: fetched, rejected with the reason, uploaded)"
    $imgOut = Join-Path $LogDir "step-images.out"
    if (Test-Path $imgOut) { $summary += (Get-Content $imgOut -Tail 14) } else { $summary += "- the image step wrote no log this cycle" }
    $summary += ""
    $summary += "## unmapped labels (top of the newest report)"
    $rep = Get-ChildItem (Join-Path $Repo "runs\reports") -Filter "unmapped-*.json" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($rep) {
      $j = Get-Content $rep.FullName -Raw | ConvertFrom-Json
      $summary += "from $($rep.Name): $($j.labels.Count) distinct unmapped labels"
      foreach ($l in ($j.labels | Select-Object -First 20)) { $summary += ("- {0} x{1}: {2}" -f $l.label, $l.count, ($l.samples -join " / ")) }
    }
    $unknown = Get-ChildItem (Join-Path $Repo "runs\reports") -Filter "unknown-skus-*.jsonl" -ErrorAction SilentlyContinue | ForEach-Object { (Get-Content $_.FullName | Measure-Object -Line).Lines } | Measure-Object -Sum
    $summary += ""
    $summary += "## unknown SKUs seen on pages (enumeration feed): $($unknown.Sum)"
    $summary -join "`n" | Set-Content (Join-Path $LogDir "latest-summary.md") -Encoding utf8

    $mins = [int]((Get-Date) - $cycleStart).TotalMinutes
    Log "===== cycle done in $mins min"
    if ($Once) { break }
    Start-Sleep -Seconds ($SleepMinutes * 60)
  }
} finally {
  Remove-Item $Lock -ErrorAction SilentlyContinue
}
