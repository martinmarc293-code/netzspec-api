// tests/rekeyGate.test.ts — the gate a rekey run owes (29 Sep 2026: run 1409 shipped without one).
//
// A rekey keeps the raw and the provenance and moves the value to another key, so its gate is retro-gate's VALUE half over
// the moved rows, asked BEFORE the write: every raw on its own cached page, over a readable share of at least
// MIN_READABLE_SHARE. The cases: a clean move passes; a raw that is not on its page fails on precision; a page that cannot be
// read fails on the readable share (could-not-check is never a pass); nothing to move is not a pass; and the script that
// rewrites facts actually CALLS the gate and refuses on a failing one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import { rekeyGate } from "../src/pipeline/rekeyGate.js";

let pass = 0, miss = 0, sabotages = 0;
const check = (what: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass++; console.log(`PASS  ${what}`); }
  else { miss++; console.log(`MISS  ${what}${detail === undefined ? "" : `  -> ${JSON.stringify(detail)}`}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rekey-gate-"));
fs.writeFileSync(path.join(dir, "psu.html"), "<html><body><table><tr><td>Power supply</td><td>MSE-PSU1-770W 770W AC power supply</td></tr></table></body></html>");
fs.writeFileSync(path.join(dir, "cable.html"), "<html><body><p>20 ft. cable with RP-TNC connectors</p></body></html>");
const clean = [{ raw: "770W", cache: "psu.html" }, { raw: "RP-TNC", cache: "cable.html" }];

const g = rekeyGate(clean, 2, dir);
check("a move whose every raw is on its own cached page PASSES, precision 1, recall 1", g.passed && g.precision === 1 && g.recall === 1 && g.checked === 2, g);

sabotages++;
const wrong = rekeyGate([{ raw: "1100W", cache: "psu.html" }, { raw: "RP-TNC", cache: "cable.html" }], 2, dir);
check("SABOTAGE a raw that is NOT on its page fails the gate on precision (0.5 < 0.98)", !wrong.passed && wrong.precision === 0.5, wrong);

sabotages++;
const unread = rekeyGate([{ raw: "770W", cache: "gone.html" }, { raw: "RP-TNC", cache: null }], 2, dir);
check("SABOTAGE pages that cannot be read FAIL the gate on the readable share — could-not-check is never a pass",
  !unread.passed && unread.unreadable === 2 && unread.checked === 0, unread);

sabotages++;
// THE DENOMINATOR CASE (6 Sep 2026): one readable row, perfect; four unreadable. Precision over what was checked is 1 -- only
// the readable share (1 of 5 = 0.2 < MIN_READABLE_SHARE) can fail it, so this is the case that proves that clause is live.
const mostlyUnread = rekeyGate([{ raw: "770W", cache: "psu.html" }, ...["a", "b", "c", "d"].map((x) => ({ raw: "770W", cache: `${x}.html` }))], 5, dir);
check("SABOTAGE one perfect readable row among four unreadable FAILS: precision 1 over 1 checked, readable share 0.2",
  !mostlyUnread.passed && mostlyUnread.precision === 1 && mostlyUnread.checked === 1 && mostlyUnread.unreadable === 4, mostlyUnread);

sabotages++;
const wrongDir = rekeyGate(clean, 2, path.join(dir, "no-such-cache"));
check("SABOTAGE the right rows against the WRONG cache directory fail (the 25 Sep default-path landmine)", !wrongDir.passed && wrongDir.unreadable === 2, wrongDir);

check("nothing to move is not a pass", !rekeyGate([], 0, dir).passed);
const partial = rekeyGate(clean, 4, dir);
check("recall is recorded (moved / selected), and refusals on purpose do not fail the gate", partial.passed && partial.recall === 0.5, partial);

// WIRING: the script that rewrites facts calls the gate before the write and refuses on a failing one. Asked of the source
// with the assertion lines excluded, so the needle cannot find itself.
const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "rekey-psu-and-compat.mts"), "utf8").split("\n")
  .filter((l) => !l.trim().startsWith("//"));
check("rekey-psu-and-compat computes the gate over the planned moves", src.some((l) => /const gate = rekeyGate\(todo\.map/.test(l)));
check("rekey-psu-and-compat refuses the write when the gate does not pass", src.some((l) => /if \(!gate\.passed\)/.test(l)));
check("rekey-psu-and-compat records the gate in its run", src.some((l) => /return \{ stats, gate \}/.test(l)));

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n    rekey gate: ${pass} passed, ${miss} missed (${sabotages} sabotage cases, 3 wiring checks)`);
if (miss) process.exit(1);
