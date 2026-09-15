#!/usr/bin/env node
// scripts/env-keys.mjs — the ONLY way to look inside a .env file in this repo (operator, 15 Sep 2026, after a masked grep printed the
// database password into a stored transcript). It prints KEY NAMES ONLY — never a value, never part of a value.
//
//   node scripts/env-keys.mjs [path ...]                  key names of each file (default: ./.env)
//   node scripts/env-keys.mjs --same KEY_A KEY_B [path]   whether two URL-valued keys carry the SAME user and password: true / false only
//
// Why a helper and not a careful grep: a grep, a sed or a cat of a .env line cannot be made safe by masking — the mask is written by hand,
// against whatever shape the value has that day, and it failed on the first try (it masked the host and printed user and password). A
// helper that never puts a value into its output cannot leak one, whatever the value looks like.
import fs from "node:fs";

const args = process.argv.slice(2);
const parse = (file) => {
  const out = new Map();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out.set(m[1], m[2].trim().replace(/^["']|["']$/g, ""));
  }
  return out;
};

if (args[0] === "--same") {
  const [, a, b, file = ".env"] = args;
  if (!a || !b) { console.error("usage: --same KEY_A KEY_B [path]"); process.exit(1); }
  const env = parse(file);
  // user and password compared as two fields: no joined string, so no separator character in this source
  const cred = (k) => {
    const v = env.get(k);
    if (v === undefined) return undefined;
    try { const u = new URL(v); return { user: u.username, pass: u.password }; } catch { return null; }
  };
  const ca = cred(a), cb = cred(b);
  if (ca === undefined || cb === undefined) { console.log(`${file}: ${ca === undefined ? a : b} is not set`); process.exit(1); }
  if (ca === null || cb === null) { console.log(`${file}: ${ca === null ? a : b} is not a URL`); process.exit(1); }
  console.log(`${file}: ${a} and ${b} carry the same user and password: ${ca.user === cb.user && ca.pass === cb.pass}`);
  process.exit(0);
}

for (const file of args.length ? args : [".env"]) {
  if (!fs.existsSync(file)) { console.log(`${file}: (no such file)`); continue; }
  console.log(`${file}: ${[...parse(file).keys()].join(" ")}`);
}
