import { describe, expect, it, vi } from "vitest";
const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { parse }; } }));
import { OpenAICareerAnalyzer, PROMPT_VERSION } from "../src/ai/analyzer.js";
import { SCREENING_CONTEXT_DISCARDED } from "../src/domain/assessment/pipeline.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";

const candidate = { source: "candidate" as const, path: "roles[0].evidence[0]", quote: "Led a React platform team" };
const role = { source: "job" as const, path: "required[0].text", quote: "Lead a React team" };
const draftContext = {
  seniorityFit: { value: "aligned", explanation: "Demonstrated team scope matches the stated lead scope.", evidence: [candidate, role], confidence: "medium" },
  careerStoryRisk: { value: "low", explanation: "Continuous frontend leadership.", evidence: [candidate, role], clarificationQuestion: null, confidence: "medium" },
  screeningRisks: [], unknowns: ["Synthetic unknown"],
};
const draft = {
  verdict: "REALISTIC", confidence: "high", resumeContortion: "low", score: null,
  strongestMatches: [{ requirementId: "req_1", requirement: "Lead a React team", evidence: "Led a React platform team", source: { company: null, role: null, project: null }, strength: "direct" }],
  gaps: [], hardBlockers: [], interviewRisks: [], recommendation: "Synthetic recommendation.", missingInformation: [], screeningContext: draftContext,
};
function respond(output_parsed: unknown) { parse.mockResolvedValueOnce({ id: "resp_synthetic", model: "gpt-synthetic", status: "completed", output_parsed }); }
const analyzer = () => new OpenAICareerAnalyzer({ apiKey: "synthetic-not-a-real-key", model: "gpt-synthetic" });

describe("M4-B2 producer: screening context in the single assessment call", () => {
  it("bumps the prompt version and returns a versioned context from the same call", async () => {
    respond(draft);
    const result = await analyzer().assess(syntheticProfile, syntheticJob);
    expect(PROMPT_VERSION).toBe("milestone-4b2-v1");
    expect(result.promptVersion).toBe(PROMPT_VERSION);
    expect(result.verdict).toBe("REALISTIC");
    const { clarificationQuestion: _null, ...careerStoryRisk } = draftContext.careerStoryRisk; void _null;
    expect(result.screeningContext).toEqual({ version: "1", ...draftContext, careerStoryRisk });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("asks for located references, uncertainty and no demographic proxies in the structured-output request", async () => {
    respond(draft);
    await analyzer().assess(syntheticProfile, syntheticJob);
    const request = parse.mock.calls.at(-1)![0] as { instructions: string; text: { format: unknown }; store: boolean };
    expect(request.store).toBe(false);
    for (const rule of ["roles[i].evidence[j]", "required[i].text", "otherwise answer uncertain", "clarificationQuestion", "demographic", "never changes the verdict"]) {
      expect(request.instructions).toContain(rule);
    }
    const format = JSON.stringify(request.text.format);
    expect(format).toContain("fit_assessment");
    for (const key of ["screeningContext", "seniorityFit", "careerStoryRisk", "screeningRisks", "unknowns", "clarificationQuestion"]) expect(format).toContain(key);
  });

  it("drops a context outside the contract and keeps the fit, saying so once", async () => {
    const nine = Array.from({ length: 9 }, () => ({ type: "career_story", severity: "low", explanation: "x", evidence: [candidate, role], confidence: "low" }));
    respond({ ...draft, screeningContext: { ...draftContext, screeningRisks: nine } });
    const tooManyRisks = await analyzer().assess(syntheticProfile, syntheticJob);
    expect(tooManyRisks.screeningContext).toBeUndefined();
    expect(tooManyRisks.verdict).toBe("REALISTIC");
    expect(tooManyRisks.missingInformation).toEqual([SCREENING_CONTEXT_DISCARDED]);
    respond({ ...draft, screeningContext: { ...draftContext, unknowns: Array.from({ length: 33 }, (_, i) => `Unknown ${i}`) } });
    const tooManyUnknowns = await analyzer().assess(syntheticProfile, syntheticJob);
    expect(tooManyUnknowns.screeningContext).toBeUndefined();
    respond({ ...draft, screeningContext: { ...draftContext, seniorityFit: { ...draftContext.seniorityFit, explanation: "x".repeat(2001) } } });
    expect((await analyzer().assess(syntheticProfile, syntheticJob)).screeningContext).toBeUndefined();
  });
});
