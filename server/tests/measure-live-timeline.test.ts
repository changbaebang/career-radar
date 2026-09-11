import type { JobRecommendations } from "@career-radar/shared";
import { describe, expect, it } from "vitest";
import type { OperationRecord } from "../scripts/measure-live/measured-analyzer.js";
import { abortLatency, accountCache, assessmentSummary, classifyCandidateOutcomes, policyInspection, sumUsage, whatIf } from "../scripts/measure-live/timeline.js";
import { applyAssessmentPolicy } from "../src/domain/assessment/policy.js";
import { groundedAssessment } from "./discovery-fixtures.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";

let seq = 0;
function op(over: Partial<OperationRecord>): OperationRecord {
  const startedPerf = over.startedPerf ?? 0;
  const durationMs = over.durationMs ?? 100;
  return { seq: ++seq, runId: "A", operation: "assess", candidateId: "c1", mappingError: false, startedPerf, settledPerf: startedPerf + durationMs, durationMs,
    status: "ok", joinMismatch: false, settledAfterBatchReturn: false, ...over };
}
function result(realistic: string[], failures: Array<[string, string]>): JobRecommendations {
  return { realistic: realistic.map((candidateId) => ({ candidate: { candidateId } })), stretch: [], pass: [],
    failures: failures.map(([candidateId, message]) => ({ candidateId, message })) } as unknown as JobRecommendations;
}

describe("measure:live timeline helpers", () => {
  it("classifies completed, failed and not-attempted candidates and flags disagreement with the failure list", () => {
    const ops = [op({ operation: "extractJob", candidateId: "c1" }), op({ candidateId: "c1" }), op({ operation: "extractJob", candidateId: "c2" }), op({ candidateId: "c2", status: "error" })];
    const consistent = classifyCandidateOutcomes(result(["c1"], [["c2", "Synthetic failure"], ["c3", "Not attempted: an earlier candidate failed."]]), ops, ["c1", "c2", "c3"]);
    expect(consistent).toEqual([{ candidateId: "c1", outcome: "completed", classificationConflict: false }, { candidateId: "c2", outcome: "failed", classificationConflict: false },
      { candidateId: "c3", outcome: "not_attempted", classificationConflict: false }]);
    const conflicting = classifyCandidateOutcomes(result(["c1"], [["c1", "Synthetic failure"], ["c2", "Not attempted: an earlier candidate failed."]]), ops, ["c1", "c2"]);
    expect(conflicting.map((c) => c.classificationConflict)).toEqual([true, true]);
    expect(classifyCandidateOutcomes(undefined, ops, ["c1", "c3"]).map((c) => c.outcome)).toEqual(["failed", "not_attempted"]);
  });

  it("classifies an interrupted batch from the recorded calls alone", () => {
    const ops = [op({ operation: "extractJob", candidateId: "c1" }), op({ candidateId: "c1" }), op({ operation: "extractJob", candidateId: "c2", status: "unsettled", settledPerf: undefined, durationMs: undefined }),
      op({ operation: "extractJob", candidateId: "c3" }), op({ candidateId: "c3", status: "error" })];
    expect(classifyCandidateOutcomes(undefined, ops, ["c1", "c2", "c3", "c4"], true).map((c) => c.outcome)).toEqual(["completed", "interrupted", "failed", "not_attempted"]);
  });

  it("accounts extraction cache hits against the store probe and names the category", () => {
    const both = [op({ operation: "extractJob", candidateId: "c1" }), op({ candidateId: "c1" })];
    expect(accountCache(both, "c1", false, "completed", false)).toEqual({ extractCalled: true, assessCalled: true, category: "extracted_and_assessed", consistent: true });
    expect(accountCache([op({ candidateId: "c1" })], "c1", true, "completed", false)).toMatchObject({ category: "extraction_cache_hit_assessed", consistent: true });
    expect(accountCache([op({ operation: "extractJob", candidateId: "c1", status: "aborted" })], "c1", false, "failed", false)).toMatchObject({ category: "extraction_only_then_failed", consistent: true });
    expect(accountCache([], "c1", false, "not_attempted", false)).toMatchObject({ category: "not_attempted", consistent: true });
    expect(accountCache([op({ candidateId: "c1" })], "c1", true, "completed", true)).toMatchObject({ category: "assess_rerun_of_completed" });
    expect(accountCache([op({ candidateId: "c1", status: "cap_refused" })], "c1", true, "failed", false)).toMatchObject({ category: "cap_refused", assessCalled: false });
    // A re-extraction of a persisted job, or an assessment without extraction of a missing job, is an inconsistency.
    expect(accountCache(both, "c1", true, "completed", false).consistent).toBe(false);
    expect(accountCache([op({ candidateId: "c1" })], "c1", false, "completed", false).consistent).toBe(false);
  });

  it("derives a what-if timeline that says true only from an exact sum", () => {
    const exact = whatIf([op({ durationMs: 100 }), op({ startedPerf: 100, durationMs: 200 })]);
    expect(exact).toMatchObject({ cumulativeMs: [100, 300], neededMs: { value: 300, lowerBound: false }, wouldFinishWithin: { "90000": true, "120000": true, "180000": true, unbounded: true } });
    const partial = whatIf([op({ durationMs: 60_000 }), op({ durationMs: 40_000 }), op({ durationMs: 10_000, status: "aborted" })]);
    expect(partial).toMatchObject({ neededMs: { value: 110_000, lowerBound: true }, wouldFinishWithin: { "90000": false, "120000": "unknown", "180000": "unknown", unbounded: "unknown" } });
    expect(partial.note).toMatch(/Lower bound/);
    expect(whatIf([op({ status: "cap_refused", durationMs: 0 })]).cumulativeMs).toEqual([]);
  });

  it("measures abort latency against the in-flight operation", () => {
    const ops = [op({ startedPerf: 0, durationMs: 100 }), op({ startedPerf: 100, durationMs: 300, status: "aborted", abortToSettleMs: 50, settledAfterBatchReturn: true })];
    expect(abortLatency(ops, 350, 0, 360)).toEqual({ abortAtOffsetMs: 350, abortToBatchReturnMs: 10, inFlightOp: { seq: ops[1]!.seq, operation: "assess", candidateId: "c1" }, abortToSettleMs: 50, settledAfterBatchReturn: true });
    expect(abortLatency(ops, undefined, 0, 360)).toBeUndefined();
  });

  it("sums usage counters and reports coverage instead of guessing missing ones", () => {
    const ops = [op({ usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 4 } }), op({ usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }), op({}), op({ status: "cap_refused" })];
    expect(sumUsage(ops)).toEqual({ usage: { inputTokens: 11, outputTokens: 6, totalTokens: 17, cachedInputTokens: 4 }, coverage: { reported: 2, total: 3 }, unknownOps: 1 });
    expect(sumUsage([op({})])).toEqual({ usage: null, coverage: { reported: 0, total: 1 }, unknownOps: 1 });
  });

  it("summarizes an assessment by counts and digest only", () => {
    const summary = assessmentSummary(groundedAssessment);
    expect(summary).toMatchObject({ verdict: groundedAssessment.verdict, strongestMatches: groundedAssessment.strongestMatches.length, hash: expect.stringMatching(/^[0-9a-f]{16,}$/) });
    expect(JSON.stringify(summary)).not.toContain(groundedAssessment.recommendation);
  });

  it("replays the policy over the captured draft and notices a tampered saved result", () => {
    const final = applyAssessmentPolicy(syntheticProfile, syntheticJob, groundedAssessment);
    expect(policyInspection(syntheticProfile, syntheticJob, groundedAssessment, final)).toMatchObject({ policyReplayMatches: true, verdictChanged: false });
    const ungrounded = { ...groundedAssessment, strongestMatches: [...groundedAssessment.strongestMatches, { ...groundedAssessment.strongestMatches[0]!, evidence: "Invented Kubernetes achievement" }] };
    const cleaned = applyAssessmentPolicy(syntheticProfile, syntheticJob, ungrounded);
    const inspection = policyInspection(syntheticProfile, syntheticJob, ungrounded, cleaned);
    expect(inspection.policyReplayMatches).toBe(true);
    expect(inspection.removedUngroundedMatches).toBe(ungrounded.strongestMatches.length - cleaned.strongestMatches.length);
    expect(policyInspection(syntheticProfile, syntheticJob, groundedAssessment, { ...final, verdict: "PASS" }).policyReplayMatches).toBe(false);
  });
});
