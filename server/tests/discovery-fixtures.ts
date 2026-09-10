import type { FitAssessment, RecommendedJob } from "@career-radar/shared";
import type { ProviderSearchResult } from "../src/infra/search/greenhouse.js";

export const discoveryResult: ProviderSearchResult = {
  provider: "Synthetic provider", sourceUrl: "https://boards-api.greenhouse.io/v1/boards/synthetic/jobs?content=true",
  retrievedAt: "2026-09-10T00:00:00.000Z", matchedCount: 3, warnings: ["Synthetic test inputs only."],
  hits: [1, 2, 3].map((id) => ({
    candidate: { candidateId: `synthetic_${id}`, title: `Synthetic role ${id}`, boardToken: "synthetic", location: "Remote",
      sourceUrl: `https://job-boards.greenhouse.io/synthetic/jobs/${id}`, retrievedAt: "2026-09-10T00:00:00.000Z" },
    description: `Synthetic role ${id}. Lead a React team building accessible frontend platform tools.`,
  })),
};
export const groundedAssessment: FitAssessment = {
  verdict: "REALISTIC", confidence: "high", resumeContortion: "low",
  strongestMatches: [{ requirementId: "req_1", requirement: "Lead a React team", evidence: "Led a React platform team", source: {}, strength: "direct" }],
  gaps: [], hardBlockers: [], interviewRisks: [], missingInformation: [], recommendation: "Synthetic grounded recommendation.",
  modelVersion: "synthetic-no-model", promptVersion: "synthetic-v1",
};
export function recommendedItem(id: number, overrides: Partial<FitAssessment> = {}): RecommendedJob {
  return { candidate: discoveryResult.hits[id - 1]!.candidate, jobId: `job_${id}`, assessmentId: `assessment_${id}`,
    assessment: { ...groundedAssessment, ...overrides } };
}
