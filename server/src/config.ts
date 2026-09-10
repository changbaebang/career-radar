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
