import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICareerAnalyzer } from "../src/ai/analyzer.js";
import { OPENROUTER_ERRORS } from "../src/ai/openrouter.js";
import { GoldenFakeAnalyzer, keyFor, type FakeFailure, type GoldenFakeOptions } from "../../evals/fixtures/golden/fake-analyzer.js";
import { GOLDEN_SET_VERSION, goldenCases, goldenPostingText, goldenResumeText, type GoldenCase } from "../../evals/fixtures/golden/index.js";
import {
  ModelEvalReportSchema, assertModelReportRedacted, classifyFailure, compareModelReports, renderModelMarkdown, runModelEvaluation, validateGoldenSet,
  type ModelRunOptions,
} from "../../evals/model-mode.js";

const metadata = { codeSha: "a".repeat(40), dirty: false, policyHash: "b".repeat(64), schemaHash: "c".repeat(64), promptVersion: "milestone-5b-v1" };
const byId = (id: string) => { const item = goldenCases.find((c) => c.caseId === id); if (!item) throw new Error(`missing golden case ${id}`); return structuredClone(item); };
type Create = ModelRunOptions["createAnalyzer"];
// The runner hands its telemetry hook to the factory; the fake reports every call through it.
const fakeWith = (opts: GoldenFakeOptions = {}): Create => (onResponse) => new GoldenFakeAnalyzer({ ...opts, onResponse });
function options(createAnalyzer: Create, over: Partial<ModelRunOptions> = {}): ModelRunOptions {
  return {
    execution: "dry-run", provider: "fake", requestedModel: "golden-fake", store: "n/a", transport: { maxRetries: 0, logLevel: "off", timeoutMs: 1000 },
    approvals: { transmission: false }, callCap: 10_000, metadata, goldenSetVersion: GOLDEN_SET_VERSION, createAnalyzer, ...over,
  };
}
// Deterministic projection of a report: what scoring must reproduce run to run.
const scores = (report: Awaited<ReturnType<typeof runModelEvaluation>>) => report.cases.map((c) => ({
  caseId: c.caseId, outcome: c.outcome, verdict: c.assessment?.verdict, inSet: c.assessment?.verdictInAllowedSet,
  match: c.extraction?.requirementMatchRate, recallMatched: c.assessment?.blockerRecallMatched, recallAll: c.assessment?.blockerRecallAll,
  citations: c.assessment?.citations, unmatched: c.extraction?.unmatchedGold,
}));

describe("M5-D golden set", () => {
  it("has at least 30 fresh raw-text cases, unique ids, blockers inside requirements, pending review, no verdict conflicts", () => {
    expect(goldenCases.length).toBeGreaterThanOrEqual(30);
    expect(validateGoldenSet(goldenCases)).toEqual([]);
    for (const item of goldenCases) {
      expect(item.humanReview).toBe("pending");
      expect(goldenResumeText(item)).toContain("Headline:");
      expect(goldenPostingText(item)).toContain("Required:");
      expect(item.expectedBlockers.every((text) => item.goldRequirements.includes(text))).toBe(true);
    }
  });

  it("reports duplicate ids, a blocker outside the requirements and conflicting gold verdicts for identical inputs", () => {
    const base = byId("gm-frontend-lead-realistic");
    const twin: GoldenCase = { ...structuredClone(base), caseId: "gm-twin", expectedVerdicts: ["PASS"] };
    const bad: GoldenCase = { ...structuredClone(base), caseId: "gm-bad", expectedBlockers: ["Not a requirement"] };
    const problems = validateGoldenSet([base, twin, bad, { ...structuredClone(base) }]);
    expect(problems.some((p) => p.includes("conflicting gold verdicts"))).toBe(true);
    expect(problems.some((p) => p.includes("not a gold requirement"))).toBe(true);
    expect(problems.some((p) => p.includes("duplicate case id"))).toBe(true);
  });
});

describe("M5-D model-mode runner (golden fake, no network)", () => {
  it("runs extraction, assessment and the pipeline per case and produces a strict report", async () => {
    const report = await runModelEvaluation(goldenCases, options(fakeWith({})));
    expect(() => ModelEvalReportSchema.parse({ ...report, extra: 1 })).toThrow();
    expect(report).toMatchObject({ reportKind: "model-evaluation", mode: "model", execution: "dry-run", success: true, problems: [], modelCalls: goldenCases.length * 3, abortedCalls: 0, unsettledCalls: 0 });
    expect(report.metrics.outcomes).toEqual({ assessed: goldenCases.length, extractionFailed: 0, assessmentFailed: 0, notAttempted: 0 });
    expect(report.metrics.requirementMatchRate.value).toBe(1);
    expect(report.metrics.humanVerdictAgreement).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(report.responseModels).toEqual(["golden-fake"]);
    expect(report.upstreamProviders).toEqual(["fake"]);
    for (const c of report.cases) expect(c.telemetry.map((t) => t.operation)).toEqual(["extractProfile", "extractJob", "assess"]);
    expect(renderModelMarkdown(report)).toContain("## Cases");
  });

  it("scores identically when extraction assigns fresh ids to the same texts", async () => {
    const first = await runModelEvaluation(goldenCases, options(fakeWith({ idSalt: "_runA" })));
    const second = await runModelEvaluation(goldenCases, options(fakeWith({ idSalt: "_runB" })));
    expect(scores(second)).toEqual(scores(first));
    expect(first.goldenSetHash).toBe(second.goldenSetHash);
  });

  it("reports an extraction failure as such, never as an assessment failure, with the failure class", async () => {
    const item = byId("gm-frontend-lead-realistic");
    const failures = new Map<string, FakeFailure>([[keyFor(goldenPostingText(item)), { stage: "extractJob", kind: "truncation" }]]);
    const report = await runModelEvaluation([item], options(fakeWith({ failures })));
    expect(report.cases[0]).toMatchObject({ outcome: "extraction_failed", failedStage: "extractJob", failureClass: "truncation", calls: 2 });
    expect(report.cases[0]!.extraction).toBeUndefined();
    expect(report.metrics.outcomes).toMatchObject({ extractionFailed: 1, assessmentFailed: 0 });
    expect(report.metrics.truncationRate).toEqual({ numerator: 1, denominator: 1, value: 1 });
  });

  it.each([
    ["schema_failure", "schema_failure"], ["refusal", "refusal"], ["timeout", "timeout"], ["provider_error", "provider_error"], ["other", "other"],
  ] as const)("classifies an assessment failure of kind %s", async (kind, expected) => {
    const item = byId("gm-frontend-lead-realistic");
    const failures = new Map<string, FakeFailure>([[keyFor(goldenPostingText(item)), { stage: "assess", kind }]]);
    const report = await runModelEvaluation([item], options(fakeWith({ failures })));
    expect(report.cases[0]).toMatchObject({ outcome: "assessment_failed", failedStage: "assess", failureClass: expected, calls: 3 });
    expect(report.cases[0]!.extraction?.requirementMatchRate.value).toBe(1);
  });

  it("classifies from fixed messages, error names and telemetry, never from prose", () => {
    expect(classifyFailure(new Error(OPENROUTER_ERRORS.truncated))).toBe("truncation");
    expect(classifyFailure(new Error("anything"), { operation: "assess", requestedModel: "m", durationMs: 1, outcome: "ok", incompleteReason: "max_output_tokens" })).toBe("truncation");
    expect(classifyFailure(new Error(OPENROUTER_ERRORS.schemaMismatch))).toBe("schema_failure");
    expect(classifyFailure(new Error("OpenAI returned no parsed fit assessment result."))).toBe("schema_failure");
    const abort = new Error("x"); abort.name = "AbortError";
    expect(classifyFailure(abort)).toBe("timeout");
    expect(classifyFailure(new Error("The model output was truncated in prose"))).toBe("other");
  });

  it("reports blocker recall twice: matched-only 1.0 and all-gold 0.5 when extraction drops one of two blockers", async () => {
    const item = byId("gm-two-required-blockers");
    const report = await runModelEvaluation([item], options(fakeWith({ dropRequirement: new Map([[keyFor(goldenPostingText(item)), 1]]) })));
    const c = report.cases[0]!;
    expect(c.extraction).toMatchObject({ requiredExtracted: 1, requirementMatchRate: { numerator: 1, denominator: 2 } });
    expect(c.extraction?.unmatchedGold).toEqual([{ text: "Example certification required", nearestExtracted: null }]);
    expect(c.assessment?.blockerRecallMatched).toEqual({ found: 1, matched: 1, value: 1 });
    expect(c.assessment?.blockerRecallAll).toEqual({ found: 1, all: 2, value: 0.5 });
  });

  it("reports N/A, never 1.0, for matched-only recall when no gold requirement was matched", async () => {
    const item = byId("gm-two-required-blockers");
    const report = await runModelEvaluation([item], options(fakeWith({ dropRequirement: new Map([[keyFor(goldenPostingText(item)), "all"]]) })));
    const c = report.cases[0]!;
    expect(c.extraction?.requirementMatchRate).toEqual({ numerator: 0, denominator: 2, value: 0 });
    expect(c.assessment?.blockerRecallMatched).toEqual({ found: 0, matched: 0, value: null });
    expect(c.assessment?.blockerRecallAll).toEqual({ found: 0, all: 2, value: 0 });
    expect(renderModelMarkdown(report)).toContain("N/A / 0/2");
  });

  it("lists an unmatched gold requirement with the nearest extracted text without classifying the cause", async () => {
    const item = byId("gm-frontend-lead-realistic");
    item.goldRequirements = ["Lead a React platform team"]; // gold text differs from the posting's requirement line
    const report = await runModelEvaluation([item], options(fakeWith({})));
    expect(report.cases[0]!.extraction?.unmatchedGold).toEqual([{ text: "Lead a React platform team", nearestExtracted: "Lead a React team" }]);
    expect(report.cases[0]!.extraction?.unmatchedExtracted).toEqual(["Lead a React team"]);
    expect(JSON.stringify(report.cases[0])).not.toMatch(/paraphrase|semantic/);
  });

  it("counts an invented employer as an extraction outcome", async () => {
    const item = byId("gm-no-employer-named");
    const invented = await runModelEvaluation([item], options(fakeWith({ inventEmployer: true })));
    expect(invented.cases[0]!.extraction).toMatchObject({ companyNamedInPosting: false, companyExtracted: true, inventedEmployer: true });
    expect(invented.metrics.inventedEmployers).toBe(1);
    const honest = await runModelEvaluation([item], options(fakeWith({})));
    expect(honest.metrics.inventedEmployers).toBe(0);
  });

  it("reports human verdict agreement only over reviewed cases", async () => {
    const cases = goldenCases.slice(0, 4).map((item) => structuredClone(item));
    cases[0]!.humanReview = "reviewed"; cases[1]!.humanReview = "reviewed";
    const report = await runModelEvaluation(cases, options(fakeWith({})));
    expect(report.metrics.humanVerdictAgreement.denominator).toBe(2);
    expect(report.metrics.goldVerdictAgreement.denominator).toBe(4);
  });

  it("stops at the call cap, marks the rest not attempted, and reports the run as unsuccessful", async () => {
    const report = await runModelEvaluation(goldenCases.slice(0, 3), options(fakeWith({}), { callCap: 4 }));
    expect(report.cases.map((c) => c.outcome)).toEqual(["assessed", "not_attempted", "not_attempted"]);
    expect(report.modelCalls).toBe(4);
    expect(report.success).toBe(false);
    expect(report.metrics.outcomes.notAttempted).toBe(2);
  });

  it("keeps resume text, evidence sentences and posting prose out of the report", async () => {
    const report = await runModelEvaluation(goldenCases, options(fakeWith({})));
    const serialized = JSON.stringify(report) + renderModelMarkdown(report);
    expect(() => assertModelReportRedacted(serialized, goldenCases)).not.toThrow();
    const leak = serialized + goldenCases[0]!.resume.experience[0]!;
    expect(() => assertModelReportRedacted(leak, goldenCases)).toThrow("Report redaction failed.");
    // Gold requirement texts are allowed: they are the authored contract, not personal data.
    expect(serialized).toContain("Native Japanese is mandatory");
  });

  it("compares two reports case by case on the same provider, model, prompt and golden set", async () => {
    const first = await runModelEvaluation(goldenCases.slice(0, 5), options(fakeWith({})));
    const second = await runModelEvaluation(goldenCases.slice(0, 5), options(fakeWith({ idSalt: "_x" })));
    expect(compareModelReports(second, first)).toMatchObject({ compatible: true, compared: 5, outcomeChanged: [], verdictChanged: [], blockerRecallAllChanged: [] });
    const item = goldenCases[0]!;
    const failed = await runModelEvaluation(goldenCases.slice(0, 5), options(fakeWith({ failures: new Map([[keyFor(goldenPostingText(item)), { stage: "assess", kind: "refusal" }]]) })));
    expect(compareModelReports(failed, first).outcomeChanged).toEqual([item.caseId]);
    expect(compareModelReports({ ...second, provider: "openrouter" }, first)).toMatchObject({ compatible: false, incompatibleReasons: ["provider"], compared: 0 });
  });
});

describe("M5-D review fixes: golden-set stop and per-call deadline", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("stops before the analyzer exists when the golden set has integrity problems: zero calls, nothing assessed", async () => {
    const bad = byId("gm-frontend-lead-realistic");
    bad.expectedBlockers = ["Not a requirement"];
    const createAnalyzer = vi.fn(fakeWith({}));
    const report = await runModelEvaluation([bad, byId("gm-two-required-blockers")], options(createAnalyzer));
    expect(createAnalyzer).not.toHaveBeenCalled();
    expect(report.problems).toEqual(["gm-frontend-lead-realistic: expected blocker is not a gold requirement"]);
    expect(report).toMatchObject({ modelCalls: 0, abortedCalls: 0, unsettledCalls: 0, success: false });
    expect(report.cases.map((c) => c.outcome)).toEqual(["not_attempted", "not_attempted"]);
    expect(report.metrics.outcomes).toEqual({ assessed: 0, extractionFailed: 0, assessmentFailed: 0, notAttempted: 2 });
    expect(renderModelMarkdown(report)).toContain("Golden-set problems: 1 (no model call was made)");
  });

  it("cuts every call at the per-call deadline, classifies it as timeout and moves on to the next case", async () => {
    const report = await runModelEvaluation(goldenCases.slice(0, 3), options(fakeWith({ delayMs: 200 }), { callTimeoutMs: 20 }));
    expect(report.cases.map((c) => [c.outcome, c.failedStage, c.failureClass, c.calls])).toEqual(Array(3).fill(["extraction_failed", "extractProfile", "timeout", 1]));
    expect(report).toMatchObject({ modelCalls: 3, abortedCalls: 3, unsettledCalls: 0, success: true });
    expect(report.metrics.timeoutRate).toEqual({ numerator: 3, denominator: 3, value: 1 });
    for (const c of report.cases) expect(c.telemetry[0]!.durationMs).toBeLessThan(150);
  });

  it("bounds a slow response body through the real SDK where its timeout alone does not (loopback server)", async () => {
    // Headers immediately, body completed only after 400 ms: the SDK timeout (100 ms) stops at the headers.
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"id":"resp_x","object":"response","model":"m","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}');
      setTimeout(() => res.end("}"), 400);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`);
      const adapter: Create = (onResponse) => new OpenAICareerAnalyzer({ apiKey: "synthetic-not-a-real-key", onResponse, transport: { maxRetries: 0, logLevel: "off", timeout: 100 } });
      const live = { execution: "live" as const, provider: "openai", requestedModel: "synthetic-model", store: false as const };
      const control = await runModelEvaluation(goldenCases.slice(0, 1), options(adapter, live));
      // The body arrived after 400 ms and only then failed to parse: the SDK timeout did not bound it.
      expect(control.cases[0]).toMatchObject({ outcome: "extraction_failed", failedStage: "extractProfile", failureClass: "schema_failure" });
      expect(control.cases[0]!.telemetry[0]!.durationMs).toBeGreaterThanOrEqual(350);
      expect(control.abortedCalls).toBe(0);
      const bounded = await runModelEvaluation(goldenCases.slice(0, 2), options(adapter, { ...live, callTimeoutMs: 100 }));
      expect(bounded.cases.map((c) => [c.outcome, c.failureClass])).toEqual([["extraction_failed", "timeout"], ["extraction_failed", "timeout"]]);
      for (const c of bounded.cases) expect(c.telemetry[0]!.durationMs).toBeLessThan(350);
      expect(bounded).toMatchObject({ modelCalls: 2, abortedCalls: 2, unsettledCalls: 0, success: true });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
