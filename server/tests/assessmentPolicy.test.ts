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

  it("does not ground a short claim through a longer sentence that merely contains it", () => {
    const negatedProfile: CandidateProfile = {
      ...profile,
      skills: [],
      roles: [{ company: "Example", title: "Engineer", responsibilities: ["Never used Kubernetes in production at any point"], evidence: [] }],
    };
    const result = applyAssessmentPolicy(negatedProfile, job, {
      ...base,
      strongestMatches: [{ requirement: "Kubernetes", evidence: "Kubernetes", source: {}, strength: "direct" }],
    });
    expect(result.strongestMatches).toEqual([]);
    expect(result.verdict).toBe("STRETCH");
    expect(result.confidence).toBe("low");
  });

  it("rejects an invented extension to a complete candidate evidence sentence", () => {
    const sentence = "Led a React platform team for three years";
    const richProfile: CandidateProfile = { ...profile, roles: [{ company: "Example", title: "Lead", responsibilities: [sentence], evidence: [] }] };
    const result = applyAssessmentPolicy(richProfile, job, {
      ...base,
      strongestMatches: [{ requirement: "Leadership", evidence: `${sentence} and owned company-wide architecture`, source: {}, strength: "direct" }],
    });
    expect(result.strongestMatches).toEqual([]);
    expect(result.verdict).toBe("STRETCH");
    expect(result.confidence).toBe("low");
  });

  it("accepts exact evidence after case and whitespace normalization", () => {
    const result = applyAssessmentPolicy(profile, job, {
      ...base,
      strongestMatches: [{ requirement: "React", evidence: "  REACT  ", source: {}, strength: "direct" }],
    });
    expect(result.strongestMatches).toHaveLength(1);
    expect(result.verdict).toBe("REALISTIC");
  });

  it.each(["cert_1", undefined, "unknown_id"])(
    "excludes preferred hard blockers from both arrays with ID %s",
    (requirementId) => {
      const gap = {
        requirementId, requirement: " AWS certification   preferred ",
        reason: "Not listed", severity: "hard_blocker" as const,
      };
      const result = applyAssessmentPolicy(profile, job, {
        ...base, gaps: [gap], hardBlockers: [gap],
      });
      expect(result.verdict).toBe("REALISTIC");
      expect(result.hardBlockers).toEqual([]);
      expect(result.gaps[0]?.severity).toBe("material");
    },
  );

  it("keeps a valid required ID authoritative over conflicting preferred text", () => {
    const result = applyAssessmentPolicy(profile, job, {
      ...base,
      gaps: [{
        requirementId: "language_1", requirement: "AWS certification preferred",
        reason: "Missing a required qualification", severity: "hard_blocker",
      }],
    });
    expect(result.verdict).toBe("PASS");
    expect(result.hardBlockers).toHaveLength(1);
  });

  it("forces PASS for a hard_blocker gap that has no matching requirement ID", () => {
    const result = applyAssessmentPolicy(profile, job, {
      ...base,
      gaps: [{ requirement: "Ten years of security architecture", reason: "None", severity: "hard_blocker" }],
    });
    expect(result.verdict).toBe("PASS");
    expect(result.hardBlockers).toHaveLength(1);
  });

  it("does not promote a minor gap on a core binary requirement", () => {
    const educationJob: JobPosting = {
      ...job,
      required: [{ id: "edu_1", text: "Bachelor's degree or equivalent", type: "education", importance: "core" }],
    };
    const result = applyAssessmentPolicy(profile, educationJob, {
      ...base,
      gaps: [{ requirementId: "edu_1", requirement: "Bachelor's degree", reason: "Equivalent experience", severity: "minor" }],
    });
    expect(result.verdict).toBe("REALISTIC");
    expect(result.hardBlockers).toEqual([]);
  });

  it("dedupes a model blocker without an ID against the promoted gap with an ID", () => {
    const result = applyAssessmentPolicy(profile, job, {
      ...base,
      verdict: "STRETCH",
      hardBlockers: [{ requirement: "Fluent Korean required", reason: "No Korean evidence", severity: "hard_blocker" }],
      gaps: [{ requirementId: "language_1", requirement: "Fluent Korean required", reason: "No Korean evidence", severity: "material" }],
    });
    expect(result.verdict).toBe("PASS");
    expect(result.hardBlockers).toHaveLength(1);
    expect(result.hardBlockers[0]?.requirementId).toBe("language_1");
    expect(result.gaps[0]?.severity).toBe("hard_blocker");
  });
});
