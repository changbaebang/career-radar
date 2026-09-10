import { z } from "zod";

export const VerdictSchema = z.enum(["REALISTIC", "STRETCH", "PASS"]);
export const ConfidenceSchema = z.enum(["low", "medium", "high"]);
export const ResumeContortionSchema = z.enum(["low", "medium", "high"]);

export const CandidateRoleSchema = z.object({
  company: z.string().min(1), title: z.string().min(1),
  start: z.string().min(1).optional(), end: z.string().min(1).optional(),
  responsibilities: z.array(z.string().min(1)), evidence: z.array(z.string().min(1)),
}).strict();

export const CandidateProfileSchema = z.object({
  id: z.string().min(1), headline: z.string().min(1),
  yearsExperience: z.number().nonnegative().optional(), roles: z.array(CandidateRoleSchema),
  skills: z.array(z.string().min(1)), domains: z.array(z.string().min(1)),
  leadership: z.array(z.string().min(1)), customerFacing: z.array(z.string().min(1)),
  aiEvidence: z.array(z.string().min(1)), cloudEvidence: z.array(z.string().min(1)),
  constraints: z.object({
    locations: z.array(z.string().min(1)).optional(),
    remotePreference: z.string().min(1).optional(),
    languages: z.array(z.string().min(1)).optional(),
  }).strict().optional(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const RequirementTypeSchema = z.enum([
  "role_experience", "domain", "technology", "leadership", "customer",
  "education", "language", "location", "certification", "other",
]);

export const RequirementSchema = z.object({
  id: z.string().min(1), text: z.string().min(1), type: RequirementTypeSchema,
  importance: z.enum(["core", "important", "nice_to_have"]),
}).strict();

export const JobPostingSchema = z.object({
  id: z.string().min(1), company: z.string().min(1), title: z.string().min(1),
  location: z.string().min(1).optional(), sourceUrl: z.string().url().optional(),
  description: z.string().min(1), required: z.array(RequirementSchema),
  preferred: z.array(RequirementSchema), responsibilities: z.array(z.string().min(1)),
  roleFamily: z.string().min(1), domains: z.array(z.string().min(1)),
  technologies: z.array(z.string().min(1)), seniority: z.string().min(1).optional(),
}).strict();

export const EvidenceMatchSchema = z.object({
  requirementId: z.string().min(1).optional(), requirement: z.string().min(1),
  evidence: z.string().min(1), source: z.object({
    company: z.string().min(1).optional(), role: z.string().min(1).optional(),
    project: z.string().min(1).optional(),
  }).strict(), strength: z.enum(["direct", "adjacent", "weak"]),
}).strict();

export const GapSchema = z.object({
  requirementId: z.string().min(1).optional(), requirement: z.string().min(1),
  reason: z.string().min(1), severity: z.enum(["minor", "material", "hard_blocker"]),
}).strict();

export const FitAssessmentSchema = z.object({
  verdict: VerdictSchema, confidence: ConfidenceSchema,
  resumeContortion: ResumeContortionSchema, score: z.number().min(0).max(100).optional(),
  strongestMatches: z.array(EvidenceMatchSchema), gaps: z.array(GapSchema),
  hardBlockers: z.array(GapSchema), interviewRisks: z.array(z.string().min(1)),
  recommendation: z.string().min(1), missingInformation: z.array(z.string().min(1)),
  modelVersion: z.string().min(1), promptVersion: z.string().min(1),
}).strict();

export const ProfileUpsertResultSchema = z.object({
  profile: CandidateProfileSchema, warnings: z.array(z.string().min(1)),
}).strict();
export const JobIngestResultSchema = z.object({
  job: JobPostingSchema, warnings: z.array(z.string().min(1)),
}).strict();
export const JobAssessmentResultSchema = z.object({
  job: JobPostingSchema, assessment: FitAssessmentSchema,
  assessmentId: z.string().min(1).optional(),
}).strict();

export const ApplicationStatusSchema = z.enum(["discovered", "saved", "applied", "interview", "rejected", "withdrawn", "offer"]);
export const ApplicationSchema = z.object({
  id: z.string().min(1), jobId: z.string().min(1), candidateProfileId: z.string().min(1),
  assessmentId: z.string().min(1), status: ApplicationStatusSchema,
  verdictAtDecision: VerdictSchema, roleFamily: z.string().min(1),
  company: z.string().min(1), title: z.string().min(1),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  appliedAt: z.string().datetime().optional(),
  outcomeStage: z.string().max(200).optional(), notes: z.string().max(2000).optional(),
}).strict();
export const ApplicationResultSchema = z.object({ application: ApplicationSchema }).strict();
export const ApplicationSaveInputSchema = z.object({
  assessmentId: z.string().min(1).max(100), status: ApplicationStatusSchema.default("saved"),
}).strict();
export const ApplicationUpdateInputSchema = z.object({
  applicationId: z.string().min(1).max(100), status: ApplicationStatusSchema,
  stage: z.string().max(200).optional(), notes: z.string().max(2000).optional(),
}).strict();
export const PipelineInputSchema = z.object({
  from: z.string().datetime().optional(), to: z.string().datetime().optional(),
}).strict();
export const PipelineSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  byStatus: z.array(z.object({ status: ApplicationStatusSchema, count: z.number().int().nonnegative() })),
  byRoleFamily: z.array(z.object({ roleFamily: z.string(), count: z.number().int().nonnegative() })),
  verdictOutcomes: z.array(z.object({ verdict: VerdictSchema, status: ApplicationStatusSchema, count: z.number().int().nonnegative() })),
  applications: z.array(ApplicationSchema), observations: z.array(z.string()),
}).strict();
export type Application = z.infer<typeof ApplicationSchema>;
export type ApplicationSaveInput = z.input<typeof ApplicationSaveInputSchema>;
export type ApplicationUpdateInput = z.infer<typeof ApplicationUpdateInputSchema>;
export type PipelineInput = z.infer<typeof PipelineInputSchema>;
export type PipelineSummary = z.infer<typeof PipelineSummarySchema>;

export const CareerRadarStatusSchema = z.object({
  name: z.literal("Career Radar"), milestone: z.literal("Milestone 2"),
  state: z.literal("ready"), message: z.string().min(1),
  checkedAt: z.string().datetime(), capabilities: z.array(z.string().min(1)).min(1),
});

export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type JobPosting = z.infer<typeof JobPostingSchema>;
export type EvidenceMatch = z.infer<typeof EvidenceMatchSchema>;
export type Gap = z.infer<typeof GapSchema>;
export type FitAssessment = z.infer<typeof FitAssessmentSchema>;
export type ProfileUpsertResult = z.infer<typeof ProfileUpsertResultSchema>;
export type JobIngestResult = z.infer<typeof JobIngestResultSchema>;
export type JobAssessmentResult = z.infer<typeof JobAssessmentResultSchema>;
export type CareerRadarStatus = z.infer<typeof CareerRadarStatusSchema>;
