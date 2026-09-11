import { z } from "zod";

const text = z.string().trim().min(1).max(2000);
const confidence = z.enum(["low", "medium", "high"]);
export const EvidenceRefSchema = z.object({
  source: z.enum(["candidate", "job"]),
  path: z.string().min(1).max(160),
  quote: z.string().trim().min(1).max(16000),
}).strict();
const evidence = z.array(EvidenceRefSchema).max(8);

// B1 contract only. The existing model output and MCP/widget schemas remain unchanged.
export const ScreeningContextV1Schema = z.object({
  version: z.literal("1"),
  seniorityFit: z.object({
    value: z.enum(["aligned", "underleveled", "overleveled", "uncertain"]),
    explanation: text, evidence, confidence,
  }).strict(),
  careerStoryRisk: z.object({
    value: z.enum(["low", "medium", "high", "uncertain"]),
    explanation: text, evidence, confidence, clarificationQuestion: text.optional(),
  }).strict(),
  screeningRisks: z.array(z.object({
    type: z.enum(["seniority_mismatch", "job_family_transition", "career_story",
      "domain_depth", "recent_experience", "formal_title_gap"]),
    severity: z.enum(["low", "medium", "high"]), explanation: text, evidence, confidence,
  }).strict()).max(8),
  unknowns: z.array(z.string().trim().min(1).max(500)).max(32),
}).strict();

export const AssessmentInputIdentitySchema = z.object({
  version: z.literal("structured-input-v1"),
  profileHash: z.string().regex(/^[a-f0-9]{64}$/),
  jobHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type ScreeningContextV1 = z.infer<typeof ScreeningContextV1Schema>;
export type AssessmentInputIdentity = z.infer<typeof AssessmentInputIdentitySchema>;
