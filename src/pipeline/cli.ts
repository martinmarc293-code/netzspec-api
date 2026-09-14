// src/pipeline/cli.ts — the one entrypoint: `npm run ingest -- <command> [args]`.
//
// The old pipeline was 52 scripts, 14 of them named apply-something, each talking to the
// database on its own terms. Here every command is a subcommand of one CLI, every write goes
// through src/store inside a run, and `ingest --help` is the list. Commands are loaded lazily so
// a broken or half-built command cannot take the others down with it.
const COMMANDS: Record<string, { help: string; run: (argv: string[]) => Promise<void> }> = {
  "sync-dictionary": {
    help: "push the field dictionary and category profiles from code into the database",
    run: async (argv) => { process.argv = [process.argv[0], "sync-dictionary", ...argv]; await import("./sync-dictionary.js"); },
  },
  "migrate-atlas": {
    help: "one-time load from MongoDB Atlas (--dry-run | --reload)",
    run: async (argv) => { process.argv = [process.argv[0], "migrate-atlas", ...argv]; await import("./migrate-atlas.js"); },
  },
  "apply-acquired": {
    help: "acquired page results -> facts inside a gated run: <dir|file>... [--commit] [--vendor V] [--sample N]",
    run: async (argv) => { const m = await import("./apply-acquired.js"); await m.main(argv); },
  },
  "apply-extract": {
    help: "Cisco datasheet extraction (HTML/PDF) -> facts inside a gated apply-specs run: <extract.json>... [--commit] [--sample N] [--allow-regression \"reason\"] [--tag T]",
    run: async (argv) => { const m = await import("./apply-extract.js"); await m.main(argv); },
  },
  remerge: {
    help: "re-evaluate every OPEN conflict under the current merge rules inside a gated run (tier restamp, inheritance retraction, agreements, unions): [--commit] [--run N] [--limit N] [--sample N] [--no-retype]",
    run: async (argv) => { const m = await import("./remerge.js"); await m.main(argv); },
  },
  renormalize: {
    help: "replay the CURRENT normaliser over the stored `raw` of facts an older one produced; same re-stamps, changed supersedes, refused quarantines: [--commit] [--field K] [--since-version V] [--limit N] [--max-change-share 0.25] [--allow \"reason\"]",
    run: async (argv) => { const m = await import("./renormalize.js"); await m.main(argv); },
  },
  "gate-extract": {
    help: "the gate alone (precision, recall, provenance, regression) for an extract file: <extract.json>... [--sample N] [--allow-regression \"reason\"]",
    run: async (argv) => { const m = await import("./gate-extract.js"); await m.main(argv); },
  },
  "apply-lifecycle": {
    help: "Cisco EoL bulletins -> lifecycle rows + successor relations: <cisco-eol.json> [--commit] [--sample N]",
    run: async (argv) => { const m = await import("./apply-lifecycle.js"); await m.main(argv); },
  },
  "apply-compat": {
    help: "Cisco TMG optics matrix -> supports_transceiver / compatible / equivalent relations: <cisco-tmg*.json>... [--commit] [--sample N]",
    run: async (argv) => { const m = await import("./apply-compat.js"); await m.main(argv); },
  },
  reclassify: {
    help: "re-run the product-class rule table over every existing part; writes only rows whose class changes: [--commit] [--vendor V] [--examples N]",
    run: async (argv) => { const m = await import("./reclassify.js"); await m.main(argv); },
  },
  "derive-link-provenance": {
    help: "link_basis + doc_relevance on doc_parts (kind layer, 13 Sep 2026): --vendor V (--dump DIR | --evidence DIR [--commit])",
    run: async (argv) => { const m = await import("./derive-link-provenance.js"); await m.main(argv); },
  },
  "reclassify-docs": {
    help: "set each document's class FROM THE DOCUMENT (Cisco type code, filename, title, PDF page 1) instead of from the extractor that read it; refuses any change that would move a fact tier: [--vendor V] [--commit] [--examples N]",
    run: async (argv) => { const m = await import("./reclassify-docs.js"); await m.main(argv); },
  },
  hygiene: {
    help: "catalogue hygiene, one check at a time, dry by default: <case-duplicates|fabricated-pids|foreign-pids|cross-brand-family|hw-variants|all> [--commit] [--examples N] [--vendor V]",
    run: async (argv) => { const m = await import("./hygiene.js"); await m.main(argv); },
  },
  "name-language": {
    help: "German shop titles in parts.name: keep them in name_de, take a twin's English name or flag name_lang=de, as one run: [--vendor cisco] [--commit]",
    run: async (argv) => { const m = await import("./name-language.js"); await m.main(argv); },
  },
  "recompute-completeness": {
    help: "per-part required/missing fields from current verified facts (the gap ledger's input): [--vendor V] [--category C] [--since ISO]",
    run: async (argv) => { const m = await import("./recompute-completeness.js"); await m.main(argv); },
  },
  "promote-required": {
    help: "earn required fields from evidence: promote a generated 'opt' to 'req' where the corpus already carries it: [--commit] [--min-share 0.6] [--min-parts 30]",
    run: async (argv) => { const m = await import("./promote-required.js"); await m.main(argv); },
  },
  "apply-alias-proposals": {
    help: "vocabulary agents' proposals -> alias rules + generated fields, re-validated: <journal.jsonl|proposals.json> [--commit]",
    run: async (argv) => { const m = await import("./apply-alias-proposals.js"); await m.main(argv); },
  },
  queue: {
    help: "enqueue fetch tasks: --source S --task T [--vendor V --category C --class hardware --limit N | --key K --url U]",
    run: async (argv) => { const m = await import("./queue.js"); await m.main(["queue", ...argv]); },
  },
  "queue-gaps": {
    help: "turn every open gap into lookups at capable sources (--limit N)",
    run: async (argv) => { const m = await import("./queue.js"); await m.main(["queue-gaps", ...argv]); },
  },
  "source-fields": {
    help: "load data/schema/source-fields.json (which sources publish which fields)",
    run: async (argv) => { const m = await import("./queue.js"); await m.main(["source-fields", ...argv]); },
  },
  "build-source-fields": {
    help: "regenerate data/schema/source-fields.json from evidence (label inventories through the alias rules, facts/golden for the Cisco datasheet sources): [--out FILE]",
    run: async (argv) => { const m = await import("./build-source-fields.js"); await m.main(argv); },
  },
  "apply-enumeration": {
    help: "every enumerated Cisco PID that is not yet a part becomes one, inside a gated run: <cisco-pid-universe.json|cisco-enumeration-full.json> [--commit] [--sample N]",
    run: async (argv) => { const m = await import("./apply-enumeration.js"); await m.main(argv); },
  },
  "promote-unknown-skus": {
    help: "SKUs pages named but the catalogue lacks (apply-acquired's unknown-skus feed) -> parts when the evidence is enough: <unknown-skus.jsonl>... [--commit]",
    run: async (argv) => { const m = await import("./promote-unknown-skus.js"); await m.main(argv); },
  },
  "queue-status": {
    help: "fetch queue counts per source and status",
    run: async (argv) => { const m = await import("./queue.js"); await m.main(["queue-status", ...argv]); },
  },
  keys: {
    help: "API keys: create --name N [--scopes read] | list | revoke --id N",
    run: async (argv) => { process.argv = [process.argv[0], "keys", ...argv]; await import("../api/keys-cli.js"); },
  },
};

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "help") {
    console.log("ingest <command>\n");
    for (const [k, v] of Object.entries(COMMANDS)) console.log(`  ${k.padEnd(18)} ${v.help}`);
    return;
  }
  const c = COMMANDS[cmd];
  if (!c) { console.error(`unknown command '${cmd}'; run ingest --help`); process.exit(2); }
  await c.run(rest);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
