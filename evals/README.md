# Policy evaluation — M4-A

The policy runner (`pnpm eval`) executes **synthetic deterministic policy contracts**, not a model.
It neither loads `.env` nor reads the application database. No network/model calls,
private input import, screening context or stage analytics. The model-mode switch
(`pnpm eval --mode model`, M5-D, last section) is the one path in this directory that can transmit
anything, and only behind an approval flag; without the flag it is a dry run.
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

Since M5-B the policy-mode path is the production post-processing: the M1 policy, then citation
validation against the deterministic pre-retrieval for the fixture's profile and job, then B1
context validation (`policyPath` in `evaluate.ts`). Dataset `synthetic-policy-v3` adds seven
citation cases (valid chunk citation kept; nonexistent id, quote from another chunk, negated
quote and another corpus's id dropped; removed-match and dedup-pair regressions). Two additive
metrics report `citationCorrectness` (valid ÷ supplied) and `unsupportedClaimRate` (claims
without a surviving citation ÷ claims); the existing metric definitions are unchanged, so
`metricVersion` stays `policy-metrics-v2`. Both measure locator validity and coverage only.

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

## Retrieval evaluation (M5-A, lexical)

```sh
pnpm eval:retrieval                # saves evals/reports/retrieval-<timestamp>-<uuid>/report.{json,md}
pnpm eval:retrieval --no-save
pnpm eval:retrieval --output evals/reports/retrieval-baseline
```

Measures Recall@3 and Recall@5 of in-process BM25 retrieval (`server/src/domain/evidence/`) over
the synthetic corpus in `fixtures/corpus/` (one structured profile, project and blog documents,
synthetic distractors), once per chunker (`field`: one chunk per profile field or document
paragraph; `sentence`: one chunk per profile leaf or document sentence). No model call, no DB, no
network. The tokenizer is NFKC + lower-case + split on non-letters/digits, no stemming, no stop
words: recall on morphology and abbreviation queries is expected to be low, and the report says
which query terms were absent from the index (`misses`).

Relevance is authored in `fixtures/corpus/queries.ts` as sentence locators with their text. The
runner checks each text against the sentence chunker, resolves the locator to chunk ids per chunker
(a field chunk is relevant when it contains the sentence and its locator is the sentence's prefix),
and refuses to score when any entry no longer resolves (`problems`, exit 1). Micro recall counts
relevant chunks found over all relevant chunks; macro recall is the mean per query. A query whose
terms are all absent from the index returns an empty hit list and is listed in
`queriesWithoutHits`; a miss is never a fabricated chunk. Two builds and searches must agree on every
score and rank (`deterministic`). Report version 1, metrics `retrieval-metrics-v1`; the report is
validated against a strict schema before it is written. Exit `0` success, `1` dataset problems or
non-deterministic scores, `2` invalid arguments or output error.

## Model-mode evaluation (M5-D)

```sh
pnpm eval --mode model --no-save                                   # dry run: golden fake analyzer, zero network
pnpm eval --mode model --cases gm-frontend-lead-realistic,gm-two-required-blockers --no-save
pnpm eval --mode model --output evals/reports/model-first-dry-run  # dry run, saved
pnpm eval --mode model --approve-transmission                      # live: the golden texts go to OpenRouter (free tier)
pnpm eval --mode model --approve-transmission --provider openai --approve-model-cost   # live on OpenAI (not the default)
pnpm eval --mode model --baseline evals/reports/<dir>/report.json --no-save
pnpm eval --mode model --help
```

Runs the real model path over the golden set in `fixtures/golden/` (`model-golden-v1`, 33 synthetic
cases as raw resume and posting text): profile extraction, job extraction and assessment through an
analyzer, then the deterministic pipeline (pre-retrieval, policy, citation and context validation).
Model gold is not policy gold: expected blockers are named by requirement *text* because extraction
assigns ids at run time, the expected verdict is an allowed set, and every case starts with
`humanReview: "pending"`, so `humanVerdictAgreement` is N/A until a reviewer signs cases.

**Execution.** Argv alone decides. Without `--approve-transmission` the analyzer is
`GoldenFakeAnalyzer` (a deterministic parser of the golden text format; no network; `execution:
"dry-run"`, provider `fake`); with it, `createAnalyzerFromEnv` builds the real adapter from
`.env.local`. The default provider is `openrouter` (owner decision 2026-09-14: the project verifies
on the free tier); `--provider openai` additionally requires `--approve-model-cost` and is refused
while `OPENAI_BASE_URL` is set. The environment can only refuse, never grant: approval flags are
rejected under `CI`, `GITHUB_ACTIONS`, `VITEST` and `NODE_ENV=test`. Up to 3 calls per case, one
HTTP attempt each (`maxRetries: 0`, SDK logging off, 300 s per call); `--max-model-calls` is at most
150 and never below the plan, which `--cases` and `--limit` shrink. A free call is still an external
transmission of the synthetic texts; the plan printed before the run names the destination and the
model.

**Scoring.** Extracted required requirements are mapped to gold by normalized-text equality only
(`requirementMatchRate`, `matchedGold`, `unmatchedGold` with the nearest extracted text,
`unmatchedExtracted`); the cause of a miss is never classified. Blocker recall is reported twice:
`blockerRecallMatched` over matched gold blockers (`null`, shown as N/A, when none matched; never
1.0) and `blockerRecallAll` over all gold blockers with unmatched ones counted as misses. Also per
case: `verdictInAllowedSet`, `spuriousBlockers`, `forbiddenClaims` (a `mustNotClaim` substring
inside a positive match's evidence), `inventedEmployer` (a company where the posting names none),
citation counts (`supplied`, `valid`, `claims`, `unsupported`) with `citationInvalid`, retrieval
counts (`queries`, `chunks`, `missingTerms`) and content-free telemetry per call. Failures are
outcomes: `extraction_failed` (stage `extractProfile` or `extractJob`) or `assessment_failed`,
classed as `schema_failure`, `refusal`, `truncation`, `timeout`, `provider_error` or `other` from
fixed adapter messages, error names and telemetry, never from message prose; a case behind the call
cap is `not_attempted` and makes `success` false. Aggregates: outcome counts, the rates above,
`goldVerdictAgreement` (all assessed cases), `humanVerdictAgreement` (reviewed cases only),
failure-class rates, `citationCorrectness`, `unsupportedClaimRate`, latency per operation (min /
median / max) and provider-reported tokens. Cost is never computed.

**Report.** `reportKind: "model-evaluation"`, report version 1, `model-metrics-v1`, validated
against a strict schema and saved as `evals/reports/model-<timestamp>-<uuid>/report.{json,md}`
(directory `0700`, files `0600`) unless `--no-save`; stdout carries the report without `cases`.
Before anything is written, `assertModelReportRedacted` throws if the JSON or the Markdown contains
a resume or posting text, a headline, an evidence sentence, a responsibility line, a key-shaped
string or a prompt tag; gold requirement texts are the authored contract and may appear.
`--baseline` compares case by case on the same `provider`, `requestedModel`, `promptVersion` and
golden-set hash (`outcomeChanged`, `verdictChanged`, `blockerRecallAllChanged`); a changed outcome
under a live model is a model-path observation, not a policy regression. Exit `0` when every
selected case was attempted, `1` on golden-set problems or not-attempted cases (the report is still
written), `2` on an argument or gate refusal or an incompatible baseline.

**What a dry run establishes.** Numbers under the fake verify the runner, not any model: the fake's
verdicts follow a fixed token-overlap rule and are not meant to agree with the gold set. Retention
is as for policy reports above. A live report names its provider, model and upstream and is evidence
for that endpoint only.
