import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Loads the gitignored repo-root .env.local when present. Missing file is not an error.
export function loadLocalEnv(): void {
  try {
    process.loadEnvFile(resolve(root, ".env.local"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export const DEFAULT_DATABASE_PATH = "data/career-radar.db";

export function resolveDatabasePath(): string {
  return resolve(root, process.env.CAREER_RADAR_DB_PATH ?? DEFAULT_DATABASE_PATH);
}

export function ensureDatabaseDirectory(databasePath: string): void {
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
}


// M5-E run traces: content-free per-call traces under data/traces by default (0o700 / 0o600 files).
// CAREER_RADAR_TRACE_DIR moves them; CAREER_RADAR_TRACES=off keeps them in memory only.
export const DEFAULT_TRACE_DIRECTORY = "data/traces";
// Where traces live, whether or not writing is currently on: removal scripts use this.
export function traceDirectory(): string {
  return resolve(root, process.env.CAREER_RADAR_TRACE_DIR ?? DEFAULT_TRACE_DIRECTORY);
}
export const tracesEnabled = (): boolean => (process.env.CAREER_RADAR_TRACES ?? "").trim().toLowerCase() !== "off";
// Where the server writes traces; undefined means memory only (CAREER_RADAR_TRACES=off).
export function resolveTraceDirectory(): string | undefined {
  return tracesEnabled() ? traceDirectory() : undefined;
}
