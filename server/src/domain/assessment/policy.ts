import { FitAssessmentSchema, type CandidateProfile, type EvidenceMatch, type FitAssessment, type Gap, type JobPosting } from "@career-radar/shared";

const BINARY_HARD_REQUIREMENTS = new Set(["language", "location", "certification", "education"]);
// Exact-match grounding must survive the model adding a trailing period or wrapping quotes.
// Exported so the evaluation harness compares evidence with exactly the rule the policy uses.
export const normalizeEvidence = (value: string) =>
  value.trim().toLocaleLowerCase().replaceAll(/\s+/g, " ").replace(/^["'\u201c\u2018]+|["'\u201d\u2019.,;:!?]+$/g, "");

function candidateEvidence(profile: CandidateProfile): string[] {
  return [profile.headline, ...profile.skills, ...profile.domains, ...profile.leadership,
    ...profile.customerFacing, ...profile.aiEvidence, ...profile.cloudEvidence,
    ...profile.roles.flatMap((role) => [role.title, ...role.responsibilities, ...role.evidence])].map(normalizeEvidence);
}
// Require the exact evidence the prompt asks the model to copy. Substrings allow
// either dropping a negation or appending an invented achievement.
function isGrounded(match: EvidenceMatch, evidence: string[]): boolean {
  const claim = normalizeEvidence(match.evidence);
  return evidence.includes(claim);
}
// Two gaps describe the same requirement when their IDs match or their normalized text matches, so a
// model blocker reported without an ID still collapses into the promoted gap that carries one.
function uniqueGaps(gaps: Gap[]): Gap[] {
  const seenIds = new Set<string>();
  const seenText = new Set<string>();
  return gaps.filter((gap) => {
    const text = normalizeEvidence(gap.requirement);
    if ((gap.requirementId !== undefined && seenIds.has(gap.requirementId)) || seenText.has(text)) return false;
    if (gap.requirementId !== undefined) seenIds.add(gap.requirementId);
    seenText.add(text);
    return true;
  });
}

export function applyAssessmentPolicy(profile: CandidateProfile, job: JobPosting, assessment: FitAssessment): FitAssessment {
  const evidence = candidateEvidence(profile);
  const strongestMatches = assessment.strongestMatches.filter((match) => isGrounded(match, evidence));
  const removedUngrounded = strongestMatches.length !== assessment.strongestMatches.length;
  const preferredIds = new Set(job.preferred.map((requirement) => requirement.id));
  const requiredIds = new Set(job.required.map((requirement) => requirement.id));
  const preferredText = new Set(job.preferred.map((requirement) => normalizeEvidence(requirement.text)));
  const isPreferred = (gap: Gap) => {
    // A valid ID is authoritative; text is a fallback for absent/unknown IDs.
    if (gap.requirementId !== undefined) {
      if (requiredIds.has(gap.requirementId)) return false;
      if (preferredIds.has(gap.requirementId)) return true;
    }
    return preferredText.has(normalizeEvidence(gap.requirement));
  };
  const modelBlockers = assessment.hardBlockers.filter((gap) => !isPreferred(gap));
  const promotedGaps = new Set<Gap>();
  for (const gap of assessment.gaps) {
    if (isPreferred(gap) || gap.severity === "minor") continue;
    const requirement = job.required.find((candidate) => candidate.id === gap.requirementId);
    const isBinaryCoreGap = requirement?.importance === "core" && BINARY_HARD_REQUIREMENTS.has(requirement.type);
    // An explicit hard blocker counts even when the model did not link it to a requirement ID.
    if (gap.severity === "hard_blocker" || isBinaryCoreGap) promotedGaps.add(gap);
  }
  const gaps = assessment.gaps.map((gap) => {
    if (isPreferred(gap) && gap.severity === "hard_blocker") return { ...gap, severity: "material" as const };
    return promotedGaps.has(gap) ? { ...gap, severity: "hard_blocker" as const } : gap;
  });
  // Promoted gaps come first so the deduped blocker keeps the requirement ID when the model omitted it.
  const hardBlockers = uniqueGaps([...gaps.filter((gap) => gap.severity === "hard_blocker"), ...modelBlockers]);
  let verdict = hardBlockers.length > 0 ? "PASS" as const : assessment.verdict;
  let confidence = removedUngrounded ? "low" as const : assessment.confidence;
  if (assessment.resumeContortion === "high" && verdict === "REALISTIC") verdict = "STRETCH";
  if (strongestMatches.length === 0 && verdict === "REALISTIC") { verdict = "STRETCH"; confidence = "low"; }
  const missingInformation = [...assessment.missingInformation];
  if (removedUngrounded) missingInformation.push("One or more positive claims lacked a traceable candidate-profile evidence sentence.");
  return FitAssessmentSchema.parse({ ...assessment, verdict, confidence, strongestMatches, gaps,
    hardBlockers, missingInformation: [...new Set(missingInformation)] });
}
