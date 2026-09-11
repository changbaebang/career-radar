import { FitAssessmentSchema, type CandidateProfile, type FitAssessment, type JobPosting } from "@career-radar/shared";
import { applyAssessmentPolicy } from "./policy.js";
import { validateScreeningContext } from "./screening.js";

export const SCREENING_CONTEXT_DISCARDED =
  "Screening context was discarded because the model output did not satisfy the reference contract; the fit verdict, evidence and ranking are unaffected.";

// Deterministic post-processing shared by job_assess, job_recommend and the live-measurement replay:
// M1 policy over the fit, then B1 located-reference validation of the screening context against the
// exact inputs the model received. Context problems never change the fit; they degrade to uncertainty
// (validator) or to an explicit absence with a note (here).
export function finalizeAssessment(profile: CandidateProfile, job: JobPosting, draft: FitAssessment): FitAssessment {
  const assessment = applyAssessmentPolicy(profile, job, draft);
  if (assessment.screeningContext === undefined) return assessment;
  try {
    return FitAssessmentSchema.parse({ ...assessment, screeningContext: validateScreeningContext(profile, job, assessment.screeningContext) });
  } catch {
    const { screeningContext: _discarded, ...rest } = assessment;
    void _discarded;
    return FitAssessmentSchema.parse({ ...rest, missingInformation: [...new Set([...rest.missingInformation, SCREENING_CONTEXT_DISCARDED])] });
  }
}
