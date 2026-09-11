import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { RECOMMEND_DEADLINE_MS } from "../../src/domain/jobs/search.js";
import { HARD_MAX_MODEL_CALLS, type Options } from "./gate.js";
import type { RunState, SearchContext } from "./run.js";
import { expectedJobId, measurementProfile, measurementResumeText } from "./synthetic-inputs.js";

export const HARNESS_VERSION = "measure-live-v1";
export const REPORT_VERSION = 1;
export const ISSUE_URL = "https://github.com/changbaebang/career-radar/issues/4";
// The SDK default; the gate refuses a live run while OPENAI_BASE_URL is set, so this is the only destination.
export const HARNESS_BASE_URL = "https://api.openai.com/v1";
export const HARNESS_TRANSPORT = { maxRetries: 0, logLevel: "off" } as const;

const iso = z.string().datetime();
const count = z.number().int().nonnegative();
const usage = z.object({ inputTokens: count, outputTokens: count, totalTokens: count, cachedInputTokens: count.optional(), reasoningTokens: count.optional() }).strict();
const operation = z.object({
  seq: count, runId: z.string(), operation: z.enum(["extractProfile", "extractJob", "assess"]), candidateId: z.string(), mappingError: z.boolean(),
  startedPerf: z.number(), settledPerf: z.number().optional(), durationMs: z.number().optional(),
  status: z.enum(["ok", "error", "aborted", "unsettled", "cap_refused"]), errorClass: z.string().optional(), httpStatus: z.number().optional(),
  errorCode: z.string().optional(), requestId: z.string().optional(), responseId: z.string().optional(), responseModel: z.string().optional(),
  responseStatus: z.string().optional(), incompleteReason: z.string().optional(), usage: usage.optional(), sdkDurationMs: z.number().optional(),
  joinMismatch: z.boolean(), settledAfterBatchReturn: z.boolean(), abortToSettleMs: z.number().optional(), waitedMs: z.number().optional(),
  extraction: z.object({ requiredCount: count, preferredCount: count, coreRequiredCount: count, responsibilitiesCount: count, technologiesCount: count,
    domainsCount: count, seniorityPresent: z.boolean(), warningsCount: count }).strict().optional(),
}).strict();
const assessmentSummary = z.object({ verdict: z.string(), confidence: z.string(), resumeContortion: z.string(), scorePresent: z.boolean(),
  strongestMatches: count, gaps: count, hardBlockers: count, interviewRisks: count, missingInformation: count, hash: z.string() }).strict();
const candidate = z.object({
  candidateId: z.string(), jobId: z.string(), storeHadJobBefore: z.boolean(), extractCalled: z.boolean(), assessCalled: z.boolean(),
  category: z.enum(["extracted_and_assessed", "extraction_cache_hit_assessed", "extraction_only_then_failed", "not_attempted", "assess_rerun_of_completed", "cap_refused"]),
  outcome: z.enum(["completed", "failed", "not_attempted", "interrupted"]), classificationConflict: z.boolean(), cacheConsistent: z.boolean(), assessmentId: z.string().optional(),
  extraction: operation.shape.extraction, draft: assessmentSummary.optional(), final: assessmentSummary.optional(),
  policy: z.object({ verdictChanged: z.boolean(), confidenceChanged: z.boolean(), removedUngroundedMatches: count, promotedBlockers: count, policyReplayMatches: z.boolean() }).strict().optional(),
}).strict();
const whatIf = z.object({ cumulativeMs: z.array(z.number()), neededMs: z.object({ value: z.number(), lowerBound: z.boolean() }).strict(),
  wouldFinishWithin: z.object({ "90000": z.union([z.boolean(), z.literal("unknown")]), "120000": z.union([z.boolean(), z.literal("unknown")]),
    "180000": z.union([z.boolean(), z.literal("unknown")]), unbounded: z.union([z.boolean(), z.literal("unknown")]) }).strict(), note: z.string() }).strict();
const run = z.object({
  runId: z.enum(["A-production-deadline", "B-retry", "C-forced-abort"]), skipped: z.enum(["retry_disabled", "nothing_to_retry", "board_changed"]).optional(),
  deadlineMs: count, selectedIds: z.array(z.string()), startedAt: iso, totalDurationMs: count, recommendOutcome: z.enum(["returned", "threw", "skipped", "interrupted"]),
  errorClass: z.string().optional(), aborted: z.boolean(),
  abort: z.object({ abortAtOffsetMs: z.number(), abortToBatchReturnMs: z.number(), inFlightOp: z.object({ seq: count, operation: z.string(), candidateId: z.string() }).strict().optional(),
    abortToSettleMs: z.number().optional(), settledAfterBatchReturn: z.boolean().optional() }).strict().optional(),
  operations: z.array(operation), candidates: z.array(candidate),
  failuresReported: z.array(z.object({ candidateId: z.string(), kind: z.enum(["failed", "not_attempted"]) }).strict()),
  warnings: z.object({ search: count, run: count, extractionDelta: count }).strict(),
  totals: z.object({ modelCalls: count, extractCalls: count, assessCalls: count, extractionCacheHits: count, extractionReruns: count, assessReruns: count,
    completed: count, failed: count, notAttempted: count, sumCallMs: count, maxCallMs: count, overheadMs: count, headroomMs: z.number(),
    usage: usage.nullable(), usageCoverage: z.object({ reported: count, total: count }).strict(), usageUnknownOps: count }).strict(),
  whatIf,
}).strict();

// Field names deliberately never include description/instructions/recommendation/evidence/reason/message/input/output.
export const LiveMeasurementReportSchema = z.object({
  reportKind: z.literal("live-batch-measurement"), reportVersion: z.literal(REPORT_VERSION), harnessVersion: z.literal(HARNESS_VERSION),
  mode: z.enum(["live", "dry-run"]), status: z.enum(["complete", "incomplete"]), interrupted: z.boolean(), exitCode: count,
  generatedAt: iso, startedAt: iso, finishedAt: iso.optional(),
  code: z.object({ codeSha: z.string(), dirty: z.boolean(), hashes: z.object({ analyzer: z.string(), search: z.string(), policy: z.string(), schema: z.string() }).strict() }).strict(),
  provider: z.object({ api: z.enum(["openai-responses", "synthetic-no-model"]), requestedModel: z.string(), responseModels: z.array(z.string()), promptVersion: z.string(),
    defaultModel: z.string(), openaiSdkVersion: z.string(), nodeVersion: z.string(), store: z.literal(false), maxRetries: z.literal(0), logLevel: z.literal("off"),
    baseUrl: z.literal(HARNESS_BASE_URL) }).strict(),
  approvals: z.object({ network: z.boolean(), modelCost: z.boolean(), confirmedVia: z.enum(["stdin-tty", "stdin-pipe", "none"]), confirmedAt: iso.optional(),
    maxModelCalls: count, hardMaxModelCalls: z.literal(HARD_MAX_MODEL_CALLS), plannedUpperBound: count, planBreakdown: z.record(z.string(), count) }).strict(),
  inputs: z.object({ profileHash: z.string(), profileRoles: count, profileSkills: count, resumeTextHash: z.string().optional(), boardToken: z.string(),
    titleKeywords: z.string().optional(), location: z.string().optional(), limit: count, candidateIds: z.array(z.string()), deadlineMs: count,
    defaultDeadlineMs: z.literal(RECOMMEND_DEADLINE_MS), forcedAbortMs: count.optional(), retryMode: z.enum(["failed-only", "all", "none"]),
    settleWaitMs: count, scenario: z.string().optional() }).strict(),
  search: z.object({ searchId: z.string(), provider: z.string(), sourceUrl: z.string(), retrievedAt: iso, expiresAt: iso, matchedCount: count, durationMs: count, warningsCount: count,
    candidates: z.array(z.object({ candidateId: z.string(), title: z.string(), location: z.string(), sourceUrl: z.string(), updatedAt: iso.optional(),
      descriptionLength: count, descriptionSha256: z.string(), jobId: z.string() }).strict()) }).strict(),
  profileExtraction: operation.optional(),
  runs: z.array(run),
  reconciliation: z.object({ hookJoinedOps: count, measuredOps: count, joinMismatches: count, mappingErrors: count, cacheInconsistencies: count,
    classificationConflicts: count, unsettledOps: count, errors: z.array(z.string()) }).strict(),
  billing: z.object({ source: z.literal("response.usage counters only"), monetaryCostConfirmed: z.literal(false), billedAmount: z.null(), currency: z.null(), note: z.string() }).strict(),
  budgetObservation: z.object({ deadlineMs: count, defaultDeadlineMs: z.literal(RECOMMEND_DEADLINE_MS), finishedWithinDeadline: z.union([z.boolean(), z.literal("n/a")]),
    totalDurationMs: count, headroomMs: z.number(), perOperationMs: z.object({ extractJob: z.array(z.number()), assess: z.array(z.number()) }).strict(),
    sampleSize: count, runsRequiredBeforeDecision: z.literal(3) }).strict(),
  decision: z.object({ recommendedDeadlineMs: z.null(), owner: z.string() }).strict(),
  links: z.object({ issueUrl: z.string(), budgetStatedIn: z.array(z.string()), relatedTests: z.array(z.string()) }).strict(),
  excluded: z.array(z.string()), interruptionNote: z.string().optional(),
}).strict();
export type LiveMeasurementReport = z.infer<typeof LiveMeasurementReportSchema>;

export type Provenance = { codeSha: string; dirty: boolean; hashes: { analyzer: string; search: string; policy: string; schema: string };
  openaiSdkVersion: string; nodeVersion: string; promptVersion: string; defaultModel: string; requestedModel: string };
export type Approvals = { network: boolean; modelCost: boolean; confirmedVia: "stdin-tty" | "stdin-pipe" | "none"; confirmedAt?: string;
  maxModelCalls: number; plannedUpperBound: number; planBreakdown: Record<string, number> };
export type ReportInputs = LiveMeasurementReport["inputs"];

// Public search metadata plus a hash and length of each description; never the description itself.
export function searchSection(context: SearchContext): LiveMeasurementReport["search"] {
  return {
    searchId: context.search.searchId, provider: context.search.provider, sourceUrl: context.search.sourceUrl, retrievedAt: context.search.retrievedAt,
    expiresAt: context.search.expiresAt, matchedCount: context.search.matchedCount, durationMs: Math.round(context.searchDurationMs), warningsCount: context.search.warnings.length,
    candidates: context.hits.map((hit) => ({ candidateId: hit.candidate.candidateId, title: hit.candidate.title, location: hit.candidate.location, sourceUrl: hit.candidate.sourceUrl,
      ...(hit.candidate.updatedAt ? { updatedAt: hit.candidate.updatedAt } : {}), descriptionLength: hit.description.length,
      descriptionSha256: createHash("sha256").update(hit.description).digest("hex"), jobId: expectedJobId(hit) })),
  };
}

export function reportInputs(options: Options, selectedIds: string[], mode: "live" | "dry-run"): ReportInputs {
  return {
    profileHash: createHash("sha256").update(JSON.stringify(measurementProfile)).digest("hex"), profileRoles: measurementProfile.roles.length, profileSkills: measurementProfile.skills.length,
    ...(options.includeProfileExtraction ? { resumeTextHash: createHash("sha256").update(measurementResumeText).digest("hex") } : {}),
    boardToken: options.boardToken, ...(options.titleKeywords ? { titleKeywords: options.titleKeywords } : {}), ...(options.location ? { location: options.location } : {}),
    limit: options.limit, candidateIds: selectedIds, deadlineMs: options.deadlineMs, defaultDeadlineMs: RECOMMEND_DEADLINE_MS,
    ...(options.forcedAbortMs !== undefined ? { forcedAbortMs: options.forcedAbortMs } : {}), retryMode: options.retryMode, settleWaitMs: options.settleWaitMs,
    ...(mode === "dry-run" ? { scenario: options.scenario ?? "ok" } : {}),
  };
}

export const EXCLUDED = [
  "API key", "resume text", "job description text", "extracted requirement/responsibility strings", "assessment prose (recommendation, evidence, reasons, risks, warnings)",
  "model request bodies and raw responses", "confirmation input", "dollar amounts or percentage comparisons",
];

export function buildReport(args: { mode: "live" | "dry-run"; state: RunState | undefined; startedAt: string; finishedAt?: string; generatedAt: string;
  provenance: Provenance; approvals: Approvals; inputs: ReportInputs; interrupted: boolean; exitCode: number; searchCandidates?: LiveMeasurementReport["search"] }): LiveMeasurementReport {
  const { state } = args;
  const runA = state?.runs.find((r) => r.runId === "A-production-deadline");
  const responseModels = [...new Set((state?.runs.flatMap((r) => r.operations) ?? []).map((op) => op.responseModel).filter((m): m is string => m !== undefined))];
  const report = {
    reportKind: "live-batch-measurement" as const, reportVersion: REPORT_VERSION, harnessVersion: HARNESS_VERSION, mode: args.mode,
    status: state && !args.interrupted && args.exitCode === 0 ? "complete" as const : "incomplete" as const, interrupted: args.interrupted, exitCode: args.exitCode,
    generatedAt: args.generatedAt, startedAt: args.startedAt, ...(args.finishedAt ? { finishedAt: args.finishedAt } : {}),
    code: { codeSha: args.provenance.codeSha, dirty: args.provenance.dirty, hashes: args.provenance.hashes },
    provider: { api: args.mode === "live" ? "openai-responses" as const : "synthetic-no-model" as const, requestedModel: args.provenance.requestedModel, responseModels,
      promptVersion: args.provenance.promptVersion, defaultModel: args.provenance.defaultModel, openaiSdkVersion: args.provenance.openaiSdkVersion,
      nodeVersion: args.provenance.nodeVersion, store: false as const, maxRetries: HARNESS_TRANSPORT.maxRetries, logLevel: HARNESS_TRANSPORT.logLevel, baseUrl: HARNESS_BASE_URL },
    approvals: { ...args.approvals, hardMaxModelCalls: HARD_MAX_MODEL_CALLS as typeof HARD_MAX_MODEL_CALLS },
    inputs: args.inputs,
    search: args.searchCandidates ?? { searchId: "n/a", provider: "n/a", sourceUrl: "https://boards-api.greenhouse.io/", retrievedAt: args.startedAt, expiresAt: args.startedAt,
      matchedCount: 0, durationMs: 0, warningsCount: 0, candidates: [] },
    ...(state?.profileExtraction ? { profileExtraction: state.profileExtraction } : {}),
    runs: state?.runs ?? [],
    reconciliation: state?.reconciliation ?? { hookJoinedOps: 0, measuredOps: 0, joinMismatches: 0, mappingErrors: 0, cacheInconsistencies: 0, classificationConflicts: 0, unsettledOps: 0, errors: [] },
    billing: { source: "response.usage counters only" as const, monetaryCostConfirmed: false as const, billedAmount: null, currency: null,
      note: "Token counters are API-reported usage, not a bill. Fill billedAmount only from the billing dashboard. Call-count differences are integers, never percentage comparisons." },
    budgetObservation: {
      deadlineMs: args.inputs.deadlineMs, defaultDeadlineMs: RECOMMEND_DEADLINE_MS as typeof RECOMMEND_DEADLINE_MS,
      finishedWithinDeadline: runA && (runA.recommendOutcome === "returned" || runA.recommendOutcome === "threw") ? !runA.aborted : "n/a" as const,
      totalDurationMs: runA?.totalDurationMs ?? 0, headroomMs: runA?.totals.headroomMs ?? args.inputs.deadlineMs,
      perOperationMs: { extractJob: (runA?.operations ?? []).filter((op) => op.operation === "extractJob" && op.durationMs !== undefined).map((op) => Math.round(op.durationMs!)),
        assess: (runA?.operations ?? []).filter((op) => op.operation === "assess" && op.durationMs !== undefined).map((op) => Math.round(op.durationMs!)) },
      sampleSize: runA?.selectedIds.length ?? 0, runsRequiredBeforeDecision: 3 as const,
    },
    decision: { recommendedDeadlineMs: null, owner: "to be filled by the owner after >= 3 approved runs" },
    links: { issueUrl: ISSUE_URL,
      budgetStatedIn: ["server/src/domain/jobs/search.ts (RECOMMEND_DEADLINE_MS)", "server/tests/discovery.test.ts (90_000 case)", "README.md / README.ko.md (M3 section)",
        "docs/MILESTONE_3.md (Follow-up gate)", "docs/DECISIONS.md (ADR-0011)", "docs/MILESTONE_4.md (§9)"],
      relatedTests: ["server/tests/discovery.test.ts", "server/tests/analyzer-abort.test.ts", "server/tests/measure-live-*.test.ts"] },
    excluded: EXCLUDED,
    ...(args.interrupted ? { interruptionNote: "Every call recorded before the interrupt is included, the batch in progress as recommendOutcome \"interrupted\". An in-flight request may still be billed with its usage unrecorded." } : {}),
  };
  return LiveMeasurementReportSchema.parse(report);
}

const cell = (value: unknown) => String(value ?? "").replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
const ms = (value: number | undefined) => value === undefined ? "" : String(Math.round(value));

export function renderMarkdown(report: LiveMeasurementReport): string {
  const lines: string[] = [
    "# Career Radar live batch measurement", "",
    report.mode === "live" ? "Live Responses API run on a synthetic profile and public job descriptions. Single run: **not a budget decision** (3 approved runs required)."
      : "**Dry run** with a synthetic provider and fake analyzer. No network, no model calls; timings are not model latencies.", "",
    `- Code: ${report.code.codeSha}; dirty worktree: ${report.code.dirty}`,
    `- Hashes: analyzer ${report.code.hashes.analyzer.slice(0, 12)} · search ${report.code.hashes.search.slice(0, 12)} · policy ${report.code.hashes.policy.slice(0, 12)} · schema ${report.code.hashes.schema.slice(0, 12)}`,
    `- Model requested: ${report.provider.requestedModel}; responded: ${report.provider.responseModels.join(", ") || "n/a"}; prompt ${report.provider.promptVersion}; SDK ${report.provider.openaiSdkVersion}; Node ${report.provider.nodeVersion}`,
    `- SDK transport: base URL ${report.provider.baseUrl}; retries ${report.provider.maxRetries}; SDK log ${report.provider.logLevel}`,
    `- Approvals: network ${report.approvals.network}, model cost ${report.approvals.modelCost} (${report.approvals.confirmedVia}); cap ${report.approvals.maxModelCalls} of hard ${report.approvals.hardMaxModelCalls}; planned upper bound ${report.approvals.plannedUpperBound}`,
    `- Status: ${report.status}; interrupted: ${report.interrupted}; exit ${report.exitCode}`, "",
    "## Search candidates (public metadata only)", "", "| Candidate | Title | Location | Updated | Description chars | Job id |", "| --- | --- | --- | --- | --- | --- |",
    ...report.search.candidates.map((c) => `| ${cell(c.candidateId)} | ${cell(c.title)} | ${cell(c.location)} | ${cell(c.updatedAt ?? "unknown")} | ${c.descriptionLength} | ${cell(c.jobId)} |`), "",
  ];
  for (const r of report.runs) {
    lines.push(`## ${r.runId}`, "");
    if (r.skipped) { lines.push(`Skipped: ${r.skipped}.`, ""); continue; }
    lines.push(`Deadline ${r.deadlineMs} ms · total ${r.totalDurationMs} ms · headroom ${r.totals.headroomMs} ms · recommend ${r.recommendOutcome}${r.errorClass ? ` (${r.errorClass})` : ""} · aborted ${r.aborted}`, "",
      "### Operations", "", "| seq | op | candidate | start offset ms | duration ms | status | error class | in | cached | out | reasoning | request id |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...r.operations.map((op) => `| ${op.seq} | ${op.operation} | ${cell(op.candidateId)} | ${ms(op.startedPerf - (r.operations[0]?.startedPerf ?? op.startedPerf))} | ${ms(op.durationMs)} | ${op.status} | ${cell(op.errorClass)} | ${op.usage?.inputTokens ?? ""} | ${op.usage?.cachedInputTokens ?? ""} | ${op.usage?.outputTokens ?? ""} | ${op.usage?.reasoningTokens ?? ""} | ${cell(op.requestId)} |`), "",
      "### Candidates", "", "| candidate | outcome | category | store had job | extract | assess | verdict draft→final | blockers draft→final | replay |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...r.candidates.map((c) => `| ${cell(c.candidateId)} | ${c.outcome} | ${c.category} | ${c.storeHadJobBefore} | ${c.extractCalled} | ${c.assessCalled} | ${c.draft?.verdict ?? ""}→${c.final?.verdict ?? ""} | ${c.draft?.hardBlockers ?? ""}→${c.final?.hardBlockers ?? ""} | ${c.policy?.policyReplayMatches ?? ""} |`), "",
      "### Abort propagation", "", r.abort ? `Deadline fired at +${r.abort.abortAtOffsetMs} ms; recommend() returned ${r.abort.abortToBatchReturnMs} ms later${r.abort.inFlightOp ? `; in-flight ${r.abort.inFlightOp.operation} for ${cell(r.abort.inFlightOp.candidateId)} settled ${r.abort.abortToSettleMs === undefined ? "never (unsettled)" : `${ms(r.abort.abortToSettleMs)} ms after the abort`}` : ""}.` : "No abort fired.", "",
      "### What-if timeline", "", `Needed ${r.whatIf.neededMs.value} ms${r.whatIf.neededMs.lowerBound ? " (lower bound)" : ""}; finishes within 90000: ${r.whatIf.wouldFinishWithin["90000"]}, 120000: ${r.whatIf.wouldFinishWithin["120000"]}, 180000: ${r.whatIf.wouldFinishWithin["180000"]}, unbounded: ${r.whatIf.wouldFinishWithin.unbounded}. ${r.whatIf.note}`, "",
      "### Cache vs rerun", "", `Model calls ${r.totals.modelCalls} (extract ${r.totals.extractCalls}, assess ${r.totals.assessCalls}); extraction cache hits ${r.totals.extractionCacheHits}; extraction reruns ${r.totals.extractionReruns}; assess reruns of completed ${r.totals.assessReruns}; completed ${r.totals.completed}, failed ${r.totals.failed}, not attempted ${r.totals.notAttempted}.`, "",
      "### Usage", "", r.totals.usage ? `input ${r.totals.usage.inputTokens} (cached ${r.totals.usage.cachedInputTokens ?? "n/a"}), output ${r.totals.usage.outputTokens} (reasoning ${r.totals.usage.reasoningTokens ?? "n/a"}), total ${r.totals.usage.totalTokens}; coverage ${r.totals.usageCoverage.reported}/${r.totals.usageCoverage.total}; unknown ${r.totals.usageUnknownOps}.` : "Not captured (dry run or no usage reported).", "");
  }
  lines.push("## Billing", "", "Unverified. Token counters above are API-reported usage, not a bill. Confirm the run window in the usage dashboard; call-count differences are integers, not a cost claim.", "",
    "## Budget observation", "", "A single run is evidence, not a budget decision; three approved runs are required before changing the deadline.", "", `Deadline ${report.budgetObservation.deadlineMs} ms (default ${report.budgetObservation.defaultDeadlineMs}); Run A total ${report.budgetObservation.totalDurationMs} ms; finished within deadline: ${report.budgetObservation.finishedWithinDeadline}; headroom ${report.budgetObservation.headroomMs} ms; sample size ${report.budgetObservation.sampleSize}; runs required before decision ${report.budgetObservation.runsRequiredBeforeDecision}.`,
    `Per-operation ms — extractJob: ${report.budgetObservation.perOperationMs.extractJob.join(", ") || "n/a"}; assess: ${report.budgetObservation.perOperationMs.assess.join(", ") || "n/a"}.`, "",
    "### Decision (owner)", "", "- Keep / adjust RECOMMEND_DEADLINE_MS: ", "- Evidence (report directories, SHAs): ", "- Places to update: " + report.links.budgetStatedIn.join("; "), "",
    "## Reconciliation", "", report.reconciliation.errors.length ? report.reconciliation.errors.map((e) => `- ${e}`).join("\n") : "- No inconsistencies.", "",
    "## Exclusions", "", ...report.excluded.map((e) => `- ${e}`), "");
  return lines.join("\n");
}

export function renderIssueComment(report: LiveMeasurementReport): string {
  const lines = [
    `Live measurement (${report.mode}) — code ${report.code.codeSha.slice(0, 7)}${report.code.dirty ? " (dirty)" : ""}, model ${report.provider.requestedModel}, prompt ${report.provider.promptVersion}, status ${report.status}`,
    "", "| run | deadline ms | total ms | calls | completed / failed / not attempted | aborted | cache hits / assess reruns |", "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.runs.map((r) => r.skipped ? `| ${r.runId} | skipped (${r.skipped}) | | | | | |`
      : `| ${r.runId} | ${r.deadlineMs} | ${r.totalDurationMs} | ${r.totals.modelCalls} | ${r.totals.completed} / ${r.totals.failed} / ${r.totals.notAttempted} | ${r.aborted} | ${r.totals.extractionCacheHits} / ${r.totals.assessReruns} |`),
    "", `Deadline observation: finished within ${report.budgetObservation.deadlineMs} ms = ${report.budgetObservation.finishedWithinDeadline}; per-op assess ms ${report.budgetObservation.perOperationMs.assess.join(", ") || "n/a"}.`,
    "Billing unverified (usage counters only). Single run; three approved runs before any deadline decision.",
    `Report directory name is recorded locally; not uploaded.`,
  ];
  return lines.slice(0, 40).join("\n");
}

const KEY_PATTERN = /sk-[A-Za-z0-9_-]{16,}/;

// Throws a static error if any forbidden fragment reaches a serialized report. Never echoes the fragment.
export function assertRedacted(serialized: string, forbidden: string[]): void {
  if (KEY_PATTERN.test(serialized) || serialized.includes("<job-description>") || serialized.includes("<resume>")) throw new Error("Report redaction failed.");
  for (const fragment of forbidden) {
    if (fragment.length >= 8 && serialized.includes(fragment)) throw new Error("Report redaction failed.");
  }
}

// Created before the first model call so a partial report always has somewhere to land. Non-recursive:
// an existing directory throws instead of being reused.
export function createReportDirectory(directory: string): void {
  mkdirSync(resolve(directory, ".."), { recursive: true });
  mkdirSync(directory, { mode: 0o700 });
}

export function writeReport(directory: string, report: LiveMeasurementReport, markdown: string, issueComment: string): void {
  writeFileSync(resolve(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  writeFileSync(resolve(directory, "report.md"), markdown, { flag: "wx", mode: 0o600 });
  writeFileSync(resolve(directory, "issue-comment.md"), `${issueComment}\n`, { flag: "wx", mode: 0o600 });
}
