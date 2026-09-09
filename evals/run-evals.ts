import { applyAssessmentPolicy } from "../server/src/domain/assessment/policy.js";
import { evalCases } from "./fixtures/cases.js";

const results = evalCases.map((fixture) => ({
  fixture,
  result: applyAssessmentPolicy(fixture.profile, fixture.job, fixture.draftAssessment),
}));
const verdictMatches = results.filter(({ fixture, result }) => result.verdict === fixture.expectedVerdict).length;
const blockerCases = results.filter(({ fixture }) => fixture.expectHardBlocker);
const blockersFound = blockerCases.filter(({ result }) => result.hardBlockers.length > 0).length;
const falseRealistic = results.filter(({ fixture, result }) => fixture.expectedVerdict === "PASS" && result.verdict === "REALISTIC").length;
const blockerCountMismatches = results
  .filter(({ fixture, result }) => fixture.expectedHardBlockerCount !== undefined && result.hardBlockers.length !== fixture.expectedHardBlockerCount)
  .map(({ fixture, result }) => `${fixture.caseId}: expected ${fixture.expectedHardBlockerCount} hard blockers, got ${result.hardBlockers.length}`);
const forbiddenClaims = results.flatMap(({ fixture, result }) =>
  fixture.mustNotClaim.filter((claim) => result.strongestMatches.some((match) => match.evidence.includes(claim)))
    .map((claim) => `${fixture.caseId}: ${claim}`),
);

const report = {
  cases: results.length,
  verdictAgreement: verdictMatches / results.length,
  hardBlockerRecall: blockerCases.length === 0 ? 1 : blockersFound / blockerCases.length,
  falseRealisticRate: falseRealistic / results.length,
  blockerCountMismatches,
  forbiddenClaims,
};
console.log(JSON.stringify(report, null, 2));

if (
  verdictMatches !== results.length || blockersFound !== blockerCases.length ||
  falseRealistic > 0 || blockerCountMismatches.length > 0 || forbiddenClaims.length > 0
) {
  process.exitCode = 1;
}
