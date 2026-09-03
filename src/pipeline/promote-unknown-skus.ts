// src/pipeline/promote-unknown-skus.ts — SKUs that pages named but the catalogue lacks become
// parts, when the evidence is enough, inside one run. Nothing is inferred silently.
//
//   ingest promote-unknown-skus runs/reports/unknown-skus-provantage-2026-09-03.jsonl [more .jsonl] [--commit]
//
// WHERE THE INPUT COMES FROM. apply-acquired writes one JSONL line per (page, SKU) it could not
// match to a part: {source, vendor, sku, name, url, facts}. A distributor listing a part number we
// do not have is how the catalogue grows past the vendor's own enumeration — but a distributor
// also lists "24x10G", typos, and its own bundle codes, so a single line is not enough.
//
// A SKU is PROMOTED only when ALL of these hold, each refusal counted under its own reason:
//   1. the token passes the part-number rules (src/pipeline/partNumber.ts)  -> junk:<reason>
//   2. the vendor is a vendors-table slug                                     -> unknown_vendor
//   3. it appears on >= 2 DISTINCT pages, or on any vendor page (tier <= 2)   -> single_page_distributor
//   4. it is not already a part (exact or case-insensitive)                   -> existing
// and its category is then INFERRED, in this order, with the rule that decided it recorded:
//   a. page facts, through the explicit tables below: provantage "General Information > Product
//      Type", itprice "Description"/"Product Description" (or the record's `name` for those two
//      sources), the Meraki family prefix of the SKU for meraki pages;
//   b. the family -> category of existing parts of the same vendor sharing the SKU prefix up to
//      the first dash (C9200L-24P-4G-1A -> C9200L-*), taken only when the siblings are UNANIMOUS
//      on the category; the family is the siblings' most common one. Siblings are parts that
//      existed BEFORE this run started and were not themselves defaulted by an earlier promotion:
//      a default must never launder itself into "inferred from a sibling" one SKU later, and a
//      group's outcome must not depend on where it sits in the feed;
//   c. else category "interfaces-modules". If a SKU rule of the product-class table fires (L-,
//      CON-, …) that class stands — it is category-independent; otherwise product_class is
//      `unknown` with the reason written into product_class_reason ("promote-unknown-skus:
//      category defaulted …"), so the default is visible on the part row itself and in the listing.
// Every decision — promoted (with the rule), refused (with the reason), existing — is counted in
// the run stats and LISTED per SKU in runs/reports/promote-unknown-skus-<day>.json.
//
// What a promoted part gets: vendor, exact SKU as first seen (case variants are folded and
// counted), slug, category, family (from a sibling when known), product_class via classify()
// unless defaulted, first_seen_source "unknown-skus:<sources>", name and datasheet_url ONLY from
// a vendor page (tier <= 2) — a distributor's product name is the distributor's prose, not the
// vendor's. No facts are written here (that is apply-acquired's job, once the part exists), so
// the run kind carries no gate.
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool, withRun, hashFile, findPart, upsertPart, type ProductClass } from "../store/index.js";
import { classify } from "../core/productClass.js";
import { isPartNumber } from "./partNumber.js";
import { REPO_ROOT } from "../config.js";

export type UnknownSkuLine = {
  source: string; vendor: string | null; sku: string; name?: string | null; url: string;
  /** apply-acquired writes the COUNT; a feed that carries the raw pairs is honoured too */
  facts?: number | { label: string; value: string }[] | null;
  not_listed?: boolean;
};

export const normSku = (s: string) => s.toUpperCase().replace(/[+=\s]/g, "");

/** provantage "General Information > Product Type" values -> category slug. Closed list. */
export const PRODUCT_TYPE_CATEGORY: Record<string, string> = {
  "ethernet switch": "switches",
  "switch": "switches",
  "network switch": "switches",
  "router": "routers",
  "wireless router": "routers",
  "wireless access point": "wireless",
  "access point": "wireless",
  "wireless lan controller": "wireless",
  "firewall": "security",
  "firewall appliance": "security",
  "security appliance": "security",
  "transceiver": "transceiver",
  "sfp": "transceiver",
  "sfp+": "transceiver",
  "qsfp": "transceiver",
  "expansion module": "interfaces-modules",
  "network module": "interfaces-modules",
  "line card": "interfaces-modules",
  "power supply": "interfaces-modules",
  "server": "servers-unified-computing",
  "rack server": "servers-unified-computing",
  "blade server": "servers-unified-computing",
  "ip phone": "collaboration-endpoints",
};

/** itprice descriptions -> category slug, first match wins. Explicit, anchored, and short on purpose. */
export const DESCRIPTION_CATEGORY: [RegExp, string][] = [
  [/^(?:TAA )?(?:Cisco )?Catalyst [0-9]{4}[A-Z]* (?:[0-9]+[- ]?port|switch)/i, "switches"],
  [/^(?:Cisco )?Nexus [0-9]{4}/i, "switches"],
  [/^(?:Cisco )?(?:ISR|ASR) ?[0-9]{3,4}/i, "routers"],
  [/Integrated Services Router|Aggregation Services Router/i, "routers"],
  [/Firepower|Secure Firewall|ASA ?[0-9]{4}/i, "security"],
  [/Access Point|Wireless Controller/i, "wireless"],
  [/(?:^|[^A-Za-z])(?:Q?SFP\+?(?:28|56)?|transceiver) /i, "transceiver"],
  [/^(?:Cisco )?UCS /i, "servers-unified-computing"],
];

/** Meraki product-family prefix of a SKU -> category. MS = switches, MR = access points, MX = security. */
export const MERAKI_FAMILY_CATEGORY: Record<string, { category: string; family: string }> = {
  MS: { category: "switches", family: "Meraki MS" },
  MR: { category: "wireless", family: "Meraki MR" },
  MX: { category: "security", family: "Meraki MX" },
  MG: { category: "routers", family: "Meraki MG" },
  MT: { category: "meraki", family: "Meraki MT" },
  MV: { category: "meraki", family: "Meraki MV" },
};

export type PageInference = { category: string; family: string | null; rule: string } | null;

/**
 * Category from what the pages said, through the tables above only. Returns null — never a
 * guess — when no table matches; the caller falls through to siblings, then the default.
 */
export function inferFromPages(lines: UnknownSkuLine[], sku: string): PageInference {
  for (const l of lines) {
    const pairs = Array.isArray(l.facts) ? l.facts : [];
    if (l.source === "provantage") {
      const pt = pairs.find((p) => p.label === "General Information > Product Type");
      if (pt) {
        const cat = PRODUCT_TYPE_CATEGORY[pt.value.trim().toLowerCase()];
        if (cat) return { category: cat, family: null, rule: `provantage:product-type=${pt.value.trim()}` };
      }
    }
    if (l.source === "itprice") {
      const desc = pairs.find((p) => p.label === "Product Description" || p.label === "Description")?.value ?? l.name ?? "";
      for (const [rx, cat] of DESCRIPTION_CATEGORY) if (desc && rx.test(desc)) return { category: cat, family: null, rule: `itprice:description~${rx.source.slice(0, 40)}` };
    }
    if (l.source === "meraki") {
      const m = /^(M[SRXGTV])[0-9]/i.exec(sku.trim());
      const hit = m ? MERAKI_FAMILY_CATEGORY[m[1].toUpperCase()] : undefined;
      if (hit) return { category: hit.category, family: hit.family, rule: `meraki:family=${m![1].toUpperCase()}` };
    }
  }
  return null;
}

/** The prefix a sibling lookup uses: up to the first dash, at least 4 characters with a digit. */
export function skuPrefix(sku: string): string | null {
  const head = sku.trim().split("-")[0];
  return head.length >= 4 && /[0-9]/.test(head) && sku.includes("-") ? head.toUpperCase() : null;
}

export type Sibling = { category: string; family: string | null };

/** Category and family from siblings: unanimous category or nothing; most common family. Pure. */
export function inferFromSiblings(siblings: Sibling[]): { category: string; family: string | null } | null {
  if (!siblings.length) return null;
  const cats = new Set(siblings.map((s) => s.category));
  if (cats.size !== 1) return null;
  const fam = new Map<string, number>();
  for (const s of siblings) if (s.family) fam.set(s.family, (fam.get(s.family) ?? 0) + 1);
  const family = [...fam.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null;
  return { category: siblings[0].category, family };
}

export const DEFAULT_CATEGORY = "interfaces-modules";
export const DEFAULT_REASON = "promote-unknown-skus: category defaulted to interfaces-modules, no page fact, no sibling, no SKU rule";

export type Group = { vendor: string | null; sku: string; skus_seen: string[]; lines: UnknownSkuLine[] };

/** One group per (vendor, folded SKU); the exact spelling is the first seen. */
export function groupLines(lines: UnknownSkuLine[]): Group[] {
  const groups = new Map<string, Group>();
  for (const l of lines) {
    const key = `${(l.vendor ?? "").toLowerCase()}|${normSku(l.sku ?? "")}`;
    const g = groups.get(key) ?? { vendor: l.vendor ?? null, sku: (l.sku ?? "").trim(), skus_seen: [], lines: [] };
    if (!g.skus_seen.includes((l.sku ?? "").trim())) g.skus_seen.push((l.sku ?? "").trim());
    g.lines.push(l);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export type Decision = {
  vendor: string | null; sku: string; pages: number; sources: string[]; vendor_page: boolean;
  outcome: "promoted" | "refused" | "existing";
  reason: string;                    // refusal reason, the inference rule, or "existing"
  category?: string; family?: string | null; product_class?: ProductClass | "unknown";
};

export type SourceRow = { slug: string; tier: number };

/**
 * The gate-keeping half of a decision (rules 1-4 in the header), pure. Returns null when the SKU
 * may proceed to category inference, otherwise the refusal.
 */
export function refusal(g: Group, ctx: { vendors: Set<string>; sources: Map<string, SourceRow> }): Omit<Decision, "outcome" | "reason"> & { reason: string | null } {
  const live = g.lines.filter((l) => !l.not_listed);
  const pages = new Set(live.map((l) => l.url)).size;
  const srcs = [...new Set(live.map((l) => l.source))];
  const vendorPage = live.some((l) => (ctx.sources.get(l.source)?.tier ?? 9) <= 2);
  const base = { vendor: g.vendor, sku: g.sku, pages, sources: srcs, vendor_page: vendorPage };
  const pn = isPartNumber(g.sku);
  if (!pn.ok) return { ...base, reason: `junk:${pn.reason}` };
  if (!g.vendor || !ctx.vendors.has(g.vendor.toLowerCase())) return { ...base, reason: "unknown_vendor" };
  if (pages < 2 && !vendorPage) return { ...base, reason: pages === 0 ? "no_page" : "single_page_distributor" };
  return { ...base, reason: null };
}

export type Args = { files: string[]; commit: boolean };

export function parseArgs(argv: string[]): Args {
  const out: Args = { files: [], commit: false };
  for (const a of argv) { if (a === "--commit") out.commit = true; else out.files.push(a); }
  return out;
}

export function readLines(files: string[]): UnknownSkuLine[] {
  const out: UnknownSkuLine[] = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(REPO_ROOT, f);
    if (!fs.existsSync(abs)) throw new Error(`no such file: ${f}`);
    for (const line of fs.readFileSync(abs, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      out.push(JSON.parse(t) as UnknownSkuLine);
    }
  }
  return out;
}

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  if (!a.files.length) throw new Error("usage: ingest promote-unknown-skus <unknown-skus.jsonl>... [--commit]");
  const lines = readLines(a.files);
  const groups = groupLines(lines);
  const pool = getPool();
  const vendors = new Set((await pool.query<{ slug: string }>("SELECT slug FROM vendors")).rows.map((r) => r.slug));
  const sources = new Map((await pool.query<SourceRow>("SELECT slug, tier FROM sources")).rows.map((r) => [r.slug, r]));
  const categories = new Map((await pool.query<{ slug: string; is_hardware: boolean }>("SELECT slug, is_hardware FROM categories")).rows.map((r) => [r.slug, r.is_hardware]));
  if (!categories.has(DEFAULT_CATEGORY)) throw new Error(`default category ${DEFAULT_CATEGORY} is not seeded`);

  const decisions: Decision[] = [];
  const stats: Record<string, number> = { lines: lines.length, groups: groups.length, promoted: 0, existing: 0, refused: 0, case_variants_folded: 0,
    category_from_page: 0, category_from_sibling: 0, category_defaulted: 0 };
  const byReason: Record<string, number> = {};
  // the sibling universe is frozen at this instant: nothing this run creates can be a sibling
  const startedAt = (await pool.query<{ now: Date }>("SELECT now() AS now")).rows[0].now;

  const body = async (runId: number | null) => {
    for (const g of groups) {
      if (g.skus_seen.length > 1) stats.case_variants_folded += g.skus_seen.length - 1;
      const r = refusal(g, { vendors, sources });
      if (r.reason) {
        decisions.push({ ...r, outcome: "refused", reason: r.reason }); stats.refused++; byReason[r.reason] = (byReason[r.reason] ?? 0) + 1; continue;
      }
      const vendor = g.vendor!.toLowerCase();
      const existing = await findPart(vendor, g.sku);
      if (existing) { decisions.push({ ...r, outcome: "existing", reason: `existing:${existing.sku}` }); stats.existing++; continue; }

      let category: string; let family: string | null = null; let rule: string;
      let klass: ProductClass; let klassReason: string;
      const page = inferFromPages(g.lines, g.sku);
      const prefix = skuPrefix(g.sku);
      const siblings = prefix ? (await pool.query<Sibling>(
        `SELECT c.slug AS category, p.family FROM parts p JOIN categories c ON c.id = p.category_id
          WHERE p.vendor_id = (SELECT id FROM vendors WHERE slug = $1) AND p.sku_norm LIKE $2 AND p.sku_norm <> upper($3)
            AND p.created_at < $4
            AND (p.product_class_reason IS NULL OR p.product_class_reason NOT LIKE 'promote-unknown-skus: category defaulted%')`,
        [vendor, `${prefix}-%`, g.sku, startedAt])).rows : [];
      const sib = inferFromSiblings(siblings);
      if (page && categories.has(page.category)) {
        category = page.category; family = page.family ?? sib?.family ?? null; rule = page.rule; stats.category_from_page++;
      } else if (sib) {
        category = sib.category; family = sib.family; rule = `sibling:${prefix}-* (${siblings.length} parts, unanimous)`; stats.category_from_sibling++;
      } else {
        category = DEFAULT_CATEGORY; rule = siblings.length ? `default (siblings ${prefix}-* disagree: ${[...new Set(siblings.map((s) => s.category))].join("/")})` : "default (no page fact, no sibling)";
        stats.category_defaulted++;
      }
      // a SKU rule (L-, CON-, …) is category-independent and stands even under the default; the
      // category branch of the table would turn the default into "hardware", which nobody established
      const k = classify({ sku: g.sku, categorySlug: category, categoryIsHardware: categories.get(category) });
      if (!page && !sib && k.reason.startsWith("category-")) { klass = "unknown"; klassReason = DEFAULT_REASON; }
      else { klass = k.klass; klassReason = k.reason; }

      const vendorLine = g.lines.find((l) => (sources.get(l.source)?.tier ?? 9) <= 2 && !l.not_listed);
      if (runId !== null) {
        await upsertPart({
          vendor, sku: g.sku, category, family, product_class: klass, product_class_reason: klassReason,
          name: vendorLine?.name ?? null, datasheet_url: vendorLine?.url ?? null,
          first_seen_source: `unknown-skus:${r.sources.join("+")}`, enumerated_at: new Date().toISOString().slice(0, 10),
        });
      }
      decisions.push({ ...r, outcome: "promoted", reason: rule, category, family, product_class: klass });
      stats.promoted++;
    }
    return { stats: { ...stats, refused_by_reason: byReason }, notes: `files=${a.files.length}` };
  };

  let out: { stats: Record<string, unknown>; runId?: number };
  if (a.commit) out = await withRun("promote-unknown-skus", { files: a.files.map((f) => hashFile(path.isAbsolute(f) ? f : path.join(REPO_ROOT, f))), commit: true }, body);
  else out = await body(null);

  const day = new Date().toISOString().slice(0, 10);
  const outDir = path.join(REPO_ROOT, "runs", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const report = path.join(outDir, `promote-unknown-skus-${day}.json`);
  fs.writeFileSync(report, JSON.stringify({ generated_at: new Date().toISOString(), commit: a.commit, run_id: out.runId ?? null, stats: out.stats, decisions }, null, 1));
  console.log(`${a.commit ? "COMMITTED run " + out.runId : "DRY RUN"} — ${a.files.length} file(s)`);
  console.table({ ...stats });
  console.log("refused by reason:", byReason);
  for (const d of decisions) console.log(`  ${d.outcome.padEnd(8)} ${(d.vendor ?? "?").padEnd(8)} ${d.sku.padEnd(28)} pages=${d.pages} vendor_page=${d.vendor_page} ${d.category ? `-> ${d.category} (${d.family ?? "-"}, ${d.product_class}) ` : ""}${d.reason}`);
  console.log(`report -> ${path.relative(REPO_ROOT, report)}`);
  await closePool();
}

if (process.argv[1] && /promote-unknown-skus\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
