import { z } from "zod";

// Separate from profile data. Only boardToken is used in a provider request.
export const JobSearchInputSchema = z.object({
  boardToken: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  titleKeywords: z.string().trim().min(1).max(80).optional(),
  location: z.string().trim().min(1).max(80).optional(),
  limit: z.number().int().min(1).max(10).default(5),
}).strict();

export const SearchCandidateSchema = z.object({
  candidateId: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  boardToken: JobSearchInputSchema.shape.boardToken,
  location: z.string().max(500),
  sourceUrl: z.string().url().max(2048),
  retrievedAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
}).strict();

export const JobSearchResultSchema = z.object({
  kind: z.literal("job_search"),
  searchId: z.string().min(1),
  provider: z.string().min(1),
  sourceUrl: z.string().url(),
  retrievedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  matchedCount: z.number().int().nonnegative(),
  candidates: z.array(SearchCandidateSchema).max(10),
  warnings: z.array(z.string()),
}).strict();

export const JobRecommendInputSchema = z.object({
  candidateProfileId: z.string().min(1).max(100),
  searchId: z.string().min(1).max(100),
  candidateIds: z.array(z.string().min(1).max(100)).min(1).max(5),
  realisticCount: z.number().int().min(0).max(5).default(1),
  stretchCount: z.number().int().min(0).max(5).default(1),
  includePass: z.boolean().default(true),
}).strict();

export type JobSearchInput = z.infer<typeof JobSearchInputSchema>;
export type SearchCandidate = z.infer<typeof SearchCandidateSchema>;
export type JobSearchResult = z.infer<typeof JobSearchResultSchema>;
export type JobRecommendInput = z.infer<typeof JobRecommendInputSchema>;
