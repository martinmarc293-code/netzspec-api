/**
 * The bundle plan's fact changes (round-7 ruling C, 12 Sep 2026): 17 retractions and 8 pack quantities.
 *
 *     npx tsx scripts/bundle-plan-facts.mts [--commit] --approved "<the operator's decision, verbatim>"
 *
 * RETRACT, each read row by row in docs/reports/cisco-bundle-separation-plan-2026-09-12.md §Facts:
 *   ports     9  on 5108 chassis rows. All store {anzahl: 4, port_typ: sfp} read from "4x SFP cable 3m" —
 *                four CABLES shipped in the bundle counted as four PORTS on the chassis. FIX-PARSER is recorded
 *                separately; this removes the stored values.
 *   standard  7  on the expired-promo rows, retracted WITH the rows (they leave hardware): each stores
 *                "802.11a", the first alternative of "802.11a/g/n" with /g/n dropped.
 *   cpu       1  UCS-SL-VDI-B200-01, a multi-device bundle: the CPU of ONE contained node among six.
 * NOT retracted: the 8 data_rate facts on UCS-SPM-MDS-0*E — the operator ruled them bundle_contents
 * EVIDENCE (the MDS switch's FC speed) now that those rows are bundles.
 *
 * INSERT pack_quantity — THE CUP MEANS PER UNIT (operator ruling). storage_capacity on UCS-SP-HD-4T-2 stays
 * 4096 (one drive) and dram on UCS-EZ8-M16G-8 stays 16 (one DIMM); the multiplier goes in its own cup and is
 * never multiplied in. 8 of the 9 multi-pack rows state the pack in their name. The 9th, UCS-SP-SD-1P6T-2, is
 * named "1.6TB 2.5in Enterprise Performance 12G SAS SSD(10Xendurance" — truncated before any pack text — so its
 * only evidence is the SKU's -2 suffix. It is HELD, not guessed, and printed.
 *
 * RAW IS A VERBATIM SPAN OF THE NAME and every value comes from the real normaliser. "8Pk" is refused by the
 * count normaliser (a glued suffix it does not read), so that row's raw is the span "8" with the full token in
 * its locator — the number is on the page, and the normaliser is not widened for one row.
 *
 * IT REFUSES ITS OWN OUTPUT: retracted rows are no longer current, and a part that holds a current
 * pack_quantity is not proposed again. Asserted after the write.
 */
import { getPool, closePool } from "../src/store/index.js";
import { withRun } from "../src/store/runs.js";
import { withTx } from "../src/store/db.js";
import { insertFact, retractFact } from "../src/store/facts.js";
import { normalizeField, NORM_VERSION } from "../src/core/specNormalize.js";
import type { SpecEntry } from "../src/core/specMerge.js";

const RETRACT: { key: string; rule: string; skus: string[]; expect: (raw: string, value: string) => boolean }[] = [
  { key: "ports", rule: "bundle-plan:sfp-cables-read-as-chassis-ports",
    skus: ["UCS-FSA1-5108-AC2", "UCS-SP-5108-AC", "UCS-SP-5108-AC3", "UCS-SP-5108-DC", "UCS-SP-5108-DC3",
           "UCS-SPL-5108-AC2", "UCS-SPL-5108-DC", "UCS-SPM-5108-AC2", "UCS-SPM-5108-DC"],
    expect: (raw, value) => /4\s*x\s*SFP\s*cable/i.test(raw) && value.includes('"anzahl": 4') },
  { key: "standard", rule: "bundle-plan:802.11a-g-n-truncated-on-expired-promo",
    skus: ["AIR-CT100-1140A30", "AIR-CT100-1140E30", "AIR-CT12-1140A5", "AIR-CT12-1140E5", "AIR-CT25-1140A10",
           "AIR-CT25-1140E10", "AIR-CT50-1140A20"],
    expect: (raw) => raw === "802.11a" },
  { key: "cpu", rule: "bundle-plan:cpu-of-one-node-on-a-multi-device-bundle",
    skus: ["UCS-SL-VDI-B200-01"], expect: (raw) => raw === "E5-2640v2" },
];

const PACKS: { sku: string; span: string; token: string }[] = [
  { sku: "UCS-SP-HD-1P2T-2", span: "2 Pack", token: "2 Pack" },
  { sku: "UCS-SP-HD-1P8T-2", span: "2 Pack", token: "2 Pack" },
  { sku: "UCS-SP-HD-4T-2", span: "2 Pack", token: "2 Pack" },
  { sku: "UCS-SP-HD-600G-2", span: "2 Pack", token: "2 Pack" },
  { sku: "UCS-SP-HD-8T-2", span: "2 Pack", token: "2 Pack" },
  { sku: "UCS-SP-S-SD-1P6T-2", span: "2 Pack", token: "2 Pack" },
  { sku: "UCS-SP-SD-3P8T-2", span: "2 Pack", token: "2 Pack" },
  { sku: "UCS-EZ8-M16G-8", span: "8", token: "8Pk" },
];
const HELD = [{ sku: "UCS-SP-SD-1P6T-2", why: "name truncated before any pack text; the only evidence is the SKU's -2 suffix" }];

type FactRow = { id: string; part_id: string; sku: string; raw: string; value: string };
type PartRow = { id: string; sku: string; name: string; cat: string; has_pack: boolean; doc_id: string | null };

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const ai = process.argv.indexOf("--approved");
  const approved = ai >= 0 ? process.argv[ai + 1] : undefined;
  if (commit && !approved) throw new Error("--commit needs --approved \"<the operator's decision, verbatim>\"");
  const pool = getPool();

  const retractPlan: { f: FactRow; rule: string }[] = [];
  const problems: string[] = [];
  for (const r of RETRACT) {
    const rows = (await pool.query<FactRow>(`
      SELECT f.id::text, f.part_id::text, p.sku, coalesce(f.raw,'') raw, coalesce(f.value::text,'') value
        FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
       WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.sku = ANY($1::text[]) AND f.field_key = $2
         AND f.superseded_by IS NULL AND f.method = 'description_mining' AND f.inherited_from IS NULL
       ORDER BY p.sku`, [r.skus, r.key])).rows;
    for (const f of rows) {
      if (!r.expect(f.raw, f.value)) { problems.push(`${r.key} on ${f.sku}: raw ${JSON.stringify(f.raw)} is not the value the plan read — refusing`); continue; }
      retractPlan.push({ f, rule: r.rule });
    }
    const missing = r.skus.filter((s) => !rows.some((f) => f.sku === s));
    console.log(`  retract ${r.key.padEnd(9)} ${rows.length} of ${r.skus.length} current${missing.length ? ` — not current (already retracted?): ${missing.join(", ")}` : ""}`);
  }

  const parts = (await pool.query<PartRow>(`
    SELECT p.id::text, p.sku, coalesce(p.name,'') name, ct.slug cat,
           EXISTS (SELECT 1 FROM facts g WHERE g.part_id = p.id AND g.field_key = 'pack_quantity' AND g.superseded_by IS NULL
                     AND g.method NOT LIKE 'retracted:%') has_pack,
           -- THE DOCUMENT THE NAME WAS READ FROM. A verified tier-2 fact must name one (facts_verified_needs_source).
           -- The pack is read from the same name as the capacity fact already on the part, so it cites that fact's
           -- document — the EoL bulletin that lists the SKU with this description. Run 1000 failed for want of it.
           (SELECT g.doc_id FROM facts g WHERE g.part_id = p.id AND g.field_key IN ('storage_capacity', 'dram')
               AND g.superseded_by IS NULL AND g.method = 'description_mining' AND g.doc_id IS NOT NULL
             ORDER BY g.id LIMIT 1) doc_id
      FROM parts p JOIN vendors v ON v.id = p.vendor_id JOIN categories ct ON ct.id = p.category_id
     WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND p.sku = ANY($1::text[])`, [PACKS.map((x) => x.sku)])).rows;
  const packPlan: { part: PartRow; entry: SpecEntry }[] = [];
  for (const pk of PACKS) {
    const part = parts.find((p) => p.sku === pk.sku);
    if (!part) { problems.push(`pack ${pk.sku}: no live part`); continue; }
    if (part.has_pack) continue;
    if (!part.doc_id) { problems.push(`pack ${pk.sku}: no description-mined capacity fact names the document its name was read from — refusing`); continue; }
    if (!part.name.includes(pk.token)) { problems.push(`pack ${pk.sku}: name ${JSON.stringify(part.name)} does not contain "${pk.token}" — refusing`); continue; }
    const n = normalizeField(part.cat, "pack_quantity", pk.span, { locale: "en" });
    if (!n.ok) { problems.push(`pack ${pk.sku}: "${pk.span}" refused by the normaliser: ${n.reason} ${n.detail}`); continue; }
    packPlan.push({ part, entry: {
      k: "pack_quantity", raw: pk.span, value: n.value as number, state: "verified",
      prov: { tier: 2, method: "description_mining", norm_v: NORM_VERSION, doc_id: part.doc_id, locator: `description:pack-quantity "${pk.token}"` },
    } });
  }

  console.log(`${commit ? "COMMIT" : "DRY RUN"} — bundle plan facts`);
  for (const x of retractPlan) console.log(`   RETRACT ${x.f.sku.padEnd(20)} fact ${x.f.id} raw=${JSON.stringify(x.f.raw.slice(0, 60))}  (${x.rule})`);
  for (const x of packPlan) console.log(`   INSERT  ${x.part.sku.padEnd(20)} pack_quantity = ${x.entry.value}  raw=${JSON.stringify(x.entry.raw)}  name=${JSON.stringify(x.part.name.slice(0, 70))}`);
  for (const h of HELD) console.log(`   HELD    ${h.sku.padEnd(20)} ${h.why}`);
  if (problems.length) { console.error("\nREFUSING, nothing written:\n  " + problems.join("\n  ")); process.exitCode = 1; await closePool(); return; }
  if (!commit) { console.log("\nnothing written. re-run with --commit --approved \"...\""); await closePool(); return; }
  if (!retractPlan.length && !packPlan.length) { console.log("nothing to do"); await closePool(); return; }

  const out = await withRun("bundle-plan-facts", { approved, retract: retractPlan.length, insert: packPlan.length, held: HELD, norm_v: NORM_VERSION }, async (runId) => {
    const stats = { retracted: 0, inserted: 0 };
    await withTx(async (tx) => {
      for (const x of retractPlan) { await retractFact(tx, Number(x.f.id), x.rule, runId); stats.retracted++; }
      for (const x of packPlan) { await insertFact(tx, Number(x.part.id), x.entry, runId); stats.inserted++; }
    });
    return { stats };
  });
  console.log(`\n  written: ${JSON.stringify(out.stats)}`);
  // THE SELECTOR MUST REJECT ITS OWN OUTPUT.
  const again = (await pool.query<{ n: number }>(`
    SELECT count(*)::int n FROM facts f JOIN parts p ON p.id = f.part_id JOIN vendors v ON v.id = p.vendor_id
     WHERE v.slug = 'cisco' AND p.retired_at IS NULL AND f.superseded_by IS NULL AND f.method = 'description_mining'
       AND ((f.field_key = 'ports' AND p.sku = ANY($1)) OR (f.field_key = 'standard' AND p.sku = ANY($2)) OR (f.field_key = 'cpu' AND p.sku = ANY($3)))`,
    [RETRACT[0].skus, RETRACT[1].skus, RETRACT[2].skus])).rows[0].n;
  const packs = (await pool.query<{ n: number }>(`
    SELECT count(*)::int n FROM facts f JOIN parts p ON p.id = f.part_id
     WHERE p.sku = ANY($1) AND p.retired_at IS NULL AND f.field_key = 'pack_quantity' AND f.superseded_by IS NULL`, [PACKS.map((x) => x.sku)])).rows[0].n;
  console.log(`  retractable facts left (MUST be 0): ${again} · pack_quantity facts held (MUST be ${PACKS.length}): ${packs}`);
  if (again !== 0 || packs !== PACKS.length) process.exitCode = 1;
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
