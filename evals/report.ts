import type { EvalReport } from "./evaluate.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid baseline object");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid baseline string");
  return value;
}

// Read only a validated projection; never trust saved aggregate metrics.
function projectBaseline(value: unknown) {
  const record = object(value);
  if (!Array.isArray(record.cases)) throw new Error("Baseline has no case-level results (legacy reports cannot be compared)");
  const cases = record.cases.map((value: unknown) => {
    const item = object(value);
    const status = string(item.status);
    if (!["passed", "failed", "error", "skipped"].includes(status)) throw new Error("Invalid baseline status");
    const caseHash = string(item.caseHash);
    if (!/^[a-f0-9]{64}$/.test(caseHash)) throw new Error("Invalid baseline case hash");
    return { caseId: string(item.caseId), caseHash, status };
  });
  if (new Set(cases.map((c) => c.caseId)).size !== cases.length) throw new Error("Duplicate baseline case IDs");
  return { reportVersion: record.reportVersion, metricVersion: string(record.metricVersion), mode: string(record.mode),
    schemaHash: string(record.schemaHash), policyHash: string(record.policyHash),
    datasetVersion: string(record.datasetVersion), datasetHash: string(record.datasetHash),
    codeSha: string(record.codeSha), cases };
}

export function compareReports(current: EvalReport, baseline: unknown) {
  const previous = projectBaseline(baseline);
  const incompatibleReasons = (["reportVersion", "metricVersion", "mode", "schemaHash"] as const)
    .filter((key) => current[key] !== previous[key]);
  const oldCases = new Map(previous.cases.map((c) => [c.caseId, c]));
  const currentIds = new Set(current.cases.map((c) => c.caseId));
  const added = current.cases.filter((c) => !oldCases.has(c.caseId)).map((c) => c.caseId);
  const removed = previous.cases.filter((c) => !currentIds.has(c.caseId)).map((c) => c.caseId);
  const modified = current.cases.filter((c) => oldCases.has(c.caseId) && oldCases.get(c.caseId)?.caseHash !== c.caseHash).map((c) => c.caseId);
  const comparable = incompatibleReasons.length ? [] : current.cases.filter((c) => oldCases.get(c.caseId)?.caseHash === c.caseHash);
  return {
    compatible: incompatibleReasons.length === 0 && comparable.length > 0,
    incompatibleReasons, compared: comparable.length, added, removed, modified,
    baselineCodeSha: previous.codeSha, currentCodeSha: current.codeSha,
    policyChanged: current.policyHash !== previous.policyHash,
    datasetChanged: current.datasetHash !== previous.datasetHash || current.datasetVersion !== previous.datasetVersion,
    regressions: comparable.filter((c) => oldCases.get(c.caseId)?.status === "passed" && c.status !== "passed").map((c) => c.caseId),
    improvements: comparable.filter((c) => oldCases.get(c.caseId)?.status !== "passed" && c.status === "passed").map((c) => c.caseId),
    note: "Case-level policy contract comparison only. No aggregate quality delta across changed datasets; no live model accuracy claim.",
  };
}
export type Comparison = ReturnType<typeof compareReports>;
const cell = (value: string) => value.replaceAll("|", "\\|").replace(/[\r\n]/g, " ");

export function renderMarkdown(report: EvalReport, comparison?: Comparison): string {
  const metric = (name: string, value: { numerator: number; denominator: number; value: number | null }) =>
    `| ${name} | ${value.numerator} / ${value.denominator} | ${value.value === null ? "N/A" : `${(value.value * 100).toFixed(1)}%`} |`;
  const lines = [
    "# Career Radar policy evaluation", "",
    "Synthetic policy execution only; model calls: **0**. Not hiring probability or live model accuracy.", "",
    `- Code: ${report.codeSha}; dirty worktree: ${report.dirty}`,
    `- Dataset: ${report.datasetVersion} (${report.datasetHash})`,
    `- Metrics: ${report.metricVersion}; report: ${report.reportVersion}`,
    `- Policy hash: ${report.policyHash}; schema hash: ${report.schemaHash}`,
    `- Fixture model/prompt labels: ${report.modelVersions.join(", ")} / ${report.promptVersions.join(", ")} (not executed)`,
    `- Cases: ${report.totals.cases}; evaluated: ${report.totals.evaluated}; passed: ${report.totals.passed}; failed: ${report.totals.failed}; errors: ${report.totals.errors}; skipped: ${report.totals.skipped}`,
    `- Human review pending: ${report.totals.humanReviewPending}. Policy expectations are not automatically human fit labels.`, "",
    "## Metrics", "", "| Measure | Count | Value |", "| --- | --- | --- |",
    metric("Execution coverage", report.metrics.coverage),
    metric("Policy verdict agreement", report.metrics.policyVerdictAgreement),
    metric("Human-reviewed verdict agreement", report.metrics.humanReviewedVerdictAgreement),
    metric("Required-blocker recall (resolved IDs)", report.metrics.requiredBlockerRecall),
    metric("Expected PASS → REALISTIC / evaluated expected PASS", report.metrics.passToRealistic),
    metric("Expected non-REALISTIC → REALISTIC / evaluated expected non-REALISTIC", report.metrics.nonRealisticToRealistic),
    metric("Legacy PASS → REALISTIC / all cases (diagnostic only)", report.metrics.legacyPassToRealisticOverAllCases), "",
    `Unlinked blockers resolved by unique exact required text: ${report.metrics.textResolvedBlockers}. These are not model-supplied IDs.`,
    `Positive evidence check failures: ${report.metrics.positiveEvidenceFailures}. Screening-context checks are not implemented.`, "",
    "## Confusion matrix", "", "Rows = policy expected; columns = actual. Errors/skips excluded and counted above.", "",
    "| Expected | REALISTIC | STRETCH | PASS |", "| --- | --- | --- | --- |",
    ...report.confusionMatrix.map((row) => `| ${row.expected} | ${row.actual.REALISTIC} | ${row.actual.STRETCH} | ${row.actual.PASS} |`), "",
    "## Cases", "", "| Case | Status | Expected | Actual | Checks / execution |", "| --- | --- | --- | --- | --- |",
    ...report.cases.map((c) => `| ${cell(c.caseId)} | ${c.status} | ${c.fixture.expectedVerdict} | ${c.actual?.verdict ?? "N/A"} | ${cell(c.error ?? (c.status === "skipped" ? c.fixture.skipReason ?? "skipped" : c.violations.join(", ") || "OK"))} |`), "",
  ];
  if (comparison) lines.push("## Baseline comparison", "",
    `Compatible: ${comparison.compatible}; comparable cases: ${comparison.compared}; policy changed: ${comparison.policyChanged}; dataset changed: ${comparison.datasetChanged}.`, "",
    ...(["incompatibleReasons", "added", "removed", "modified", "regressions", "improvements"] as const)
      .map((key) => `- ${key}: ${comparison[key].join(", ") || "none"}`), "", comparison.note, "");
  return lines.join("\n");
}
