# M5-F — what M5 built, what it measured, and what it did not show

The closing page of Milestone 5. It compares the frozen pre-M5 baseline with the tree after
M5-E, lists every recorded failure with the change it caused, and separates what was verified from
what was only built. Numbers here are reproducible from the repository unless a row says which
live run they come from. The architecture is on one page in [ARCHITECTURE.md](ARCHITECTURE.md);
the per-feature verification labels stay in [MILESTONE_5_BASELINE.md](MILESTONE_5_BASELINE.md).

## What M5 built

| Slice | PR | What landed | Verified as |
| --- | --- | --- | --- |
| Plan | #20 | `MILESTONE_5.md`, ADR-0013 | — |
| Host runbook | #21 | `HOST_CHECK.md` for issue #5 | not run yet |
| M5-0 baseline | #22 | `compareReports` reports `schemaChanged` instead of refusing; committed policy report at `47e7c13`; baseline page | synthetic |
| M5-A retrieval | #23 | `EvidenceChunkSchema`, field/sentence chunkers, BM25 with missing terms, synthetic corpus, `pnpm eval:retrieval` | synthetic (no model call by design) |
| M5-B citations | #24 | Pre-retrieval before the model call, `chunk:<id>` references resolved only against the run's trace, claim ids, policy re-keying, citation validator, widget v7, prompt `milestone-5b-v1` | synthetic |
| M5-D model-mode eval | #25, #26 | 33-case synthetic golden set, `pnpm eval --mode model`, failures as outcomes, two blocker recalls, `:free`-only OpenRouter gate, body-covering deadline, stage-attributed diagnostics (report v3) | synthetic; two small live runs recorded below |
| M5-E run trace | #27 | One run id per tool call, telemetry attribution, stage records and counters, `data/traces`, `pnpm diagnose` | synthetic |
| M5-C tool use | — | Dropped (ADR-0014) | — |

Owner decision on 2026-09-14 (ADR-0014): verification finishes on the free tier; no paid
provider, lexical retrieval only, synthetic corpus only, no tool use.

## Policy baseline: M5-0 versus the tree after M5-E

Both reports are committed: `evals/baselines/m5-0/report.json` (code `47e7c13`, dataset
`synthetic-policy-v2`, 28 cases) and `evals/baselines/m5-f/report.json` (code as recorded in the
file, dataset `synthetic-policy-v3`, 35 cases). `pnpm eval --baseline evals/baselines/m5-0/report.json`
on the current tree reports `compatible: true`, `compared: 28`, `schemaChanged: true`,
`policyChanged: true`, `regressions: []` and the seven citation cases under `added`.

| Metric (policy-metrics-v2) | M5-0 | After M5-E |
| --- | --- | --- |
| Coverage | 28/28 | 35/35 |
| Policy verdict agreement | 28/28 | 35/35 |
| Required blocker recall | 9/9 | 10/10 |
| PASS → REALISTIC (must stay 0) | 0/8 | 0/9 |
| Non-REALISTIC → REALISTIC (must stay 0) | 0/16 | 0/17 |
| Text-resolved blockers | 1 | 1 |
| Citation correctness (valid ÷ supplied) | — | 4/9 |
| Unsupported claim rate | — | 48/51 |
| Positive-evidence failures | 0 | 0 |

The table is the state of two different datasets, not a before/after measurement of the same one:
seven citation cases were added in M5-B. `citationCorrectness` 4/9 comes from those seven only (nine
supplied citations, five adversarial ones dropped by construction). `unsupportedClaimRate` 48/51 is
over all 35 cases: the original 28 supply no citations at all, so their 43 claims count as
unsupported, and the seven new cases add 5 unsupported of 8. Both are expected values for this
dataset, not scores. Every human-review field is still `pending`: the policy dataset is a contract
on the policy, not gold about people.

## Model-mode observations before the baseline

Two live runs exist, both on `dots-studio/dots-3-note-preview:free` through OpenRouter (upstream
`AtlasCloud`), synthetic golden texts only, cost reported as 0 by the key dashboard at the time of
the check. Neither is the baseline (next section): the first predates the draft/diagnostic fields, the
second was produced by report version 2 whose note attribution was text-based (fixed in #26), and
both are partial sets.

| Run | Cases | Calls | Outcomes | Observations |
| --- | --- | --- | --- | --- |
| Smoke, 2026-09-14 (report v1) | 3 | 9 | 3 assessed | 2 of 2 REALISTIC-expected cases came back STRETCH; 8 of 22 supplied citations resolved; all three cases lowered to `low` confidence by the citation validator; assess latency 49–86 s; 20.3k of 24.6k output tokens were reasoning |
| `--limit 13`, 2026-09-14 (report v2) | 13 | 29 | 7 assessed, 1 assessment timeout, 5 extraction failures | Timeout: the 300 s per-call deadline cut the call and the run continued. Extraction failures: `AuthenticationError` within 75–402 ms once the key stopped being accepted mid-run (cause not established from the 401 alone). Over the 7 assessed: requirement text match 9/9 (over the 8 extracted), blocker recall 2/2, verdict inside the gold set 5/7, verdict changed by the policy 2/7 (both to PASS through blocker promotion), confidence lowered by post-processing 5/7, citations 13/35 resolved; assess median ≈54 s over 8 calls including the timeout; 54,731 output tokens (49,040 reasoning) over the 23 calls that reported usage |

A third run on 2026-09-15 attempted the full set (66 calls before the key stopped being accepted from the 52nd
call on — the count matches a daily limit, which is not established) and lost its report: the model had copied a
posting's responsibilities line into the requirements, the report echoed it in `unmatchedExtracted`, and the
redaction guard discarded the whole run. The runner now replaces such strings with a fixed marker and counts
them, and `--resume` completes a cut run into one report; the attempt itself left only the per-case log lines
(18 cases reached an outcome: 15 assessed, 3 extraction failures at the posting).

The two REALISTIC-expected cases were STRETCH in the model's own draft in the second run; the first
run recorded no draft, so its cause is not established.

## Model-mode baseline (first approved full-set run)

Committed as `evals/baselines/m5-d/report.json` (report version 3, `model-metrics-v1`, code
`6afcd0a`, clean checkout, golden set `model-golden-v1` with the hash the runner computes today;
`server/tests/model-eval-baseline.test.ts` fails when the golden set, prompt, policy or shared
schema drifts from it). Provider `openrouter`, model `dots-studio/dots-3-note-preview:free`,
upstream `AtlasCloud`, synthetic golden texts only, cost 0 on the key dashboard. Made in 2 rounds
because the no-credit free tier allows 50 requests per day: 2026-09-16 (17 cases assessed, then 429
from the 52nd call) and 2026-09-17 `--resume` of the 16 remaining (109 calls in total, 5 cut by the
300 s per-call deadline). Numbers are evidence for this provider, model and endpoint only.

| Measure | Value |
| --- | --- |
| Outcomes | assessed 28, extraction failed 5 (all `timeout` at 300 s on the extraction call), assessment failed 0 |
| Requirement text match (extracted → gold) | 38/39 — the one miss is the Korean posting, where the model wrote `이끌은` for `이끈` |
| Blocker recall, matched / all | 10/10 / 10/10 |
| Verdict inside the gold allowed set | 18/28 (human-reviewed: none yet, N/A) |
| Verdict changed by the policy (draft → final) | 16/28, all towards PASS through blocker promotion |
| Pipeline diagnostics (cases) | ungrounded match removed 16, citation invalid 15, citation orphan 16, re-keyed 1 |
| Citation correctness / unsupported claim rate | 60/174 / 15/37 |
| Schema failure / refusal / truncation / timeout | 0/33 / 0/33 / 0/33 / 5/33 |
| Invented employers / forbidden claims / redacted model strings | 0 / 0 / 0 |
| Latency median ms (extractProfile / extractJob / assess) | 8614 / 14700 / 58318 (max 93370; five extraction calls hit 300,000) |
| Tokens over 88 reporting calls (in / out; reasoning) | 39,292 / 225,074; 195,864 |

What the baseline says about this model on this endpoint: it answers the M5-B question — the model
does cite retrieved chunk ids, but only about a third of its citations resolve against the run's
retrieval trace, and the rest are dropped with lowered confidence. It is lenient on the draft
(REALISTIC or STRETCH at `high` confidence) and the deterministic policy is the main source of PASS
verdicts: more than half of the final verdicts differ from the draft. Every case in the gold set is
still `pending` human review, so whether the gold or the model is right in the ten out-of-set cases
is not decided here. Extraction is the fragile stage on this endpoint: five calls did not return
within 300 s while no assessment call did.

## Recorded failures and the change each one caused

| Where it was found | Failure | Change |
| --- | --- | --- |
| Usage check, round 1 (#18) | A posting that named no employer got one invented by the model | `company` optional in the read contract; draft `null` instruction; widget v6 (#19) |
| Usage check, round 1 | `score` 0.65 on an undeclared scale | Integer 0–100 generation contract; stored fractions stay readable (#19) |
| Usage check, round 1 | Free endpoint reasoning ran to tens of thousands of tokens; one orphaned call finished after 515 s | Per-call `AbortSignal` deadline covering the body in the usage check; `OPENROUTER_REASONING_EFFORT` opt-in (#18 follow-up, #19) |
| #18 review | SDK `timeout` bounds only the wait for headers | Per-call deadline through `withCallDeadline` (now `server/src/ai/deadline.ts`) |
| #23 review | A heading directly followed by text lost the whole paragraph in the section chunker | Line-wise heading removal |
| #23 review | Partially resolvable relevance still produced a score | Recall reported as N/A for any unresolved entry |
| #23 review | "A content hash prevents citing chunks not in the run" was an overclaim | The trace decides membership; wording corrected everywhere |
| #24 review | One out-of-bounds citation (quote 2,001 chars, 65 citations, …) failed the whole assessment when the draft was mapped to the read contract | Bounds applied per citation with a fixed note and lowered confidence; `text-sha256:` claim ids for long requirements |
| #24 review | Harness replay lacked the retrieval evidence, so valid chunk citations were reported as mismatches | The measured analyzer records the evidence per call; replay uses it |
| #25 review | Choosing the OpenRouter provider did not enforce a free model | Live OpenRouter runs accept only `:free` model ids unless `--approve-model-cost` |
| #25 review | The model-mode runner pinned only the SDK timeout (the #18 lesson, missed again) | Shared `withCallDeadline` wraps the analyzer in the runner |
| #25 review | Golden-set integrity problems were reported but calls still ran | No analyzer is created when problems exist; CLI refuses before the plan |
| #26 review | Diagnostic codes were read from fixed sentences that the model could also write | Stages return what they did as counts; codes derive from those (report v3) |
| #27 review | A trace write failure failed the tool call after the assessment was saved | `trySave` with a fixed warning; the result is unaffected |
| #27 review | A stage still open when the batch deadline returned was saved as `ok / 0 ms` | Open stages are closed as aborted/timeout at finish; late settles do not rewrite |
| #27 review | `CAREER_RADAR_TRACES=off` also hid the directory from the removal scripts | Storage switch and removal path separated |
| #27 review | Duplicate import block passed the test runner and failed typecheck | Pre-commit chain fixed as typecheck, lint, build, test — all four, every time |
| Live run, 2026-09-14 | Key stopped being accepted mid-run | Failures classified `provider_error`; run continued; cause not established |

## The question M5 did not answer

The usage check's third question — is this easier than pasting the same material into a plain
chat — was answered "not yet" in round 1 and has not been measured side by side since. The owner's
own judgment on 2026-09-14 was that no large advantage had shown up, which is why verification ends
on the free tier. What the repository can show is narrower and concrete. The M1 policy removes a
positive match whose evidence sentence is not in the profile and promotes unmet binary core
requirements to hard blockers. The citation validator drops a citation that does not resolve against
this run's inputs or retrieval trace and lowers confidence, but keeps the verdict, evidence, gaps and
blockers as they are — an unsupported claim is marked, not removed, and a located quote is not proof
that the sentence supports the claim. A model failure of any class is an execution outcome and never
a verdict. Reports are comparable across runs, and a per-call trace explains where time went. What
it cannot show is that a person prioritizing
applications ends up better off than with a plain chat. That comparison would need the same inputs
run both ways and read by the same person; it is not scheduled.

## Not claimed

No live number verifies OpenAI; no run of the ChatGPT host beyond the M0 status card (#5); no
five-candidate batch measurement (#4); no human-reviewed gold; no cost figure other than the
dashboard's 0 on the day. Everything labelled `synthetic-verified` is exactly that.
