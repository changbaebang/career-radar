import { describe, expect, it } from "vitest";
import { JobSearchInputSchema, JobRecommendInputSchema, JobRecommendationsSchema } from "../src/index.js";

describe("search and recommendation contracts", () => {
  it("bounds discovery and applies safe defaults", () => {
    expect(JobSearchInputSchema.parse({ boardToken: "synthetic" })).toEqual({ boardToken: "synthetic", limit: 5 });
    expect(JobSearchInputSchema.safeParse({ boardToken: "synthetic", resumeText: "Synthetic private data" }).success).toBe(false);
    for (const limit of [0, 11, 1.5]) expect(JobSearchInputSchema.safeParse({ boardToken: "synthetic", limit }).success).toBe(false);
  });
  it("bounds selected IDs and group requests without asking for caller-supplied verdicts", () => {
    const input = { searchId: "search_1", candidateProfileId: "profile_1", candidateIds: ["candidate_1"] };
    expect(JobRecommendInputSchema.parse(input)).toMatchObject({ realisticCount: 1, stretchCount: 1, includePass: true });
    expect(JobRecommendInputSchema.safeParse({ ...input, verdict: "REALISTIC" }).success).toBe(false);
    expect(JobRecommendInputSchema.safeParse({ ...input, candidateIds: [] }).success).toBe(false);
    expect(JobRecommendInputSchema.safeParse({ ...input, realisticCount: -1 }).success).toBe(false);
  });
  it("requires explicit failures and shortages even when no recommendations were possible", () => {
    const result = { kind: "job_recommendations", searchId: "search_1", provider: "Synthetic",
      sourceUrl: "https://boards-api.greenhouse.io", retrievedAt: "2026-09-10T00:00:00.000Z", assessedAt: "2026-09-10T00:00:00.000Z",
      requested: { realistic: 1, stretch: 1 }, available: { realistic: 0, stretch: 0, pass: 0 }, shortfall: { realistic: 1, stretch: 1 },
      realistic: [], stretch: [], pass: [], failures: [{ candidateId: "candidate_1", message: "No model result." }], warnings: [],
    };
    expect(JobRecommendationsSchema.safeParse(result).success).toBe(true);
    expect(JobRecommendationsSchema.safeParse({ ...result, failures: undefined }).success).toBe(false);
  });
});
