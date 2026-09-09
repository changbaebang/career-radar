import { describe, expect, it } from "vitest";

import {
  CandidateProfileSchema,
  FitAssessmentSchema,
  JobPostingSchema,
} from "../src/index.js";

describe("Milestone 1 shared schemas", () => {
  it("rejects an assessment without model and prompt versions", () => {
    expect(() => FitAssessmentSchema.parse({
      verdict: "REALISTIC",
      confidence: "high",
      resumeContortion: "low",
      strongestMatches: [], gaps: [], hardBlockers: [], interviewRisks: [],
      recommendation: "Apply.", missingInformation: [],
    })).toThrow();
  });

  it("accepts privacy-safe candidate and job records", () => {
    const profile = CandidateProfileSchema.parse({
      id: "profile_1", headline: "Frontend engineer", roles: [],
      skills: ["React"], domains: [], leadership: [], customerFacing: [],
      aiEvidence: [], cloudEvidence: [], sourceHash: "a".repeat(64),
    });
    const job = JobPostingSchema.parse({
      id: "job_1", company: "Example", title: "Frontend Engineer",
      description: "Build accessible React products.", required: [], preferred: [],
      responsibilities: ["Build web products"], roleFamily: "frontend engineering",
      domains: [], technologies: ["React"],
    });
    expect(profile.skills).toEqual(["React"]);
    expect(job.title).toBe("Frontend Engineer");
  });
});
