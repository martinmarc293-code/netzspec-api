// scripts/measure-family-mismatch-retractions.mts — handoff §3.12: what the 4 Sep 2026 `retracted:family:mismatch` rule
// withdrew from REQUIRED cups, sorted into what should come back and what should stay withdrawn (17 Sep 2026).
//
//   npx tsx scripts/measure-family-mismatch-retractions.mts            (production; read-only)
//
// Read-only. The population is exactly the 16 Sep record's: current withdrawal rows with that method, whose withdrawn row
// was inherited, on a live hardware part, on a cup the part's own kind requires (kindQuestionSet(category,
// partKind(...)).required). It prints, in order:
//   * the population at each filter, so every count says what it was counted over;
//   * whether each value's source document LISTS the part (doc_parts), with a control that pairs every part with a
//     DIFFERENT row's document — "all of them" is only a finding if the control is far below it;
//   * three buckets by explicit rules (keep / model-name row / restore candidate), per field;
//   * today's inheritance gate (describesPart, as applyMerge calls it: parts.family against inherited_from) per bucket.
//     See docs/decisions/2026-09-17-item-12-and-the-inheritance-gate-level.md for why that verdict matters.
//
// THE BUCKETS REST ON A READING, NOT ON A RULE THAT GENERALISES. All 49 (part series <= document title) groups were read
// on 17 Sep 2026 and are listed in READ below. A group not in that list is reported as UNREAD and is never a restore
// candidate by default: a new pairing has to be read before anyone acts on it.
import { closePool, databaseName, query, resolveDatabaseUrl } from "../src/store/db.js";
import { kindQuestionSet, LEDGER_KINDS } from "../src/core/cupLedger.js";
import { partKind } from "../src/core/partKind.js";
import { describesPart } from "../src/core/specMerge.js";

const READ = new Set([
  "2900 ISR <= Cisco Integrated Services Routers Generation 2 Ordering Guide - Cisco",
  "2960Plus <= Cisco Catalyst 2960-Plus Series Switches Data Sheet - Cisco",
  "3560-C <= Cisco Catalyst 2960-C and 3560-C Series Compact Switches Data Sheet - Cisco",
  "3560C <= Cisco Catalyst 2960-C and 3560-C Series Compact Switches Data Sheet - Cisco",
  "3750-X <= Cisco Catalyst 3750-X and 3560-X Series Switches Data Sheet - Cisco",
  "800 <= Cisco 819 4G LTE 2.0 Machine-to-Machine Integrated Services Routers Data Sheet - Cisco",
  "800 <= Cisco 819 4G LTE M2M Gateway Integrated Service Routers Data Sheet - Cisco",
  "800 <= Cisco 819 Non-Hardened 4G LTE 2.0 Machine-to-Machine Integrated Services Routers with Wi-Fi - Data Sheet - Cisco",
  "800 <= Cisco 819 Non-Hardened 4G LTE 2.5 Machine-to-Machine Integrated Services Routers with Wi-Fi for Asia, Australia, and Selected Latin America Regions - Cisco",
  "800 <= Cisco 880 Series Integrated Services Routers - Data Sheet - Cisco",
  "800 ISR <= Cisco 809 Industrial Integrated Services Routers Data Sheet - Cisco",
  "Business 350 <= Cisco 5940 Series Embedded Services Router Data Sheet - Cisco",
  "Business 350 <= Cisco 890 Series Integrated Services Routers Data Sheet - Cisco",
  "CMICR <= Cisco Catalyst Micro Switches Data Sheet - Cisco",
  "Catalyst 2960-CX <= Cisco Catalyst 3560-CX and 2960-CX Series Compact Switches Data Sheet - Cisco",
  "Catalyst 3750-X <= Cisco Catalyst 3750-X and 3560-X Series Switches Data Sheet - Cisco",
  "Catalyst IR1100 Rugged <= Cisco Catalyst IR1101 Rugged Series Router Data Sheet - Cisco",
  "IE 3010 <= Cisco Industrial Ethernet 3010 Series Switches Layer 2/Layer 3 - Cisco",
  "IE1000 <= Cisco Industrial Ethernet 1000 Series Switches Data Sheet - Cisco",
  "IE2000 <= Cisco Industrial Ethernet 2000 Series Switches Data Sheet - Cisco",
  "IE3400H <= Cisco Catalyst IE3400 Heavy Duty Series Data Sheet - Cisco",
  "IE3500H <= Cisco IE3500 Heavy Duty Series Data Sheet - Cisco",
  "IE4000 <= Cisco Industrial Ethernet 4000 Series Switches Data Sheet - Cisco",
  "IP Phone 8800 Series <= Cisco Wireless IP Phone 8821 Data Sheet - Cisco",
  "IP Phone 8800 Series <= Cisco Wireless IP Phone 8821-EX Data Sheet - Cisco",
  "MDS 9200 Series Multiservice <= Cisco MDS 9250i Multiservice Fabric Switch Data Sheet - Cisco",
  "MDS 9500 Series Multilayer Directors <= Cisco MDS 9513 Multilayer Director Data Sheet - Cisco",
  "Meraki <= MS130R Datasheet - Cisco Meraki Documentation",
  "Network Convergence System 2000 Series <= 8-Port Enhanced Data Muxponder Card for the Cisco ONS 15454 Data Sheet - Cisco",
  "Network Convergence System 2000 Series <= Cisco ONS 15454 4 x 2.5-Gbps Muxponder Card - Cisco",
  "Network Convergence System 2000 Series <= Multirate DWDM OTU2 XPonder Card for the Cisco ONS 15454 MSTP Data Sheet - Cisco",
  "Network Convergence System 4200 Series <= Cisco ONS 15454 Any Rate Enhanced Xponder Card - Cisco",
  "Network Convergence System 4200 Series <= Gigabit Carrier Ethernet DWDM XPonder Card for the Cisco ONS 15454 MSTP Data Sheet - Cisco",
  "Nexus 3000 <= Cisco Nexus 3132Q, 3132Q-X, and 3132Q-XL Switches Data Sheet - Cisco",
  "Nexus 3000 <= Cisco Nexus 3232C Switch Data Sheet - Cisco",
  "Nexus 3016 <= Cisco Nexus 3016 Switch Data Sheet - Cisco",
  "Nexus 3048 <= Cisco Nexus 3048 Switch Data Sheet - Cisco",
  "Nexus 3064 <= Cisco Nexus 3064-X, 3064-T, and 3064-32T Switches Data Sheet - Cisco",
  "Nexus 31108 <= Cisco Nexus 3100-V Platform Switches Data Sheet - Cisco",
  "Nexus 3132C Z <= Cisco Nexus 3132C-Z Switches Data Sheet - Cisco",
  "Nexus 3132Q V <= Cisco Nexus 3100-V Platform Switches Data Sheet - Cisco",
  "Nexus 3172 <= Cisco Nexus 3172PQ, 3172TQ, 3172TQ-32T, 3172PQ-XL, and 3172TQ-XL Switches Data Sheet - Cisco",
  "Nexus 3264C E <= Cisco Nexus 3264C-E Switch Data Sheet - Cisco",
  "Nexus 3432D S <= Cisco Nexus 3432D-S Switch Data Sheet - Cisco",
  "Nexus 3500 <= Cisco Nexus 3548-X, 3524-X, 3548-XL, and 3524-XL Switches Data Sheet - Cisco",
  "Nexus 36180YC R <= Cisco Nexus C36180YC-R Switch Data Sheet - Cisco",
  "Nexus 3636C R <= Cisco Nexus 3636C-R Switch Data Sheet - Cisco",
  "SPA500 IP Phones <= Cisco SPA525G 5-Line IP Phone with Color Display - Cisco",
  "Wireless Gateway for LoRaWAN <= Cisco Wireless Gateway for LoRaWAN Data Sheet - Cisco",
]);

type Row = {
  sku: string; name: string | null; series: string | null; family: string | null; family_raw: string | null; product_class: string; live: boolean; category: string;
  part_id: string; doc_id: string | null; doc_title: string | null; field_key: string; inherited: boolean; inherited_from: string | null;
  still_withdrawn: boolean; lists: boolean;
};
type Bucket = "keep" | "model-name row" | "restore candidate" | "UNREAD";

/** The 17 Sep reading of all 49 groups, as rules. First match decides; each names what it read. */
function bucketOf(r: Row): { bucket: Bucket; why: string } {
  const t = r.doc_title ?? "";
  if (/Integrated Services Routers Generation 2 Ordering Guide/.test(t)) return { bucket: "keep", why: "an ordering guide listing every ISR G2 SKU; the values are the 1900 ISR's fixed memory" };
  if (/ONS 15454/.test(t)) return { bucket: "keep", why: "an ONS 15454 card datasheet; the operating temperature is the card's, not the pluggable's" };
  if (r.sku === "AIR-ACC1530-PMK1") return { bucket: "keep", why: "a pole-mount kit given the LoRaWAN gateway's mounting options" };
  if (r.sku === "IPv6") return { bucket: "keep", why: "not a product: a datasheet cell enumerated as a part" };
  if (r.sku === "SPA500S") return { bucket: "keep", why: "an expansion module given the SPA525G phone's certifications" };
  if (!READ.has(`${r.series ?? "(no series)"} <= ${r.doc_title ?? "(no document)"}`)) return { bucket: "UNREAD", why: "a (series <= document) group not read on 17 Sep: read it before acting" };
  if (!/^WS-C/i.test(r.sku) && (r.series === "3750-X" || r.series === "3560-C")) return { bucket: "model-name row", why: "a prefix-less model-name row; the value is true of the model, decide the part first" };
  return { bucket: "restore candidate", why: "one of the datasheet's own models, losing a line-wide value the datasheet states" };
}

/** "key n, key n" by count, ties by key, so two runs over the same data print the same line. */
function count<T>(xs: T[], key: (x: T) => string): string {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`).join(", ");
}

try {
  console.log(`database: ${databaseName(resolveDatabaseUrl())}`);
  const { rows } = await query<Row>(`
    SELECT p.sku, p.name, p.series, p.family, p.family_raw, p.product_class::text AS product_class, (p.retired_at IS NULL) AS live, c.slug AS category,
           p.id::text AS part_id, o.doc_id, sd.title AS doc_title, o.field_key, o.inherited, o.inherited_from,
           (g.superseded_by IS NULL) AS still_withdrawn,
           EXISTS (SELECT 1 FROM doc_parts dp WHERE dp.doc_id = o.doc_id AND dp.part_id = p.id) AS lists
      FROM facts g
      JOIN facts o ON o.superseded_by = g.id AND o.id <> g.id
      JOIN parts p ON p.id = g.part_id
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN source_docs sd ON sd.doc_id = o.doc_id
     WHERE g.method = 'retracted:family:mismatch'`);
  const cupOf = (r: Row): string => {
    if (!LEDGER_KINDS[r.category]) return "no ledger";
    try {
      const q = kindQuestionSet(r.category, partKind(r.category, r.sku, r.name ?? undefined) ?? "(none)");
      return q.required.includes(r.field_key) ? "required" : q.optional.includes(r.field_key) ? "optional"
        : q.not_applicable_by_kind.includes(r.field_key) ? "not applicable" : "other";
    } catch { return "question set refused"; }
  };
  const current = rows.filter((r) => r.still_withdrawn && r.inherited && r.live);
  const hardware = current.filter((r) => r.product_class === "hardware");
  console.log(`withdrawals by this rule: ${rows.length}; still withdrawn, inherited, on a live part: ${current.length}; on hardware: ${hardware.length}`);
  console.log(`  cup for the part's own kind: ${count(hardware, cupOf)}`);
  const pop = hardware.filter((r) => cupOf(r) === "required");
  console.log(`REQUIRED population: ${pop.length} rows on ${new Set(pop.map((r) => r.part_id)).size} parts — ${count(pop, (r) => r.field_key)}`);

  const lists = pop.filter((r) => r.lists).length;
  // Sorted, so the rotation (and therefore the control's count) is the same on every run over the same data.
  const docs = [...new Set(pop.map((r) => r.doc_id ?? ""))].sort();
  const rotated = new Map(docs.map((d, i) => [d, docs[(i + 1) % docs.length]]));
  // ONE query, asked twice: with each row's own document it must reproduce `lists` (so it can say yes), and with another
  // row's document it must fall far below it (so a yes means something). A zero from the second alone could be a broken query.
  const listed = async (docIds: string[]) => (await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM unnest($1::bigint[], $2::text[]) AS x(part_id, doc_id)
      WHERE EXISTS (SELECT 1 FROM doc_parts dp WHERE dp.doc_id = x.doc_id AND dp.part_id = x.part_id)`,
    [pop.map((r) => r.part_id), docIds])).rows[0].n;
  const own = await listed(pop.map((r) => r.doc_id ?? ""));
  const control = await listed(pop.map((r) => rotated.get(r.doc_id ?? "") ?? ""));
  console.log(`source document lists the part: ${lists} of ${pop.length} (same check by the control's query: ${own}); `
    + `CONTROL, each part against another row's document: ${control} of ${pop.length}`);

  // The gate as applyMerge runs it reads parts.family (the MODEL since 8 Sep); the 4 Sep retraction ran when that column held
  // what is now family_raw. All three levels, so "would a restore pass the gate" is answered for every level on offer.
  const gateAt = (r: Row, fam: string | null) =>
    describesPart({ sku: r.sku, productClass: r.product_class, categorySlug: r.category, partFamily: fam, docFamily: r.inherited_from })?.rule ?? "accepted";
  const classified = pop.map((r) => ({ ...r, ...bucketOf(r), gate: gateAt(r, r.family), gateRaw: gateAt(r, r.family_raw), gateSeries: gateAt(r, r.series) }));
  console.log("\nbucket              rows  parts  fields");
  for (const b of ["restore candidate", "model-name row", "keep", "UNREAD"] as Bucket[]) {
    const xs = classified.filter((r) => r.bucket === b);
    console.log(`${b.padEnd(18)} ${String(xs.length).padStart(5)} ${String(new Set(xs.map((r) => r.part_id)).size).padStart(6)}  ${count(xs, (r) => r.field_key) || "-"}`);
    if (!xs.length) continue;
    console.log(`${"".padEnd(26)}gate today (family = model): ${count(xs, (r) => r.gate)}`);
    console.log(`${"".padEnd(26)}gate on family_raw:           ${count(xs, (r) => r.gateRaw)}`);
    console.log(`${"".padEnd(26)}gate on series:               ${count(xs, (r) => r.gateSeries)}`);
  }
  console.log("\nevery group: bucket | rows | parts | series <= document | fields | sample SKUs");
  const groups = new Map<string, typeof classified>();
  for (const r of classified) { const k = `${r.bucket}\t${r.series ?? "(no series)"} <= ${r.doc_title ?? "(no document)"}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  for (const [k, xs] of [...groups].sort((a, b) => a[0].localeCompare(b[0]) || b[1].length - a[1].length)) {
    const [b, key] = k.split("\t");
    console.log(`${b} | ${xs.length} | ${new Set(xs.map((r) => r.part_id)).size} | ${key} | ${count(xs, (r) => r.field_key)} | ${[...new Set(xs.map((r) => r.sku))].sort().slice(0, 3).join(", ")}`);
  }
} finally {
  await closePool();
}
