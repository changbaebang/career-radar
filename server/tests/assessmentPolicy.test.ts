import type { CandidateProfile, FitAssessment, JobPosting } from "@career-radar/shared";
import { describe, expect, it } from "vitest";

import { applyAssessmentPolicy } from "../src/domain/assessment/policy.js";

const profile: CandidateProfile = {
  id: "profile_test", headline: "Frontend engineer", roles: [], skills: ["React"],
  domains: [], leadership: [], customerFacing: [], aiEvidence: [], cloudEvidence: [],
  sourceHash: "a".repeat(64),
};
const job: JobPosting = {
  id: "job_test", company: "Example", title: "Frontend Engineer", description: "Test job",
  required: [{ id: "language_1", text: "Fluent Korean required", type: "language", importance: "core" }],
  preferred: [{ id: "cert_1", text: "AWS certification preferred", type: "certification", importance: "nice_to_have" }],
  responsibilities: [], roleFamily: "frontend", domains: [], technologies: ["React"],
};
const base: FitAssessment = {
  verdict: "REALISTIC", confidence: "high", resumeContortion: "low",
  strongestMatches: [{ requirement: "React", evidence: "React", source: {}, strength: "direct" }],
  gaps: [], hardBlockers: [], interviewRisks: [], recommendation: "Apply.",
  missingInformation: [], modelVersion: "test-model", promptVersion: "test-prompt",
};

describe("applyAssessmentPolicy", () => {
  it("forces PASS for a missing core language requirement", () => {
    const result = applyAssessmentPolicy(profile, job, {
      ...base,
      gaps: [{ requirementId: "language_1", requirement: "Fluent Korean required", reason: "No language evidence", severity: "material" }],
    });
    expect(result.verdict).toBe("PASS");
    expect(result.hardBlockers[0]?.severity).toBe("hard_blocker");
  });

  it("does not promote a preferred certification gap to a blocker", () => {
    const result = applyAssessmentPolicy(profile, job, {
      ...base,
      gaps: [{ requirementId: "cert_1", requirement: "AWS certification preferred", reason: "Not listed", severity: "material" }],
      hardBlockers: [{ requirementId: "cert_1", requirement: "AWS certification preferred", reason: "Not listed", severity: "hard_blocker" }],
    });
    expect(result.verdict).toBe("REALISTIC");
    expect(result.hardBlockers).toEqual([]);
  });

  it("removes ungrounded matches and prevents an unsupported REALISTIC", () => {
    const result = applyAssessmentPolicy(profile, job, {
      ...base,
      strongestMatches: [{ requirement: "Vue", evidence: "Led Vue migrations", source: {}, strength: "direct" }],
    });
    expect(result.verdict).toBe("STRETCH");
    expect(result.confidence).toBe("low");
    expect(result.strongestMatches).toEqual([]);
  });
});
