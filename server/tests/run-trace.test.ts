import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CareerAnalyzer } from "../src/ai/analyzer.js";
import type { AnalyzerResponseEvent } from "../src/ai/telemetry.js";
import { finalizeAssessmentDetailed } from "../src/domain/assessment/pipeline.js";
import { retrieveEvidence } from "../src/domain/evidence/retrieve.js";
import { RUN_TRACE_VERSION, RunTracer, currentTrace, digestQuery, runWithTrace, traceHook } from "../src/domain/trace/run-trace.js";
import { renderTrace, renderTraceList } from "../src/domain/trace/render.js";
import { TraceStore, isRunId } from "../src/domain/trace/store.js";
import { assertRedacted } from "../scripts/measure-live/report.js";
import { groundedAssessment } from "./discovery-fixtures.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";

const directories: string[] = [];
const temporary = () => { const d = mkdtempSync(join(tmpdir(), "career-radar-traces-")); directories.push(d); return d; };
afterEach(() => { for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }); });

// Mimics an adapter: the telemetry hook fires while the call is still open, as observeCall does.
const event = (operation: AnalyzerResponseEvent["operation"]): AnalyzerResponseEvent =>
  ({ operation, requestedModel: "m", durationMs: 5, outcome: "ok", responseModel: "fake-model", upstreamProvider: "FakeCloud", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, reasoningTokens: 7 } });
const analyzer: CareerAnalyzer = {
  extractProfile: async () => { traceHook(event("extractProfile")); return { profile: syntheticProfile, warnings: [] }; },
  extractJob: async () => { traceHook(event("extractJob")); return { job: syntheticJob, warnings: [] }; },
  assess: async () => { traceHook(event("assess")); return groundedAssessment; },
};
const inputTexts = [syntheticJob.description, ...syntheticProfile.roles.flatMap((role) => role.evidence), ...syntheticJob.required.map((r) => r.text), "Synthetic unsupported scope claim."];

async function tracedAssess(tracer: RunTracer, inner: CareerAnalyzer = analyzer) {
  return runWithTrace(tracer, async () => {
    expect(currentTrace()).toBe(tracer);
    const evidence = await tracer.stage("retrieve", () => retrieveEvidence(syntheticProfile, syntheticJob), (found) => tracer.retrieveDetail(found));
    const draft = await tracer.wrap(inner).assess(syntheticProfile, syntheticJob, undefined, evidence);
    const done = await tracer.stage("validate", () => finalizeAssessmentDetailed(syntheticProfile, syntheticJob, draft, evidence), (d) => tracer.validateDetail(draft, d.assessment, d.diagnostics));
    await tracer.stage("persist", () => "assessment_1");
    return done.assessment;
  });
}

describe("M5-E run trace", () => {
  it("records retrieve, model, validate and persist stages with timings, attributes the telemetry to the open model stage, and never copies input text", async () => {
    const tracer = new RunTracer("job_assess");
    await tracedAssess(tracer);
    const trace = tracer.finish("ok");
    expect(trace).toMatchObject({ version: RUN_TRACE_VERSION, tool: "job_assess", outcome: "ok", counters: { modelCalls: 1, timeouts: 0, fallbacks: 0, toolFailures: 0 } });
    expect(isRunId(trace.runId)).toBe(true);
    expect(trace.stages.map((s) => s.stage)).toEqual(["retrieve", "model", "validate", "persist"]);
    const [retrieve, model, validate] = trace.stages;
    expect(retrieve!.retrieval).toMatchObject({ queries: syntheticJob.required.length + syntheticJob.preferred.length });
    expect(retrieve!.retrieval!.queryDigests[0]).toEqual({ hash: digestQuery(syntheticJob.required[0]!.text), length: syntheticJob.required[0]!.text.length, hits: expect.any(Array) });
    expect(model).toMatchObject({ operation: "assess", outcome: "ok", responseModel: "fake-model", upstreamProvider: "FakeCloud", usage: { reasoningTokens: 7 } });
    expect(validate!.validation).toMatchObject({ draftVerdict: groundedAssessment.verdict, citationsSupplied: groundedAssessment.citations?.length ?? 0, diagnostics: { citationsInvalid: expect.any(Number) } });
    expect(currentTrace()).toBeUndefined();
    expect(() => assertRedacted(JSON.stringify(trace) + renderTrace(trace), inputTexts)).not.toThrow();
  });

  it("stamps the run id on the telemetry event so other consumers can correlate", async () => {
    const tracer = new RunTracer("job_assess");
    const seen: AnalyzerResponseEvent[] = [];
    const observed: CareerAnalyzer = { ...analyzer, assess: async () => { const e = event("assess"); traceHook(e); seen.push(e); return groundedAssessment; } };
    await tracedAssess(tracer, observed);
    expect(seen[0]!.runId).toBe(tracer.runId);
    const outside = event("assess"); traceHook(outside);
    expect(outside.runId).toBeUndefined();
  });

  it("classifies a failed model stage, marks a deadline abort as aborted, and keeps the failing run redacted", async () => {
    const tracer = new RunTracer("job_assess");
    const abort = new Error("The operation was aborted"); abort.name = "AbortError";
    const failing: CareerAnalyzer = { ...analyzer, assess: async () => { throw abort; } };
    await expect(tracedAssess(tracer, failing)).rejects.toBe(abort);
    const trace = tracer.finish("failed", abort);
    expect(trace).toMatchObject({ outcome: "failed", failureClass: "timeout", counters: { modelCalls: 1, timeouts: 1 } });
    expect(trace.stages.map((s) => [s.stage, s.outcome])).toEqual([["retrieve", "ok"], ["model", "aborted"]]);
    expect(trace.stages[1]).toMatchObject({ failureClass: "timeout", errorName: "AbortError" });
    expect(() => assertRedacted(JSON.stringify(trace) + renderTrace(trace), inputTexts)).not.toThrow();
  });

  it("carries the candidate index on batch stages and counts pipeline diagnostics into the run counters", async () => {
    const tracer = new RunTracer("job_recommend");
    tracer.item(0); await tracedAssess(tracer); tracer.item(1); await tracedAssess(tracer);
    const trace = tracer.finish("partial");
    expect(trace.stages.filter((s) => s.item === 1)).toHaveLength(4);
    expect(trace.counters.modelCalls).toBe(2);
    const invalid = trace.stages.filter((s) => s.validation).reduce((n, s) => n + s.validation!.diagnostics.citationsInvalid, 0);
    expect(trace.counters.invalidCitations).toBe(invalid);
    expect(renderTrace(trace)).toContain("#1  validate");
  });
});

describe("M5-E trace store", () => {
  it("writes each trace as a private file, reads it back by id, lists newest first, and clears", async () => {
    const directory = temporary();
    const store = new TraceStore(directory);
    const first = new RunTracer("job_assess"); await tracedAssess(first); store.save(first.finish("ok"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = new RunTracer("job_recommend"); store.save(second.finish("failed", new Error("x")));
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(directory, `${first.runId}.json`)).mode & 0o777).toBe(0o600);
    expect(store.get(first.runId)?.tool).toBe("job_assess");
    expect(new TraceStore(directory).get(first.runId)?.stages.map((s) => s.stage)).toEqual(["retrieve", "model", "validate", "persist"]);
    expect(store.get("../etc/passwd")).toBeUndefined();
    expect(store.list().map((t) => t.tool)).toEqual(["job_recommend", "job_assess"]);
    expect(renderTraceList(store.list(), directory)).toContain(first.runId);
    expect(store.clear()).toBe(2);
    expect(readdirSync(directory)).toEqual([]);
    expect(renderTraceList(store.list(), directory)).toContain("No run traces");
  });

  it("keeps only the newest traces in memory when no directory is given", () => {
    const store = new TraceStore(undefined, 2);
    const ids = [1, 2, 3].map(() => { const t = new RunTracer("job_assess"); store.save(t.finish("ok")); return t.runId; });
    expect(store.get(ids[0]!)).toBeUndefined();
    expect(store.list()).toHaveLength(2);
  });
});
