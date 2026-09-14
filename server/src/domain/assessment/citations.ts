import { FitAssessmentSchema, type CandidateProfile, type Citation, type FitAssessment, type JobPosting } from "@career-radar/shared";
import { evidenceTextById, type RetrievedEvidence } from "../evidence/retrieve.js";
import { claimIds } from "./claims.js";
import { isEvidenceRefGrounded } from "./screening.js";

// Fixed diagnostics: they name the rule, never the dropped text, so a bad citation cannot smuggle
// its quote into the result through missingInformation.
export const CITATION_INVALID_DROPPED =
  "One or more citations were dropped because their reference did not resolve to an exact retrieved chunk or input field for this run.";
export const CITATION_ORPHAN_DROPPED =
  "One or more citations were dropped because the claim they supported was removed or is not in the result.";
export const CITATION_REKEYED =
  "One or more citations were moved to a merged requirement claim.";
export const CITATION_BOUNDS_DROPPED =
  "One or more citations were dropped because they exceeded the citation contract bounds (reference length, claim id length or citation count).";

// M5-B validator, the B1 rule applied to fit citations: a citation is evidence only when its
// reference resolves against the exact inputs of this run (candidate/job paths, or a `chunk:<id>`
// that this run retrieved) and its quote equals that text under normalizeEvidence. An invalid or
// orphaned citation is dropped, diagnosed with a fixed sentence and lowers confidence; the verdict,
// evidence, gaps and blockers are never changed here.
export function validateCitations(profile: CandidateProfile, job: JobPosting, assessment: FitAssessment, evidence?: RetrievedEvidence): FitAssessment {
  if (assessment.citations === undefined) return assessment;
  const texts = evidenceTextById(evidence);
  const claims = claimIds(assessment);
  const kept: Citation[] = [];
  let invalid = 0, orphaned = 0;
  for (const citation of assessment.citations) {
    if (!claims.has(citation.claimId)) { orphaned++; continue; }
    if (!isEvidenceRefGrounded(profile, job, citation.ref, texts)) { invalid++; continue; }
    kept.push(citation);
  }
  if (invalid === 0 && orphaned === 0) return assessment;
  const missingInformation = [...assessment.missingInformation];
  if (invalid) missingInformation.push(CITATION_INVALID_DROPPED);
  if (orphaned) missingInformation.push(CITATION_ORPHAN_DROPPED);
  return FitAssessmentSchema.parse({
    ...assessment, citations: kept, missingInformation: [...new Set(missingInformation)],
    ...(invalid ? { confidence: "low" as const } : {}),
  });
}
