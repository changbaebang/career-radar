import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { goldenCases } from "../../evals/fixtures/golden/index.js";
import { HARD_MAX_MODEL_EVAL_CALLS, MODEL_REFUSALS, parseModelArgs, resolveModelGate, selectCases } from "../../evals/model-mode-cli.js";
import { CALLS_PER_CASE, ModelEvalReportSchema } from "../../evals/model-mode.js";

const serverDirectory = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("../../evals/run-evals.ts", import.meta.url));
const directories: string[] = [];
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), "career-radar-model-eval-"));
  directories.push(directory); return directory;
}
// The vitest environment (VITEST=true) is inherited on purpose: the CLI must refuse approval flags under it.
function cli(args: string[]) {
  const tsx = createRequire(import.meta.url).resolve("tsx");
  return spawnSync(process.execPath, ["--import", tsx, script, "--mode", "model", ...args], { cwd: serverDirectory, encoding: "utf8" });
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("model-mode gate (argv decides execution; the environment can only refuse)", () => {
  it("defaults to a dry run on the openrouter provider over every case", () => {
    const base = parseModelArgs([]);
    expect(base).toMatchObject({ provider: "openrouter", approveTransmission: false, approveModelCost: false, save: true, help: false });
    const upperBound = goldenCases.length * CALLS_PER_CASE;
    expect(resolveModelGate(base, {}, goldenCases.length)).toEqual({ execution: "dry-run", cap: upperBound, upperBound });
  });

  it("refuses approval flags under CI, GitHub Actions, vitest and NODE_ENV=test", () => {
    const live = parseModelArgs(["--approve-transmission"]);
    for (const env of [{ CI: "1" }, { GITHUB_ACTIONS: "true" }, { VITEST: "true" }, { NODE_ENV: "test" }]) {
      expect(resolveModelGate(live, env, 3).refusal).toBe(MODEL_REFUSALS.ciEnvironment);
    }
    expect(resolveModelGate(live, {}, 3)).toEqual({ execution: "live", cap: 9, upperBound: 9 });
  });

  it("requires --approve-model-cost for openai only, and refuses OPENAI_BASE_URL there", () => {
    expect(resolveModelGate(parseModelArgs(["--provider", "openai", "--approve-transmission"]), {}, 3).refusal).toBe(MODEL_REFUSALS.openaiNeedsCostFlag);
    const paid = parseModelArgs(["--provider", "openai", "--approve-transmission", "--approve-model-cost"]);
    expect(resolveModelGate(paid, { OPENAI_BASE_URL: "http://127.0.0.1:1" }, 3).refusal).toBe(MODEL_REFUSALS.baseUrlSet);
    expect(resolveModelGate(paid, {}, 3).refusal).toBeUndefined();
    expect(resolveModelGate(parseModelArgs(["--approve-transmission"]), { OPENAI_BASE_URL: "http://127.0.0.1:1" }, 3).refusal).toBeUndefined();
  });

  it("keeps the call cap under the hard ceiling and refuses plans above the cap", () => {
    expect(resolveModelGate(parseModelArgs(["--max-model-calls", String(HARD_MAX_MODEL_EVAL_CALLS + 1)]), {}, 1).refusal).toBe(MODEL_REFUSALS.capAboveCeiling);
    expect(resolveModelGate(parseModelArgs(["--max-model-calls", "2"]), {}, 1).refusal).toBe(MODEL_REFUSALS.planAboveCap);
    expect(resolveModelGate(parseModelArgs(["--max-model-calls", "3"]), {}, 1).refusal).toBeUndefined();
    expect(resolveModelGate(parseModelArgs([]), {}, 0).refusal).toBe(MODEL_REFUSALS.noCases);
  });

  it("rejects unknown options, bad integers, bad providers and --output with --no-save", () => {
    for (const argv of [["--bogus"], ["--limit", "0"], ["--limit", "x"], ["--provider", "other"], ["--cases"], ["--cases", ""], ["--max-model-calls", "1.5"]]) {
      expect(() => parseModelArgs(argv)).toThrow(MODEL_REFUSALS.unknownOption);
    }
    expect(() => parseModelArgs(["--output", "x", "--no-save"])).toThrow(MODEL_REFUSALS.outputWithNoSave);
  });

  it("selects by id and limit, and selects nothing when an id is unknown", () => {
    expect(selectCases(parseModelArgs(["--cases", "gm-frontend-lead-realistic,gm-korean-posting"])).map((c) => c.caseId)).toEqual(["gm-frontend-lead-realistic", "gm-korean-posting"]);
    expect(selectCases(parseModelArgs(["--limit", "2"]))).toHaveLength(2);
    expect(selectCases(parseModelArgs(["--cases", "gm-frontend-lead-realistic,nope"]))).toEqual([]);
  });
});

describe("pnpm eval --mode model (dry run with the golden fake, no network)", () => {
  it("prints model-mode help and exits 0", () => {
    const result = cli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pnpm eval --mode model");
    expect(result.stdout).toContain("--approve-transmission");
  });

  it("runs selected cases without saving and prints the aggregate view only", () => {
    const result = cli(["--cases", "gm-frontend-lead-realistic,gm-two-required-blockers", "--no-save"]);
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({ reportKind: "model-evaluation", execution: "dry-run", provider: "fake", requestedModel: "golden-fake", selectedCases: 2, modelCalls: 6, success: true, problems: [] });
    expect(output.cases).toBeUndefined();
    expect(output.reportDirectory).toBeUndefined();
    expect(result.stderr).toContain("analyzer: golden fake (no network)");
  });

  it("refuses --approve-transmission under the test environment before any provider exists", () => {
    const result = cli(["--approve-transmission", "--limit", "1", "--no-save"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(MODEL_REFUSALS.ciEnvironment);
    expect(result.stdout).toBe("");
  });

  it("saves a strict JSON report and a Markdown view into a new private directory, then compares against it", () => {
    const output = join(temporary(), "run");
    const first = cli(["--limit", "2", "--output", output]);
    expect(first.status, first.stderr).toBe(0);
    const report = ModelEvalReportSchema.parse(JSON.parse(readFileSync(join(output, "report.json"), "utf8")));
    expect(report.cases).toHaveLength(2);
    expect(readFileSync(join(output, "report.md"), "utf8")).toContain("# Career Radar model-mode evaluation");
    expect(statSync(output).mode & 0o777).toBe(0o700);
    expect(statSync(join(output, "report.json")).mode & 0o777).toBe(0o600);
    const second = cli(["--limit", "2", "--baseline", join(output, "report.json"), "--no-save"]);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout).comparison).toMatchObject({ compatible: true, compared: 2, outcomeChanged: [], verdictChanged: [] });
    const other = join(temporary(), "baseline.json");
    writeFileSync(other, JSON.stringify({ ...report, requestedModel: "some-other-model" }));
    const third = cli(["--limit", "2", "--baseline", other, "--no-save"]);
    expect(third.status).toBe(2);
    expect(JSON.parse(third.stdout).comparison).toMatchObject({ compatible: false, incompatibleReasons: ["requestedModel"], compared: 0 });
  });

  it("refuses an existing output directory, unknown options, unknown case ids, --output with --no-save and plans above the cap", () => {
    expect(cli(["--output", temporary()]).status).toBe(2);
    const unknown = cli(["--bogus"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain(MODEL_REFUSALS.unknownOption);
    expect(cli(["--cases", "nope", "--no-save"]).stderr).toContain(MODEL_REFUSALS.noCases);
    expect(cli(["--output", "x", "--no-save"]).stderr).toContain(MODEL_REFUSALS.outputWithNoSave);
    expect(cli(["--max-model-calls", "2", "--no-save"]).stderr).toContain(MODEL_REFUSALS.planAboveCap);
  });
});
