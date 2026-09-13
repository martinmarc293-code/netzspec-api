// III.0 item 5 (a)+(c): cross-tab of partKind against a NAME-NOUN control for non-Cisco vendors, and a check of
// whether the STORED completeness row for each part equals what the cisco tree's kind axis would ask now
// (requiredFieldsFor + completenessV2 on the part's facts, same inputs recompute-completeness uses).
// The name-noun is a heuristic control, not a truth: the latest-ending noun phrase in the name head (text before
// " – "), phrase list below. Every mismatch bucket is printed with rows so it can be read.
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "file:///D:/tmp/kindlayer-III0/D/scripts/db.mts";
import { partKind, FALLBACK_KINDS } from "file:///D:/Project/netzspec-api-cisco/src/core/partKind.ts";
import { requiredFieldsFor } from "file:///D:/Project/netzspec-api-cisco/src/pipeline/recompute-completeness.ts";
import { kindQuestionSet } from "file:///D:/Project/netzspec-api-cisco/src/core/cupLedger.ts";

const NOUNS: [RegExp, string][] = [
  [/fibre channel switch|fc switch|san switch/i, "fc-switch"],
  [/fabric module/i, "fabric"],
  [/management module|supervisor|main processing unit|routing engine|control board/i, "supervisor"],
  [/power supply|power supplies|netzteil|psu|power shelf/i, "power"],
  [/power cord|power cable|jumper cord|netzkabel/i, "power-cord"],
  [/fan tray|fan module|\bfans?\b|lüfter/i, "fan"],
  [/transceiver|optic(?:al)? module/i, "optic"],
  [/breakout/i, "breakout-cable"],
  [/direct[- ]attach|\bdac\b|active optical cable|\baoc\b|twinax|copper cable|dac-kabel/i, "cable"],
  [/stacking cable|stack cable/i, "stack-cable"],
  [/\bcable\b|\bkabel\b/i, "cable"],
  [/line card|linecard|\bmpc\b|interface card/i, "linecard"],
  [/\bmic\b|\bpic\b|module|modul\b|expansion slot card|adapter card/i, "module"],
  [/access point/i, "ap"],
  [/gateway/i, "gateway"],
  [/\bchassis\b/i, "chassis"],
  [/\bswitch\b|switch series/i, "switch"],
  [/\brouter\b/i, "router"],
  [/rack mount|mounting kit|rail kit|bracket|\bkit\b/i, "mechanical"],
];

function nameNoun(name: string | null): string {
  if (!name) return "(no name)";
  const head = name.split(" – ")[0];
  let best: { end: number; noun: string } | null = null;
  for (const [re, noun] of NOUNS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(head))) {
      const end = m.index + m[0].length;
      if (!best || end > best.end) best = { end, noun };
    }
  }
  return best?.noun ?? "(none)";
}

const c = await connect();
const parts = (await c.query(`
  SELECT p.id, v.slug AS vendor, c.slug AS category, p.sku, p.name, p.series, p.family,
         cp.required_total, cp.required_fields, cp.computed_at
    FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories c ON c.id = p.category_id
    LEFT JOIN completeness cp ON cp.part_id = p.id
   WHERE p.retired_at IS NULL AND p.product_class = 'hardware' AND v.slug <> 'cisco'`)).rows;
const facts = (await c.query(`SELECT f.part_id, f.field_key, f.value FROM facts f
   WHERE f.part_id = ANY($1::bigint[]) AND f.superseded_by IS NULL AND f.state IN ('verified','corroborated')`, [parts.map((p: any) => p.id)])).rows;
const computed = (await c.query(`SELECT v.slug, min(cp.computed_at) AS min, max(cp.computed_at) AS max, count(*)::int AS n
   FROM completeness cp JOIN parts p ON p.id = cp.part_id JOIN vendors v ON v.id = p.vendor_id
  WHERE p.retired_at IS NULL AND p.product_class='hardware' GROUP BY v.slug ORDER BY v.slug`)).rows;
const lastRuns = (await c.query(`SELECT id, kind, status, started_at, git_sha, inputs FROM runs WHERE kind = 'recompute-completeness' ORDER BY id DESC LIMIT 15`)).rows;
await c.end();

const byPart = new Map<number, Record<string, unknown>>();
for (const f of facts) { const m = byPart.get(f.part_id) ?? {}; m[f.field_key] = f.value; byPart.set(f.part_id, m); }

const out: string[] = [];
out.push("# name-noun control vs partKind (cisco tree), non-Cisco live hardware\n");
out.push("## completeness computed_at per vendor (live hardware)");
for (const r of computed) out.push(`- ${r.slug}: n=${r.n} min=${new Date(r.min).toISOString()} max=${new Date(r.max).toISOString()}`);
out.push("\n## last recompute-completeness runs");
for (const r of lastRuns) out.push(`- #${r.id} ${r.status} ${new Date(r.started_at).toISOString()} ${r.git_sha} ${JSON.stringify(r.inputs)}`);

type X = { vendor: string; category: string; kind: string; noun: string; sku: string; name: string; storedMatch: boolean | null; storedN: number | null; nowN: number };
const xs: X[] = [];
for (const p of parts) {
  const kind = partKind(p.category, p.sku, p.name ?? undefined) ?? "(undefined)";
  const values: Record<string, unknown> = { ...(byPart.get(p.id) ?? {}) };
  if (values.vendor === undefined) values.vendor = p.vendor;
  if (values.series === undefined && p.series) values.series = p.series;
  if (values.series === undefined && p.family) values.series = p.family;
  if (kind !== "(undefined)") values.kind = kind;
  const now = requiredFieldsFor(p.category, values);
  const stored: string[] | null = p.required_fields;
  const storedMatch = stored ? JSON.stringify([...stored].sort()) === JSON.stringify([...now].sort()) : null;
  xs.push({ vendor: p.vendor, category: p.category, kind, noun: nameNoun(p.name), sku: p.sku, name: p.name ?? "", storedMatch, storedN: stored ? stored.length : null, nowN: now.length });
}
writeFileSync("D:/tmp/kindlayer-III0/D/out/nouns-rows.json", JSON.stringify(xs, null, 1));

out.push("\n## stored completeness.required_fields == what the cisco-tree axis asks now (per vendor/category)");
const g1 = new Map<string, X[]>();
for (const x of xs) { const k = `${x.vendor}|${x.category}`; (g1.get(k) ?? g1.set(k, []).get(k)!).push(x); }
for (const [k, rs] of [...g1].sort()) {
  const match = rs.filter((r) => r.storedMatch).length;
  const avgS = rs.reduce((a, r) => a + (r.storedN ?? 0), 0) / rs.length, avgN = rs.reduce((a, r) => a + r.nowN, 0) / rs.length;
  out.push(`- ${k}: ${match}/${rs.length} match; mean stored required ${avgS.toFixed(1)}, mean now ${avgN.toFixed(1)}`);
}

out.push("\n## cross-tab (vendor / category / kind x name-noun) with rows");
const g2 = new Map<string, X[]>();
for (const x of xs) { const k = `${x.vendor}|${x.category}|${x.kind}|${x.noun}`; (g2.get(k) ?? g2.set(k, []).get(k)!).push(x); }
let lastVC = "";
for (const [k, rs] of [...g2].sort((a, b) => a[0].localeCompare(b[0]))) {
  const [v, cat, kind, noun] = k.split("|");
  if (`${v}|${cat}` !== lastVC) { out.push(`\n### ${v} / ${cat}`); lastVC = `${v}|${cat}`; }
  out.push(`- kind=${kind} noun=${noun}: ${rs.length}`);
  for (const r of rs.slice(0, 8)) out.push(`    - ${r.sku} | ${r.name.slice(0, 120)}`);
}

out.push("\n## question sets referenced");
for (const [cat, kind] of [["interfaces-modules", "module"], ["interfaces-modules", "interface"], ["switches", "switch"], ["switches", "accessory"], ["switches", "fabric"], ["switches", "power"], ["switches", "linecard"], ["switches", "module"], ["routers", "enterprise"], ["transceiver", "pluggable"], ["wireless", "other"], ["wireless", "ap"], ["storage-networking", "switch"]]) {
  const qs = kindQuestionSet(cat, kind);
  out.push(`- ${cat}.${kind}: required=[${qs.required.join(", ")}] pending=[${qs.pending.map((p) => p.key).join(", ")}]`);
}
writeFileSync("D:/tmp/kindlayer-III0/D/out/nouns-tab.md", out.join("\n"));
console.log(`rows ${xs.length}; written`);
