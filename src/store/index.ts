// src/store/index.ts — the write-side store, one import for the pipeline.
//
// Every module here performs a database effect and nothing else: decisions (what a label means,
// what a value normalises to, whether two values agree) live in src/core and are pure. The
// pipeline imports from here; the API never does — it reads (docs/ARCHITECTURE.md: "Store: Postgres
// schema and typed access; never business rules").
export * from "./db.js";
export * from "./runs.js";
export * from "./parts.js";
export * from "./docs.js";
export * from "./facts.js";
export * from "./lifecycle.js";
export * from "./relations.js";
export * from "./images.js";
export * from "./aliases.js";
export * from "./checks.js";
