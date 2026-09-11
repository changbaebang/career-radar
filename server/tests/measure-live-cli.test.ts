import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { REFUSALS } from "../scripts/measure-live/gate.js";
import { SYNTHETIC_EVIDENCE_SENTINEL, SYNTHETIC_JD_SENTINEL, measurementResumeText } from "../scripts/measure-live/synthetic-inputs.js";

const serverDirectory = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const script = fileURLToPath(new URL("../scripts/measure-live/cli.ts", import.meta.url));
const directories: string[] = [];
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), "career-radar-measure-"));
  directories.push(directory); return directory;
}
function cli(args: string[], env: Record<string, string> = {}) {
  const tsx = createRequire(import.meta.url).resolve("tsx");
  return spawnSync(process.execPath, ["--import", tsx, script, ...args], { cwd: serverDirectory, encoding: "utf8", env: { ...process.env, ...env }, timeout: 120_000 });
}
// The documented entry point: the root package script (which builds shared first), run through pnpm itself.
function rootScript(args: string[]) {
  const execPath = process.env.npm_execpath;
  const [command, prefix] = execPath && /\.c?js$/.test(execPath) ? [process.execPath, [execPath]] : ["pnpm", [] as string[]];
  return spawnSync(command, [...prefix, "measure:live", ...args], { cwd: repositoryRoot, encoding: "utf8", env: { ...process.env }, timeout: 180_000 });
}
const forbidden = [SYNTHETIC_JD_SENTINEL, SYNTHETIC_EVIDENCE_SENTINEL, "Lead a React team", measurementResumeText.slice(0, 40)];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("measure:live CLI (dry run only; approvals are refused under the test runner)", () => {
  it("runs the full dry run by default with no approvals, no network and no key", () => {
    const run = cli(["--no-save"], { OPENAI_API_KEY: "" });
    expect(run.status, run.stderr).toBe(0);
    const summary = JSON.parse(run.stdout);
    expect(summary).toMatchObject({ mode: "dry-run", status: "complete", exitCode: 0, modelCalls: 10, reconciliation: { errors: [] } });
    expect(summary.runs.map((r: { runId: string; skipped?: string }) => [r.runId, r.skipped ?? null])).toEqual([["A-production-deadline", null], ["B-retry", "nothing_to_retry"]]);
    for (const fragment of forbidden) { expect(run.stdout).not.toContain(fragment); expect(run.stderr).not.toContain(fragment); }
  });

  it("saves report.json, report.md and issue-comment.md as 0o600 under a 0o700 directory, and keeps text out of them", () => {
    const output = join(temporary(), "run");
    const run = cli(["--scenario", "fail-at-3", "--output", output]);
    expect(run.status, run.stderr).toBe(0);
    expect(statSync(output).mode & 0o777).toBe(0o700);
    expect(readdirSync(output).sort()).toEqual(["issue-comment.md", "report.json", "report.md"]);
    for (const name of readdirSync(output)) {
      expect(statSync(join(output, name)).mode & 0o777).toBe(0o600);
      const text = readFileSync(join(output, name), "utf8");
      for (const fragment of forbidden) expect(text).not.toContain(fragment);
    }
    const report = JSON.parse(readFileSync(join(output, "report.json"), "utf8"));
    expect(report).toMatchObject({ reportKind: "live-batch-measurement", mode: "dry-run", inputs: { scenario: "fail-at-3" }, billing: { monetaryCostConfirmed: false } });
    expect(report.runs[0].totals).toMatchObject({ completed: 2, failed: 1, notAttempted: 2 });
    expect(cli(["--output", output]).status).toBe(2);
  });

  it("--inspect keeps drafts and the SQLite file under inspection/, separate from the report", () => {
    const output = join(temporary(), "run");
    const run = cli(["--inspect", "--output", output]);
    expect(run.status, run.stderr).toBe(0);
    expect(statSync(join(output, "inspection")).mode & 0o777).toBe(0o700);
    expect(existsSync(join(output, "inspection", "harness.db"))).toBe(true);
    const drafts = readdirSync(join(output, "inspection", "drafts"));
    expect(drafts.filter((f) => f.endsWith(".assessment-draft.json"))).toHaveLength(5);
    expect(readFileSync(join(output, "inspection", "drafts", drafts[0]!), "utf8")).toContain("SYNTHETIC");
    expect(readFileSync(join(output, "report.json"), "utf8")).not.toContain(SYNTHETIC_EVIDENCE_SENTINEL);
  });

  it.each([[{ CI: "1" }], [{ GITHUB_ACTIONS: "true" }], [{ CAREER_RADAR_DB_PATH: "/tmp/app.db" }], [{ OPENAI_BASE_URL: "https://synthetic-review.invalid/v1" }]])("refuses live approvals under %j before any search or key access", (env) => {
    const run = cli(["--approve-network", "--approve-model-cost"], env);
    expect(run.status).toBe(2);
    expect(run.stderr.trim()).toMatch(/^Refused/);
    expect(run.stdout).toBe("");
  });

  it("refuses under the test runner's own environment too", () => {
    const run = cli(["--approve-network", "--approve-model-cost"]);
    expect(run.status).toBe(2);
    expect(run.stderr.trim()).toBe(REFUSALS.ciEnvironment);
  });

  it.each([[["--approve-model-cost"], REFUSALS.costWithoutNetwork], [["--bogus"], REFUSALS.unknownOption], [["--scenario", "stall"], REFUSALS.stallNeedsShortDeadline],
    [["--approve-network", "--no-save"], REFUSALS.dryRunOnlyFlags]])("rejects %j with a fixed message", (args, message) => {
    const run = cli(args);
    expect(run.status).toBe(2);
    expect(run.stderr.trim()).toBe(message);
  });

  it("the documented root command reaches the CLI: --help, default execution and option pass-through", () => {
    const help = rootScript(["--help"]);
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain("environment variables can refuse, never grant");
    const run = rootScript(["--scenario", "fail-at-3", "--no-save"]);
    expect(run.status, run.stderr).toBe(0);
    const summary = JSON.parse(run.stdout.slice(run.stdout.indexOf("{"), run.stdout.lastIndexOf("}") + 1));
    expect(summary).toMatchObject({ mode: "dry-run", status: "complete", modelCalls: 11 });
    expect(summary.runs[0].totals).toMatchObject({ modelCalls: 6, completed: 2, failed: 1, notAttempted: 2 });
  });

  it("writes a partial report holding every call of the batch in progress when interrupted", async () => {
    const output = join(temporary(), "run");
    const tsx = createRequire(import.meta.url).resolve("tsx");
    const child = spawn(process.execPath, ["--import", tsx, script, "--scenario", "stall", "--deadline-ms", "5000", "--settle-wait-ms", "100", "--output", output],
      { cwd: serverDirectory, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    await new Promise<void>((resolve, reject) => {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { stderr += chunk; if (stderr.includes("Run A:")) resolve(); });
      child.once("exit", () => reject(new Error(`exited before run A started: ${stderr}`)));
    });
    await new Promise((resolve) => setTimeout(resolve, 400)); // candidate 1 extracted and assessed; candidate 2's extraction is stalled
    child.kill("SIGINT");
    const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    expect(code).toBe(130);
    const report = JSON.parse(readFileSync(join(output, "report.json"), "utf8"));
    expect(report).toMatchObject({ status: "incomplete", interrupted: true, exitCode: 130 });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({ runId: "A-production-deadline", recommendOutcome: "interrupted", totals: { modelCalls: 3, completed: 1 } });
    expect(report.runs[0].operations.map((op: { operation: string; status: string }) => [op.operation, op.status])).toEqual([["extractJob", "ok"], ["assess", "ok"], ["extractJob", "unsettled"]]);
    expect(report.runs[0].candidates.map((c: { outcome: string }) => c.outcome)).toEqual(["completed", "interrupted", "not_attempted", "not_attempted", "not_attempted"]);
    expect(report.reconciliation).toMatchObject({ measuredOps: 3, unsettledOps: 1 });
    expect(report.interruptionNote).toContain("batch in progress");
    for (const name of ["report.json", "report.md", "issue-comment.md"]) for (const fragment of forbidden) expect(readFileSync(join(output, name), "utf8")).not.toContain(fragment);
  });

  it("prints help and exits 0", () => {
    const run = cli(["--help"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("--approve-network --approve-model-cost");
    expect(run.stdout).toContain("environment variables can refuse, never grant");
  });
});
