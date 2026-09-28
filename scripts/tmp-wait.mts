import { query } from "../src/store/db.js";
for (;;) {
  const r = (await query<{ rid: string; status: string }>(`SELECT id::text AS rid, status FROM runs WHERE kind='apply-retract-column-backed' ORDER BY runs.id DESC LIMIT 1`)).rows[0];
  const live = Number((await query<{ n: string }>(`SELECT count(*)::text AS n FROM facts f JOIN parts p ON p.id=f.part_id WHERE f.superseded_by IS NULL AND f.field_key IN ('vendor','series') AND p.retired_at IS NULL AND (f.method IS NULL OR f.method NOT LIKE 'retracted:%')`)).rows[0].n);
  if (r.status !== "running" || live <= 1986) { console.log(`DONE: run ${r.rid} ${r.status}; live ${live}`); break; }
  await new Promise((s) => setTimeout(s, 120000));
}
process.exit(0);
