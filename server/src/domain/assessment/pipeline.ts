import { FitAssessmentSchema, type CandidateProfile, type FitAssessment, type JobPosting } from "@career-radar/shared";
import { evidenceTextById, type RetrievedEvidence } from "../evidence/retrieve.js";
import { validateCitations } from "./citations.js";
import { applyAssessmentPolicy } from "./policy.js";
import { validateScreeningContext } from "./screening.js";

export const SCREENING_CONTEXT_DISCARDED =
  "Screening context was discarded because the model output did not satisfy the reference contract; the fit verdict, evidence and ranking are unaffected.";

// Deterministic post-processing shared by job_assess, job_recommend and the live-measurement replay:
// M1 policy over the fit (which keeps citations consistent with the claims it rewrites), M5-B
// validation of the surviving citations against this run's retrieved evidence, then B1
// located-reference validation of the screening context against the exact inputs the model
// received. Context problems never change the fit; they degrade to uncertainty (validator) or to an
// explicit absence with a note (here). `evidence` is the retrieval of this run; without it every
// `chunk:<id>` reference fails closed.
export function finalizeAssessment(profile: CandidateProfile, job: JobPosting, draft: FitAssessment, evidence?: RetrievedEvidence): FitAssessment {
  const assessment = validateCitations(profile, job, applyAssessmentPolicy(profile, job, draft), evidence);
  if (assessment.screeningContext === undefined) return assessment;
  try {
    return FitAssessmentSchema.parse({ ...assessment, screeningContext: validateScreeningContext(profile, job, assessment.screeningContext, evidenceTextById(evidence)) });
  } catch {
    const { screeningContext: _discarded, ...rest } = assessment;
    void _discarded;
    return FitAssessmentSchema.parse({ ...rest, missingInformation: [...new Set([...rest.missingInformation, SCREENING_CONTEXT_DISCARDED])] });
  }
}
