// src/config.ts — the one place environment is read. Everything else takes a Config.
//
// Reads .env from the repo root if present (never committed), then the process environment
// wins. Missing required values fail at startup with the variable NAMED, because a service
// that starts half-configured is the worst of the three states (CLAUDE.md §9).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Config = {
  DATABASE_URL: string;
  /** the throwaway database for tests/db; its name must end in `_test` (see src/store/db.ts) */
  DATABASE_URL_TEST?: string;
  PORT: number;
  HOST: string;
  PUBLIC_BASE_URL: string;
  IMAGE_DIR: string;
  CACHE_DIR: string;
  RUNS_DIR: string;
  LOG_LEVEL: string;
};

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readDotEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    // .env files store KEY="value"; the quotes are not part of the value (CLAUDE.md §8)
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

let cached: Config | null = null;

export function loadEnv(): Config {
  if (cached) return cached;
  const file = { ...readDotEnv(path.join(REPO_ROOT, ".env")), ...process.env } as Record<string, string | undefined>;
  const need = (k: string): string => {
    const v = file[k];
    if (!v) throw new Error(`config: ${k} is not set (put it in .env or the environment)`);
    return v;
  };
  const opt = (k: string, d: string): string => file[k] || d;
  cached = {
    DATABASE_URL: need("DATABASE_URL"),
    DATABASE_URL_TEST: file["DATABASE_URL_TEST"] || undefined,
    PORT: Number(opt("PORT", "3021")),
    HOST: opt("HOST", "127.0.0.1"),
    PUBLIC_BASE_URL: opt("PUBLIC_BASE_URL", "http://127.0.0.1:3021"),
    IMAGE_DIR: opt("IMAGE_DIR", path.join(REPO_ROOT, "runs", "images")),
    CACHE_DIR: opt("CACHE_DIR", path.join(REPO_ROOT, "scraper", "cache")),
    RUNS_DIR: opt("RUNS_DIR", path.join(REPO_ROOT, "runs")),
    LOG_LEVEL: opt("LOG_LEVEL", "info"),
  };
  return cached;
}
