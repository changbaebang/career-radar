import { existsSync } from "node:fs";
import { loadLocalEnv, resolveDatabasePath, resolveTraceDirectory } from "../src/config.js";
import { CareerStore } from "../src/domain/store.js";
import { TraceStore } from "../src/domain/trace/store.js";

// Owner-initiated wipe of the local database (profiles, jobs, assessments, applications, events)
// and of the M5-E run trace files next to it.
// Stop the server first. Uses the same .env.local / CAREER_RADAR_DB_PATH resolution as `pnpm dev`.
loadLocalEnv();
const databasePath = resolveDatabasePath();
if (!existsSync(databasePath)) {
  console.log(`No database at ${databasePath}. Nothing to reset.`);
} else {
  const store = new CareerStore(databasePath);
  try { store.reset(); } finally { store.close(); }
  console.log(`Cleared all Career Radar records in ${databasePath}. The file was vacuumed; delete it and its -wal/-shm siblings if you want no trace.`);
}
const traceDirectory = resolveTraceDirectory();
if (traceDirectory) console.log(`Removed ${new TraceStore(traceDirectory).clear()} run trace file(s) from ${traceDirectory}.`);
