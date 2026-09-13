// III.0 item 6: what each III.1 rename does to the one-cup-set-per-kind contract. For every (category, old kind)
// print its current question set beside the set of the TARGET name wherever that name already exists, so the
// rename's collision with the cupLedger one-set-per-name check is visible. Pure: reads the cisco tree, no DB.
import { writeFileSync } from "node:fs";
import { kindQuestionSet, LEDGER_KINDS } from "file:///D:/Project/netzspec-api-cisco/src/core/cupLedger.ts";

const RENAMES: [string, string][] = [
  ["psu", "power"], ["power-supply", "power"], ["line-card", "linecard"], ["enterprise", "router"], ["other", "unknown"],
  ["daughter", "module"], ["stack-module", "module"], ["security-module", "module"], ["ips-module", "module"],
  ["switch@storage-networking", "fc-switch"], ["forwarding", "linecard"],
];
const sig = (cat: string, kind: string) => {
  const q = kindQuestionSet(cat, kind);
  return [...q.required, ...q.pending.map((p) => p.key + "(g)")].sort().join(", ");
};
const out: string[] = ["# III.1 renames vs the one-cup-set-per-kind contract (cisco tree @ 3aff73b, question set at nothing known)"];
for (const [oldRaw, target] of RENAMES) {
  const [old, onlyCat] = oldRaw.split("@");
  out.push(`\n## ${old}${onlyCat ? " (" + onlyCat + ")" : ""} -> ${target}`);
  for (const [cat, kinds] of Object.entries(LEDGER_KINDS)) {
    if (onlyCat && cat !== onlyCat) continue;
    if (kinds.includes(old)) out.push(`- FROM ${cat}.${old}: [${sig(cat, old)}]`);
  }
  const targets = Object.entries(LEDGER_KINDS).filter(([, ks]) => ks.includes(target));
  if (!targets.length) out.push(`- target name \`${target}\` exists in no category today`);
  for (const [cat] of targets) out.push(`- TARGET ${cat}.${target}: [${sig(cat, target)}]`);
}
writeFileSync("D:/tmp/kindlayer-III0/D/out/rename-sets.md", out.join("\n"));
console.log(out.join("\n"));
