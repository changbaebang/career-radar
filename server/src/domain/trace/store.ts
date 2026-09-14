import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunTrace } from "./run-trace.js";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isRunId = (value: string): boolean => RUN_ID.test(value);

export type TraceSummary = Pick<RunTrace, "runId" | "tool" | "startedAt" | "durationMs" | "outcome"> & { modelCalls: number };
const summarize = (trace: RunTrace): TraceSummary => ({ runId: trace.runId, tool: trace.tool, startedAt: trace.startedAt, durationMs: trace.durationMs, outcome: trace.outcome, modelCalls: trace.counters.modelCalls });

// Keeps the last `keep` traces in memory and, when a directory is given, writes each trace as
// `<runId>.json` (directory 0o700, files 0o600) so `pnpm diagnose <runId>` can read it after the
// process is gone. Traces are not database rows: `pnpm db:reset` and `pnpm traces:clear` remove them.
export class TraceStore {
  readonly directory: string | undefined;
  readonly #keep: number;
  readonly #memory = new Map<string, RunTrace>();

  constructor(directory?: string, keep = 100) { this.directory = directory; this.#keep = keep; }

  save(trace: RunTrace): void {
    this.#memory.set(trace.runId, trace);
    while (this.#memory.size > this.#keep) { const oldest = this.#memory.keys().next().value; if (oldest === undefined) break; this.#memory.delete(oldest); }
    if (!this.directory) return;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(this.directory, `${trace.runId}.json`), `${JSON.stringify(trace, null, 2)}\n`, { mode: 0o600 });
  }

  get(runId: string): RunTrace | undefined {
    if (!isRunId(runId)) return undefined;
    const cached = this.#memory.get(runId);
    if (cached) return cached;
    if (!this.directory) return undefined;
    const path = join(this.directory, `${runId}.json`);
    if (!existsSync(path) || statSync(path).size > 5_000_000) return undefined;
    try { return JSON.parse(readFileSync(path, "utf8")) as RunTrace; } catch { return undefined; }
  }

  list(): TraceSummary[] {
    const seen = new Map<string, RunTrace>(this.#memory);
    if (this.directory && existsSync(this.directory)) {
      for (const name of readdirSync(this.directory)) {
        const runId = name.replace(/\.json$/, "");
        if (!name.endsWith(".json") || !isRunId(runId) || seen.has(runId)) continue;
        const trace = this.get(runId);
        if (trace) seen.set(runId, trace);
      }
    }
    return [...seen.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.endedAt.localeCompare(a.endedAt)).map(summarize);
  }

  // Removes every trace file the store recognises (uuid-named .json only) and the memory copies.
  clear(): number {
    const removed = new Set(this.#memory.keys());
    this.#memory.clear();
    if (this.directory && existsSync(this.directory)) {
      for (const name of readdirSync(this.directory)) {
        const runId = name.replace(/\.json$/, "");
        if (name.endsWith(".json") && isRunId(runId)) { rmSync(join(this.directory, name)); removed.add(runId); }
      }
    }
    return removed.size;
  }
}
