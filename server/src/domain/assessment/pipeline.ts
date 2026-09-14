import { FitAssessmentSchema, type CandidateProfile, type FitAssessment, type JobPosting } from "@career-radar/shared";
import { evidenceTextById, type RetrievedEvidence } from "../evidence/retrieve.js";
import { validateCitationsDetailed, type CitationDiagnostics } from "./citations.js";
import { applyAssessmentPolicyDetailed, type PolicyDiagnostics } from "./policy.js";
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
  return finalizeAssessmentDetailed(profile, job, draft, evidence).assessment;
}

// What each stage actually did, as counts and flags, separately from the assessment text. The fixed
// sentences the stages add to missingInformation are the user-facing trace of the same events, but a
// model can write those sentences too, so attribution must come from here, never from the text.
// Notes added inside the adapter mapping (citation bounds, producer-side context discard) happen
// before this pipeline and are not attributable from it.
export type PipelineDiagnostics = PolicyDiagnostics & CitationDiagnostics & { screeningContextDiscarded: boolean };

export function finalizeAssessmentDetailed(profile: CandidateProfile, job: JobPosting, draft: FitAssessment, evidence?: RetrievedEvidence): { assessment: FitAssessment; diagnostics: PipelineDiagnostics } {
  const policy = applyAssessmentPolicyDetailed(profile, job, draft);
  const citations = validateCitationsDetailed(profile, job, policy.assessment, evidence);
  const assessment = citations.assessment;
  const diagnostics = { ...policy.diagnostics, citationsOrphaned: policy.diagnostics.citationsOrphaned + citations.diagnostics.citationsOrphaned,
    citationsInvalid: citations.diagnostics.citationsInvalid, screeningContextDiscarded: false };
  if (assessment.screeningContext === undefined) return { assessment, diagnostics };
  try {
    return { assessment: FitAssessmentSchema.parse({ ...assessment, screeningContext: validateScreeningContext(profile, job, assessment.screeningContext, evidenceTextById(evidence)) }), diagnostics };
  } catch {
    const { screeningContext: _discarded, ...rest } = assessment;
    void _discarded;
    return { assessment: FitAssessmentSchema.parse({ ...rest, missingInformation: [...new Set([...rest.missingInformation, SCREENING_CONTEXT_DISCARDED])] }), diagnostics: { ...diagnostics, screeningContextDiscarded: true } };
  }
}
