import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { RunTracer } from "../src/domain/trace/run-trace.js";
import { TraceStore } from "../src/domain/trace/store.js";

const serverDirectory = fileURLToPath(new URL("../", import.meta.url));
const directories: string[] = [];
const temporary = () => { const d = mkdtempSync(join(tmpdir(), "career-radar-trace-cli-")); directories.push(d); return d; };
afterEach(() => { for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }); });
function run(script: string, args: string[], env: Record<string, string>) {
  const tsx = createRequire(import.meta.url).resolve("tsx");
  return spawnSync(process.execPath, ["--import", tsx, join(serverDirectory, "scripts", script), ...args], { cwd: serverDirectory, encoding: "utf8", env: { ...process.env, ...env } });
}

describe("pnpm diagnose / traces:clear / db:reset (trace files)", () => {
  it("prints a trace by id, lists traces, and refuses unknown ids and disabled traces", () => {
    const directory = temporary();
    const tracer = new RunTracer("job_assess");
    new TraceStore(directory).save(tracer.finish("ok"));
    const shown = run("diagnose.ts", [tracer.runId], { CAREER_RADAR_TRACE_DIR: directory });
    expect(shown.status).toBe(0);
    expect(shown.stdout).toContain(`run ${tracer.runId}  tool job_assess`);
    const listed = run("diagnose.ts", ["--list"], { CAREER_RADAR_TRACE_DIR: directory });
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain("1 run trace(s)");
    expect(run("diagnose.ts", ["00000000-0000-4000-8000-000000000000"], { CAREER_RADAR_TRACE_DIR: directory }).status).toBe(1);
    expect(run("diagnose.ts", [tracer.runId], { CAREER_RADAR_TRACE_DIR: directory, CAREER_RADAR_TRACES: "off" }).status).toBe(2);
    expect(run("diagnose.ts", [], { CAREER_RADAR_TRACE_DIR: directory }).status).toBe(2);
    expect(run("diagnose.ts", ["--help"], { CAREER_RADAR_TRACE_DIR: directory }).status).toBe(0);
  });

  it("removes trace files with traces:clear and alongside db:reset", () => {
    const directory = temporary();
    const store = new TraceStore(directory);
    store.save(new RunTracer("job_assess").finish("ok")); store.save(new RunTracer("job_recommend").finish("ok"));
    const cleared = run("clear-traces.ts", [], { CAREER_RADAR_TRACE_DIR: directory });
    expect(cleared.status).toBe(0);
    expect(cleared.stdout).toContain("Removed 2 run trace file(s)");
    expect(readdirSync(directory)).toEqual([]);
    store.save(new RunTracer("job_assess").finish("ok"));
    const reset = run("reset-db.ts", [], { CAREER_RADAR_TRACE_DIR: directory, CAREER_RADAR_DB_PATH: join(temporary(), "none.db") });
    expect(reset.status).toBe(0);
    expect(reset.stdout).toContain("Nothing to reset");
    expect(reset.stdout).toContain("Removed 1 run trace file(s)");
    expect(readdirSync(directory)).toEqual([]);
  });
});
