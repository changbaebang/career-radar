import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { RetrievalReportSchema } from "../../evals/retrieval.js";

const serverDirectory = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("../../evals/run-retrieval.ts", import.meta.url));
const directories: string[] = [];
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), "career-radar-retrieval-"));
  directories.push(directory); return directory;
}
function cli(args: string[]) {
  const tsx = createRequire(import.meta.url).resolve("tsx");
  return spawnSync(process.execPath, ["--import", tsx, script, ...args], { cwd: serverDirectory, encoding: "utf8" });
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("eval:retrieval CLI (synthetic corpus, no model)", () => {
  it("prints help and exits 0", () => {
    const result = cli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pnpm eval:retrieval");
  });

  it("runs without saving and prints the aggregate view only", () => {
    const result = cli(["--no-save"]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({ reportKind: "retrieval-evaluation", modelCalls: 0, success: true, deterministic: true, problems: [] });
    expect(output.reportDirectory).toBeUndefined();
    for (const entry of output.chunkers) expect(entry.results).toBeUndefined();
  });

  it("saves a strict JSON report and a Markdown view into a new private directory", () => {
    const output = join(temporary(), "run");
    const result = cli(["--output", output]);
    expect(result.status).toBe(0);
    const report = RetrievalReportSchema.parse(JSON.parse(readFileSync(join(output, "report.json"), "utf8")));
    expect(report.chunkers).toHaveLength(2);
    expect(report.chunkers[0]!.results.length).toBe(report.queries);
    expect(readFileSync(join(output, "report.md"), "utf8")).toContain("# Career Radar retrieval evaluation (lexical)");
    expect(statSync(output).mode & 0o777).toBe(0o700);
    expect(statSync(join(output, "report.json")).mode & 0o777).toBe(0o600);
  });

  it("refuses an existing output directory and unknown options with fixed messages", () => {
    const existing = temporary();
    expect(cli(["--output", existing]).status).toBe(2);
    const unknown = cli(["--bogus"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("Unknown option or missing value. Use --help.");
    expect(cli(["--output", "x", "--no-save"]).stderr).toContain("--output cannot be combined with --no-save");
  });
});
