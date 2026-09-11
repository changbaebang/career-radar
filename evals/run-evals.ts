import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { policyCases } from "./dataset.js";
import { digest, runEvaluation } from "./evaluate.js";
import { compareReports, renderMarkdown } from "./report.js";

const root = fileURLToPath(new URL("../", import.meta.url));
function main() {
  let output: string | undefined, baseline: string | undefined, save = true;
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("pnpm eval [--output NEW_DIRECTORY] [--baseline REPORT_JSON] [--no-save]\nPaths are relative to repository root. Policy-only; no model, DB, or network access. Exit 0: no failed/error cases (skips are reported, not failures); 1: failed/error/empty run; 2: invalid command/baseline or no comparable cases.");
    return;
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--no-save") { save = false; continue; }
    if ((arg === "--output" || arg === "--baseline") && args[i + 1] && !args[i + 1].startsWith("--")) {
      const value = resolve(root, args[++i]);
      if (arg === "--output") output = value; else baseline = value;
    } else throw new Error("Unknown option or missing value. Use --help. Model mode is not implemented.");
  }
  if (!save && output) throw new Error("--output cannot be combined with --no-save");
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  // Outside a Git checkout (tarball, export) the evaluation still runs; the report says so.
  let codeSha = "unknown", dirty = true;
  try { codeSha = git(["rev-parse", "HEAD"]); dirty = git(["status", "--porcelain"]) !== ""; } catch { /* not a git checkout */ }
  const report = runEvaluation(policyCases, {
    codeSha, dirty,
    policyHash: digest(readFileSync(resolve(root, "server/src/domain/assessment/policy.ts"), "utf8")),
    schemaHash: digest(readFileSync(resolve(root, "packages/shared/src/index.ts"), "utf8")),
  });
  let comparison;
  if (baseline) {
    if (statSync(baseline).size > 5_000_000) throw new Error("Baseline exceeds 5 MB");
    comparison = compareReports(report, JSON.parse(readFileSync(baseline, "utf8")));
  }
  let reportDirectory: string | undefined;
  if (save) {
    reportDirectory = output ?? resolve(root, "evals/reports", `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`);
    mkdirSync(dirname(reportDirectory), { recursive: true });
    mkdirSync(reportDirectory, { mode: 0o700 });
    writeFileSync(resolve(reportDirectory, "report.json"), `${JSON.stringify({ ...report, comparison }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    writeFileSync(resolve(reportDirectory, "report.md"), renderMarkdown(report, comparison), { flag: "wx", mode: 0o600 });
  }
  console.log(JSON.stringify({ ...report, cases: undefined, reportDirectory, comparison }, null, 2));
  process.exitCode = comparison && !comparison.compatible ? 2 : report.success && !comparison?.regressions.length ? 0 : 1;
}

try { main(); }
catch (error) {
  // Do not print untrusted JSON, Zod issues, or arbitrary exception payloads.
  const allowed = error instanceof Error && [
    "Unknown option or missing value. Use --help. Model mode is not implemented.",
    "--output cannot be combined with --no-save", "Baseline exceeds 5 MB",
    "Baseline has no case-level results (legacy reports cannot be compared)",
    "Baseline uses an older report version; generate a new baseline",
  ].includes(error.message);
  console.error(allowed ? error.message : "Evaluation could not complete. Check arguments, baseline format, Git checkout, and output permissions; output directories must be new.");
  process.exitCode = 2;
}
