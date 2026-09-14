# M5-0 — the pre-M5 baseline

Frozen on 2026-09-14 at commit `47e7c13ec412c902ddae6cd9ba46c05e9700981c` (clean checkout). Every
later M5 slice is compared against this page and against the committed policy-eval report
`evals/baselines/m5-0/report.json`. Nothing here is a claim about live model accuracy; each row
carries one of three labels and the run or SHA that supports it.

- `synthetic-verified`: exercised with the fake analyzer, synthetic fixtures and the test suites.
- `live-verified`: exercised with a real provider in an approved run, valid for the named provider,
  model and prompt version only.
- `not verified`: not exercised where the label says.

## Identifiers

| What | Value | Where it comes from |
| --- | --- | --- |
| Code SHA | `47e7c13ec412c902ddae6cd9ba46c05e9700981c` | `codeSha` in the baseline report; `dirty: false` |
| Prompt version | `milestone-4b2-v2` | `PROMPT_VERSION`, `server/src/ai/contracts.ts` |
| Policy hash | `c32f094edb818e2daa158bc61f8414584abe6b04f209debef2338249b09e24fc` | `digest(fileText)` of `server/src/domain/assessment/policy.ts`, where `digest` (`evals/evaluate.ts`) is `sha256(canonical(value))` and `canonical` of a string is `JSON.stringify(fileText)`; not the sha256 of the raw file bytes |
| Shared schema hash | `0e6a63c3e7afe7ad1c7869960bac72424f27cb38f11eafe5155caab189fc36a8` | same method over `packages/shared/src/index.ts` |
| Dataset | `synthetic-policy-v2`, 28 cases, hash `c685971017902d7e21251301dcdb8e47567341cebbec338210d66c025f462c54` | `evals/dataset.ts`, `evals/fixtures/cases.ts` |
| Metrics / report | `policy-metrics-v2` / report version 3 | `evals/evaluate.ts` |
| SQLite schema | `PRAGMA user_version = 2` (two migrations) | `server/src/infra/db/migrations.ts` |
| Widget URI | `ui://career-radar/widget-v6.html` | `server/src/mcp/createServer.ts` |
| MCP tools | 9: `career_radar_status`, `profile_upsert`, `job_ingest`, `job_assess`, `job_search`, `job_recommend`, `application_save`, `application_update`, `pipeline_summary` | `server/src/mcp/*.ts` |
| OpenAI adapter | Responses API `responses.parse`, `store: false`, model `OPENAI_MODEL` (default `gpt-5-mini`); SDK `openai` 7.4.0 | `server/src/ai/analyzer.ts`, `pnpm-lock.yaml` |
| OpenRouter adapter | chat/completions at `https://openrouter.ai/api/v1`, `provider.require_parameters`, schema re-validation, model `OPENROUTER_MODEL` (no default), `store: n/a`, optional `OPENROUTER_REASONING_EFFORT` | `server/src/ai/openrouter.ts` |
| Other pins | `@modelcontextprotocol/sdk` 1.30.0, `@modelcontextprotocol/ext-apps` 1.7.5, `zod` 3.25.76, Node ≥ 22.13 (`node:sqlite`) | `pnpm-lock.yaml`, `package.json` |

## Policy-eval baseline

`evals/baselines/m5-0/report.json` is the policy-mode report at the SHA above: 28 cases, 28
evaluated, 28 passed, 0 failed, 0 errors, 0 skipped, 28 pending human review. It is committed on
purpose (synthetic fixtures only). It compares only with policy-mode reports; the model-mode
runner (M5-D) gets its own baseline when it lands.

```sh
pnpm eval --baseline evals/baselines/m5-0/report.json --no-save
# expected: compatible: true, compared: 28, regressions: []
```

The comparison rule changed in this slice (report version 3): a different shared-schema hash is
reported as `schemaChanged`, next to `policyChanged` and `datasetChanged`, and comparability is
decided per case by `contractHash`. Before this change the first M5 slice that added a schema to
`packages/shared` would have made the baseline unusable. `reportVersion`, `metricVersion` and
`mode` differences are still hard incompatibilities. A test in
`server/tests/evaluation-baseline.test.ts` asserts that the committed baseline stays
version-compatible with the current runner and still compares all 28 cases.

## Usage-check behaviour baseline (round 1, pre-#19)

Round 1 of the usage check ran on 2026-09-12 with the synthetic measurement resume and three
public postings (local text files, not committed), provider OpenRouter, through the real MCP tools
over HTTP. Results files live under `data/usage-check/` (gitignored). Numbers below are the
recorded per-call durations; no text from the runs is reproduced here.

**Run `2026-09-12T03-03-45.865Z`** — model `liquid/lfm-2.5-2.6b:free`, prompt version not recorded
(pre-#18 build), 6 model calls, every posting failed with the fixed message "OpenRouter response ended before the structured output completed" (each failing call stopped at 8192 output tokens):

| Call | Duration (s) |
| --- | --- |
| extractProfile | 13.0 |
| extractJob (posting 1) | 61.8 |
| extractJob (posting 2) | 31.2 |
| assess (posting 2) | 38.1 |
| extractJob (posting 3) | 8.9 |
| assess (posting 3) | 36.5 |

**Run `2026-09-12T03-07-22.190Z`** — model `dots-studio/dots-3-note-preview:free`, prompt version
`milestone-4b2-v1`, 6 model calls, postings 2 and 3 assessed (both `PASS`), posting 1 failed with
`MCP error -32001: Request timed out` at the 5-minute tool deadline; in that build the underlying
request was not cancelled with the tool call (fixed in #18) and was recorded when it finished:

| Call | Duration (s) |
| --- | --- |
| extractProfile | 28.3 |
| extractJob (posting 1) | 515.0 (tool call timed out at 300.0) |
| extractJob (posting 2) | 59.9 |
| assess (posting 2) | 80.5 |
| extractJob (posting 3) | 28.8 |
| assess (posting 3) | 66.9 |

These runs used the pre-#19 contracts (`company` required, fractional `score` accepted, prompt
`milestone-4b2-v1`). **Post-#19 behaviour: not verified.** The owner step for this slice is to
re-run `pnpm usage-check` on the same three postings with the merged #19 contracts and record the
results file name here; until then the usage-check row below stays `not verified` for the current
SHA.

## First check after the freeze (M5-A)

M5-A added `EvidenceChunkSchema` to `packages/shared/src/index.ts`, the first M5 change to the
shared schema hash. `pnpm eval --baseline evals/baselines/m5-0/report.json --no-save` on the M5-A
branch reports `compatible: true`, `compared: 28`, `schemaChanged: true`, `regressions: []`: the
comparison rule from this slice did what it was changed for. The row for M5-A is at the bottom of
the table below.

## Second check after the freeze (M5-B)

M5-B changed `packages/shared` again (the `evidence` reference source and the optional
`citations` field) and the M1 policy file (citation re-keying). The comparison against this
baseline on the M5-B branch reports `compatible: true`, `compared: 28`, `schemaChanged: true`,
`policyChanged: true`, `regressions: []`, and lists the seven citation cases under `added`. The
current tree therefore runs `PROMPT_VERSION` `milestone-5b-v1`, widget `ui://career-radar/widget-v7.html`
and dataset `synthetic-policy-v3` (35 cases); the identifiers above stay the frozen pre-M5 values.

## Verification labels by feature

| Feature | Label | Supported by |
| --- | --- | --- |
| Deterministic fit policy: REALISTIC / STRETCH / PASS, hard blockers, ungrounded-match removal (M1) | synthetic-verified | policy eval 28/28 at `47e7c13`; `server/tests` |
| Same, on a live model path | live-verified for OpenRouter `dots-studio/dots-3-note-preview:free`, prompt `milestone-4b2-v1`, pre-#19 | run `2026-09-12T03-07-22.190Z`, two assessments; post-#19: **not verified** |
| Local SQLite storage, deletion path (`db:reset`), loopback Host/Origin gate (M2) | synthetic-verified | `server/tests` (store, HTTP gate) |
| Job search on allowed boards, recommendation batch, call cap, extraction cache (M3) | synthetic-verified; live: **not verified** | `server/tests`; issue #4 (no approved batch run) |
| Policy-eval contract: per-case hashes, versions, baseline comparison (M4-A, report v3) | synthetic-verified | this baseline; `server/tests/evaluation*.test.ts` |
| Evidence contract: located exact-match citations, `uncertain` coercion (M4-B1) | synthetic-verified; live-verified pre-#19 (same run as above) | `server/tests/screening.test.ts`; run `2026-09-12T03-07-22.190Z`; post-#19: **not verified** |
| Stage-aware application history, correction-safe aggregation (M4-C) | synthetic-verified; live: **not verified** | `server/tests`; not exercised in round 1 |
| Screening context in the model path, `unknowns` when ungrounded (M4-B2) | synthetic-verified; live-verified pre-#19 (same run) | `server/tests`; run `2026-09-12T03-07-22.190Z` (`uncertain` values observed); post-#19: **not verified** |
| Live batch measurement harness `measure:live` (approval gates, redaction, abort) | synthetic-verified; live: **not verified** | dry-run and fake-analyzer tests; no approved run (issue #4) |
| OpenAI adapter (Responses API, `store: false`) | synthetic-verified; live: **not verified** | fetch-stub tests; the only live attempt (M1) stopped at a credit error |
| OpenRouter adapter (`require_parameters`, re-validation, telemetry) | live-verified for `dots-studio/dots-3-note-preview:free`; structured-output failures observed with `liquid/lfm-2.5-2.6b:free` | runs `2026-09-12T03-07-22.190Z` and `2026-09-12T03-03-45.865Z`; other models: **not verified** |
| Usage-check runner (`pnpm usage-check`, loopback results page, per-call deadline with cancel propagation) | current runner: synthetic-verified; live: **not verified** | `server/tests/usage-check.test.ts`. The pre-fix runner (before the #18 review fixes) produced both round-1 runs above; the missing cancel propagation seen there was fixed afterwards and has not been exercised live since |
| #19 contract changes: employer optional, integer `score` generation contract, `OPENROUTER_REASONING_EFFORT` | synthetic-verified; live: **not verified** | `server/tests`; post-#19 re-run pending |
| Widget v6 strict parsing, stored pre-#19 snapshots still readable | synthetic-verified | `server/tests` (store snapshot fixture), `web` build |
| ChatGPT host: tool discovery, widget v6 rendering, re-entry, error display | **not verified** | only the M0 status card was seen in ChatGPT (2026-09-09); runbook `docs/HOST_CHECK.md`, run pending (issue #5) |
| Citations to retrieved evidence (M5-B): pre-retrieval before the model call, `chunk:<id>` refs resolved only against the run's trace, claim ids, policy re-keying, validator, widget v7 | synthetic-verified; live: **not verified** | `server/tests/{claims,citations,retrieve,snapshot-compat}.test.ts`, `screening.test.ts`, `httpApp.test.ts`; policy eval 35/35 with the seven citation cases: `citationCorrectness` 4/9 and `unsupportedClaimRate` 48/51 by construction (five adversarial refs are meant to be dropped); whether a live model produces resolvable chunk ids is M5-D's question |
| Evidence corpus, field/sentence chunkers, BM25 retrieval, `pnpm eval:retrieval` (M5-A) | synthetic-verified; live: not applicable (no model call) | `server/tests/evidence-*.test.ts`, `retrieval-*.test.ts`; retrieval eval on the M5-A branch: 36 queries, field chunker Recall@3 47/55 (0.855 micro, 0.866 macro) and Recall@5 49/55 (0.891 / 0.882), sentence chunker Recall@3 46/60 (0.767 / 0.773) and Recall@5 51/60 (0.850 / 0.845), deterministic, 0 dataset problems; no query returned an empty hit list, and three queries returned hits that contained none of their relevant chunks (morphology and an abbreviation, by design) |

No row above depends on anything not in the repository, in a results file named here, or in a
linked issue. When a later slice changes a row, it changes this table in the same PR and names
the run or SHA.
