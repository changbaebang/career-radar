import { describe, expect, it } from "vitest";
import { FitAssessmentSchema, JobAssessmentResultSchema, ScreeningAssessmentSchema,
  ScreeningContextV1Schema, type EvidenceRef, type ScreeningContextV1 } from "@career-radar/shared";
import { validateScreeningAssessment, validateScreeningContext, isEvidenceRefGrounded } from "../src/domain/assessment/screening.js";
import { syntheticProfile as profile, syntheticJob as job } from "./fixtures.js";
import { evalCases } from "../../evals/fixtures/cases.js";

const candidate: EvidenceRef = { source: "candidate", path: "roles[0].evidence[0]", quote: profile.roles[0]!.evidence[0]! };
const role: EvidenceRef = { source: "job", path: "required[0].text", quote: job.required[0]!.text };
function context(evidence: EvidenceRef[] = [candidate, role]): ScreeningContextV1 {
  return { version: "1", seniorityFit: { value: "aligned", confidence: "medium", explanation: "Synthetic scope comparison.", evidence },
    careerStoryRisk: { value: "low", confidence: "medium", explanation: "Synthetic career context.", evidence },
    screeningRisks: [], unknowns: [] };
}
const fit = evalCases.find((c) => c.caseId === "frontend-lead-realistic")!.draftAssessment;

describe("B1 located evidence (synthetic, no model or semantic evaluator)", () => {
  it("retains exact evidence and M1 quote/case/space/trailing-punctuation normalization", () => {
    expect(isEvidenceRefGrounded(profile, job, { ...candidate, quote: '  “LED a   React platform team.”  ' })).toBe(true);
    expect(isEvidenceRefGrounded(profile, job, { ...role, quote: "Lead a React team!" })).toBe(true);
    expect(validateScreeningContext(profile, job, context())).toEqual(context());
  });
  it.each(["roles[1].evidence[0]", "roles[0].evidence[1]", "roles[-1].evidence[0]",
    "roles[00].evidence[0]", "__proto__.evidence", "constructor", "sourceHash", "yearsExperience",
    "roles[0].start", "constraints.locations[0]", "https://example.com", "roles[0].evidence[0].length"])("rejects disallowed/missing candidate locator %s", (path) => {
    expect(isEvidenceRefGrounded(profile, job, { ...candidate, path })).toBe(false);
  });
  it("does not accept text from another source, role, or preferred requirement", () => {
    const p = { ...profile, roles: [...profile.roles, { ...profile.roles[0]!, evidence: ["Owned a synthetic backend"] }] };
    expect(isEvidenceRefGrounded(p, job, { ...candidate, path: "roles[1].evidence[0]" })).toBe(false);
    expect(isEvidenceRefGrounded(profile, job, { ...candidate, source: "job" })).toBe(false);
    const j = { ...job, preferred: [{ ...job.required[0]!, id: "preferred", text: "Optional synthetic certification" }] };
    expect(isEvidenceRefGrounded(profile, j, { ...role, quote: j.preferred[0]!.text })).toBe(false);
    expect(isEvidenceRefGrounded(profile, j, { ...role, path: "preferred[0].text", quote: j.preferred[0]!.text })).toBe(true);
  });
  it("rejects negation cutting, appended achievements, punctuation-only and unknown sources", () => {
    const p = { ...profile, roles: [{ ...profile.roles[0]!, evidence: ["Never used Kubernetes in production"] }] };
    expect(isEvidenceRefGrounded(p, job, { ...candidate, quote: "Kubernetes" })).toBe(false);
    expect(isEvidenceRefGrounded(p, job, { ...candidate, quote: p.roles[0]!.evidence[0]! })).toBe(true);
    expect(isEvidenceRefGrounded(profile, job, { ...candidate, quote: `${candidate.quote} and owned global architecture` })).toBe(false);
    expect(isEvidenceRefGrounded(profile, { ...job, description: "!!!" }, { source: "job", path: "description", quote: "!" })).toBe(false);
    expect(isEvidenceRefGrounded(profile, job, { ...candidate, source: "outcome" })).toBe(false);
  });
  it("anchors job evidence to sentence-level fields, never the whole description or title", () => {
    expect(isEvidenceRefGrounded(profile, job, { source: "job", path: "description", quote: job.description })).toBe(false);
    expect(isEvidenceRefGrounded(profile, job, { source: "job", path: "title", quote: job.title })).toBe(false);
    const j = { ...job, responsibilities: ["Build reliable React applications for commerce customers."] };
    expect(isEvidenceRefGrounded(profile, j, { source: "job", path: "responsibilities[0]", quote: j.responsibilities[0]! })).toBe(true);
    expect(isEvidenceRefGrounded(profile, j, { source: "job", path: "responsibilities[0]", quote: "React" })).toBe(false);
  });

  it("reserves unknowns headroom so validator diagnostics never reject a contract-abiding context", () => {
    const bad = { ...candidate, path: "roles[9].evidence[0]" };
    const full = context(); full.unknowns = Array.from({ length: 32 }, (_, i) => `Unknown ${i}`);
    full.screeningRisks = Array.from({ length: 8 }, () => ({ type: "career_story" as const, severity: "low" as const, confidence: "low" as const, explanation: "x", evidence: [bad] }));
    const result = validateScreeningContext(profile, job, full);
    expect(result.screeningRisks).toEqual([]);
    expect(result.unknowns).toHaveLength(40);
    const over = context(); over.unknowns = Array.from({ length: 33 }, (_, i) => `Unknown ${i}`);
    expect(() => validateScreeningContext(profile, job, over)).toThrow("more than 32 unknowns");
  });
  it("requires both sources, downgrades the whole judgment on any failed ref and removes unsupported prose", () => {
    const bad = context([candidate, role, { ...candidate, path: "roles[9].evidence[0]" }]);
    bad.seniorityFit.explanation = "SECRET-FABRICATED-EXPLANATION";
    bad.careerStoryRisk.clarificationQuestion = "SECRET-FABRICATED-QUESTION";
    bad.screeningRisks = [{ type: "career_story", severity: "high", confidence: "high", explanation: "SECRET-RISK", evidence: [candidate] }];
    const original = structuredClone(bad);
    const result = validateScreeningContext(profile, job, bad);
    expect(result.seniorityFit).toMatchObject({ value: "uncertain", confidence: "low", evidence: [candidate, role] });
    expect(result.careerStoryRisk.value).toBe("uncertain");
    expect(result.screeningRisks).toEqual([]);
    expect(result.unknowns).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain("SECRET-");
    expect(bad).toEqual(original);
    expect(validateScreeningContext(profile, job, context([role])).seniorityFit.value).toBe("uncertain");
  });
  it("does not treat a title or years field as demonstrated candidate scope", () => {
    const title: EvidenceRef = { source: "candidate", path: "roles[0].title", quote: profile.roles[0]!.title };
    const draft = context([title, role]); draft.seniorityFit.value = "overleveled";
    draft.screeningRisks = [{ type: "seniority_mismatch", severity: "high", confidence: "high", explanation: "Title-only comparison", evidence: [title, role] }];
    const result = validateScreeningContext({ ...profile, yearsExperience: 30 }, job, draft);
    expect(result.seniorityFit.value).toBe("uncertain");
    expect(result.screeningRisks).toEqual([]);
    expect(result.unknowns).toHaveLength(2);
  });
  it("keeps verified individual risks; uncertainty stays low-confidence", () => {
    const draft = context(); draft.seniorityFit.value = "uncertain"; draft.seniorityFit.confidence = "high";
    draft.screeningRisks = [{ type: "career_story", severity: "low", confidence: "medium", explanation: "Synthetic question", evidence: [candidate, role] }];
    const result = validateScreeningContext(profile, job, draft);
    expect(result.seniorityFit.confidence).toBe("low"); expect(result.screeningRisks).toEqual(draft.screeningRisks);
    expect(validateScreeningContext(profile, job, result)).toEqual(result);
  });
  it("bounds versions, text, arrays and diagnostics without silently truncating failures", () => {
    expect(ScreeningContextV1Schema.safeParse({ ...context(), version: "2" }).success).toBe(false);
    expect(ScreeningContextV1Schema.safeParse({ ...context(), extra: true }).success).toBe(false);
    expect(ScreeningContextV1Schema.safeParse(context(Array(9).fill(candidate))).success).toBe(false);
    expect(ScreeningContextV1Schema.safeParse(context([{ ...candidate, quote: "a".repeat(2001) }])).success).toBe(false);
    expect(ScreeningContextV1Schema.safeParse({ ...context(), unknowns: Array.from({ length: 49 }, (_, i) => `u${i}`) }).success).toBe(false);
  });
});

describe("B1 A-F authored contracts, not measured model judgments", () => {
  it("A: missing scope remains uncertain; paired explicit narrower scope can be preserved without changing fit", () => {
    const p = { ...profile, yearsExperience: 20 };
    const draft = context([]); draft.seniorityFit.value = "overleveled";
    expect(validateScreeningContext(p, { ...job, description: "At least two years required." }, draft).seniorityFit.value).toBe("uncertain");
    const j = { ...job, responsibilities: ["Implement pre-scoped UI tasks with no architecture ownership."] };
    const pair = context([candidate, { source: "job", path: "responsibilities[0]", quote: j.responsibilities[0]! }]);
    pair.seniorityFit.value = "overleveled";
    const result = validateScreeningAssessment(p, j, { ...fit, screeningContext: pair });
    expect(result.screeningContext?.seniorityFit.value).toBe("overleveled");
    const { screeningContext: _context, ...unchanged } = result; void _context;
    expect(unchanged).toEqual(fit);
  });
  it("B: explicit broad scope can remain aligned regardless of minimum years", () => {
    const sentence = "Own architecture decisions and mentor the delivery team.";
    const p = { ...profile, leadership: [sentence] };
    const j = { ...job, description: "At least two years required.", responsibilities: [sentence] };
    const draft = context([{ source: "candidate", path: "leadership[0]", quote: sentence },
      { source: "job", path: "responsibilities[0]", quote: sentence }]);
    expect(validateScreeningContext(p, j, draft).seniorityFit.value).toBe("aligned");
  });
  it("C: lead-to-IC does not create a risk; authored unknown intent versus explicit intent stay separate", () => {
    const draft = context(); draft.careerStoryRisk.value = "uncertain";
    draft.careerStoryRisk.clarificationQuestion = "Is hands-on work your intended next step?";
    const first = validateScreeningContext(profile, job, draft);
    expect(first.careerStoryRisk.value).toBe("uncertain"); expect(first.screeningRisks).toEqual([]);
    const p = { ...profile, headline: "I am intentionally looking for hands-on UI delivery." };
    const pair = context(); pair.careerStoryRisk.evidence = [{ source: "candidate", path: "headline", quote: p.headline }, role];
    expect(validateScreeningContext(p, job, pair).careerStoryRisk.value).toBe("low");
  });
  it.each([
    ["D", "formal-tpm-pass"], ["E", "preferred-certification-not-pass"], ["F", "ai-application-stretch"],
  ])("%s: paired required/preferred locators preserve existing fit and do not manufacture experience", (_axis, caseId) => {
    const fixture = evalCases.find((c) => c.caseId === caseId)!;
    const requirement = fixture.job.required[0]!;
    const evidence: EvidenceRef = { source: "candidate", path: "roles[0].evidence[0]", quote: fixture.profile.roles[0]!.evidence[0]! };
    for (const bucket of ["required", "preferred"] as const) {
      const j = { ...fixture.job, required: [], preferred: [], [bucket]: [requirement] };
      const c = context([evidence, { source: "job", path: `${bucket}[0].text`, quote: requirement.text }]);
      const result = validateScreeningAssessment(fixture.profile, j, { ...fixture.draftAssessment, screeningContext: c });
      const { screeningContext, ...unchanged } = result;
      expect(screeningContext?.unknowns).toEqual([]); expect(unchanged).toEqual(fixture.draftAssessment);
      const wrong = context([evidence, { source: "job", path: `${bucket === "required" ? "preferred" : "required"}[0].text`, quote: requirement.text }]);
      expect(validateScreeningContext(fixture.profile, j, wrong).seniorityFit.value).toBe("uncertain");
    }
  });
  it("keeps old payloads valid, absence unevaluated, and the new envelope out of existing strict tool/widget contracts", () => {
    expect(validateScreeningAssessment(profile, job, fit)).toEqual(fit);
    expect(validateScreeningAssessment(profile, job, fit)).not.toHaveProperty("screeningContext");
    const next = { ...fit, screeningContext: context() };
    expect(ScreeningAssessmentSchema.safeParse(next).success).toBe(true);
    expect(FitAssessmentSchema.safeParse(next).success).toBe(false);
    expect(JobAssessmentResultSchema.safeParse({ job, assessment: next }).success).toBe(false);
    expect(JobAssessmentResultSchema.safeParse({ job, assessment: fit }).success).toBe(true);
  });
});
