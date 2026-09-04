// src/pipeline/queue.ts — the planner that feeds the scrapers. Workers never decide what to
// fetch (docs/ARCHITECTURE.md § Acquisition); this is where the deciding happens, as rows.
//
//   ingest queue --source provantage --task search --vendor cisco --category switches --limit 500
//   ingest queue --source meraki --task listing --key https://documentation.meraki.com/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets
//   ingest queue-gaps --limit 2000          every open gap -> a lookup at each capable source not yet consulted
//   ingest source-fields                    load data/schema/source-fields.json into the capability matrix
//   ingest queue-status
//
// Rules: a part is not re-queued at a source that checked it in the last 90 days; parts with the
// fewest current facts go first (the thinnest records are the ones the operator is paying to
// fill); vendor sources outrank aggregators through priority = 50 + tier * 10.
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool } from "../store/db.js";
import { REPO_ROOT } from "../config.js";

/** The task a source answers when all we know is a SKU. Sources absent here are listing-driven
 *  (their coverage comes from crawling their own indexes) and are skipped by queue-gaps. */
export const LOOKUP_TASK: Record<string, string> = {
  provantage: "search",
  "router-switch": "search",
  itprice: "gpl",
  cdw: "search",
};

export type Args = Record<string, string | boolean>;

/** `--k v` pairs; a flag with no value (or followed by another flag) is `true`. Exported for the proof. */
export function parseArgs(argv: string[]): { cmd: string; args: Args } {
  const [cmd, ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) args[k] = true; else { args[k] = v; i++; }
    }
  }
  return { cmd, args };
}

async function sourceId(slug: string): Promise<{ id: number; enabled: boolean; tier: number }> {
  const r = await getPool().query("SELECT id, enabled, tier FROM sources WHERE slug = $1", [slug]);
  if (!r.rowCount) throw new Error(`unknown source '${slug}' (see the sources table)`);
  return r.rows[0];
}

export async function enqueue(args: Args): Promise<number> {
  const slug = String(args.source || "");
  const task = String(args.task || "");
  if (!slug || !task) throw new Error("--source and --task are required");
  const src = await sourceId(slug);
  if (!src.enabled) throw new Error(`source '${slug}' is disabled`);
  const priority = Number(args.priority ?? 50 + src.tier * 10);
  const pool = getPool();

  if (args.key || args.url) {
    const key = String(args.key || args.url);
    const r = await pool.query(
      `INSERT INTO fetch_queue (source_id, task, key, url, priority) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_id, task, key) DO NOTHING`,
      [src.id, task, key, args.url ? String(args.url) : null, priority]);
    return r.rowCount ?? 0;
  }

  const limit = Number(args.limit ?? 500);
  const r = await pool.query(
    `INSERT INTO fetch_queue (source_id, task, key, part_id, priority)
     SELECT $1, $2, p.sku, p.id, $3
       FROM parts p
       JOIN vendors v ON v.id = p.vendor_id
       JOIN categories c ON c.id = p.category_id
      WHERE ($4::text IS NULL OR v.slug = $4)
        AND ($5::text IS NULL OR c.slug = $5)
        AND ($6::text IS NULL OR p.product_class::text = $6)
        AND NOT EXISTS (SELECT 1 FROM part_source_checks psc
                         WHERE psc.part_id = p.id AND psc.source_id = $1 AND psc.checked_at > now() - interval '90 days')
      -- Order of value, not of thinness alone: a bare "10-2527-01" cable assembly has zero facts
      -- and is listed nowhere, so a thinnest-first crawl spent an hour on not-listed answers.
      -- Sellable hardware in the categories buyers search first, parts that HAVE a datasheet or a
      -- family (i.e. exist as products), then the rest; within a rank, fewest facts first.
      ORDER BY CASE c.slug WHEN 'switches' THEN 0 WHEN 'transceiver' THEN 1 WHEN 'routers' THEN 2 WHEN 'wireless' THEN 3
                           WHEN 'security' THEN 4 WHEN 'meraki' THEN 5 WHEN 'interfaces-modules' THEN 6 WHEN 'optical-networking' THEN 7
                           WHEN 'servers-unified-computing' THEN 8 ELSE 9 END,
               (p.datasheet_url IS NULL AND p.family IS NULL) ASC,
               (p.sku ~ '^[0-9]{2,3}-[0-9]{4,}') ASC,
               (SELECT count(*) FROM facts f WHERE f.part_id = p.id AND f.superseded_by IS NULL) ASC, p.id
      LIMIT $7
     ON CONFLICT (source_id, task, key) DO NOTHING`,
    [src.id, task, priority, args.vendor ? String(args.vendor) : null, args.category ? String(args.category) : null,
      args.class ? String(args.class) : null, limit]);
  return r.rowCount ?? 0;
}

/** Every open gap becomes a lookup at each capable, enabled source that has not checked the part. */
export async function queueGaps(args: Args): Promise<{ inserted: number; skippedNoLookup: string[] }> {
  const limit = Number(args.limit ?? 2000);
  const pool = getPool();
  const sources = (await pool.query<{ id: number; slug: string; tier: number }>("SELECT id, slug, tier FROM sources WHERE enabled")).rows;
  const lookup = sources.filter((s) => LOOKUP_TASK[s.slug]);
  const skipped = sources.filter((s) => !LOOKUP_TASK[s.slug]).map((s) => s.slug);
  let inserted = 0;
  for (const s of lookup) {
    if (inserted >= limit) break;
    const r = await pool.query(
      `INSERT INTO fetch_queue (source_id, task, key, part_id, priority)
       SELECT DISTINCT $1::smallint, $2::text, p.sku, g.part_id, $3::smallint
         FROM gap_ledger g
         JOIN parts p ON p.id = g.part_id
         JOIN source_fields sf ON sf.source_id = $1 AND sf.field_key = g.field_key
                              AND (sf.category_id IS NULL OR sf.category_id = g.category_id)
        WHERE g.state = 'gap_unattempted'
          AND NOT EXISTS (SELECT 1 FROM part_source_checks psc WHERE psc.part_id = g.part_id AND psc.source_id = $1)
        LIMIT $4
       ON CONFLICT (source_id, task, key) DO NOTHING`,
      [s.id, LOOKUP_TASK[s.slug], 50 + s.tier * 10, limit - inserted]);
    inserted += r.rowCount ?? 0;
  }
  return { inserted, skippedNoLookup: skipped };
}

/** The shape of data/schema/source-fields.json: { "sources": { "<slug>": { "*": ["field_key", ...], "<category>": [...] } } } */
export type SourceFieldsConfig = { sources: Record<string, Record<string, string[]>> };

export const SOURCE_FIELDS_FILE = path.join(REPO_ROOT, "data", "schema", "source-fields.json");

/** Load the capability matrix from the repo file (the CLI path) or from any file handed in (the proof's path). */
export async function loadSourceFields(file: string = SOURCE_FIELDS_FILE): Promise<{ inserted: number; unknownFields: string[] }> {
  const cfg = JSON.parse(fs.readFileSync(file, "utf8")) as SourceFieldsConfig;
  return applySourceFields(cfg);
}

/**
 * Write a parsed capability matrix into source_fields. An unknown source or category throws,
 * naming it, before anything under it is written; an unknown FIELD KEY is reported and skipped
 * (the FK would refuse it anyway — reporting it is what makes the typo visible), the known keys
 * beside it still land.
 */
export async function applySourceFields(cfg: SourceFieldsConfig): Promise<{ inserted: number; unknownFields: string[] }> {
  const pool = getPool();
  const known = new Set((await pool.query<{ key: string }>("SELECT key FROM field_dictionary")).rows.map((r) => r.key));
  const cats = new Map((await pool.query<{ slug: string; id: number }>("SELECT slug, id FROM categories")).rows.map((r) => [r.slug, r.id]));
  const unknownFields: string[] = [];
  let inserted = 0;
  for (const [slug, byCat] of Object.entries(cfg.sources || {})) {
    const src = await sourceId(slug);
    for (const [cat, keys] of Object.entries(byCat)) {
      const catId = cat === "*" ? null : cats.get(cat);
      if (cat !== "*" && catId === undefined) throw new Error(`source-fields.json: unknown category '${cat}' under '${slug}'`);
      for (const k of keys) {
        if (!known.has(k)) { unknownFields.push(`${slug}/${cat}/${k}`); continue; }
        const r = await pool.query(
          `INSERT INTO source_fields (source_id, category_id, field_key) VALUES ($1, $2, $3)
           ON CONFLICT (source_id, COALESCE(category_id, 0), field_key) DO NOTHING`, [src.id, catId, k]);
        inserted += r.rowCount ?? 0;
      }
    }
  }
  return { inserted, unknownFields };
}

export async function queueStatus(): Promise<{ slug: string; status: string; n: number }[]> {
  return (await getPool().query(
    "SELECT s.slug, q.status::text AS status, count(*)::int AS n FROM fetch_queue q JOIN sources s ON s.id = q.source_id GROUP BY 1, 2 ORDER BY 1, 2")).rows;
}

export async function main(argv: string[]): Promise<void> {
  const { cmd, args } = parseArgs(argv);
  try {
    if (cmd === "queue") {
      const n = await enqueue(args);
      console.log(`queued ${n} task(s) at ${args.source} (${args.task})`);
    } else if (cmd === "queue-gaps") {
      const r = await queueGaps(args);
      console.log(`queued ${r.inserted} gap lookup(s); listing-driven sources skipped: ${r.skippedNoLookup.join(", ") || "none"}`);
    } else if (cmd === "source-fields") {
      const r = await loadSourceFields();
      console.log(`source_fields: ${r.inserted} inserted; unknown field keys: ${r.unknownFields.length ? r.unknownFields.join(", ") : "none"}`);
      if (r.unknownFields.length) process.exitCode = 1;
    } else if (cmd === "queue-status") {
      const rows = await queueStatus();
      if (!rows.length) console.log("queue is empty");
      for (const r of rows) console.log(`${r.slug.padEnd(16)} ${r.status.padEnd(8)} ${r.n}`);
    } else {
      throw new Error(`unknown queue command '${cmd}'`);
    }
  } finally {
    await closePool();
  }
}
