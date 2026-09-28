import { query } from "../src/store/db.js";
const r = (await query<{ rid: string; status: string; stats: unknown; fin: string | null }>(`
  SELECT id::text AS rid, status, stats, finished_at::text AS fin FROM runs WHERE kind='apply-retract-column-backed' ORDER BY runs.id DESC LIMIT 1`)).rows[0];
console.log(`  run ${r.rid} status=${r.status} finished=${r.fin}  stats=${JSON.stringify(r.stats).slice(0, 140)}`);
const live = (await query<{ n: string }>(`SELECT count(*)::text AS n FROM facts f JOIN parts p ON p.id=f.part_id WHERE f.superseded_by IS NULL AND f.field_key IN ('vendor','series') AND p.retired_at IS NULL AND (f.method IS NULL OR f.method NOT LIKE 'retracted:%')`)).rows[0];
console.log(`  CONTROL live facts under column-backed keys: ${live.n}  (must be 1986)`);
const orph = (await query<{ n: string }>(`
  SELECT count(*)::text AS n FROM parts p
   WHERE p.retired_at IS NULL AND p.series IS NULL AND p.product_series IS NULL
     AND EXISTS (SELECT 1 FROM facts f WHERE f.part_id=p.id AND f.field_key='series' AND f.method LIKE 'retracted:column_backed%')`)).rows[0];
console.log(`  CONTROL parts whose series fact went and hold NO series in a column: ${orph.n}  (must be 0)`);
process.exit(0);
