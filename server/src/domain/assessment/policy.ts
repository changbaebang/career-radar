import { FitAssessmentSchema, type CandidateProfile, type EvidenceMatch, type FitAssessment, type Gap, type JobPosting } from "@career-radar/shared";

const BINARY_HARD_REQUIREMENTS = new Set(["language", "location", "certification", "education"]);
const normalize = (value: string) => value.trim().toLocaleLowerCase().replaceAll(/\s+/g, " ");

function candidateEvidence(profile: CandidateProfile): string[] {
  return [profile.headline, ...profile.skills, ...profile.domains, ...profile.leadership,
    ...profile.customerFacing, ...profile.aiEvidence, ...profile.cloudEvidence,
    ...profile.roles.flatMap((role) => [role.title, ...role.responsibilities, ...role.evidence])].map(normalize);
}
function isGrounded(match: EvidenceMatch, evidence: string[]): boolean {
  const claim = normalize(match.evidence);
  return evidence.some(
    (item) =>
      item === claim ||
      (item.length >= 24 && (item.includes(claim) || claim.includes(item))),
  );
}
function uniqueGaps(gaps: Gap[]): Gap[] {
  const seen = new Set<string>();
  return gaps.filter((gap) => { const key = gap.requirementId ?? normalize(gap.requirement); if (seen.has(key)) return false; seen.add(key); return true; });
}

export function applyAssessmentPolicy(profile: CandidateProfile, job: JobPosting, assessment: FitAssessment): FitAssessment {
  const strongestMatches = assessment.strongestMatches.filter((match) => isGrounded(match, candidateEvidence(profile)));
  const removedUngrounded = strongestMatches.length !== assessment.strongestMatches.length;
  const preferredIds = new Set(job.preferred.map((requirement) => requirement.id));
  const hardBlockers = assessment.hardBlockers.filter(
    (gap) => gap.requirementId === undefined || !preferredIds.has(gap.requirementId),
  );
  for (const gap of assessment.gaps) {
    const requirement = job.required.find((candidate) => candidate.id === gap.requirementId);
    if (!requirement || requirement.importance !== "core") continue;
    if (gap.severity === "hard_blocker" || BINARY_HARD_REQUIREMENTS.has(requirement.type)) {
      hardBlockers.push({ ...gap, severity: "hard_blocker" });
    }
  }
  const dedupedBlockers = uniqueGaps(hardBlockers);
  let verdict = dedupedBlockers.length > 0 ? "PASS" as const : assessment.verdict;
  let confidence = removedUngrounded ? "low" as const : assessment.confidence;
  if (assessment.resumeContortion === "high" && verdict === "REALISTIC") verdict = "STRETCH";
  if (strongestMatches.length === 0 && verdict === "REALISTIC") { verdict = "STRETCH"; confidence = "low"; }
  const missingInformation = [...assessment.missingInformation];
  if (removedUngrounded) missingInformation.push("One or more positive claims lacked a traceable candidate-profile evidence sentence.");
  return FitAssessmentSchema.parse({ ...assessment, verdict, confidence, strongestMatches,
    hardBlockers: dedupedBlockers, missingInformation: [...new Set(missingInformation)] });
}
