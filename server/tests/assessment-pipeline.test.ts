import { describe, expect, it } from "vitest";
import type { EvidenceRef, FitAssessment, ScreeningContextV1 } from "@career-radar/shared";
import { SCREENING_CONTEXT_DISCARDED, finalizeAssessment } from "../src/domain/assessment/pipeline.js";
import { applyAssessmentPolicy } from "../src/domain/assessment/policy.js";
import { groundedAssessment } from "./discovery-fixtures.js";
import { syntheticJob as job, syntheticProfile as profile } from "./fixtures.js";

const candidate: EvidenceRef = { source: "candidate", path: "roles[0].evidence[0]", quote: profile.roles[0]!.evidence[0]! };
const role: EvidenceRef = { source: "job", path: "required[0].text", quote: job.required[0]!.text };
function context(evidence: EvidenceRef[] = [candidate, role]): ScreeningContextV1 {
  return { version: "1",
    seniorityFit: { value: "aligned", confidence: "medium", explanation: "Synthetic scope comparison.", evidence },
    careerStoryRisk: { value: "low", confidence: "medium", explanation: "Synthetic career context.", evidence },
    screeningRisks: [], unknowns: [] };
}
const policy = applyAssessmentPolicy(profile, job, groundedAssessment);

describe("finalizeAssessment (policy, then located-reference validation)", () => {
  it("applies the M1 policy and keeps a fully located context", () => {
    expect(finalizeAssessment(profile, job, { ...groundedAssessment, screeningContext: context() })).toEqual({ ...policy, screeningContext: context() });
  });

  it("coerces judgments with unverified references to uncertain without touching the fit", () => {
    const wrong: EvidenceRef = { ...candidate, path: "roles[0].evidence[9]" };
    const result = finalizeAssessment(profile, job, { ...groundedAssessment, screeningContext: context([wrong, role]) });
    const { screeningContext, ...fit } = result;
    expect(fit).toEqual(policy);
    expect(screeningContext).toMatchObject({ seniorityFit: { value: "uncertain", confidence: "low" }, careerStoryRisk: { value: "uncertain", confidence: "low" } });
    expect(screeningContext!.unknowns).toHaveLength(2);
    expect(JSON.stringify(screeningContext)).not.toContain("Synthetic scope comparison.");
  });

  it("leaves an absent context absent", () => {
    const result = finalizeAssessment(profile, job, groundedAssessment);
    expect(result).toEqual(policy);
    expect(result).not.toHaveProperty("screeningContext");
  });

  it("discards a context the validator rejects and records the note exactly once", () => {
    const over = context(); over.unknowns = Array.from({ length: 33 }, (_, i) => `Unknown ${i}`); // within the schema bound, beyond the producer contract
    const draft: FitAssessment = { ...groundedAssessment, screeningContext: over };
    const result = finalizeAssessment(profile, job, draft);
    expect(result).not.toHaveProperty("screeningContext");
    expect(result.missingInformation).toEqual([SCREENING_CONTEXT_DISCARDED]);
    expect(finalizeAssessment(profile, job, { ...result, screeningContext: over }).missingInformation).toEqual([SCREENING_CONTEXT_DISCARDED]);
  });

  it("policy verdict changes never depend on the context", () => {
    const invented = { ...groundedAssessment, strongestMatches: [{ ...groundedAssessment.strongestMatches[0]!, evidence: "Invented Kubernetes achievement" }] };
    const result = finalizeAssessment(profile, job, { ...invented, screeningContext: context() });
    expect(result.verdict).toBe("STRETCH");
    expect(result.confidence).toBe("low");
    expect(result.screeningContext).toEqual(context());
  });
});
