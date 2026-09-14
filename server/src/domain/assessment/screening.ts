import { EvidenceRefSchema, ScreeningContextV1Schema, ScreeningAssessmentSchema, MAX_PRODUCER_UNKNOWNS,
  type CandidateProfile, type JobPosting, type EvidenceRef, type ScreeningContextV1,
  type ScreeningAssessment } from "@career-radar/shared";
import { normalizeEvidence } from "./normalize.js";

// Explicit locators only: never resolve arbitrary object paths, URLs or prototype properties.
// `evidence` maps chunk id → text for the chunks retrieved in this run; an `evidence` ref resolves
// only there, and with no trace every evidence ref fails closed. Each source has its own branch, so
// a ref with an unexpected source never falls through to another source's paths.
export type RetrievedTexts = ReadonlyMap<string, string>;
function located(ref: EvidenceRef, profile: CandidateProfile, job: JobPosting, evidence?: RetrievedTexts): string | undefined {
  const index = "(0|[1-9][0-9]*)";
  if (ref.source === "evidence") {
    const chunk = ref.path.match(/^chunk:([a-f0-9]{64})$/);
    return chunk ? evidence?.get(chunk[1]!) : undefined;
  }
  if (ref.source === "candidate") {
    if (ref.path === "headline") return profile.headline;
    const flat = ref.path.match(new RegExp(`^(skills|domains|leadership|customerFacing|aiEvidence|cloudEvidence)\\[${index}\\]$`));
    if (flat) return profile[flat[1] as "skills"][Number(flat[2])];
    const role = ref.path.match(new RegExp(`^roles\\[${index}\\]\\.(responsibilities|evidence)\\[${index}\\]$`));
    if (role) return profile.roles[Number(role[1])]?.[role[2] as "evidence"][Number(role[3])];
    const title = ref.path.match(new RegExp(`^roles\\[${index}\\]\\.title$`));
    return title ? profile.roles[Number(title[1])]?.title : undefined;
  }
  if (ref.source !== "job") return undefined;
  const requirement = ref.path.match(new RegExp(`^(required|preferred)\\[${index}\\]\\.text$`));
  if (requirement) return job[requirement[1] as "required"][Number(requirement[2])]?.text;
  const responsibility = ref.path.match(new RegExp(`^responsibilities\\[${index}\\]$`));
  return responsibility ? job.responsibilities[Number(responsibility[1])] : undefined;
}

export function isEvidenceRefGrounded(profile: CandidateProfile, job: JobPosting, input: unknown, evidence?: RetrievedTexts): boolean {
  const parsed = EvidenceRefSchema.safeParse(input);
  if (!parsed.success) return false;
  const source = located(parsed.data, profile, job, evidence);
  const quote = normalizeEvidence(parsed.data.quote);
  return source !== undefined && quote.length > 0 && normalizeEvidence(source) === quote;
}

// A title/headline/skill token cannot by itself support a scope comparison. This is a
// source-category guard, not NLP: whether a located sentence actually proves scope needs review.
function scopeRef(ref: EvidenceRef): boolean {
  return ref.source === "job" || /^(roles\[\d+\]\.(responsibilities|evidence)\[\d+\]|leadership\[\d+\])$/.test(ref.path);
}
function bothSources(refs: EvidenceRef[]): boolean {
  return refs.some((ref) => ref.source === "candidate") && refs.some((ref) => ref.source === "job");
}

// Pure, opt-in B1 validator. No outcome input, model calls, ranking or verdict policy.
export function validateScreeningContext(profile: CandidateProfile, job: JobPosting, input: unknown, evidence?: RetrievedTexts): ScreeningContextV1 {
  const context = ScreeningContextV1Schema.parse(input);
  // The producer contract is smaller than the schema bound; the difference is reserved for the
  // diagnostics added below, so a contract-abiding producer can never be rejected by validation.
  if (context.unknowns.length > MAX_PRODUCER_UNKNOWNS) throw new Error(`Producer supplied more than ${MAX_PRODUCER_UNKNOWNS} unknowns.`);
  const unknowns = new Set(context.unknowns);
  function check(refs: EvidenceRef[], scope: boolean) {
    const valid = refs.filter((ref) => isEvidenceRefGrounded(profile, job, ref, evidence));
    return { valid, supported: valid.length === refs.length && bothSources(scope ? valid.filter(scopeRef) : valid) };
  }
  const seniority = check(context.seniorityFit.evidence, true);
  if (!seniority.supported) {
    context.seniorityFit = { value: "uncertain", confidence: "low", evidence: seniority.valid,
      explanation: "Candidate and job scope require verified references before comparison." };
    unknowns.add("seniorityFit: missing scope references or invalid source/path/quote; marked uncertain.");
  } else if (context.seniorityFit.value === "uncertain") context.seniorityFit.confidence = "low";
  const story = check(context.careerStoryRisk.evidence, false);
  if (!story.supported) {
    context.careerStoryRisk = { value: "uncertain", confidence: "low", evidence: story.valid,
      explanation: "Career context requires verified candidate and job references.",
      clarificationQuestion: "What career context should be clarified for this role?" };
    unknowns.add("careerStoryRisk: missing references or invalid source/path/quote; marked uncertain.");
  } else if (context.careerStoryRisk.value === "uncertain") context.careerStoryRisk.confidence = "low";
  context.screeningRisks = context.screeningRisks.filter((risk, index) => {
    if (check(risk.evidence, risk.type === "seniority_mismatch").supported) return true;
    // Do not echo ungrounded explanations/quotes into unknowns or keep actionable severity.
    unknowns.add(`screeningRisks[${index}] (${risk.type}): excluded for missing references or invalid source/path/quote.`);
    return false;
  });
  // Still parse the result: bounds other than unknowns (which has reserved headroom) fail closed.
  return ScreeningContextV1Schema.parse({ ...context, unknowns: [...unknowns] });
}

export function validateScreeningAssessment(profile: CandidateProfile, job: JobPosting, input: unknown, evidence?: RetrievedTexts): ScreeningAssessment {
  const assessment = ScreeningAssessmentSchema.parse(input);
  return assessment.screeningContext === undefined ? assessment : {
    ...assessment, screeningContext: validateScreeningContext(profile, job, assessment.screeningContext, evidence),
  };
}
