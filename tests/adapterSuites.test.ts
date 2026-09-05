// tests/adapterSuites.test.ts — proof for the RECALL half of the apply gate.
//
//   npx tsx tests/adapterSuites.test.ts
//
// WHY. `runAdapterSuites` runs each touched source's adapter suite fresh, and its result is half of
// what decides whether facts may land. It spawned a hardcoded `python3.11`.
//
// That is correct on the operator's laptop, where `python` and `python3` resolve to a Microsoft
// Store stub and 3.11 is the only name that works. It is WRONG on the Hetzner box, which has
// python3 3.12.3 and no python3.11 binary at all — so the colocated apply spawned a program that
// does not exist, spawnSync returned non-zero, and the gate recorded `suites: {juniper: false}`
// while that same suite passed 85/85 when run by hand on that same box.
//
// A FALSE NEGATIVE IN THE ONE PLACE IT MUST NEVER HAPPEN. "I could not run your suite" and "your
// suite did not pass" are different facts; only one was true; the gate reported the other. That is
// this project's standing rule about a monitor that cannot tell its own failure from a fault,
// arriving one layer below where the rule was written.
//
// The third instance of the same portability shape found in one hour — the other two were
// `shell=True` calls in Juniper's suites, which run a bare command, exit 0 and produce no output.
// All three are correct on the machine they were written on and silently wrong on the deploy
// target, and all three fail as a FALSE NEGATIVE rather than as an error.
import { resolvePython, runAdapterSuites } from "../src/pipeline/apply-acquired.js";

let pass = 0, miss = 0;
function check(id: string, what: string, ok: boolean, got: unknown = "") {
  if (ok) pass++; else miss++;
  console.log(`${ok ? "PASS" : "MISS"} | ${id.padEnd(5)} | ${what.slice(0, 84).padEnd(86)}${ok ? "" : ` | got ${String(got).slice(0, 140)}`}`);
}
function refuses(id: string, what: string, fn: () => unknown, mustSay: string): void {
  try { fn(); } catch (e) {
    const m = String((e as Error).message);
    check(id, what, m.toLowerCase().includes(mustSay.toLowerCase()), m.slice(0, 160));
    return;
  }
  check(id, what, false, "did NOT refuse");
}

// ---- resolution asks, it does not guess -------------------------------------------------------
check("PY1", "an interpreter is found on this machine at all (if this fails every case below is "
           + "measuring nothing)", resolvePython() !== null, String(resolvePython()));
check("PY2", "an explicit interpreter that WORKS is honoured over the default order",
  resolvePython("python3") === "python3", String(resolvePython("python3")));
check("PY3", "SABOTAGE an explicit name that does not exist falls THROUGH to a working one rather "
           + "than failing - a stale --python flag must not take the gate down",
  resolvePython("nz-no-such-python") !== null, String(resolvePython("nz-no-such-python")));
check("PY4", "candidates are tried by ASKING them (--version), not by guessing from the platform - "
           + "the laptop needs python3.11 and the box needs python3, and neither is derivable from "
           + "process.platform",
  ["python3.11", "python3", "python"].includes(resolvePython() as string), String(resolvePython()));

const savedPath = process.env.PATH;
const savedVar = process.env.NETZSPEC_PYTHON;
try {
  process.env.NETZSPEC_PYTHON = "nz-also-missing";
  check("PY5", "SABOTAGE a broken NETZSPEC_PYTHON override still resolves - the escape hatch cannot "
             + "become a foot-gun", resolvePython() !== null, String(resolvePython()));
  process.env.NETZSPEC_PYTHON = savedVar;

  process.env.PATH = "";
  check("PY6", "with NOTHING runnable, resolution returns null rather than a plausible name",
    resolvePython() === null, String(resolvePython()));
  refuses("PY7", "...and runAdapterSuites REFUSES rather than reporting every adapter as failing. "
               + "Returning false would say the adapters are broken; throwing says the machine "
               + "cannot check them, and those send an operator to different places",
    () => runAdapterSuites(["cisco-datasheets"]), "could not check");
  refuses("PY8", "the refusal NAMES what it tried, so the fix is in the message rather than in the "
               + "source", () => runAdapterSuites(["cisco-datasheets"]), "python3.11");
  refuses("PY9", "...and it names the environment variable that overrides it",
    () => runAdapterSuites(["cisco-datasheets"]), "NETZSPEC_PYTHON");
} finally {
  process.env.PATH = savedPath;
  if (savedVar === undefined) delete process.env.NETZSPEC_PYTHON; else process.env.NETZSPEC_PYTHON = savedVar;
}
check("PY10", "SABOTAGE the environment is restored - a test that leaves PATH empty breaks every "
            + "case after it, in this file and any other the runner loads next",
  process.env.PATH === savedPath && !!process.env.PATH);

// ---- a MISSING suite is still a plain false, and that is correct ------------------------------
// "This source has no adapter suite" is a real answer about the adapters, not a machine fault: the
// gate's own rule is that a source with no suite is a failed suite. Only the interpreter case is a
// refusal.
const r = runAdapterSuites(["nz-source-with-no-suite"]);
check("PY11", "SABOTAGE a source with NO suite file is false, not a throw - that is a fact about "
            + "the adapters and the gate is right to refuse on it",
  r["nz-source-with-no-suite"] === false, JSON.stringify(r));

console.log(`\n${pass} passed, ${miss} missed`);
process.exit(miss ? 1 : 0);
