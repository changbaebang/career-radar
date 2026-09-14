import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const serverDirectory = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("../../evals/run-evals.ts", import.meta.url));
const directories: string[] = [];
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), "career-radar-eval-"));
  directories.push(directory); return directory;
}
function cli(args: string[], cwd = serverDirectory) {
  const tsx = createRequire(import.meta.url).resolve("tsx");
  return spawnSync(process.execPath, ["--import", tsx, script, ...args], { cwd, encoding: "utf8" });
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("evaluation CLI (synthetic only)", () => {
  it("saves JSON/Markdown and compares an actual saved baseline from a different cwd", () => {
    const directory = temporary(); const output = join(directory, "run");
    const first = cli(["--output", output]);
    expect(first.status, first.stderr).toBe(0);
    const json = readFileSync(join(output, "report.json"), "utf8");
    const total = JSON.parse(json).totals.cases as number;
    expect(total).toBeGreaterThanOrEqual(35);
    expect(JSON.parse(json)).toMatchObject({ mode: "policy", modelCalls: 0, totals: { passed: total } });
    expect(readFileSync(join(output, "report.md"), "utf8")).toContain(`Human review pending: ${total}`);
    expect(statSync(join(output, "report.json")).mode & 0o777).toBe(0o600);
    const second = cli(["--baseline", join(output, "report.json"), "--no-save"], directory);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout).comparison).toMatchObject({ compatible: true, compared: total, regressions: [] });
  });

  it("refuses to overwrite a report directory", () => {
    const output = join(temporary(), "run");
    expect(cli(["--output", output]).status).toBe(0);
    const before = readFileSync(join(output, "report.json"), "utf8");
    expect(cli(["--output", output]).status).toBe(2);
    expect(readFileSync(join(output, "report.json"), "utf8")).toBe(before);
  });

  it.each([["--mode", "model"], ["--baseline"], ["--output", "unused", "--no-save"]].map((args) => ({ args })))("rejects unsupported arguments $args", ({ args }) => {
    expect(cli(args).status).toBe(2);
  });

  it("rejects legacy/malformed baselines without echoing file contents", () => {
    const file = join(temporary(), "baseline.json");
    writeFileSync(file, '{"cases":16}');
    expect(cli(["--baseline", file, "--no-save"]).status).toBe(2);
    writeFileSync(file, "PRIVATE-JSON-CONTENT");
    const invalid = cli(["--baseline", file, "--no-save"]);
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).not.toContain("PRIVATE-JSON-CONTENT");
  });

  it("returns a distinct failure for a valid but incompatible baseline", () => {
    const output = join(temporary(), "run");
    expect(cli(["--output", output]).status).toBe(0);
    const file = join(output, "report.json");
    const report = JSON.parse(readFileSync(file, "utf8"));
    report.metricVersion = "old-metrics";
    writeFileSync(file, JSON.stringify(report));
    const result = cli(["--baseline", file, "--no-save"]);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).comparison).toMatchObject({ compatible: false, incompatibleReasons: ["metricVersion"] });
  });
});
