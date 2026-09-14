import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { policyCases } from "../../evals/dataset.js";
import { METRIC_VERSION, REPORT_VERSION, runEvaluation } from "../../evals/evaluate.js";
import { compareReports } from "../../evals/report.js";

// The committed M5-0 baseline (docs/MILESTONE_5_BASELINE.md) must stay usable by the current runner.
// If this fails, a runner, metric or fixture change made the pre-M5 baseline stale: decide whether
// to refresh it (new SHA on the baseline page) rather than silently comparing fewer cases.
const baselinePath = fileURLToPath(new URL("../../evals/baselines/m5-0/report.json", import.meta.url));

describe("M5-0 committed policy baseline", () => {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, unknown>;

  it("was produced from a clean checkout by the current report contract", () => {
    expect(baseline).toMatchObject({ reportVersion: REPORT_VERSION, metricVersion: METRIC_VERSION, mode: "policy", dirty: false });
    expect(baseline.codeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(baseline.cases).toHaveLength(28);
  });

  it("still compares every case with the current runner and dataset, with no regressions", () => {
    const current = runEvaluation(policyCases, {
      codeSha: "0".repeat(40), dirty: false,
      policyHash: baseline.policyHash as string, schemaHash: baseline.schemaHash as string,
    });
    expect(compareReports(current, baseline)).toMatchObject({
      compatible: true, compared: 28, incompatibleReasons: [], removed: [], modified: [], regressions: [],
    });
  });

  it("reports, not refuses, a shared-schema change against this baseline", () => {
    const current = runEvaluation(policyCases, { codeSha: "0".repeat(40), dirty: false, policyHash: baseline.policyHash as string, schemaHash: "m5-a-adds-a-schema" });
    expect(compareReports(current, baseline)).toMatchObject({ compatible: true, compared: 28, schemaChanged: true });
  });
});
