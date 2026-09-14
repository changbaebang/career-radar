import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CORPUS_VERSION, corpusDocuments, corpusProfile } from "./fixtures/corpus/index.js";
import { QUERY_SET_VERSION, retrievalQueries } from "./fixtures/corpus/queries.js";
import { renderRetrievalMarkdown, runRetrievalEvaluation } from "./retrieval.js";

// pnpm eval:retrieval — M5-A lexical retrieval evaluation. Synthetic corpus only; no model, DB or
// network access. Mirrors run-evals.ts: paths resolve from the repository root, an explicit output
// directory must be new, saved reports are private to the owner.
const root = fileURLToPath(new URL("../", import.meta.url));
const USAGE = "pnpm eval:retrieval [--output NEW_DIRECTORY] [--no-save]\nPaths are relative to repository root. Lexical retrieval over the synthetic corpus; no model, DB, or network access. Exit 0: every relevance entry resolved and two runs agreed; 1: dataset problems or non-deterministic scores; 2: invalid command or output error.";
const ERRORS = {
  args: "Unknown option or missing value. Use --help.",
  outputWithNoSave: "--output cannot be combined with --no-save",
} as const;

function main() {
  let output: string | undefined, save = true;
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log(USAGE); return; }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--no-save") { save = false; continue; }
    if (arg === "--output" && args[i + 1] && !args[i + 1].startsWith("--")) { output = resolve(root, args[++i]); continue; }
    throw new Error(ERRORS.args);
  }
  if (!save && output) throw new Error(ERRORS.outputWithNoSave);
  const git = (a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  let codeSha = "unknown", dirty = true;
  try { codeSha = git(["rev-parse", "HEAD"]); dirty = git(["status", "--porcelain"]) !== ""; } catch { /* not a git checkout */ }
  const report = runRetrievalEvaluation(
    { version: CORPUS_VERSION, profile: corpusProfile, documents: corpusDocuments },
    { version: QUERY_SET_VERSION, queries: retrievalQueries },
    { codeSha, dirty },
  );
  let reportDirectory: string | undefined;
  if (save) {
    reportDirectory = output ?? resolve(root, "evals/reports", `retrieval-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`);
    mkdirSync(dirname(reportDirectory), { recursive: true });
    mkdirSync(reportDirectory, { mode: 0o700 });
    writeFileSync(resolve(reportDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    writeFileSync(resolve(reportDirectory, "report.md"), renderRetrievalMarkdown(report), { flag: "wx", mode: 0o600 });
  }
  // Per-query rows stay in the saved report; the console gets the aggregate view.
  console.log(JSON.stringify({ ...report, chunkers: report.chunkers.map((entry) => ({ ...entry, results: undefined })), reportDirectory }, null, 2));
  process.exitCode = report.success ? 0 : 1;
}

try { main(); }
catch (error) {
  const allowed = error instanceof Error && (Object.values(ERRORS) as string[]).includes(error.message);
  console.error(allowed ? error.message : "Retrieval evaluation could not complete. Check arguments, Git checkout, and output permissions; output directories must be new.");
  process.exitCode = 2;
}
