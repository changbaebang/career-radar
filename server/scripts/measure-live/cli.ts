import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VERSION as OPENAI_SDK_VERSION } from "openai/version";
import { DEFAULT_OPENAI_MODEL, OpenAICareerAnalyzer, PROMPT_VERSION, type CareerAnalyzer } from "../../src/ai/analyzer.js";
import { loadLocalEnv } from "../../src/config.js";
import { JobDiscovery } from "../../src/domain/jobs/search.js";
import { CareerStore } from "../../src/domain/store.js";
import { GreenhouseJobSearchProvider, type JobSearchProvider } from "../../src/infra/search/greenhouse.js";
import { FakeCareerAnalyzer } from "./fake-analyzer.js";
import { HELP, REFUSALS, confirmationAccepted, parseArgs, plannedMaxWallMs, resolveMode, type GateEnv, type Options } from "./gate.js";
import { MeasuredAnalyzer } from "./measured-analyzer.js";
import { ISSUE_URL, assertRedacted, buildReport, createReportDirectory, renderIssueComment, renderMarkdown, reportInputs, searchSection, writeReport, type Approvals, type Provenance } from "./report.js";
import { performSearch, recordingProvider, runMeasurement, type RunDeps, type RunRecord, type RunState } from "./run.js";
import { createFixtureProvider, measurementProfile, measurementResumeText } from "./synthetic-inputs.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

// Read before anything else: an env file loaded later must not be able to grant approval.
const gateEnv: GateEnv = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS, VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV, CAREER_RADAR_DB_PATH: process.env.CAREER_RADAR_DB_PATH };

const ALLOWED_MESSAGES = new Set<string>([...Object.values(REFUSALS), "Selected candidate IDs are not present in the search result.",
  "The search returned no candidates to measure.", "Set OPENAI_API_KEY in .env.local before a live run.", "Declined; 0 model calls made.", "Report redaction failed."]);

function sha256(path: string): string { return createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex"); }

function provenance(requestedModel: string): Provenance {
  let codeSha = "unknown", dirty = true;
  try {
    const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    codeSha = git(["rev-parse", "HEAD"]); dirty = git(["status", "--porcelain"]) !== "";
  } catch { /* not a git checkout */ }
  return {
    codeSha, dirty,
    hashes: { analyzer: sha256("server/src/ai/analyzer.ts"), search: sha256("server/src/domain/jobs/search.ts"), policy: sha256("server/src/domain/assessment/policy.ts"), schema: sha256("packages/shared/src/index.ts") },
    openaiSdkVersion: OPENAI_SDK_VERSION, nodeVersion: process.version,
    promptVersion: PROMPT_VERSION, defaultModel: DEFAULT_OPENAI_MODEL, requestedModel,
  };
}

function reportDirectory(options: Options, mode: "live" | "dry-run"): string {
  if (options.output) return resolve(options.output); // relative to the current directory, like pnpm eval
  return resolve(root, "evals/reports", `${mode}-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`);
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(HELP); return 0; }
  const candidateCount = options.candidateIds?.length ?? Math.min(5, options.limit);
  const resolution = resolveMode(options, gateEnv, candidateCount);
  if (resolution.refusal) throw new Error(resolution.refusal);
  if (options.output && existsSync(resolve(options.output))) throw new Error(REFUSALS.outputExists);
  const mode = resolution.mode;
  const clock = () => performance.now();
  const startedAt = new Date().toISOString();
  const log = (line: string) => console.error(line);

  const rawProvider: JobSearchProvider = mode === "dry-run" ? createFixtureProvider(candidateCount) : new GreenhouseJobSearchProvider();
  const provider = recordingProvider(rawProvider);
  const discoveryFactory = (deadlineMs: number) => new JobDiscovery(provider, undefined, { deadlineMs });
  const discovery = discoveryFactory(options.deadlineMs);
  const context = await performSearch(discovery, provider, options, clock);
  const plan = resolveMode(options, gateEnv, context.selectedIds.length);
  if (plan.refusal) throw new Error(plan.refusal);

  if (mode === "search-only") {
    console.log(JSON.stringify({ mode, search: searchSection(context), plan: { upperBound: plan.upperBound, breakdown: plan.breakdown, cap: plan.cap }, modelCalls: 0 }, null, 2));
    discovery.close();
    return 0;
  }

  let approvals: Approvals = { network: options.approveNetwork, modelCost: options.approveModelCost, confirmedVia: "none", maxModelCalls: plan.cap, plannedUpperBound: plan.upperBound, planBreakdown: plan.breakdown };
  const forbidden: string[] = [measurementResumeText, ...context.hits.flatMap((h) => [h.description, ...h.description.split("\n").filter((l) => l.length >= 40)])];
  let inner: CareerAnalyzer;
  const hookTarget: { current?: MeasuredAnalyzer } = {};
  let requestedModel = "synthetic-no-model";

  if (mode === "live") {
    if (Date.parse(context.search.expiresAt) - Date.now() < plannedMaxWallMs(options)) throw new Error(REFUSALS.wallTime);
    log([
      "Live measurement plan", `  board: ${options.boardToken}   searchId: ${context.search.searchId}   expiresAt: ${context.search.expiresAt}`,
      ...context.hits.filter((h) => context.selectedIds.includes(h.candidate.candidateId)).map((h) => `  candidate: ${h.candidate.candidateId} — ${h.candidate.title} — ${h.candidate.location} — ${h.description.length} chars`),
      `  model: OPENAI_MODEL from .env.local if set, else ${DEFAULT_OPENAI_MODEL} (read only after confirmation)`,
      `  prompt version: ${PROMPT_VERSION}`,
      `  runs: A-production-deadline (${options.deadlineMs} ms) → B-retry (${options.retryMode})${options.forcedAbortMs !== undefined ? ` → C-forced-abort (${options.forcedAbortMs} ms)` : ""}${options.includeProfileExtraction ? " + profile extraction" : ""}`,
      `  model-call upper bound: ${plan.upperBound}   cap: ${plan.cap}   settle wait: ${options.settleWaitMs} ms`,
      "  These public job descriptions and the synthetic profile will be transmitted to api.openai.com.",
      "  No dollar estimate is computed; confirm cost in the OpenAI usage dashboard for the run window.",
      `Type the cap number (${plan.cap}) to approve at most ${plan.cap} paid Responses API calls:`,
    ].join("\n"));
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
    let line: string;
    try {
      // A closed or empty stdin never answers question(); treat end-of-input as a decline.
      line = await Promise.race([rl.question(""), new Promise<string>((resolve) => rl.once("close", () => resolve("")))]);
    } finally { rl.close(); }
    if (!confirmationAccepted(line, plan.cap)) { console.error("Declined; 0 model calls made."); return 3; }
    approvals = { ...approvals, confirmedVia: process.stdin.isTTY ? "stdin-tty" : "stdin-pipe", confirmedAt: new Date().toISOString() };
    loadLocalEnv();
    if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("Set OPENAI_API_KEY in .env.local before a live run.");
    requestedModel = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
    forbidden.push(process.env.OPENAI_API_KEY);
    const analyzer = new OpenAICareerAnalyzer({ onResponse: (event) => hookTarget.current?.onResponseEvent(event) });
    delete process.env.OPENAI_API_KEY;
    inner = analyzer;
  } else {
    inner = new FakeCareerAnalyzer(options.scenario ?? "ok");
  }
  const measured = new MeasuredAnalyzer(inner, { cap: plan.cap, clock, hits: context.hits, allowProfileExtraction: options.includeProfileExtraction });
  hookTarget.current = measured;

  const directory = options.save ? reportDirectory(options, mode) : undefined;
  const inspection = options.inspect && directory ? join(directory, "inspection") : undefined;
  if (directory) createReportDirectory(directory);
  if (inspection) mkdirSync(inspection, { mode: 0o700 });
  const tempDir = inspection ? undefined : mkdtempSync(join(tmpdir(), "career-radar-measure-"));
  const store = new CareerStore(join(inspection ?? tempDir!, "harness.db"));
  store.upsertProfile(measurementProfile);
  const prov = provenance(requestedModel);
  const inputs = reportInputs(options, context.selectedIds, mode);

  let state: RunState | undefined; let interrupted = false; let exitCode = 0;
  const finishedRuns: RunRecord[] = [];
  const emit = (final: boolean) => {
    const report = buildReport({ mode, state: state ?? (finishedRuns.length ? { search: context, runs: finishedRuns, reconciliation: { hookJoinedOps: 0, measuredOps: 0, joinMismatches: 0, mappingErrors: 0, cacheInconsistencies: 0, classificationConflicts: 0, unsettledOps: 0, errors: [] } } : undefined),
      startedAt, ...(final ? { finishedAt: new Date().toISOString() } : {}), generatedAt: new Date().toISOString(), provenance: prov, approvals, inputs, interrupted, exitCode, searchCandidates: searchSection(context) });
    const markdown = renderMarkdown(report); const comment = renderIssueComment(report);
    const forbiddenValues = [...forbidden, ...draftProse(measured)];
    assertRedacted(JSON.stringify(report) + markdown + comment, forbiddenValues);
    if (directory) writeReport(directory, report, markdown, comment);
    return report;
  };
  const stop = () => { interrupted = true; exitCode = 130; try { emit(true); } catch { /* best effort */ } store.close(); discovery.close(); process.exit(130); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);

  try {
    const deps: RunDeps = { provider, measured, store, profile: measurementProfile, clock, now: () => new Date(), discoveryFactory, log,
      ...(options.includeProfileExtraction ? { resumeText: measurementResumeText } : {}), onRunFinished: (r) => finishedRuns.push(r) };
    state = await runMeasurement(deps, context, options);
    if (state.reconciliation.errors.length) exitCode = 1;
    if (inspection) {
      const draftsDir = join(inspection, "drafts"); mkdirSync(draftsDir, { mode: 0o700 });
      for (const run of state.runs) for (const c of run.candidates) {
        const assessOp = [...run.operations].reverse().find((op) => op.candidateId === c.candidateId && op.operation === "assess" && op.status === "ok");
        const draft = assessOp ? measured.drafts.get(assessOp.seq) : undefined;
        if (draft) writeFileSync(join(draftsDir, `${run.runId}.${c.candidateId}.assessment-draft.json`), `${JSON.stringify(draft, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        const job = store.getJob(c.jobId);
        if (job) writeFileSync(join(draftsDir, `${run.runId}.${c.candidateId}.extraction.json`), `${JSON.stringify(job, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      }
    }
    const report = emit(true);
    console.log(JSON.stringify({ mode, status: report.status, exitCode, reportDirectory: directory, modelCalls: measured.calls,
      runs: report.runs.map((r) => ({ runId: r.runId, skipped: r.skipped, totalDurationMs: r.totalDurationMs, aborted: r.aborted, totals: r.totals })),
      budgetObservation: report.budgetObservation, reconciliation: report.reconciliation, usage: report.runs[0]?.totals.usage ?? null, issueUrl: ISSUE_URL }, null, 2));
    return exitCode;
  } finally {
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    store.close(); discovery.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

function draftProse(measured: MeasuredAnalyzer): string[] {
  const values: string[] = [];
  for (const draft of measured.drafts.values()) {
    values.push(draft.recommendation, ...draft.interviewRisks, ...draft.missingInformation,
      ...draft.strongestMatches.flatMap((m) => [m.evidence, m.requirement]), ...[...draft.gaps, ...draft.hardBlockers].flatMap((g) => [g.reason, g.requirement]));
  }
  return values;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    const message = error instanceof Error && ALLOWED_MESSAGES.has(error.message) ? error.message
      : "Measurement could not complete. Check arguments, environment, key and output directory; no untrusted content is printed.";
    console.error(message);
    process.exitCode = 2;
  });
}
