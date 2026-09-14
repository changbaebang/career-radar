# Policy evaluation — M4-A

This runner executes **synthetic deterministic policy contracts**, not a model.
It neither loads `.env` nor reads the application database. No network/model calls,
private input import, screening context, stage analytics, or model-mode switch is implemented.
The live measurement harness (`pnpm measure:live`, see `docs/LIVE_MEASUREMENT.md`) is a separate
tool: its reports also land under ignored `evals/reports/` but describe live batch timings, never policy cases.

## Run and compare

From the repository root (Node >= 22.13, dependencies installed):

```sh
pnpm eval
pnpm eval --output evals/reports/baseline
pnpm eval --baseline evals/reports/baseline/report.json
pnpm eval --no-save
pnpm eval --help
```

All relative paths resolve from the **repository root**, even when launched by the server package.
The root command builds shared first. An explicit output directory must not already exist.
The default creates a unique directory under ignored `evals/reports/`, containing:

- `report.json`: structured profile/JD and injected draft, expectations/rationale,
  per-case input/contract hashes, post-policy output, failures and aggregate metrics.
- `report.md`: readable metadata, counts, confusion matrix and per-case status.

Reports carry code SHA, dirty-worktree flag, content hashes of policy/schema,
dataset/metric/report versions and fixture prompt/model labels. Those labels identify
the **injected drafts**, not models executed in this run. Use a clean committed checkout
for a reproducible baseline; a dirty flag alone is not a copy of uncommitted code.

Exit status: `0` no failed or error cases (skips are deliberate deferrals: counted in
totals and coverage, not failures) and any requested comparison is compatible without
regressions; `1` failed assertions, errors or empty run; `2` invalid arguments,
unreadable/invalid baseline, incompatible versions, zero comparable cases or output error.
The new versioned JSON shape replaces the old aggregate CLI shape.

A comparison is incompatible only when `reportVersion`, `metricVersion` or `mode` differ.
A different shared-schema hash (`packages/shared/src/index.ts`) is reported as
`schemaChanged`, next to `policyChanged` and `datasetChanged`; comparability is decided per
case by `contractHash` (report version 3, M5-0). The committed pre-M5 baseline is
`evals/baselines/m5-0/report.json`, described in
[docs/MILESTONE_5_BASELINE.md](../docs/MILESTONE_5_BASELINE.md):

```sh
pnpm eval --baseline evals/baselines/m5-0/report.json --no-save
```

## What the 28 cases establish

All 16 M1–M3 fixtures remain unchanged. `dataset.ts` adds rationale, expected required
blocker IDs, positive-evidence controls and 12 independent synthetic policy variants.
Fixtures deliberately include corrupt drafts (such as invented production claims)
to test rejection, plus valid controls to catch over-removal.

Every case is marked `synthetic-policy-contract`, with `humanReview: pending`.
Passing these tests does **not** mean a human accepted 28 fit labels. Review
[the annotation template](REVIEW_TEMPLATE.md) before changing that status; record
the decision and rationale in a separate reviewed annotation alongside the fixture.
M4's reviewed-fit dataset gate is not completed by this PR alone.

The new cases cover case/whitespace/quote normalization, a positive production
control, mixed valid/invalid evidence, high versus medium contortion, core versus
important binary requirements, required versus preferred qualifications, invented
production experience and two distinct blockers. They do not assert success for
M4-B's unimplemented seniority/trajectory producer or M4-C's outcome analytics.

## Metric contract: policy-metrics-v2

Every ratio reports numerator, denominator and value; an empty denominator is
`null` in JSON and **N/A** in Markdown. Failed assertions still have evaluated
outputs; thrown executions, invalid outputs and explicit skips do not become verdicts.
All exclusions appear in totals and execution coverage.

| Measure | Definition |
| --- | --- |
| Policy verdict agreement | Exact matches / evaluated policy contracts |
| Human-reviewed verdict agreement | Exact matches / evaluated cases with accepted human review; currently 0/0, N/A |
| Required-blocker recall | Expected required IDs found / expected required IDs in evaluated cases |
| PASS → REALISTIC | Expected-PASS cases returning REALISTIC / evaluated expected-PASS cases |
| Non-REALISTIC → REALISTIC | Expected PASS or STRETCH returning REALISTIC / evaluated expected PASS or STRETCH |
| Legacy diagnostic | PASS → REALISTIC / all cases; retained under an explicit legacy name, not used for quality comparisons |

Blocker matching uses output IDs; a wrong ID is not repaired using text. For an
ID-less blocker preserved by the legacy policy, the evaluator may resolve a unique
normalized full-text match among required requirements. `textResolvedBlockers`
reports those separately; it does not change the saved policy output or claim that
the model supplied an ID. Ambiguous/unresolved, spurious and duplicate IDs fail
the case. Expected count checks are retained. Positive evidence checks test both
forbidden phrases in `strongestMatches[].evidence` and required valid evidence.
They do not prove semantic truth, original-resume extraction, or all prose grounding.

## Comparison boundaries

Report version, metric version, execution mode and schema hash must match.
Then compare by **case ID plus contract hash**, which covers inputs, injected draft
and expectations (verdict, blocker IDs/count, forbidden and required evidence, skip
state). Rationale, review state and provenance live in a separate annotation hash:
accepting a human review or fixing prose keeps the case comparable and lists it under
`annotated`. Added, removed and changed-contract cases are listed separately; changed
cases are not presented as regressions or improvements. Prompt/model label changes
within a fixture change its contract hash.

`datasetChanged` alone does not mean a case changed: it compares the whole-dataset hash,
which also moves when the canonical key ordering changes (as it did when `canonical` was
shared with assessment input identity). Trust the per-case `compared`/`modified` lists.

Different code/policy hashes are permitted and disclosed: this is how a policy
change is tested against unchanged contracts. A previously passing comparable case
becoming failed/error/skipped is a regression. Do not compare aggregate rates across
different datasets, and do not treat excluded cases as passing. If no cases can be
compared, comparison is unsuccessful. Legacy aggregate-only reports are rejected;
generate a new v2 baseline rather than inventing missing per-case evidence.

## Retention

Generated reports are local, ignored by Git, and synthetic-only through this CLI.
They are **not** SQLite records: `pnpm db:reset` does not delete them. Remove an
individual, verified run directory through your file manager when no longer needed.
No reports are uploaded automatically; CI artifact export is not configured here.

Human fit review, actual model/host verification and design issues #8–11 remain separate.
