import { describe, expect, it } from "vitest";
import { MAX_CITATIONS } from "@career-radar/shared";
import { AssessmentDraftSchema, toAssessment } from "../src/ai/contracts.js";
import { CITATION_BOUNDS_DROPPED } from "../src/domain/assessment/citations.js";
import { TEXT_HASH_CLAIM_PREFIX } from "../src/domain/assessment/claims.js";

// The generation schema carries no bounds (strict JSON schemas reject them); the read contract does.
// A citation that fits the draft but not the read contract must be dropped with a note, never turn
// the whole fit into a ZodError (which would lose the job_assess result and fail the batch candidate).
const ref = (path: string, quote: string) => ({ source: "evidence" as const, path, quote });
const chunkPath = `chunk:${"a".repeat(64)}`;
const match = { requirementId: "req_1", requirement: "Lead a React team", evidence: "Led a React platform team", source: { company: null, role: null, project: null }, strength: "direct" as const, citations: [] as ReturnType<typeof ref>[] };
const context = {
  seniorityFit: { value: "uncertain" as const, explanation: "Synthetic.", evidence: [], confidence: "low" as const },
  careerStoryRisk: { value: "uncertain" as const, explanation: "Synthetic.", evidence: [], clarificationQuestion: null, confidence: "low" as const },
  screeningRisks: [], unknowns: [],
};
const draft = {
  verdict: "REALISTIC" as const, confidence: "high" as const, resumeContortion: "low" as const, score: null,
  strongestMatches: [match], gaps: [], hardBlockers: [], interviewRisks: [], recommendation: "Synthetic recommendation.",
  missingInformation: [], screeningContext: context,
};
const withMatchCitations = (citations: ReturnType<typeof ref>[]) => ({ ...draft, strongestMatches: [{ ...match, citations }] });

describe("M5-B generation → read contract: citation bounds never fail the fit", () => {
  it("keeps an in-bounds citation and the model's confidence (control)", () => {
    const input = withMatchCitations([ref(chunkPath, "Led a React platform team")]);
    expect(AssessmentDraftSchema.safeParse(input).success).toBe(true);
    const result = toAssessment(input, "synthetic");
    expect(result.citations).toHaveLength(1);
    expect(result.confidence).toBe("high");
    expect(result.missingInformation).not.toContain(CITATION_BOUNDS_DROPPED);
  });

  it.each([
    ["a quote of 2,001 characters", [ref(chunkPath, "x".repeat(2001))]],
    ["a path of 161 characters", [ref(`chunk:${"a".repeat(155)}`, "quote")]],
    ["a whitespace-only quote", [ref(chunkPath, "   ")]],
  ])("drops a citation with %s, says so once, lowers confidence and keeps the fit", (_label, citations) => {
    const input = withMatchCitations(citations);
    expect(AssessmentDraftSchema.safeParse(input).success).toBe(true);
    const result = toAssessment(input, "synthetic");
    expect(result.verdict).toBe("REALISTIC");
    expect(result.strongestMatches).toHaveLength(1);
    expect(result.citations).toEqual([]);
    expect(result.confidence).toBe("low");
    expect(result.missingInformation.filter((note) => note === CITATION_BOUNDS_DROPPED)).toHaveLength(1);
    expect(result.missingInformation.join(" ")).not.toContain("xxxx");
  });

  it("caps the citation list at the read-contract maximum and notes the surplus", () => {
    const input = withMatchCitations(Array.from({ length: MAX_CITATIONS + 1 }, () => ref(chunkPath, "Led a React platform team")));
    const result = toAssessment(input, "synthetic");
    expect(result.citations).toHaveLength(MAX_CITATIONS);
    expect(result.confidence).toBe("low");
    expect(result.missingInformation).toContain(CITATION_BOUNDS_DROPPED);
    const exact = withMatchCitations(Array.from({ length: MAX_CITATIONS }, () => ref(chunkPath, "Led a React platform team")));
    expect(toAssessment(exact, "synthetic")).toMatchObject({ confidence: "high" });
  });

  it("gives an ID-less gap with a 196-character requirement a bounded hashed claim id and keeps its citation", () => {
    const requirement = "r".repeat(196);
    const input = { ...draft, gaps: [{ requirementId: null, requirement, reason: "Synthetic.", severity: "material" as const, citations: [ref(chunkPath, "Led a React platform team")] }] };
    expect(AssessmentDraftSchema.safeParse(input).success).toBe(true);
    const result = toAssessment(input, "synthetic");
    expect(result.citations).toHaveLength(1);
    expect(result.citations?.[0]?.claimId.startsWith(TEXT_HASH_CLAIM_PREFIX)).toBe(true);
    expect(result.citations?.[0]?.claimId.length).toBeLessThanOrEqual(200);
    expect(result.confidence).toBe("high");
    expect(result.gaps[0]).not.toHaveProperty("citations");
  });
});
