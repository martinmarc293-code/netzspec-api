import { FIELD_DICTIONARY } from "file:///D:/Project/netzspec-api-cisco/src/core/fieldSchema.ts";
import { KINDS } from "./proposals.mts";
const missing = new Map<string, Set<string>>();
for (const kd of KINDS) {
  const cups = [...kd.cups, ...Object.values(kd.roles ?? {}).flatMap((r) => r.add)];
  for (const c of cups) for (const key of c.keys) if (!FIELD_DICTIONARY[key]) {
    const s = missing.get(key) ?? new Set(); s.add(`${kd.category}.${kd.kind}${c.isNew ? " (spec NEW)" : ""}`); missing.set(key, s);
  }
}
for (const [k, v] of missing) console.log(k, "<-", [...v].join(", "));
const sup = Object.entries(FIELD_DICTIONARY).filter(([, d]) => (d as { superseded_by?: string }).superseded_by).map(([k, d]) => `${k}->${(d as { superseded_by?: string }).superseded_by}`);
console.log("superseded in dictionary:", sup.length, sup.slice(0, 40).join(" "));
