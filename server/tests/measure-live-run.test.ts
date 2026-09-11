import { describe, expect, it } from "vitest";
import { SYNTHETIC_EVIDENCE_SENTINEL, SYNTHETIC_JD_SENTINEL, measurementResumeText } from "../scripts/measure-live/synthetic-inputs.js";
import { dryRun } from "./measure-live-helpers.js";

describe("measure:live run orchestration (fixture provider, fake analyzer, no network)", () => {
  it("runs the production batch, skips the retry when nothing failed, and reconciles cleanly", async () => {
    const { state, measured, store } = await dryRun();
    const [a, b] = state.runs;
    expect(a).toMatchObject({ runId: "A-production-deadline", recommendOutcome: "returned", aborted: false, deadlineMs: 90_000,
      totals: { modelCalls: 10, extractCalls: 5, assessCalls: 5, completed: 5, failed: 0, notAttempted: 0, extractionCacheHits: 0, extractionReruns: 0, assessReruns: 0 } });
    expect(a!.candidates.map((c) => c.category)).toEqual(Array(5).fill("extracted_and_assessed"));
    expect(a!.candidates.every((c) => c.policy?.policyReplayMatches && c.draft && c.final && c.cacheConsistent)).toBe(true);
    expect(a!.whatIf).toMatchObject({ neededMs: { lowerBound: false }, wouldFinishWithin: { "90000": true } });
    expect(b).toMatchObject({ runId: "B-retry", skipped: "nothing_to_retry", recommendOutcome: "skipped" });
    expect(state.reconciliation).toMatchObject({ measuredOps: 10, errors: [], unsettledOps: 0, mappingErrors: 0 });
    expect(measured.calls).toBe(10);
    for (const c of a!.candidates) expect(store.getJob(c.jobId)).toBeDefined();
    store.close();
  });

  it("fail-at-3: the retry reuses the persisted extraction and re-attempts the skipped candidates", async () => {
    const { state } = await dryRun([], "fail-at-3");
    const [a, b] = state.runs;
    expect(a!.totals).toMatchObject({ modelCalls: 6, extractCalls: 3, assessCalls: 3, completed: 2, failed: 1, notAttempted: 2 });
    expect(a!.failuresReported.map((f) => f.kind).sort()).toEqual(["failed", "not_attempted", "not_attempted"]);
    const failed = a!.candidates.find((c) => c.outcome === "failed")!;
    expect(failed).toMatchObject({ category: "extracted_and_assessed", storeHadJobBefore: false, extractCalled: true, assessCalled: true });
    expect(b!.selectedIds).toHaveLength(3);
    expect(b!.totals).toMatchObject({ modelCalls: 5, extractCalls: 2, assessCalls: 3, completed: 3, extractionCacheHits: 1, extractionReruns: 0 });
    expect(b!.candidates.find((c) => c.candidateId === failed.candidateId)).toMatchObject({ category: "extraction_cache_hit_assessed", storeHadJobBefore: true, extractCalled: false });
    expect(state.reconciliation.errors).toEqual([]);
  });

  it("stall: the deadline aborts the in-flight extraction, the abort is timed, and the retry starts from a clean store", async () => {
    const { state } = await dryRun(["--deadline-ms", "300", "--settle-wait-ms", "2000"], "stall", 5);
    const [a, b] = state.runs;
    expect(a).toMatchObject({ aborted: true, recommendOutcome: "returned", totals: { completed: 1, failed: 1, notAttempted: 3 } });
    expect(a!.abort).toMatchObject({ inFlightOp: { operation: "extractJob" } });
    expect(a!.abort!.abortAtOffsetMs).toBeGreaterThanOrEqual(290);
    expect(a!.abort!.abortToSettleMs).toBeGreaterThanOrEqual(0);
    expect(a!.whatIf).toMatchObject({ neededMs: { lowerBound: true }, wouldFinishWithin: { "90000": "unknown", unbounded: "unknown" } });
    const stalled = a!.candidates.find((c) => c.outcome === "failed")!;
    expect(stalled.category).toBe("extraction_only_then_failed");
    expect(b!.totals).toMatchObject({ extractCalls: 4, assessCalls: 4, completed: 4, extractionCacheHits: 0 });
    expect(state.reconciliation).toMatchObject({ unsettledOps: 0, errors: [] });
  });

  it("forced abort (run C) reuses every persisted extraction and reports assess reruns, not cache hits", async () => {
    const { state } = await dryRun(["--forced-abort-ms", "25", "--retry-mode", "all"], "ok", 10);
    const [a, b, c] = state.runs;
    expect(a!.totals.modelCalls).toBe(10);
    expect(b!.totals).toMatchObject({ modelCalls: 5, extractCalls: 0, assessCalls: 5, assessReruns: 5, extractionCacheHits: 0, completed: 5 });
    expect(c).toMatchObject({ runId: "C-forced-abort", deadlineMs: 25, aborted: true, totals: { extractCalls: 0, extractionReruns: 0 } });
    expect(c!.totals.assessCalls).toBeGreaterThanOrEqual(1);
    expect(c!.totals.assessCalls).toBeLessThan(5);
    expect(c!.candidates.every((x) => x.storeHadJobBefore && x.cacheConsistent)).toBe(true);
    expect(state.reconciliation.errors).toEqual([]);
  });

  it("retry-mode none skips run B and profile extraction adds exactly one recorded call", async () => {
    const { state, measured } = await dryRun(["--retry-mode", "none", "--include-profile-extraction"]);
    expect(state.runs[1]).toMatchObject({ skipped: "retry_disabled" });
    expect(state.profileExtraction).toMatchObject({ operation: "extractProfile", status: "ok", candidateId: "profile" });
    expect(measured.calls).toBe(11);
  });

  it("keeps job text, resume text and assessment prose out of the run records", async () => {
    const { state } = await dryRun([], "fail-at-3");
    const serialized = JSON.stringify({ runs: state.runs, reconciliation: state.reconciliation, profileExtraction: state.profileExtraction });
    for (const fragment of [SYNTHETIC_JD_SENTINEL, SYNTHETIC_EVIDENCE_SENTINEL, "Lead a React team", "SYNTHETIC_PROVIDER_FAILURE", measurementResumeText.slice(0, 40)]) {
      expect(serialized).not.toContain(fragment);
    }
  });
});
