import { z } from "zod";
import { SearchCandidateSchema } from "./search.js";
import { ScreeningContextV1Schema } from "./screening.js";
export * from "./search.js";
export * from "./screening.js";

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

// company is absent when the posting text does not name the employer; nothing may fill it in.
export const JobPostingSchema = z.object({
  id: z.string().min(1), company: z.string().min(1).optional(), title: z.string().min(1),
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
  // Read contract: any stored 0-100 value is accepted, because snapshots saved before milestone-4b2-v2
  // can hold fractions such as 0.65 whose intended scale is unknown and must not be rewritten. The
  // generation contract (server/src/ai/contracts.ts) requires an integer on the stated 0-100 scale.
  resumeContortion: ResumeContortionSchema, score: z.number().min(0).max(100).optional(),
  strongestMatches: z.array(EvidenceMatchSchema), gaps: z.array(GapSchema),
  hardBlockers: z.array(GapSchema), interviewRisks: z.array(z.string().min(1)),
  recommendation: z.string().min(1), missingInformation: z.array(z.string().min(1)),
  modelVersion: z.string().min(1), promptVersion: z.string().min(1),
  // M4-B2: located screening context produced in the same assessment call and validated against the
  // captured inputs before storage/output. Absence means not evaluated, never low risk.
  screeningContext: ScreeningContextV1Schema.optional(),
}).strict();

export const ProfileUpsertResultSchema = z.object({
  profile: CandidateProfileSchema, warnings: z.array(z.string().min(1)),
}).strict();
// B1 introduced this extension; since B2 the base fit schema carries the optional context, so the
// name is retained as an alias for existing callers.
export const ScreeningAssessmentSchema = FitAssessmentSchema;
export type ScreeningAssessment = z.infer<typeof ScreeningAssessmentSchema>;
export const JobIngestResultSchema = z.object({
  job: JobPostingSchema, warnings: z.array(z.string().min(1)),
}).strict();
export const JobAssessmentResultSchema = z.object({
  job: JobPostingSchema, assessment: FitAssessmentSchema,
  assessmentId: z.string().min(1).optional(),
}).strict();

export const RecommendedJobSchema = z.object({
  candidate: SearchCandidateSchema,
  jobId: z.string().min(1), assessmentId: z.string().min(1),
  assessment: FitAssessmentSchema,
}).strict();
export const JobRecommendationsSchema = z.object({
  kind: z.literal("job_recommendations"), searchId: z.string().min(1),
  provider: z.string().min(1), sourceUrl: z.string().url(),
  retrievedAt: z.string().datetime(), assessedAt: z.string().datetime(),
  requested: z.object({ realistic: z.number().int().nonnegative(), stretch: z.number().int().nonnegative() }).strict(),
  available: z.object({ realistic: z.number().int().nonnegative(), stretch: z.number().int().nonnegative(), pass: z.number().int().nonnegative() }).strict(),
  shortfall: z.object({ realistic: z.number().int().nonnegative(), stretch: z.number().int().nonnegative() }).strict(),
  realistic: z.array(RecommendedJobSchema).max(5), stretch: z.array(RecommendedJobSchema).max(5),
  pass: z.array(RecommendedJobSchema).max(5),
  failures: z.array(z.object({ candidateId: z.string(), message: z.string() }).strict()).max(5),
  warnings: z.array(z.string()),
}).strict();
export type RecommendedJob = z.infer<typeof RecommendedJobSchema>;
export type JobRecommendations = z.infer<typeof JobRecommendationsSchema>;

export const ApplicationStatusSchema = z.enum(["discovered", "saved", "applied", "interview", "rejected", "withdrawn", "offer"]);
export const OutcomeStageSchema = z.enum([
  "resume_screen", "recruiter_screen", "coding_test", "technical_interview",
  "hiring_manager_interview", "final_interview", "offer", "unknown",
]);
export type OutcomeStage = z.infer<typeof OutcomeStageSchema>;
export const ApplicationSchema = z.object({
  id: z.string().min(1), jobId: z.string().min(1), candidateProfileId: z.string().min(1),
  assessmentId: z.string().min(1), status: ApplicationStatusSchema,
  verdictAtDecision: VerdictSchema, roleFamily: z.string().min(1),
  company: z.string().min(1).optional(), title: z.string().min(1),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  appliedAt: z.string().datetime().optional(),
  outcomeStage: z.string().max(200).optional(), notes: z.string().max(2000).optional(),
  normalizedOutcomeStage: OutcomeStageSchema.optional(),
  occurredAt: z.string().datetime().optional(),
  outcomeProvenance: z.enum(["user_report", "legacy_mapping"]).optional(),
  outcomeRevision: z.number().int().nonnegative().optional(),
  outcomeHistoryMode: z.enum(["append", "replace"]).optional(),
}).strict();
export const ApplicationResultSchema = z.object({ application: ApplicationSchema }).strict();
export const ApplicationSaveInputSchema = z.object({
  assessmentId: z.string().min(1).max(100), status: ApplicationStatusSchema.default("saved"),
}).strict();
export const ApplicationUpdateInputSchema = z.object({
  applicationId: z.string().min(1).max(100), status: ApplicationStatusSchema,
  stage: z.string().max(200).optional(), notes: z.string().max(2000).optional(),
  normalizedOutcomeStage: OutcomeStageSchema.nullable().optional(),
  occurredAt: z.string().datetime().nullable().optional(),
  historyMode: z.enum(["append", "replace"]).optional(),
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
  stageSummary: z.object({
    version: z.literal(1), windowBasis: z.literal("last_updated"),
    from: z.string().datetime().optional(), to: z.string().datetime().optional(),
    total: z.number().int().nonnegative(), excludedByWindow: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(), withdrawn: z.number().int().nonnegative(),
    knownStage: z.number().int().nonnegative(), unknownStage: z.number().int().nonnegative(),
    knownOccurrenceDate: z.number().int().nonnegative(), unknownOccurrenceDate: z.number().int().nonnegative(),
    resumeScreenRejected: z.number().int().nonnegative(),
    unknownStageRejected: z.number().int().nonnegative(),
    recordedProgression: z.number().int().nonnegative(),
    stageReach: z.array(z.object({ stage: OutcomeStageSchema, count: z.number().int().nonnegative() }).strict()),
    verdictStages: z.array(z.object({ verdict: VerdictSchema, stage: OutcomeStageSchema, count: z.number().int().nonnegative() }).strict()),
    roleProgression: z.array(z.object({ roleFamily: z.string(), total: z.number().int().nonnegative(), progressed: z.number().int().nonnegative(), unknownStage: z.number().int().nonnegative() }).strict()),
  }).strict().optional(),
}).strict();
export type Application = z.infer<typeof ApplicationSchema>;
export type ApplicationSaveInput = z.input<typeof ApplicationSaveInputSchema>;
export type ApplicationUpdateInput = z.infer<typeof ApplicationUpdateInputSchema>;
export type PipelineInput = z.infer<typeof PipelineInputSchema>;
export type PipelineSummary = z.infer<typeof PipelineSummarySchema>;

export const CareerRadarStatusSchema = z.object({
  name: z.literal("Career Radar"), milestone: z.literal("Milestone 4"),
  state: z.literal("ready"), message: z.string().min(1),
  checkedAt: z.string().datetime(), capabilities: z.array(z.string().min(1)).min(1),
});

// M5-A evidence corpus. A chunk is one retrievable unit of candidate evidence. `id` is a content
// hash (sha256 over sourceType, sourceId, locator and text, computed by the server chunker) so a
// citation can only name a chunk that exists in the run's corpus. `locator` reuses the B1 candidate
// path grammar for profile chunks (`roles[0].evidence[1]`) and `section:<n>/sentence:<m>` for
// documents. Read contract: additive, no existing schema changes.
export const EvidenceSourceTypeSchema = z.enum(["profile", "project", "blog", "synthetic"]);
export const EvidenceChunkSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  sourceType: EvidenceSourceTypeSchema,
  sourceId: z.string().min(1).max(200),
  locator: z.string().min(1).max(200),
  text: z.string().min(1).max(2000),
  metadata: z.record(z.string().min(1).max(100), z.string().max(500)).optional(),
}).strict();
export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;
export type EvidenceChunk = z.infer<typeof EvidenceChunkSchema>;

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
