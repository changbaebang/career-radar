import type { CandidateProfile, FitAssessment, JobPosting, JobRecommendations } from "@career-radar/shared";
import { digest } from "../../../evals/evaluate.js";
import { applyAssessmentPolicy } from "../../src/domain/assessment/policy.js";
import type { OperationRecord, Usage } from "./measured-analyzer.js";

// Pure helpers over recorded operations. Nothing here performs I/O.

export type CandidateOutcome = "completed" | "failed" | "not_attempted" | "interrupted";
export type CacheCategory = "extracted_and_assessed" | "extraction_cache_hit_assessed" | "extraction_only_then_failed"
  | "not_attempted" | "assess_rerun_of_completed" | "cap_refused";

export function classifyCandidateOutcomes(result: JobRecommendations | undefined, ops: OperationRecord[], ids: string[], interrupted = false) {
  if (interrupted) {
    // No batch result exists yet: read the outcome from the recorded calls alone.
    return ids.map((candidateId) => {
      const mine = ops.filter((op) => op.candidateId === candidateId);
      const outcome: CandidateOutcome = mine.some((op) => op.operation === "assess" && op.status === "ok") ? "completed"
        : mine.some((op) => op.status === "error") ? "failed" : mine.length ? "interrupted" : "not_attempted";
      return { candidateId, outcome, classificationConflict: false };
    });
  }
  const completed = new Set([...(result?.realistic ?? []), ...(result?.stretch ?? []), ...(result?.pass ?? [])].map((i) => i.candidate.candidateId));
  const failures = new Map((result?.failures ?? []).map((f) => [f.candidateId, f.message]));
  return ids.map((candidateId) => {
    const attempted = ops.some((op) => op.candidateId === candidateId);
    const outcome: CandidateOutcome = completed.has(candidateId) ? "completed" : attempted ? "failed" : "not_attempted";
    const message = failures.get(candidateId);
    // recommend() reports "Not attempted…" for candidates skipped after an earlier failure.
    const reportedNotAttempted = message?.startsWith("Not attempted") ?? false;
    const classificationConflict = (outcome === "not_attempted") !== reportedNotAttempted && message !== undefined
      || (outcome === "completed" && message !== undefined);
    return { candidateId, outcome, classificationConflict };
  });
}

export function accountCache(ops: OperationRecord[], candidateId: string, storeHadJobBefore: boolean, outcome: CandidateOutcome, previouslyCompleted: boolean) {
  const mine = ops.filter((op) => op.candidateId === candidateId);
  const extractCalled = mine.some((op) => op.operation === "extractJob" && op.status !== "cap_refused");
  const assessCalled = mine.some((op) => op.operation === "assess" && op.status !== "cap_refused");
  let category: CacheCategory;
  if (mine.some((op) => op.status === "cap_refused")) category = "cap_refused";
  else if (outcome === "not_attempted") category = "not_attempted";
  else if (previouslyCompleted && assessCalled) category = "assess_rerun_of_completed";
  else if (outcome === "completed") category = storeHadJobBefore ? "extraction_cache_hit_assessed" : "extracted_and_assessed";
  else category = extractCalled && !assessCalled ? "extraction_only_then_failed" : storeHadJobBefore ? "extraction_cache_hit_assessed" : "extracted_and_assessed";
  const consistent = outcome === "not_attempted" || extractCalled === !storeHadJobBefore;
  return { extractCalled, assessCalled, category, consistent };
}

export type WhatIf = { cumulativeMs: number[]; neededMs: { value: number; lowerBound: boolean };
  wouldFinishWithin: Record<"90000" | "120000" | "180000" | "unbounded", boolean | "unknown">; note: string };

// Sequential timeline: exact when every call settled ok; otherwise a lower bound that stops at the
// abort. "true" is only ever derived from an exact sum.
export function whatIf(ops: OperationRecord[]): WhatIf {
  const cumulative: number[] = [];
  let sum = 0; let exact = true;
  for (const op of ops) {
    if (op.status === "cap_refused") continue;
    const duration = op.status === "ok" ? op.durationMs ?? 0
      : op.status === "aborted" && op.durationMs !== undefined ? op.durationMs : op.durationMs ?? 0;
    if (op.status !== "ok") exact = false;
    sum += duration; cumulative.push(Math.round(sum));
  }
  const decide = (limit: number | null): boolean | "unknown" => {
    if (limit !== null && sum > limit) return false;
    return exact ? true : "unknown";
  };
  return { cumulativeMs: cumulative, neededMs: { value: Math.round(sum), lowerBound: !exact },
    wouldFinishWithin: { "90000": decide(90_000), "120000": decide(120_000), "180000": decide(180_000), unbounded: exact ? true : "unknown" },
    note: exact ? "Exact: every call settled successfully." : "Lower bound: at least one call was aborted, failed or never settled; run with a larger --deadline-ms to measure completion." };
}

export function abortLatency(ops: OperationRecord[], abortedPerf: number | undefined, batchStartedPerf: number, recommendResolvedPerf: number) {
  if (abortedPerf === undefined) return undefined;
  const inFlight = ops.find((op) => op.startedPerf <= abortedPerf && (op.settledPerf === undefined || op.settledPerf >= abortedPerf));
  return {
    abortAtOffsetMs: Math.round(abortedPerf - batchStartedPerf),
    abortToBatchReturnMs: Math.round(recommendResolvedPerf - abortedPerf),
    ...(inFlight ? { inFlightOp: { seq: inFlight.seq, operation: inFlight.operation, candidateId: inFlight.candidateId },
      abortToSettleMs: inFlight.abortToSettleMs, settledAfterBatchReturn: inFlight.settledAfterBatchReturn } : {}),
  };
}

export function sumUsage(ops: OperationRecord[]): { usage: Usage | null; coverage: { reported: number; total: number }; unknownOps: number } {
  const total = ops.filter((op) => op.status !== "cap_refused");
  const reported = total.filter((op) => op.usage !== undefined);
  if (reported.length === 0) return { usage: null, coverage: { reported: 0, total: total.length }, unknownOps: total.length };
  const usage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let cached = 0, reasoning = 0, hasCached = false, hasReasoning = false;
  for (const op of reported) {
    usage.inputTokens += op.usage!.inputTokens; usage.outputTokens += op.usage!.outputTokens; usage.totalTokens += op.usage!.totalTokens;
    if (op.usage!.cachedInputTokens !== undefined) { hasCached = true; cached += op.usage!.cachedInputTokens; }
    if (op.usage!.reasoningTokens !== undefined) { hasReasoning = true; reasoning += op.usage!.reasoningTokens; }
  }
  if (hasCached) usage.cachedInputTokens = cached;
  if (hasReasoning) usage.reasoningTokens = reasoning;
  return { usage, coverage: { reported: reported.length, total: total.length }, unknownOps: total.length - reported.length };
}

export type AssessmentSummary = { verdict: string; confidence: string; resumeContortion: string; scorePresent: boolean;
  strongestMatches: number; gaps: number; hardBlockers: number; interviewRisks: number; missingInformation: number; hash: string };

export function assessmentSummary(a: FitAssessment): AssessmentSummary {
  return { verdict: a.verdict, confidence: a.confidence, resumeContortion: a.resumeContortion, scorePresent: a.score !== undefined,
    strongestMatches: a.strongestMatches.length, gaps: a.gaps.length, hardBlockers: a.hardBlockers.length,
    interviewRisks: a.interviewRisks.length, missingInformation: a.missingInformation.length, hash: digest(a) };
}

// Criterion 1: the saved result must equal the deterministic policy applied to the captured draft.
export function policyInspection(profile: CandidateProfile, job: JobPosting, draft: FitAssessment, final: FitAssessment) {
  const replay = applyAssessmentPolicy(profile, job, draft);
  return {
    verdictChanged: draft.verdict !== final.verdict, confidenceChanged: draft.confidence !== final.confidence,
    removedUngroundedMatches: Math.max(0, draft.strongestMatches.length - final.strongestMatches.length),
    promotedBlockers: Math.max(0, final.hardBlockers.length - draft.hardBlockers.length),
    policyReplayMatches: digest(replay) === digest(final),
  };
}
