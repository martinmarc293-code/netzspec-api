# scraper/tools/nightshift.ps1 — the supervisor that keeps the acquisition loop running on the
# operator's machine, day and night, without anyone watching it.
#
#   powershell -ExecutionPolicy Bypass -File scraper\tools\nightshift.ps1              run until stopped
#   powershell -ExecutionPolicy Bypass -File scraper\tools\nightshift.ps1 -Once        one cycle, then exit
#   powershell -ExecutionPolicy Bypass -File scraper\tools\nightshift.ps1 -Install     register as a scheduled task at logon
#
# One cycle:
#   1. make sure the debug Chrome is up (scraper/tools/start-chrome-debug.ps1)
#   2. top up the queue: thinnest parts first at every lookup source, then every open gap
#   3. run the worker over every enabled source until the queue is empty (one browser, one tab)
#   4. apply today's acquired pages: gate -> facts -> unmapped-label and unknown-SKU reports
#   5. write runs/nightshift/latest-summary.md — what landed, what is blocked, what needs a human
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
  [int]$SleepMinutes = 10
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

function Run-Step([string]$name, [string]$file, [string[]]$args, [int]$timeoutMin) {
  Log "-> $name"
  $out = Join-Path $LogDir ("step-" + $name.Replace(" ", "-") + ".out")
  $p = Start-Process -FilePath $file -ArgumentList $args -WorkingDirectory $Repo -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError ($out + ".err")
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
  if ($age.TotalHours -lt 6) { Log "another nightshift holds the lock ($([int]$age.TotalMinutes) min old); exiting"; exit 0 }
  Log "stale lock ($([int]$age.TotalHours) h); taking over"
}
Set-Content -Path $Lock -Value $PID

try {
  while ($true) {
    $cycleStart = Get-Date
    Log "===== cycle start (sources: $Sources)"
    (Get-Date) | Out-File $Lock

    # 1. browser
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-chrome-debug.ps1") 2>&1 | ForEach-Object { Log "   chrome: $_" }

    # 2. plan
    foreach ($src in @("provantage", "router-switch", "itprice")) {
      $task = if ($src -eq "itprice") { "gpl" } else { "search" }
      Run-Step "queue $src" "npx" @("tsx", "src/pipeline/cli.ts", "queue", "--source", $src, "--task", $task, "--vendor", "cisco", "--class", "hardware", "--limit", "$TopUp") 10 | Out-Null
    }
    Run-Step "queue-gaps" "npx" @("tsx", "src/pipeline/cli.ts", "queue-gaps", "--limit", "2000") 10 | Out-Null

    # 3. fetch until the queue is dry: ONE WORKER PER SOURCE in parallel (each is a tab in the same
    #    Chrome; per-host politeness makes cross-host parallelism the only real throughput lever),
    #    with a stall detector: a worker whose log has not grown for 20 minutes is killed and its
    #    lease is reclaimed by the next cycle (worker.py re-leases leases older than 30 min).
    $procs = @{}
    foreach ($src in $Sources.Split(",")) {
      $wlog = Join-Path $LogDir ("worker-" + $src + ".out")
      $p = Start-Process -FilePath "python3.11" -ArgumentList @("-u", "scraper/worker.py", "run", "--sources", $src, "--cdp", "http://127.0.0.1:9222") -WorkingDirectory $Repo -NoNewWindow -PassThru -RedirectStandardOutput $wlog -RedirectStandardError ($wlog + ".err")
      $procs[$src] = @{ proc = $p; log = $wlog; size = 0; quietSince = Get-Date }
      Start-Sleep -Seconds 3
    }
    Log ("   started {0} workers" -f $procs.Count)
    $deadline = (Get-Date).AddMinutes(240)
    while ($true) {
      $alive = @($procs.Values | Where-Object { -not $_.proc.HasExited })
      if ($alive.Count -eq 0 -or (Get-Date) -gt $deadline) { break }
      foreach ($k in @($procs.Keys)) {
        $w = $procs[$k]
        if ($w.proc.HasExited) { continue }
        $len = (Get-Item $w.log -ErrorAction SilentlyContinue).Length
        if ($len -gt $w.size) { $w.size = $len; $w.quietSince = Get-Date }
        elseif (((Get-Date) - $w.quietSince).TotalMinutes -gt 20) {
          Log "   STALL: $k produced nothing for 20 min; killing it (its lease is reclaimed automatically)"
          try { Stop-Process -Id $w.proc.Id -Force -ErrorAction SilentlyContinue } catch {}
        }
      }
      Start-Sleep -Seconds 60
    }
    foreach ($k in $procs.Keys) {
      $w = $procs[$k]
      if (-not $w.proc.HasExited) { try { Stop-Process -Id $w.proc.Id -Force -ErrorAction SilentlyContinue } catch {} }
      $done = (Select-String -Path $w.log -Pattern "^  done " -ErrorAction SilentlyContinue | Measure-Object).Count
      $blocked = (Select-String -Path $w.log -Pattern "^  (blocked|ERROR|pdf-fail)" -ErrorAction SilentlyContinue | Measure-Object).Count
      Log ("   worker {0}: done={1} blocked/errors={2}" -f $k, $done, $blocked)
    }

    # 4. apply today's acquisitions per source (a failed gate for one source must not block the rest)
    $today = Get-Date -Format "yyyy-MM-dd"
    foreach ($src in $Sources.Split(",")) {
      $dir = Join-Path $Repo ("runs\acquired\" + $src + "\" + $today)
      if (Test-Path $dir) { Run-Step "apply $src" "npx" @("tsx", "src/pipeline/cli.ts", "apply-acquired", "runs/acquired/$src/$today", "--commit") 60 | Out-Null }
    }

    # 4b. the gap ledger's input: recompute completeness for parts touched since the cycle began
    Run-Step "recompute-completeness" "npx" @("tsx", "src/pipeline/cli.ts", "recompute-completeness", "--since", $cycleStart.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")) 30 | Out-Null

    # 5. summary for the human (and for Claude): what needs judgment
    Run-Step "status" "npx" @("tsx", "src/pipeline/cli.ts", "queue-status") 5 | Out-Null
    $summary = @()
    $summary += "# nightshift summary — $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    $summary += ""
    $summary += "## queue"
    $summary += (Get-Content (Join-Path $LogDir "step-status.out") -ErrorAction SilentlyContinue)
    $summary += ""
    $summary += "## yield per source today (pages done vs pages with facts) — a source with pages but no facts is a BROKEN ADAPTER"
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
