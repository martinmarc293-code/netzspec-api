// tests/arrangementFreeze.test.ts — the phase-1 arrangement may not move silently.
//
//   npx tsx tests/arrangementFreeze.test.ts
//
// data/freeze/<vendor>.json pins the table filling is measured against (src/core/arrangementFreeze.ts). This test
// re-derives every unit from the code and committed files, and fails naming the unit that moved and the command
// that re-freezes it. Re-freezing is legitimate ONLY with a decision record and the rebuilt artifacts on the same
// commit (CLAUDE.md "The arrangement is frozen"). Each unit has a sabotage case: a changed input must change that
// unit's hash, or the pin is decoration.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/config.js";
import {
  freezeUnits, freezeHash, parseKindSnapshot, kindDrift, sha, stable, roleDrift, roleRuleTable, liveRoleOf, inheritClassesUnit, type FreezeUnits, type KindRow,
} from "../src/core/arrangementFreeze.js";
import { INHERIT_CLASS_A, INHERIT_CLASS_B, INHERIT_CLASS_C } from "../src/core/specMerge.js";
import { RULES } from "../src/core/deployRole.js";

let pass = 0;
const misses: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) pass++;
  else misses.push(`${name}${detail ? `\n     ${detail}` : ""}`);
};
const REFREEZE = "npx tsx scripts/build-freeze.mts --vendor cisco (with a docs/decisions/ record, on the commit that rebuilds ledgers, censuses, traces and the completeness report)";

const vendor = "cisco";
const file = path.join(REPO_ROOT, "data", "freeze", `${vendor}.json`);
const tsv = path.join(REPO_ROOT, "data", "freeze", `${vendor}-kinds.tsv`);
check("the freeze file exists", fs.existsSync(file) && fs.existsSync(tsv), `missing ${file} or ${tsv} — ${REFREEZE}`);
if (fs.existsSync(file) && fs.existsSync(tsv)) {
  const frozen = JSON.parse(fs.readFileSync(file, "utf8")) as { freeze_hash: string; units: FreezeUnits };
  const rows: KindRow[] = parseKindSnapshot(fs.readFileSync(tsv, "utf8").replace(/\r\n/g, "\n"));
  const now = freezeUnits(vendor, REPO_ROOT, rows);
  const f = frozen.units;

  // ---- each unit, named ----------------------------------------------------------------------------------------
  const movedProfiles = Object.keys({ ...f.profiles, ...now.profiles }).filter((c) => f.profiles[c] !== now.profiles[c]);
  check(`profiles: all ${Object.keys(f.profiles).length} category profile hashes are the frozen ones`, movedProfiles.length === 0, `moved: ${movedProfiles.join(", ")} — ${REFREEZE}`);
  check(`dictionary: the projection of ${f.dictionary.keys} keys (type, unit, domain, band, shape, superseded_by) is frozen`,
    now.dictionary.sha === f.dictionary.sha, `${now.dictionary.keys} keys now — ${REFREEZE}`);
  const drift = kindDrift(rows);
  check(`kinds: the live classifier reproduces all ${rows.length} frozen (category, sku) -> kind rows`, drift.length === 0,
    `${drift.length} moved, e.g. ${drift.slice(0, 5).map((d) => `${d.row.category}/${d.row.sku} ${d.row.kind}->${d.now}`).join("; ")} — ${REFREEZE}`);
  check("kinds: the snapshot file is the one frozen (mapping hash)", now.kinds.mapping_sha === f.kinds.mapping_sha, REFREEZE);
  check(`mapper: the alias rule file is frozen`, now.mapper.alias_file_sha === f.mapper.alias_file_sha, REFREEZE);
  check(`mapper: the ${f.mapper.conflicts}-entry frozen conflict table is unchanged`, now.mapper.conflicts_sha === f.mapper.conflicts_sha, `${now.mapper.conflicts} entries now — ${REFREEZE}`);
  check(`derived fill paths: ${f.derived_fill_paths.keys.join(", ")} (function, population, validation) are frozen`,
    now.derived_fill_paths.sha === f.derived_fill_paths.sha, `now: ${now.derived_fill_paths.keys.join(", ")} — ${REFREEZE}`);
  check(`spec-bearing document classes are frozen (${f.spec_bearing_classes.classes.join(", ")})`,
    now.spec_bearing_classes.sha === f.spec_bearing_classes.sha, `now: ${now.spec_bearing_classes.classes.join(", ")} — ${REFREEZE}`);
  const movedDen = Object.keys({ ...f.denominators, ...now.denominators }).filter((c) => stable(f.denominators[c]) !== stable(now.denominators[c]));
  check("denominators: every committed ledger's parts and required_slots_stored equal the frozen ones", movedDen.length === 0,
    movedDen.map((c) => `${c}: frozen ${stable(f.denominators[c])}, ledger ${stable(now.denominators[c])}`).join("; "));
  const snapshotCounts = Object.entries(now.denominators).filter(([c, d]) => (now.kinds.by_category[c] ?? 0) !== d.parts);
  check("the kind snapshot and the ledgers describe the same population, per category", snapshotCounts.length === 0,
    snapshotCounts.map(([c, d]) => `${c}: snapshot ${now.kinds.by_category[c] ?? 0}, ledger ${d.parts}`).join("; "));
  check("the freeze hash is reproduced", freezeHash(now) === frozen.freeze_hash, `now ${freezeHash(now).slice(0, 16)}, frozen ${frozen.freeze_hash.slice(0, 16)}`);

  // ---- inheritance classes and the normaliser version (reviewer ruling 29 Sep 2026: both change what a stored value means) ----
  const fi = (f as Partial<FreezeUnits>).inherit_classes, fn = (f as Partial<FreezeUnits>).normaliser;
  check("inherit classes: the freeze pins the class unit", fi !== undefined, `the committed freeze predates it — ${REFREEZE}`);
  if (fi) check(`inherit classes: the A ${fi.a} / B ${fi.b} / C ${fi.c} membership canInherit reads is frozen`, now.inherit_classes.sha === fi.sha,
    `now A ${now.inherit_classes.a} / B ${now.inherit_classes.b} / C ${now.inherit_classes.c} — ${REFREEZE}`);
  check("normaliser: the freeze pins NORM_VERSION", fn !== undefined, `the committed freeze predates it — ${REFREEZE}`);
  if (fn) check(`normaliser: NORM_VERSION ${fn.version} is the frozen one`, now.normaliser.version === fn.version, `now ${now.normaliser.version} — ${REFREEZE}`);
  // The moved field is taken FROM class C and checked absent from A: the first fixture moved ieee_standards, which was
  // already a hand-written A member, so the move changed nothing and the sabotage stayed green.
  const mv = [...INHERIT_CLASS_C].find((k) => !INHERIT_CLASS_A.has(k)) ?? "";
  check(`SABOTAGE a field moved from class C to A (${mv}) changes the class unit`, mv !== "" &&
    inheritClassesUnit({ a: new Set([...INHERIT_CLASS_A, mv]), b: INHERIT_CLASS_B, c: new Set([...INHERIT_CLASS_C].filter((k) => k !== mv)) }).sha !== now.inherit_classes.sha);
  check("CONTROL the same membership in another order hashes the same (content, not text)",
    inheritClassesUnit({ a: new Set([...INHERIT_CLASS_A].reverse()), b: INHERIT_CLASS_B, c: INHERIT_CLASS_C }).sha === now.inherit_classes.sha);
  check("SABOTAGE a different NORM_VERSION changes the freeze hash", freezeHash({ ...now, normaliser: { version: "0.0.0" } }) !== freezeHash(now));

  // ---- layer 3 (kind-layer infra, 13 Sep 2026): the role of every frozen row, and the rule table that derives it -----
  // A SNAPSHOT WITHOUT THE COLUMN is its own finding, not "no roles": the rows cannot be compared, and a check that
  // passed on them would be a check over nothing.
  const rd = roleDrift(rows);
  check(`roles: the kind snapshot carries the deploy_role column`, rd.column,
    `data/freeze/${vendor}-kinds.tsv has 4 columns — it predates layer 3; ${REFREEZE}`);
  check(`roles: the live deployRole reproduces every frozen (category, sku) -> deploy_role row (derived with the frozen kind)`, rd.column && rd.moved.length === 0,
    rd.column ? `${rd.moved.length} moved, e.g. ${rd.moved.slice(0, 5).map((d) => `${d.row.category}/${d.row.sku} [${d.row.kind}] ${d.row.deploy_role || "(none)"}->${d.now || "(none)"}`).join("; ")} — ${REFREEZE}` : "no column to compare");
  const fr = (f as Partial<FreezeUnits>).roles;
  check("roles: the freeze pins the role unit (rule table, axes, role mapping)", fr !== undefined, `the committed freeze predates layer 3 — ${REFREEZE}`);
  if (fr) {
    check(`roles: the ${fr.rules}-rule deploy_role table (ids, patterns, roles, issues, domains) is frozen`, now.roles.rules_sha === fr.rules_sha, `${now.roles.rules} rules now — ${REFREEZE}`);
    check("roles: the (category|kind) -> role axis table is frozen", now.roles.axes_sha === fr.axes_sha, `now ${JSON.stringify(now.roles.axes)} — ${REFREEZE}`);
    check("roles: the snapshot's role mapping is the one frozen (mapping hash)", now.roles.mapping_sha === fr.mapping_sha, REFREEZE);
  }

  // ---- sabotage: a moved input must move its unit's hash, or the pin pins nothing ---------------------------
  const tamperedRows = rows.map((r, i) => (i === 0 ? { ...r, kind: r.kind === "unknown" ? "server" : "unknown" } : r));
  check("SABOTAGE a changed kind in the snapshot is caught by the classifier re-derivation", kindDrift(tamperedRows).length === 1);
  check("SABOTAGE a changed kind changes the mapping hash", freezeUnits(vendor, REPO_ROOT, tamperedRows).kinds.mapping_sha !== f.kinds.mapping_sha);
  check("SABOTAGE a dropped part changes the per-category count", stable(freezeUnits(vendor, REPO_ROOT, rows.slice(1)).kinds.by_category) !== stable(f.kinds.by_category));
  const alt = { ...now, dictionary: { ...now.dictionary, sha: sha("x") } };
  check("SABOTAGE any unit change changes the freeze hash", freezeHash(alt) !== freezeHash(now));

  // ---- layer 3 sabotage. When the committed snapshot predates the column, the rows are given their live roles first
  // (the shape the next freeze writes), so the flip below is measured against a snapshot that HAS the column.
  const withRoles: KindRow[] = rd.column ? rows : rows.map((r) => ({ ...r, deploy_role: liveRoleOf(r) }));
  check("CONTROL a snapshot whose roles are the live derivation shows no role drift", roleDrift(withRoles).column && roleDrift(withRoles).moved.length === 0);
  const flipAt = withRoles.findIndex((r) => r.deploy_role !== "");
  check("the snapshot holds at least one row with a role to flip", flipAt >= 0);
  if (flipAt >= 0) {
    const flipped = withRoles.map((r, i) => (i === flipAt ? { ...r, deploy_role: r.deploy_role === "access" ? "datacenter" : "access" } : r));
    const d = roleDrift(flipped);
    check(`SABOTAGE one flipped role (${withRoles[flipAt].category}/${withRoles[flipAt].sku} ${withRoles[flipAt].deploy_role}) is caught by the re-derivation, naming that row`,
      d.moved.length === 1 && d.moved[0].row.sku === withRoles[flipAt].sku, `${d.moved.length} moved`);
    check("SABOTAGE a flipped role changes the role mapping hash, and NOT the kind mapping hash",
      freezeUnits(vendor, REPO_ROOT, flipped).roles.mapping_sha !== freezeUnits(vendor, REPO_ROOT, withRoles).roles.mapping_sha
        && freezeUnits(vendor, REPO_ROOT, flipped).kinds.mapping_sha === freezeUnits(vendor, REPO_ROOT, withRoles).kinds.mapping_sha);
    const cleared = withRoles.map((r, i) => (i === flipAt ? { ...r, deploy_role: "" } : r));
    check("SABOTAGE a role cleared to none is caught too (a null role is a value, not a skip)", roleDrift(cleared).moved.length === 1);
  }
  const noColumn = withRoles.map((r, i) => (i === 0 ? { category: r.category, sku: r.sku, name: r.name, kind: r.kind } : r));
  check("SABOTAGE one row without the column makes the whole snapshot incomparable, never a silent pass", roleDrift(noColumn).column === false);
  check("SABOTAGE the kind unit hashes the same whether or not the role column is present",
    freezeUnits(vendor, REPO_ROOT, rows.map((r) => ({ category: r.category, sku: r.sku, name: r.name, kind: r.kind }))).kinds.mapping_sha === freezeUnits(vendor, REPO_ROOT, withRoles).kinds.mapping_sha);
  const ruleIdx = RULES.findIndex((r) => r.role !== undefined);
  const roleChanged = RULES.map((r, i) => (i === ruleIdx ? { ...r, role: r.role === "access" ? "datacenter" : "access" } : r));
  check(`SABOTAGE a rule whose role changed (${RULES[ruleIdx].id}) changes the rule-table hash`, sha(stable(roleRuleTable(roleChanged))) !== sha(stable(roleRuleTable())));
  const patChanged = RULES.map((r, i) => (i === ruleIdx && r.re ? { ...r, re: new RegExp(r.re.source + "|^ZZZ", r.re.flags) } : r));
  check(`SABOTAGE a rule whose pattern widened changes the rule-table hash`, sha(stable(roleRuleTable(patChanged))) !== sha(stable(roleRuleTable())));
  const evidenceChanged = RULES.map((r, i) => (i === ruleIdx ? { ...r, evidence: r.evidence + " (reworded)" } : r));
  check("CONTROL rewording a rule's evidence does NOT move the rule-table hash", sha(stable(roleRuleTable(evidenceChanged))) === sha(stable(roleRuleTable())));
}

console.log(`    arrangement freeze: ${pass} passed, ${misses.length} missed`);
for (const m of misses) console.log(`    MISS ${m}`);
if (misses.length) process.exit(1);
