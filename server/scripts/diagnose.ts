import { loadLocalEnv, resolveTraceDirectory } from "../src/config.js";
import { TraceStore } from "../src/domain/trace/store.js";
import { renderTrace, renderTraceList } from "../src/domain/trace/render.js";

// `pnpm diagnose <runId>` prints the stage table of one M5-E run trace; `pnpm diagnose --list`
// lists the traces on disk. Traces hold counts, hashes, ids, timings and fixed classes only, so the
// output can be pasted into an issue as it is. Exit 0 printed, 1 not found, 2 usage or traces off.
loadLocalEnv();
const directory = resolveTraceDirectory();
const argument = process.argv[2];
if (!argument || argument === "--help") {
  console.log("pnpm diagnose <runId> | --list\nReads data/traces (CAREER_RADAR_TRACE_DIR) written by the server; CAREER_RADAR_TRACES=off means nothing is written.");
  process.exitCode = argument ? 0 : 2;
} else if (!directory) {
  console.error("Run traces are off (CAREER_RADAR_TRACES=off); nothing to read.");
  process.exitCode = 2;
} else {
  const store = new TraceStore(directory);
  if (argument === "--list") {
    console.log(renderTraceList(store.list(), directory));
  } else {
    const trace = store.get(argument);
    if (!trace) { console.error("No trace with that run id under the trace directory (ids are UUIDs)."); process.exitCode = 1; }
    else console.log(renderTrace(trace));
  }
}
