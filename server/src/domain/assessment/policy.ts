import { FitAssessmentSchema, type CandidateProfile, type Citation, type EvidenceMatch, type FitAssessment, type Gap, type JobPosting } from "@career-radar/shared";
import { CITATION_ORPHAN_DROPPED, CITATION_REKEYED } from "./citations.js";
import { claimIds, requirementClaimId } from "./claims.js";
import { normalizeEvidence } from "./normalize.js";

// Re-exported so the evaluation harness compares evidence with exactly the rule the policy uses.
export { normalizeEvidence } from "./normalize.js";

const BINARY_HARD_REQUIREMENTS = new Set(["language", "location", "certification", "education"]);

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
// `merged` maps the claim id of each collapsed gap to the surviving gap's claim id, so the citations
// of the collapsed gap can follow it (M5-B).
function uniqueGaps(gaps: Gap[]): { gaps: Gap[]; merged: Map<string, string> } {
  const byId = new Map<string, Gap>();
  const byText = new Map<string, Gap>();
  const merged = new Map<string, string>();
  const survivors: Gap[] = [];
  for (const gap of gaps) {
    const text = normalizeEvidence(gap.requirement);
    const survivor = (gap.requirementId !== undefined ? byId.get(gap.requirementId) : undefined) ?? byText.get(text);
    if (survivor) {
      const from = requirementClaimId(gap), to = requirementClaimId(survivor);
      if (from !== to) merged.set(from, to);
      continue;
    }
    survivors.push(gap);
    if (gap.requirementId !== undefined) byId.set(gap.requirementId, gap);
    byText.set(text, gap);
  }
  return { gaps: survivors, merged };
}

// M5-B: citations follow the claims the policy keeps. A removed match takes its citations with it
// (orphan, dropped), a collapsed gap hands its citations to the survivor (re-keyed), and every drop
// or re-key is recorded as a fixed sentence. Absent citations stay absent (pre-M5-B results).
function reconcileCitations(citations: Citation[] | undefined, surviving: Set<string>, merged: Map<string, string>): { citations?: Citation[]; notes: string[] } {
  if (citations === undefined) return { notes: [] };
  const kept: Citation[] = [];
  let rekeyed = false, orphaned = false;
  for (const citation of citations) {
    let claimId = citation.claimId;
    if (!surviving.has(claimId) && merged.has(claimId)) { claimId = merged.get(claimId)!; rekeyed = true; }
    if (!surviving.has(claimId)) { orphaned = true; continue; }
    kept.push({ ...citation, claimId });
  }
  return { citations: kept, notes: [...(rekeyed ? [CITATION_REKEYED] : []), ...(orphaned ? [CITATION_ORPHAN_DROPPED] : [])] };
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
  const { gaps: hardBlockers, merged } = uniqueGaps([...gaps.filter((gap) => gap.severity === "hard_blocker"), ...modelBlockers]);
  const reconciled = reconcileCitations(assessment.citations, claimIds({ strongestMatches, gaps, hardBlockers }), merged);
  let verdict = hardBlockers.length > 0 ? "PASS" as const : assessment.verdict;
  let confidence = removedUngrounded ? "low" as const : assessment.confidence;
  if (assessment.resumeContortion === "high" && verdict === "REALISTIC") verdict = "STRETCH";
  if (strongestMatches.length === 0 && verdict === "REALISTIC") { verdict = "STRETCH"; confidence = "low"; }
  const missingInformation = [...assessment.missingInformation, ...reconciled.notes];
  if (removedUngrounded) missingInformation.push("One or more positive claims lacked a traceable candidate-profile evidence sentence.");
  return FitAssessmentSchema.parse({ ...assessment, verdict, confidence, strongestMatches, gaps,
    hardBlockers, missingInformation: [...new Set(missingInformation)],
    ...(reconciled.citations !== undefined ? { citations: reconciled.citations } : {}) });
}
