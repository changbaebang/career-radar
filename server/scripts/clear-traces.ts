import { loadLocalEnv, resolveTraceDirectory } from "../src/config.js";
import { TraceStore } from "../src/domain/trace/store.js";

// Owner-initiated removal of every M5-E run trace file. `pnpm db:reset` does the same alongside the
// database; this script removes only the traces.
loadLocalEnv();
const directory = resolveTraceDirectory();
if (!directory) console.log("Run traces are off (CAREER_RADAR_TRACES=off); nothing to clear.");
else console.log(`Removed ${new TraceStore(directory).clear()} run trace file(s) from ${directory}.`);
