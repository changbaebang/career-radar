import { describe, expect, it } from "vitest";
import { policyCases, type PolicyCase } from "../../evals/dataset.js";
import { evalCases } from "../../evals/fixtures/cases.js";
import { contractOf, digest, runEvaluation } from "../../evals/evaluate.js";
import { compareReports, renderMarkdown } from "../../evals/report.js";
import { applyAssessmentPolicy } from "../src/domain/assessment/policy.js";

const metadata = { codeSha: "a".repeat(40), dirty: false, policyHash: "policy-v1", schemaHash: "schema-v1" };
function fixture(id: string): PolicyCase {
  const item = policyCases.find((c) => c.caseId === id);
  if (!item) throw new Error(`Missing test fixture ${id}`);
  return structuredClone(item);
}

describe("M4-A policy evaluation", () => {
  it("runs 28 explicit contracts and preserves all 16 legacy inputs and outputs", () => {
    const report = runEvaluation(policyCases, metadata);
    expect(report.success).toBe(true);
    expect(report.totals).toMatchObject({ cases: 28, passed: 28, errors: 0, skipped: 0, humanReviewPending: 28 });
    expect(report.modelCalls).toBe(0);
    expect(report.metrics.humanReviewedVerdictAgreement.value).toBeNull();
    for (const legacy of evalCases) {
      const actual = report.cases.find((c) => c.caseId === legacy.caseId);
      expect(actual?.fixture).toMatchObject(legacy);
      expect(actual?.actual).toEqual(applyAssessmentPolicy(legacy.profile, legacy.job, legacy.draftAssessment));
    }
  });

  it("distinguishes both false-REALISTIC denominators from the legacy all-case fraction", () => {
    const cases = [fixture("mandatory-language-pass"), fixture("solution-architect-stretch"), fixture("frontend-lead-realistic")];
    const report = runEvaluation(cases, metadata, (_p, _j, draft) => ({ ...draft, verdict: "REALISTIC" }));
    expect(report.metrics.passToRealistic).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(report.metrics.nonRealisticToRealistic).toEqual({ numerator: 2, denominator: 2, value: 1 });
    expect(report.metrics.legacyPassToRealisticOverAllCases).toEqual({ numerator: 1, denominator: 3, value: 1 / 3 });
    expect(report.confusionMatrix.find((r) => r.expected === "PASS")?.actual.REALISTIC).toBe(1);
    expect(report.success).toBe(false);
  });

  it("does not call empty denominators success or 100 percent", () => {
    const empty = runEvaluation([], metadata);
    expect(empty.success).toBe(false);
    expect(empty.metrics.coverage.value).toBeNull();
    expect(empty.metrics.requiredBlockerRecall.value).toBeNull();
    const normal = runEvaluation([fixture("frontend-lead-realistic")], metadata);
    expect(normal.metrics.passToRealistic.value).toBeNull();
    expect(renderMarkdown(empty)).toContain("0 / 0 | N/A");
  });

  it("counts required IDs, not just any blocker, and reports spurious IDs", () => {
    const f = fixture("two-required-blockers-preserved");
    const report = runEvaluation([f], metadata, (p, j, d) => {
      const actual = applyAssessmentPolicy(p, j, d);
      actual.hardBlockers[1].requirementId = "wrong_id";
      return actual;
    });
    expect(report.metrics.requiredBlockerRecall).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(report.cases[0].blockers).toMatchObject({ missing: ["req_2"], spurious: ["wrong_id"] });
    expect(report.cases[0].violations).toContain("blocker_missing");
  });

  it("detects duplicate IDs even when verdict and blocker coverage look correct", () => {
    const report = runEvaluation([fixture("mandatory-language-pass")], metadata, (p, j, d) => {
      const actual = applyAssessmentPolicy(p, j, d);
      actual.hardBlockers.push(structuredClone(actual.hardBlockers[0]));
      return actual;
    });
    expect(report.metrics.requiredBlockerRecall.value).toBe(1);
    expect(report.cases[0].blockers.duplicates).toEqual(["req_1"]);
    expect(report.success).toBe(false);
  });

  it("reports legacy exact-text resolution separately and never repairs a wrong ID", () => {
    const f = fixture("unlinked-hard-blocker-gap-pass");
    const normal = runEvaluation([f], metadata);
    expect(normal.metrics.textResolvedBlockers).toBe(1);
    expect(normal.cases[0].actual?.hardBlockers[0].requirementId).toBeUndefined();
    const wrong = runEvaluation([f], metadata, (p, j, d) => {
      const actual = applyAssessmentPolicy(p, j, d);
      actual.hardBlockers[0].requirementId = "nonexistent";
      return actual;
    });
    expect(wrong.metrics.textResolvedBlockers).toBe(0);
    expect(wrong.cases[0].blockers.missing).toEqual(["req_1"]);
    const unresolved = runEvaluation([f], metadata, (p, j, d) => {
      const actual = applyAssessmentPolicy(p, j, d);
      actual.hardBlockers[0].requirement = "security";
      return actual;
    });
    expect(unresolved.cases[0].blockers.unlinked).toBe(1);
    expect(unresolved.success).toBe(false);
  });

  it("rejects ambiguous exact-text mapping and invalid expected IDs", () => {
    const f = fixture("unlinked-hard-blocker-gap-pass");
    f.job.required.push({ ...f.job.required[0], id: "req_2" });
    expect(runEvaluation([f], metadata).cases[0].blockers.unlinked).toBe(1);
    f.expectedBlockerIds = ["missing"];
    expect(runEvaluation([f], metadata).cases[0].error).toBe("invalid_fixture");
  });

  it("tests both forbidden claim removal and valid evidence retention", () => {
    const f = fixture("mixed-evidence-preserves-valid-match");
    const untouched = runEvaluation([f], metadata, (_p, _j, d) => d);
    expect(untouched.cases[0].violations).toContain("forbidden_positive_claim");
    const allRemoved = runEvaluation([f], metadata, (_p, _j, d) => ({ ...d, strongestMatches: [] }));
    expect(allRemoved.cases[0].violations).toContain("required_evidence_missing");
    expect(runEvaluation([f], metadata).success).toBe(true);
  });

  it("treats a deliberate skip as a deferral, not a failed run", () => {
    const skipped = fixture("frontend-lead-realistic"); skipped.skipReason = "Deferred pending human review";
    const report = runEvaluation([skipped, fixture("mandatory-language-pass")], metadata);
    expect(report.totals).toMatchObject({ cases: 2, evaluated: 1, passed: 1, failed: 0, errors: 0, skipped: 1 });
    expect(report.success).toBe(true);
    expect(runEvaluation([skipped], metadata).success).toBe(false); // nothing evaluated
  });

  it("keeps execution errors and skips out of verdict labels and preserves coverage", () => {
    const skipped = fixture("frontend-lead-realistic"); skipped.skipReason = "Explicitly deferred";
    const f = fixture("mandatory-language-pass");
    const report = runEvaluation([skipped, f], metadata, () => { throw new Error("PRIVATE-ERROR-TEXT"); });
    expect(report.totals).toMatchObject({ cases: 2, evaluated: 0, errors: 1, skipped: 1 });
    expect(report.metrics.passToRealistic.value).toBeNull();
    expect(report.success).toBe(false);
    expect(JSON.stringify(report)).not.toContain("PRIVATE-ERROR-TEXT");
    expect(report.cases[1].actual).toBeUndefined();
  });

  it("validates malformed policy outputs separately from thrown execution", () => {
    const report = runEvaluation([fixture("frontend-lead-realistic")], metadata, (_p, _j, d) => ({ ...d, recommendation: "" }));
    expect(report.cases[0].error).toBe("invalid_output");
    expect(report.totals.evaluated).toBe(0);
  });

  it("rejects duplicate case IDs and retains input snapshots when policy mutates arguments", () => {
    const f = fixture("frontend-lead-realistic");
    expect(() => runEvaluation([f, f], metadata)).toThrow("Duplicate case IDs");
    const report = runEvaluation([f], metadata, (p, _j, d) => { p.headline = "changed"; return d; });
    expect(report.cases[0].fixture.profile.headline).toBe(f.profile.headline);
    expect(report.cases[0].contractHash).toBe(digest(contractOf(f)));
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
  });
});

describe("saved-run comparison", () => {
  const f = fixture("frontend-lead-realistic");
  it("compares unchanged contracts across policy/code revisions", () => {
    const before = runEvaluation([f], metadata);
    const after = runEvaluation([f], { ...metadata, codeSha: "b".repeat(40), policyHash: "policy-v2" },
      (_p, _j, d) => ({ ...d, verdict: "PASS" }));
    expect(compareReports(after, before)).toMatchObject({ compatible: true, compared: 1, policyChanged: true, regressions: [f.caseId] });
    expect(compareReports(before, after).improvements).toEqual([f.caseId]);
  });

  it.each(["metricVersion", "schemaHash", "mode", "reportVersion"])("refuses incompatible %s", (key) => {
    const report = runEvaluation([f], metadata);
    expect(compareReports(report, { ...report, [key]: "incompatible" })).toMatchObject({ compatible: false, compared: 0, incompatibleReasons: [key] });
  });

  it("separates added, removed, modified and comparable cases without an aggregate quality claim", () => {
    const before = runEvaluation([f, fixture("mandatory-language-pass"), fixture("ai-application-stretch")], metadata);
    const changed = fixture("mandatory-language-pass"); changed.expectedHardBlockerCount = 2;
    const after = runEvaluation([f, changed, fixture("formal-tpm-pass")], metadata);
    expect(compareReports(after, before)).toMatchObject({ compared: 1, datasetChanged: true,
      added: ["formal-tpm-pass"], removed: ["ai-application-stretch"], modified: [changed.caseId] });
  });

  it("keeps a case comparable when only its rationale or review state changes", () => {
    const before = runEvaluation(policyCases, metadata);
    const accepted = structuredClone(policyCases);
    for (const c of accepted) c.humanReview = "accepted";
    accepted[3].rationale += " Typo fixed.";
    const broken = runEvaluation(accepted, metadata, (_p, _j, d) => ({ ...d, verdict: "REALISTIC" }));
    const comparison = compareReports(broken, before);
    expect(comparison).toMatchObject({ compatible: true, compared: 28, modified: [] });
    expect(comparison.annotated).toHaveLength(28);
    expect(comparison.regressions.length).toBeGreaterThan(0);
  });

  it("rejects a v1 baseline that only has caseHash", () => {
    const report = runEvaluation([f], metadata);
    const legacy = { ...report, reportVersion: 1, cases: [{ caseId: f.caseId, caseHash: "a".repeat(64), status: "passed" }] };
    expect(() => compareReports(report, legacy)).toThrow("older report version");
  });

  it("does not treat zero comparable cases as regression-free success", () => {
    const before = runEvaluation([f], metadata);
    const after = runEvaluation([fixture("formal-tpm-pass")], metadata);
    expect(compareReports(after, before)).toMatchObject({ compatible: false, compared: 0 });
  });

  it("validates baseline JSON instead of asserting its type", () => {
    const report = runEvaluation([f], metadata);
    expect(() => compareReports(report, { cases: 16 })).toThrow("legacy reports");
    expect(() => compareReports(report, { ...report, cases: [report.cases[0], report.cases[0]] })).toThrow("Duplicate baseline");
    expect(() => compareReports(report, { ...report, cases: [{ ...report.cases[0], status: "success" }] })).toThrow("Invalid baseline status");
  });
});
