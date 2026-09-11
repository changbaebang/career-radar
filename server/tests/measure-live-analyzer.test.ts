import { describe, expect, it, vi } from "vitest";
import type { CareerAnalyzer } from "../src/ai/analyzer.js";
import { FakeCareerAnalyzer } from "../scripts/measure-live/fake-analyzer.js";
import { HarnessCallCapError, MeasuredAnalyzer } from "../scripts/measure-live/measured-analyzer.js";
import { SYNTHETIC_EVIDENCE_SENTINEL, SYNTHETIC_JD_SENTINEL, createFixtureProvider, expectedDescription, expectedJobId, measurementProfile } from "../scripts/measure-live/synthetic-inputs.js";

async function hits(count = 3) {
  const { hits } = await createFixtureProvider(count).search({ boardToken: "greenhouse", limit: count });
  return hits;
}

describe("MeasuredAnalyzer (records timings and identifiers, never text)", () => {
  it("maps extractJob by exact description and assess by job id, recording counts and a draft", async () => {
    const found = await hits();
    const measured = new MeasuredAnalyzer(new FakeCareerAnalyzer("ok", 1), { cap: 10, hits: found });
    measured.beginRun("A");
    const hit = found[0]!;
    const { job: extracted } = await measured.extractJob(expectedDescription(hit));
    const job = { ...extracted, id: expectedJobId(hit) }; // recommend() re-keys the job by source URL + description before assessing
    const draft = await measured.assess(measurementProfile, job);
    expect(measured.records.map((r) => [r.runId, r.operation, r.candidateId, r.status, r.mappingError]))
      .toEqual([["A", "extractJob", hit.candidate.candidateId, "ok", false], ["A", "assess", hit.candidate.candidateId, "ok", false]]);
    expect(measured.records[0]!.extraction).toMatchObject({ requiredCount: 1, coreRequiredCount: 1, preferredCount: 0 });
    expect(measured.records[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(measured.drafts.get(2)).toEqual(draft);
    expect(measured.calls).toBe(2);
    const serialized = JSON.stringify(measured.records);
    expect(serialized).not.toContain(SYNTHETIC_JD_SENTINEL);
    expect(serialized).not.toContain(SYNTHETIC_EVIDENCE_SENTINEL);
    expect(serialized).not.toContain("Lead a React team");
  });

  it("flags a call it cannot map instead of guessing a candidate", async () => {
    const measured = new MeasuredAnalyzer(new FakeCareerAnalyzer("ok", 1), { cap: 10, hits: await hits() });
    await measured.extractJob("Title: unrelated\n\nNot one of the snapshot descriptions.");
    expect(measured.records[0]).toMatchObject({ candidateId: "unknown", mappingError: true, status: "ok" });
  });

  it("refuses a call past the cap before delegating and does not count it", async () => {
    const found = await hits();
    const inner = new FakeCareerAnalyzer("ok", 1);
    const spy = vi.spyOn(inner, "extractJob");
    const measured = new MeasuredAnalyzer(inner, { cap: 1, hits: found });
    await measured.extractJob(expectedDescription(found[0]!));
    await expect(measured.extractJob(expectedDescription(found[1]!))).rejects.toBeInstanceOf(HarnessCallCapError);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(measured.calls).toBe(1);
    expect(measured.records[1]).toMatchObject({ status: "cap_refused", durationMs: 0, errorClass: "HarnessCallCapError" });
  });

  it("times an abandoned call through its abort and marks it settled after the batch returned", async () => {
    const found = await hits();
    const measured = new MeasuredAnalyzer(new FakeCareerAnalyzer("stall", 1), { cap: 10, hits: found });
    measured.beginRun("A");
    await measured.extractJob(expectedDescription(found[0]!));
    const controller = new AbortController();
    const abandoned = measured.extractJob(expectedDescription(found[1]!), controller.signal); // stalls until abort
    abandoned.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    await measured.settle(1_000);
    const record = measured.records[1]!;
    expect(record).toMatchObject({ status: "aborted", settledAfterBatchReturn: true, candidateId: found[1]!.candidate.candidateId });
    expect(record.abortToSettleMs).toBeGreaterThanOrEqual(0);
    // Timers may fire slightly before the requested delay on performance.now(); assert a wide margin, not the exact wait.
    expect(record.durationMs).toBeGreaterThanOrEqual(15);
    expect(measured.runAbortedAt("A")).toBeDefined();
    expect(measured.runAbortedAt("B")).toBeUndefined();
  });

  it("marks a call that never settles within the settle wait as unsettled", async () => {
    const never: CareerAnalyzer = { extractProfile: vi.fn(), extractJob: () => new Promise(() => undefined), assess: vi.fn() };
    const found = await hits();
    const measured = new MeasuredAnalyzer(never, { cap: 10, hits: found });
    measured.extractJob(expectedDescription(found[0]!)).catch(() => undefined);
    await measured.settle(10);
    expect(measured.records[0]).toMatchObject({ status: "unsettled" });
    expect(measured.records[0]!.waitedMs).toBeGreaterThanOrEqual(5);
    expect(measured.records[0]!.durationMs).toBeUndefined();
  });

  it("joins hook events to the pending record of the same operation, whichever arrives first", async () => {
    const found = await hits();
    const measured = new MeasuredAnalyzer(new FakeCareerAnalyzer("ok", 5), { cap: 10, hits: found });
    const first = measured.extractJob(expectedDescription(found[0]!));
    measured.onResponseEvent({ operation: "extractJob", requestedModel: "m", durationMs: 3, outcome: "ok", responseId: "resp_1", responseModel: "m-2026", requestId: "req_1",
      upstreamProvider: "SyntheticUpstreamA", responseStatus: "completed", usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, cachedInputTokens: 2 } });
    await first;
    expect(measured.records[0]).toMatchObject({ sdkDurationMs: 3, responseId: "resp_1", responseModel: "m-2026", requestId: "req_1", upstreamProvider: "SyntheticUpstreamA", responseStatus: "completed",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, cachedInputTokens: 2 }, joinMismatch: false });
    // An event that arrives before its record is queued for the next call of that operation only.
    measured.onResponseEvent({ operation: "assess", requestedModel: "m", durationMs: 7, outcome: "error", error: { name: "APIConnectionError", status: 502, code: "bad_gateway" } });
    await measured.extractJob(expectedDescription(found[1]!));
    expect(measured.records[1]!.sdkDurationMs).toBeUndefined();
    const { job } = await measured.extractJob(expectedDescription(found[2]!));
    await measured.assess(measurementProfile, job);
    expect(measured.records[3]).toMatchObject({ operation: "assess", sdkDurationMs: 7, errorClass: "APIConnectionError", httpStatus: 502, errorCode: "bad_gateway" });
  });

  it("refuses profile extraction unless the harness enabled it", async () => {
    const inner = new FakeCareerAnalyzer("ok", 1);
    const spy = vi.spyOn(inner, "extractProfile");
    const off = new MeasuredAnalyzer(inner, { cap: 10 });
    await expect(off.extractProfile("synthetic resume")).rejects.toThrow("disabled");
    expect(spy).not.toHaveBeenCalled();
    expect(off.records).toHaveLength(0);
    const on = new MeasuredAnalyzer(inner, { cap: 10, allowProfileExtraction: true });
    await on.extractProfile("synthetic resume");
    expect(on.records[0]).toMatchObject({ operation: "extractProfile", candidateId: "profile", mappingError: false, status: "ok" });
  });
});
