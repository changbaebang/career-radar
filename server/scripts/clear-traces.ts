import { loadLocalEnv, traceDirectory } from "../src/config.js";
import { TraceStore } from "../src/domain/trace/store.js";

// Owner-initiated removal of every M5-E run trace file. `pnpm db:reset` does the same alongside the
// database; this script removes only the traces. CAREER_RADAR_TRACES=off stops new writes only, so
// removal always resolves the configured directory.
loadLocalEnv();
const directory = traceDirectory();
console.log(`Removed ${new TraceStore(directory).clear()} run trace file(s) from ${directory}.`);
