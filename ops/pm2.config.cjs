// ops/pm2.config.cjs — the PM2 ecosystem entry for the API on the Hetzner box.
//
// Why a config file and not `pm2 start dist/api/server.js`: the deploy script needs the same
// name, cwd, memory limit and environment on every restart, and PM2 remembers whatever the
// FIRST start used. A file makes the definition reviewable and `pm2 startOrRestart` re-reads it.
//
// Environment: read from /root/netzspec-api/.env with the same rules as src/config.ts (blank
// lines and # comments skipped, surrounding quotes stripped — CLAUDE.md §8: the quotes are not
// part of the value). src/config.ts reads .env itself too, so this loader is belt-and-braces;
// what it uniquely provides is GIT_SHA, which is not in .env: it comes from the deploy shell's
// environment, or from the GIT_SHA file the deploy script drops next to the tree.
//
// CommonJS (.cjs) because the package is "type": "module" and PM2 loads ecosystem files with
// require(). Nothing here needs TypeScript; keep it dependency-free.
//
// Usage (on the box):  pm2 startOrRestart /root/netzspec-api/ops/pm2.config.cjs --update-env
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = "/root/netzspec-api";

function readDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function gitSha() {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try { return fs.readFileSync(path.join(APP_DIR, "GIT_SHA"), "utf8").trim() || "unknown"; }
  catch { return "unknown"; }
}

const dotenv = readDotEnv(path.join(APP_DIR, ".env"));

module.exports = {
  apps: [
    {
      name: "netzspec-api",
      script: "dist/api/server.js",
      cwd: APP_DIR,
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      // The box is 2 vCPU / 3.8 GB shared with two Next.js sites. 400M is well above the API's
      // steady state; hitting it means a leak, and a restart beats an OOM-killed box.
      max_memory_restart: "400M",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 2000,
      kill_timeout: 8000,
      time: true,
      env: {
        ...dotenv,
        NODE_ENV: "production",
        PORT: dotenv.PORT || "3021",
        HOST: dotenv.HOST || "127.0.0.1",
        GIT_SHA: gitSha(),
      },
    },
  ],
};

// Exposed for a local sanity check (node -e 'require("./ops/pm2.config.cjs").__readDotEnv(...)');
// PM2 ignores extra exports.
module.exports.__readDotEnv = readDotEnv;
