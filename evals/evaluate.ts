import { createHash } from "node:crypto";
import { CandidateProfileSchema, FitAssessmentSchema, JobPostingSchema, type CandidateProfile, type FitAssessment, type JobPosting } from "@career-radar/shared";
import { canonical } from "../server/src/domain/assessment/input-identity.js";
import { claimIds } from "../server/src/domain/assessment/claims.js";
import { finalizeAssessment } from "../server/src/domain/assessment/pipeline.js";
import { applyAssessmentPolicy, normalizeEvidence } from "../server/src/domain/assessment/policy.js";
import { retrieveEvidence } from "../server/src/domain/evidence/retrieve.js";
import { DATASET_VERSION, type PolicyCase } from "./dataset.js";

export const VERDICTS = ["REALISTIC", "STRETCH", "PASS"] as const;
export const METRIC_VERSION = "policy-metrics-v2";
// 3: a shared-schema hash difference is reported as `schemaChanged` (per-case contract hashes decide
// comparability), no longer as an incompatibility. Report shape is otherwise the v2 shape.
export const REPORT_VERSION = 3;
export type RunMetadata = { codeSha: string; dirty: boolean; policyHash: string; schemaHash: string };
export type CaseResult = {
  // contractHash covers only what the run executes and asserts; annotationHash covers prose and
  // review state. Baselines compare contracts, so accepting a human review or fixing a rationale
  // typo never removes a case from regression comparison.
  caseId: string; contractHash: string; annotationHash: string; inputHash: string;
  citations: { supplied: number; valid: number; claims: number; unsupported: number };
  status: "passed" | "failed" | "error" | "skipped";
  fixture: PolicyCase; actual?: FitAssessment;
  violations: string[]; error?: "invalid_fixture" | "policy_execution_failed" | "invalid_output";
  blockers: { found: string[]; missing: string[]; spurious: string[]; duplicates: string[]; unlinked: number; textResolved: number };
};

// Stable serialization hashes the structured input, not the resume's sourceHash.
// `canonical` is shared with assessment input identity so both hash families normalize identically.
export { canonical };
export const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const normalize = normalizeEvidence;
export function contractOf(fixture: PolicyCase) {
  const { profile, job, draftAssessment, expectedVerdict, expectedBlockerIds, expectedHardBlockerCount, mustNotClaim, requiredEvidence, skipReason,
    expectedValidCitations, expectedUnsupportedClaims } = fixture;
  return { profile, job, draftAssessment, expectedVerdict, expectedBlockerIds, expectedHardBlockerCount, mustNotClaim, requiredEvidence, skipReason,
    // M5-B expectations are part of the executable contract only for cases that state them, so the
    // contract hashes of the 28 pre-M5 cases are unchanged (both keys are absent → omitted by canonical()).
    ...(expectedValidCitations === undefined ? {} : { expectedValidCitations }),
    ...(expectedUnsupportedClaims === undefined ? {} : { expectedUnsupportedClaims }) };
}

// M5-B citation counters per case: supplied = citations in the injected draft, valid = citations
// that survived policy and validation, claims = matches + gaps + blockers in the output, unsupported
// = output claims with no surviving citation. Locator validity and coverage only; whether a cited
// sentence semantically supports the claim is a human-review question.
export function citationCounts(draft: FitAssessment, actual: FitAssessment): CaseResult["citations"] {
  const supported = new Set((actual.citations ?? []).map((citation) => citation.claimId));
  const claims = [...claimIds(actual)];
  return { supplied: draft.citations?.length ?? 0, valid: actual.citations?.length ?? 0, claims: claims.length,
    unsupported: claims.filter((id) => !supported.has(id)).length };
}

// The policy-mode path is the production post-processing (M1 policy, M5-B citation validation,
// B1 context validation) over the deterministic pre-retrieval for the fixture's profile and job.
export const policyPath = (profile: CandidateProfile, job: JobPosting, draft: FitAssessment): FitAssessment =>
  finalizeAssessment(profile, job, draft, retrieveEvidence(profile, job));
export function annotationOf(fixture: PolicyCase) {
  const { rationale, humanReview, provenance } = fixture;
  return { rationale, humanReview, provenance };
}
export const ratio = (numerator: number, denominator: number) => ({
  numerator, denominator, value: denominator === 0 ? null : numerator / denominator,
});

function checkBlockers(fixture: PolicyCase, actual: FitAssessment): CaseResult["blockers"] {
  const required = new Set(fixture.job.required.map((requirement) => requirement.id));
  const expected = new Set(fixture.expectedBlockerIds);
  const ids: string[] = [];
  let unlinked = 0, textResolved = 0;
  for (const blocker of actual.hardBlockers) {
    if (blocker.requirementId !== undefined) { ids.push(blocker.requirementId); continue; }
    // Legacy policy deliberately preserves unlinked blockers. Resolve only an
    // unambiguous exact required text; never infer an ID from a partial quote.
    const matches = fixture.job.required.filter((r) => normalize(r.text) === normalize(blocker.requirement));
    if (matches.length === 1) { ids.push(matches[0].id); textResolved++; }
    else unlinked++;
  }
  const unique = new Set(ids);
  return {
    found: [...expected].filter((id) => unique.has(id)),
    missing: [...expected].filter((id) => !unique.has(id)),
    spurious: [...unique].filter((id) => !required.has(id) || !expected.has(id)),
    duplicates: [...unique].filter((id) => ids.filter((other) => other === id).length > 1),
    unlinked, textResolved,
  };
}

function validFixture(fixture: PolicyCase): boolean {
  const ids = fixture.job.required.map((r) => r.id);
  return Boolean(fixture.caseId && fixture.rationale && fixture.provenance === "synthetic-policy-contract"
    && ["pending", "accepted"].includes(fixture.humanReview)
    && VERDICTS.includes(fixture.expectedVerdict)
    && CandidateProfileSchema.safeParse(fixture.profile).success
    && JobPostingSchema.safeParse(fixture.job).success
    && FitAssessmentSchema.safeParse(fixture.draftAssessment).success
    && new Set(ids).size === ids.length
    && new Set(fixture.expectedBlockerIds).size === fixture.expectedBlockerIds.length
    && fixture.expectedBlockerIds.every((id) => ids.includes(id))
    && fixture.expectHardBlocker === (fixture.expectedBlockerIds.length > 0));
}

export function runEvaluation(fixtures: PolicyCase[], metadata: RunMetadata,
  policy: typeof applyAssessmentPolicy = policyPath) {
  if (new Set(fixtures.map((f) => f.caseId)).size !== fixtures.length) throw new Error("Duplicate case IDs");
  const cases: CaseResult[] = fixtures.map((source) => {
    const fixture = structuredClone(source);
    const result: CaseResult = {
      caseId: fixture.caseId, contractHash: digest(contractOf(fixture)), annotationHash: digest(annotationOf(fixture)),
      inputHash: digest({ profile: fixture.profile, job: fixture.job, draft: fixture.draftAssessment }),
      fixture, status: "error", violations: [],
      blockers: { found: [], missing: [], spurious: [], duplicates: [], unlinked: 0, textResolved: 0 },
      citations: { supplied: 0, valid: 0, claims: 0, unsupported: 0 },
    };
    if (!validFixture(fixture)) { result.error = "invalid_fixture"; return result; }
    if (fixture.skipReason) { result.status = "skipped"; return result; }
    let output: unknown;
    try {
      // Preserve the immutable report inputs even if the function under test mutates its arguments.
      output = policy(structuredClone(fixture.profile), structuredClone(fixture.job), structuredClone(fixture.draftAssessment));
    } catch { result.error = "policy_execution_failed"; return result; }
    const parsed = FitAssessmentSchema.safeParse(output);
    if (!parsed.success) { result.error = "invalid_output"; return result; }
    const actual = parsed.data;
    result.actual = actual;
    result.blockers = checkBlockers(fixture, actual);
    result.citations = citationCounts(fixture.draftAssessment, actual);
    if (fixture.expectedValidCitations !== undefined && result.citations.valid !== fixture.expectedValidCitations) result.violations.push("citation_validity_mismatch");
    if (fixture.expectedUnsupportedClaims !== undefined && result.citations.unsupported !== fixture.expectedUnsupportedClaims) result.violations.push("unsupported_claims_mismatch");
    if (actual.verdict !== fixture.expectedVerdict) result.violations.push("verdict_mismatch");
    for (const key of ["missing", "spurious", "duplicates"] as const) {
      if (result.blockers[key].length) result.violations.push(`blocker_${key}`);
    }
    if (result.blockers.unlinked) result.violations.push("blocker_unresolved");
    if (fixture.expectedHardBlockerCount !== undefined && actual.hardBlockers.length !== fixture.expectedHardBlockerCount) {
      result.violations.push("blocker_count_mismatch");
    }
    if (fixture.mustNotClaim.some((claim) => actual.strongestMatches.some((match) => normalize(match.evidence).includes(normalize(claim))))) {
      result.violations.push("forbidden_positive_claim");
    }
    if (fixture.requiredEvidence.some((evidence) => !actual.strongestMatches.some((match) => normalize(match.evidence) === normalize(evidence)))) {
      result.violations.push("required_evidence_missing");
    }
    result.status = result.violations.length ? "failed" : "passed";
    return result;
  });
  const evaluated = cases.filter((c) => c.actual !== undefined);
  const expectedPass = evaluated.filter((c) => c.fixture.expectedVerdict === "PASS");
  const expectedNonRealistic = evaluated.filter((c) => c.fixture.expectedVerdict !== "REALISTIC");
  const reviewed = evaluated.filter((c) => c.fixture.humanReview === "accepted");
  const falseRealistic = (items: CaseResult[]) => items.filter((c) => c.actual?.verdict === "REALISTIC").length;
  const agreement = (items: CaseResult[]) => items.filter((c) => c.actual?.verdict === c.fixture.expectedVerdict).length;
  const confusionMatrix = VERDICTS.map((expected) => ({ expected,
    actual: Object.fromEntries(VERDICTS.map((actual) => [actual,
      evaluated.filter((c) => c.fixture.expectedVerdict === expected && c.actual?.verdict === actual).length])),
  }));
  return {
    reportVersion: REPORT_VERSION, metricVersion: METRIC_VERSION, mode: "policy" as const,
    datasetVersion: DATASET_VERSION, datasetHash: digest(fixtures),
    generatedAt: new Date().toISOString(), ...metadata,
    modelCalls: 0, modelVersions: [...new Set(fixtures.map((f) => f.draftAssessment.modelVersion))],
    promptVersions: [...new Set(fixtures.map((f) => f.draftAssessment.promptVersion))],
    totals: { cases: cases.length, evaluated: evaluated.length,
      passed: cases.filter((c) => c.status === "passed").length,
      failed: cases.filter((c) => c.status === "failed").length,
      errors: cases.filter((c) => c.status === "error").length,
      skipped: cases.filter((c) => c.status === "skipped").length,
      humanReviewPending: cases.filter((c) => c.fixture.humanReview === "pending").length },
    metrics: {
      coverage: ratio(evaluated.length, cases.length),
      policyVerdictAgreement: ratio(agreement(evaluated), evaluated.length),
      humanReviewedVerdictAgreement: ratio(agreement(reviewed), reviewed.length),
      requiredBlockerRecall: ratio(evaluated.reduce((n, c) => n + c.blockers.found.length, 0),
        evaluated.reduce((n, c) => n + c.fixture.expectedBlockerIds.length, 0)),
      passToRealistic: ratio(falseRealistic(expectedPass), expectedPass.length),
      nonRealisticToRealistic: ratio(falseRealistic(expectedNonRealistic), expectedNonRealistic.length),
      legacyPassToRealisticOverAllCases: ratio(falseRealistic(expectedPass), cases.length),
      textResolvedBlockers: evaluated.reduce((n, c) => n + c.blockers.textResolved, 0),
      // M5-B (additive; metric definitions above are unchanged, so metricVersion stays).
      citationCorrectness: ratio(evaluated.reduce((n, c) => n + c.citations.valid, 0), evaluated.reduce((n, c) => n + c.citations.supplied, 0)),
      unsupportedClaimRate: ratio(evaluated.reduce((n, c) => n + c.citations.unsupported, 0), evaluated.reduce((n, c) => n + c.citations.claims, 0)),
      positiveEvidenceFailures: evaluated.filter((c) => c.violations.includes("required_evidence_missing") || c.violations.includes("forbidden_positive_claim")).length,
    }, confusionMatrix, cases,
    // Skips are deliberate deferrals: reported in totals/coverage, not a failed run.
    success: evaluated.length > 0 && cases.every((c) => c.status !== "failed" && c.status !== "error"),
  };
}
export type EvalReport = ReturnType<typeof runEvaluation>;
