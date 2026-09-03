# netzspec-api

The canonical store and read API for network-hardware part data: every part number of the
vendors we cover, every fact with the document it came from, lifecycle with dates and
successors, relations, images. netzspec.com and hexwaren.de consume it.

- `docs/ARCHITECTURE.md` — what this is, boundaries, the rules that are enforced
- `docs/DATA_MODEL.md` — tables, states, tiers, invariants
- `docs/API.md` — the v1 contract
- `docs/RUNBOOK.md` — deploy, backup, restore, keys, adding a vendor

## Layout

```
scraper/        Python acquisition: fetch, cache, enumerate, extract raw facts
src/core/       vocabulary + pure engine: dictionary, aliases, normalise, parse, merge, completeness
src/pipeline/   the `ingest` CLI: extraction JSON → gate → Postgres, inside a run
src/store/      Postgres access
src/api/        Fastify read API
src/derive/     content generated from facts
db/             migrations + runner
data/schema/    alias rules, description patterns, ETIM/Icecat maps
data/reference/ non-regenerable datasets: enumerations, datasheet→SKU maps, golden samples
tests/          every suite; `npm test` (pure) · `npm run test:db` (needs DATABASE_URL)
```

## Run

```
npm ci
cp .env.example .env        # fill DATABASE_URL
npm run migrate
npm test
npm run dev                 # http://127.0.0.1:3021/docs
```
