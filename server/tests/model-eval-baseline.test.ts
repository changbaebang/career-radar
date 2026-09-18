import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GOLDEN_SET_VERSION, goldenCases } from "../../evals/fixtures/golden/index.js";
import { provenance } from "../../evals/model-mode-cli.js";
import { ModelEvalReportSchema, checkResume, compareModelReports, goldHash } from "../../evals/model-mode.js";
import { digest } from "../../evals/evaluate.js";

// The committed model-mode baseline (docs/MILESTONE_5_WRAP_UP.md): the first approved full-set run
// on the free OpenRouter route. If this fails, the golden set, the prompt, the policy or the shared
// schema changed since the baseline was made: refresh it with an approved run rather than
// comparing a live report with a stale contract.
const baselinePath = fileURLToPath(new URL("../../evals/baselines/m5-d/report.json", import.meta.url));

describe("M5-D committed model-mode baseline", () => {
  const baseline = ModelEvalReportSchema.parse(JSON.parse(readFileSync(baselinePath, "utf8")));

  it("is a live report of the full golden set from a clean checkout on the free OpenRouter route", () => {
    expect(baseline).toMatchObject({ execution: "live", provider: "openrouter", dirty: false, goldenSetVersion: GOLDEN_SET_VERSION, selectedCases: goldenCases.length, problems: [] });
    expect(baseline.requestedModel).toMatch(/:free$/);
    expect(baseline.codeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(baseline.cases.map((c) => c.caseId)).toEqual(goldenCases.map((c) => c.caseId));
    expect(baseline.cases.every((c) => c.outcome !== "not_attempted")).toBe(true);
  });

  it("still matches the current golden set, prompt, policy and shared schema", () => {
    expect(baseline.goldenSetHash).toBe(digest(goldenCases.map(goldHash)));
    const { promptVersion, policyHash, schemaHash } = provenance();
    expect(checkResume(baseline, { provider: baseline.provider, requestedModel: baseline.requestedModel, promptVersion, policyHash, schemaHash, goldenSetVersion: GOLDEN_SET_VERSION }, goldenCases)).toBeUndefined();
    expect(compareModelReports(baseline, baseline)).toMatchObject({ compatible: true, compared: goldenCases.length, outcomeChanged: [], verdictChanged: [] });
  });
});
