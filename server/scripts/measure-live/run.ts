import type { CandidateProfile, JobRecommendations, JobSearchResult } from "@career-radar/shared";
import { JobDiscovery } from "../../src/domain/jobs/search.js";
import type { CareerStore } from "../../src/domain/store.js";
import type { JobSearchProvider, ProviderSearchResult, SearchHit } from "../../src/infra/search/greenhouse.js";
import type { Options } from "./gate.js";
import { MeasuredAnalyzer, type Clock, type OperationRecord } from "./measured-analyzer.js";
import { expectedJobId } from "./synthetic-inputs.js";
import { abortLatency, accountCache, assessmentSummary, classifyCandidateOutcomes, policyInspection, sumUsage, whatIf,
  type AssessmentSummary, type CacheCategory, type CandidateOutcome, type WhatIf } from "./timeline.js";

export type RunId = "A-production-deadline" | "B-retry" | "C-forced-abort";
export type RunOutcome = "returned" | "threw" | "skipped" | "interrupted";

// JobDiscovery keeps provider hits private; the harness needs them to map calls to candidates.
export function recordingProvider(inner: JobSearchProvider): JobSearchProvider & { last?: ProviderSearchResult } {
  const wrapped: JobSearchProvider & { last?: ProviderSearchResult } = {
    async search(input) { const result = await inner.search(input); wrapped.last = result; return result; },
  };
  return wrapped;
}

export type SearchContext = {
  discovery: JobDiscovery; search: JobSearchResult; hits: SearchHit[]; selectedIds: string[]; searchDurationMs: number;
};

export async function performSearch(discovery: JobDiscovery, provider: { last?: ProviderSearchResult }, options: Options, clock: Clock): Promise<SearchContext> {
  const started = clock();
  const search = await discovery.search({ boardToken: options.boardToken, limit: options.limit,
    ...(options.titleKeywords ? { titleKeywords: options.titleKeywords } : {}), ...(options.location ? { location: options.location } : {}) });
  const searchDurationMs = clock() - started;
  const hits = structuredClone(provider.last?.hits ?? []);
  const available = new Set(hits.map((h) => h.candidate.candidateId));
  const selectedIds = options.candidateIds ?? hits.slice(0, Math.min(5, options.limit)).map((h) => h.candidate.candidateId);
  const missing = selectedIds.filter((id) => !available.has(id));
  if (missing.length) throw new Error("Selected candidate IDs are not present in the search result.");
  if (selectedIds.length === 0) throw new Error("The search returned no candidates to measure.");
  return { discovery, search, hits, selectedIds, searchDurationMs };
}

export type CandidateRow = {
  candidateId: string; jobId: string; storeHadJobBefore: boolean; extractCalled: boolean; assessCalled: boolean;
  category: CacheCategory; outcome: CandidateOutcome; classificationConflict: boolean; cacheConsistent: boolean; assessmentId?: string;
  extraction?: OperationRecord["extraction"]; draft?: AssessmentSummary; final?: AssessmentSummary;
  policy?: ReturnType<typeof policyInspection>;
};

export type RunRecord = {
  runId: RunId; skipped?: "retry_disabled" | "nothing_to_retry" | "board_changed"; deadlineMs: number; selectedIds: string[];
  startedAt: string; totalDurationMs: number; recommendOutcome: RunOutcome; errorClass?: string; aborted: boolean;
  abort?: ReturnType<typeof abortLatency>; operations: OperationRecord[]; candidates: CandidateRow[];
  failuresReported: Array<{ candidateId: string; kind: "failed" | "not_attempted" }>;
  warnings: { search: number; run: number; extractionDelta: number };
  totals: { modelCalls: number; extractCalls: number; assessCalls: number; extractionCacheHits: number; extractionReruns: number; assessReruns: number;
    completed: number; failed: number; notAttempted: number; sumCallMs: number; maxCallMs: number; overheadMs: number; headroomMs: number;
    usage: ReturnType<typeof sumUsage>["usage"]; usageCoverage: { reported: number; total: number }; usageUnknownOps: number };
  whatIf: WhatIf;
};

export type Reconciliation = { hookJoinedOps: number; measuredOps: number; joinMismatches: number; mappingErrors: number; cacheInconsistencies: number;
  classificationConflicts: number; unsettledOps: number; errors: string[] };

export type RunState = { search: SearchContext; profileExtraction?: OperationRecord; runs: RunRecord[]; reconciliation: Reconciliation };

// Everything known about a batch before recommend() returns, so an interrupted batch can still be summarized.
export type ActiveRun = {
  runId: RunId; deadlineMs: number; selectedIds: string[]; hits: SearchHit[]; startedAt: string; batchStartedPerf: number;
  previouslyCompleted: Set<string>; searchWarnings: number; storeHadJobBefore: Map<string, boolean>; result?: JobRecommendations;
};

export type RunDeps = {
  provider: JobSearchProvider & { last?: ProviderSearchResult }; measured: MeasuredAnalyzer; store: CareerStore; profile: CandidateProfile;
  clock: Clock; now: () => Date; discoveryFactory: (deadlineMs: number) => JobDiscovery; log: (line: string) => void; resumeText?: string;
  onRunStarted?: (active: ActiveRun) => void; onRunFinished?: (run: RunRecord) => void;
};

const NOT_ATTEMPTED_PREFIX = "Not attempted";

function startRun(runId: RunId, deadlineMs: number, hits: SearchHit[], selectedIds: string[], previouslyCompleted: Set<string>, searchWarnings: number, deps: RunDeps): ActiveRun {
  const hitById = new Map(hits.map((h) => [h.candidate.candidateId, h]));
  const storeHadJobBefore = new Map(selectedIds.map((id) => [id, deps.store.getJob(expectedJobId(hitById.get(id)!)) !== undefined]));
  deps.measured.beginRun(runId);
  const active: ActiveRun = { runId, deadlineMs, selectedIds, hits, startedAt: deps.now().toISOString(), batchStartedPerf: deps.clock(), previouslyCompleted, searchWarnings, storeHadJobBefore };
  deps.onRunStarted?.(active);
  return active;
}

// Builds the run record from the operations recorded so far. Used at completion and, with
// recommendOutcome "interrupted", from the SIGINT handler while the batch is still in flight.
export function summarizeRun(active: ActiveRun, deps: Pick<RunDeps, "measured" | "store" | "profile">, recommendOutcome: RunOutcome, errorClass: string | undefined,
  recommendResolvedPerf: number): RunRecord {
  const { measured, store, profile } = deps;
  const { runId, deadlineMs, selectedIds, previouslyCompleted, searchWarnings, storeHadJobBefore, result } = active;
  const hitById = new Map(active.hits.map((h) => [h.candidate.candidateId, h]));
  const ops = measured.runRecords(runId);
  const outcomes = classifyCandidateOutcomes(result, ops, selectedIds, recommendOutcome === "interrupted" && result === undefined);
  const itemById = new Map([...(result?.realistic ?? []), ...(result?.stretch ?? []), ...(result?.pass ?? [])].map((i) => [i.candidate.candidateId, i]));
  const candidates: CandidateRow[] = outcomes.map(({ candidateId, outcome, classificationConflict }) => {
    const hit = hitById.get(candidateId)!;
    const jobId = expectedJobId(hit);
    const before = storeHadJobBefore.get(candidateId) ?? false;
    const cache = accountCache(ops, candidateId, before, outcome, previouslyCompleted.has(candidateId));
    const row: CandidateRow = { candidateId, jobId, storeHadJobBefore: before, extractCalled: cache.extractCalled, assessCalled: cache.assessCalled,
      category: cache.category, outcome, classificationConflict, cacheConsistent: cache.consistent };
    const extraction = ops.find((op) => op.candidateId === candidateId && op.operation === "extractJob" && op.extraction)?.extraction;
    if (extraction) row.extraction = extraction;
    const item = itemById.get(candidateId);
    const assessOp = [...ops].reverse().find((op) => op.candidateId === candidateId && op.operation === "assess" && op.status === "ok");
    const draft = assessOp ? measured.drafts.get(assessOp.seq) : undefined;
    if (draft) row.draft = assessmentSummary(draft);
    if (item) {
      row.assessmentId = item.assessmentId; row.final = assessmentSummary(item.assessment);
      const job = store.getJob(item.jobId);
      if (draft && job) row.policy = policyInspection(profile, job, draft, item.assessment);
    }
    return row;
  });
  const abortedPerf = measured.runAbortedAt(runId);
  const abort = abortLatency(ops, abortedPerf, active.batchStartedPerf, recommendResolvedPerf);
  const durations = ops.filter((op) => op.durationMs !== undefined && op.status !== "cap_refused").map((op) => op.durationMs!);
  const sumCallMs = Math.round(durations.reduce((n, d) => n + d, 0));
  const totalDurationMs = Math.round(recommendResolvedPerf - active.batchStartedPerf);
  const usage = sumUsage(ops);
  return {
    runId, deadlineMs, selectedIds, startedAt: active.startedAt, totalDurationMs, recommendOutcome,
    ...(errorClass ? { errorClass } : {}), aborted: abortedPerf !== undefined, ...(abort ? { abort } : {}), operations: ops, candidates,
    failuresReported: (result?.failures ?? []).map((f) => ({ candidateId: f.candidateId, kind: f.message.startsWith(NOT_ATTEMPTED_PREFIX) ? "not_attempted" as const : "failed" as const })),
    warnings: { search: searchWarnings, run: result?.warnings.length ?? 0, extractionDelta: Math.max(0, (result?.warnings.length ?? 0) - searchWarnings - 2) },
    totals: {
      modelCalls: ops.filter((op) => op.status !== "cap_refused").length,
      extractCalls: ops.filter((op) => op.operation === "extractJob" && op.status !== "cap_refused").length,
      assessCalls: ops.filter((op) => op.operation === "assess" && op.status !== "cap_refused").length,
      extractionCacheHits: candidates.filter((c) => c.category === "extraction_cache_hit_assessed").length,
      extractionReruns: candidates.filter((c) => c.storeHadJobBefore && c.extractCalled).length,
      assessReruns: candidates.filter((c) => c.category === "assess_rerun_of_completed").length,
      completed: candidates.filter((c) => c.outcome === "completed").length, failed: candidates.filter((c) => c.outcome === "failed").length,
      notAttempted: candidates.filter((c) => c.outcome === "not_attempted").length,
      sumCallMs, maxCallMs: Math.round(Math.max(0, ...durations)), overheadMs: Math.max(0, totalDurationMs - sumCallMs),
      headroomMs: deadlineMs - totalDurationMs, usage: usage.usage, usageCoverage: usage.coverage, usageUnknownOps: usage.unknownOps,
    },
    whatIf: whatIf(ops),
  };
}

async function executeRun(runId: RunId, deadlineMs: number, discovery: JobDiscovery, searchId: string, hits: SearchHit[], selectedIds: string[],
  previouslyCompleted: Set<string>, searchWarnings: number, deps: RunDeps, options: Options): Promise<RunRecord> {
  const active = startRun(runId, deadlineMs, hits, selectedIds, previouslyCompleted, searchWarnings, deps);
  let errorClass: string | undefined;
  try {
    active.result = await discovery.recommend({ searchId, candidateProfileId: deps.profile.id, candidateIds: selectedIds, realisticCount: 5, stretchCount: 0, includePass: true }, deps.store, () => deps.measured);
  } catch (error) {
    errorClass = typeof (error as { name?: unknown })?.name === "string" ? (error as { name: string }).name : "Error";
  }
  const recommendResolvedPerf = deps.clock();
  await deps.measured.settle(options.settleWaitMs);
  const run = summarizeRun(active, deps, errorClass ? "threw" : "returned", errorClass, recommendResolvedPerf);
  deps.onRunFinished?.(run);
  return run;
}

export function reconcile(records: OperationRecord[], runs: RunRecord[]): Reconciliation {
  const candidates = runs.flatMap((r) => r.candidates);
  const reconciliation: Reconciliation = {
    hookJoinedOps: records.filter((op) => op.sdkDurationMs !== undefined).length, measuredOps: records.filter((op) => op.status !== "cap_refused").length,
    joinMismatches: records.filter((op) => op.joinMismatch).length, mappingErrors: records.filter((op) => op.mappingError && op.operation !== "extractProfile").length,
    cacheInconsistencies: candidates.filter((c) => !c.cacheConsistent).length, classificationConflicts: candidates.filter((c) => c.classificationConflict).length,
    unsettledOps: records.filter((op) => op.status === "unsettled").length, errors: [],
  };
  if (reconciliation.joinMismatches) reconciliation.errors.push("hook events joined to a different operation than measured");
  if (reconciliation.mappingErrors) reconciliation.errors.push("an analyzer call could not be mapped to a candidate");
  if (reconciliation.cacheInconsistencies) reconciliation.errors.push("extraction call did not match the store probe");
  if (reconciliation.classificationConflicts) reconciliation.errors.push("candidate outcome disagrees with the reported failure list");
  if (reconciliation.unsettledOps) reconciliation.errors.push("an abandoned call never settled within the settle wait");
  return reconciliation;
}

export async function runMeasurement(deps: RunDeps, context: SearchContext, options: Options): Promise<RunState> {
  const { measured, log } = deps;
  const runs: RunRecord[] = [];
  let profileExtraction: OperationRecord | undefined;
  if (options.includeProfileExtraction && deps.resumeText !== undefined) {
    measured.beginRun("profile-extraction");
    try { await measured.extractProfile(deps.resumeText); } catch { /* recorded on the operation */ }
    await measured.settle(options.settleWaitMs);
    profileExtraction = measured.runRecords("profile-extraction")[0];
  }
  const searchWarnings = context.search.warnings.length;
  log(`Run A: ${context.selectedIds.length} candidates, deadline ${options.deadlineMs} ms`);
  const runA = await executeRun("A-production-deadline", options.deadlineMs, context.discovery, context.search.searchId, context.hits, context.selectedIds, new Set(), searchWarnings, deps, options);
  runs.push(runA);
  const completedA = new Set(runA.candidates.filter((c) => c.outcome === "completed").map((c) => c.candidateId));
  const retryIds = options.retryMode === "all" ? context.selectedIds
    : options.retryMode === "none" ? [] : runA.candidates.filter((c) => c.outcome !== "completed").map((c) => c.candidateId);
  if (options.retryMode === "none" || retryIds.length === 0) {
    runs.push(skippedRun("B-retry", options.deadlineMs, options.retryMode === "none" ? "retry_disabled" : "nothing_to_retry", deps));
  } else {
    log(`Run B: retrying ${retryIds.length} candidate(s)`);
    runs.push(await executeRun("B-retry", options.deadlineMs, context.discovery, context.search.searchId, context.hits, retryIds, completedA, searchWarnings, deps, options));
  }
  if (options.forcedAbortMs !== undefined) {
    const discoveryC = deps.discoveryFactory(options.forcedAbortMs);
    const searchC = await discoveryC.search({ boardToken: options.boardToken, limit: options.limit,
      ...(options.titleKeywords ? { titleKeywords: options.titleKeywords } : {}), ...(options.location ? { location: options.location } : {}) });
    const hitsC = structuredClone(deps.provider.last?.hits ?? []);
    for (const hit of hitsC) measured.registerHit(hit);
    const availableC = new Set(hitsC.map((h) => h.candidate.candidateId));
    if (context.selectedIds.some((id) => !availableC.has(id))) {
      runs.push(skippedRun("C-forced-abort", options.forcedAbortMs, "board_changed", deps));
    } else {
      log(`Run C: forced abort at ${options.forcedAbortMs} ms`);
      const completedSoFar = new Set(runs.flatMap((r) => r.candidates.filter((c) => c.outcome === "completed").map((c) => c.candidateId)));
      runs.push(await executeRun("C-forced-abort", options.forcedAbortMs, discoveryC, searchC.searchId, hitsC, context.selectedIds, completedSoFar, searchC.warnings.length, deps, options));
    }
    discoveryC.close();
  }
  return { search: context, ...(profileExtraction ? { profileExtraction } : {}), runs, reconciliation: reconcile(measured.records, runs) };
}

function skippedRun(runId: RunId, deadlineMs: number, skipped: NonNullable<RunRecord["skipped"]>, deps: RunDeps): RunRecord {
  const run: RunRecord = { runId, skipped, deadlineMs, selectedIds: [], startedAt: deps.now().toISOString(), totalDurationMs: 0, recommendOutcome: "skipped", aborted: false,
    operations: [], candidates: [], failuresReported: [], warnings: { search: 0, run: 0, extractionDelta: 0 },
    totals: { modelCalls: 0, extractCalls: 0, assessCalls: 0, extractionCacheHits: 0, extractionReruns: 0, assessReruns: 0, completed: 0, failed: 0, notAttempted: 0,
      sumCallMs: 0, maxCallMs: 0, overheadMs: 0, headroomMs: deadlineMs, usage: null, usageCoverage: { reported: 0, total: 0 }, usageUnknownOps: 0 },
    whatIf: whatIf([]) };
  deps.onRunFinished?.(run);
  return run;
}
