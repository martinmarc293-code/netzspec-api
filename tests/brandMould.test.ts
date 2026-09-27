// tests/brandMould.test.ts — the guard that stops one brand being measured by another's mould.
//
//   npx tsx tests/brandMould.test.ts
//
// The case that matters is the hyphen one: vendor slugs contain hyphens, so a file cannot be attributed by
// splitting its name. `dell-emc-switches.json` read naively belongs to a vendor called `dell`, which exists
// in no catalogue — the file counts towards nobody while appearing to count towards someone, and `dell-emc`
// is then reported as having no mould when it has one. Every sabotage below is refused for its stated reason.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mouldStatuses, isArranged, NO_MOULD_REASON } from "../src/core/brandMould.js";

let pass = 0; const misses: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (ok) pass++; else misses.push(`MISS ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brandmould-"));
const write = (n: string) => fs.writeFileSync(path.join(dir, n), "{}");
const VENDORS = ["cisco", "dell-emc", "dell", "hpe", "juniper"];

write("cisco.json"); write("cisco-switches.json"); write("dell-emc-switches.json");

const s = mouldStatuses(VENDORS, dir);
const of = (v: string) => s.find((x) => x.vendor === v)!;

check("a brand with reference files is arranged", of("cisco").arranged && of("cisco").files === 2, of("cisco"));
check("a brand with none is NOT arranged", !of("hpe").arranged && !of("juniper").arranged);
check("its reason names the cause rather than leaving a bare false",
  /no product-line reference file/.test(of("hpe").reason), of("hpe").reason);

// THE HYPHEN CASE. Attribution is by longest matching slug, so the dell-emc file must not land on `dell`.
check("a hyphenated vendor slug owns its own file", of("dell-emc").arranged && of("dell-emc").files === 1, of("dell-emc"));
check("…and the shorter slug that PREFIXES it gets nothing", !of("dell").arranged && of("dell").files === 0, of("dell"));

// SABOTAGE: attribute by splitting on the first hyphen, as a naive reader would, and show it inverts both.
{
  const naive = (f: string) => f.replace(/\.json$/, "").split("-")[0];
  const owners = fs.readdirSync(dir).map(naive);
  check("SABOTAGE naive first-hyphen split hands dell-emc's file to a vendor that does not exist",
    owners.includes("dell") && !owners.includes("dell-emc"), owners);
}

check("every vendor asked about gets an answer, none silently dropped", s.length === VENDORS.length, s.length);
check("isArranged agrees with mouldStatuses", isArranged("cisco", VENDORS, dir) && !isArranged("hpe", VENDORS, dir));
check("an empty directory arranges nobody, rather than throwing",
  mouldStatuses(VENDORS, path.join(dir, "does-not-exist")).every((x) => !x.arranged));
check("the not-arranged reason is its own constant, distinct from every other unscored reason",
  NO_MOULD_REASON === "brand_not_arranged");

fs.rmSync(dir, { recursive: true, force: true });
console.log(misses.join("\n"));
console.log(`    brand mould: ${pass} passed, ${misses.length} missed (1 sabotage, 2 hyphen cases)`);
if (misses.length) process.exit(1);
