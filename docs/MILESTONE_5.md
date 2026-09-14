# Milestone 5 plan — grounded GenAI application evidence (reviewed draft)

Status: **proposal**. Reviewed against `main` at `f8eee80` (#19) and open issues #4, #5, #6 on
2026-09-13. Nothing in this document changes runtime behaviour. The owner's draft plan
(`CAREER_RADAR_M5_GENAI_PLAN.md`) is the source; this file keeps its goal and principles, maps
each item onto what the repository already has, cuts what is duplicated, and turns the rest into
PR-sized slices with contract impact, acceptance criteria and test/eval plans.

## 0. What M5 is for, and what it is not

The goal stays as drafted: make the repository honest evidence that the owner can **design,
evaluate and operate a grounded GenAI application** (retrieval, evidence citations, bounded tool
use, regression evals, model-path observability). It is not ML/LLM training, fine-tuning, GPU
serving or large-scale production RAG, and the README must keep saying so.

Two rules from M4 carry over unchanged and gate every slice below:

- **Use before build.** The first usage check (2026-09-12) showed the product loop works and where
  it fails. Every M5 slice ends by re-running `pnpm usage-check` on the same three postings and
  recording whether the change helped a person prioritize. The re-run needs an approved call: a
  slice may merge as `synthetic-verified` before it, with the usage-check row on the baseline page
  marked `not verified` until the approved run is filed. The gate applies to the slices that change
  what `job_assess` returns (B and C); A, D and E are gated by their own evals. A change to the
  assessment path whose approved re-run makes the three answers worse is reworked before the next
  assessment-path slice merges.
- **Measure before claim.** `synthetic-verified`, `live-verified` and `not verified` are the only
  three labels. Live verification needs an approved call and names its provider and model
  (`docs/PROVIDERS.md`); numbers from one endpoint say nothing about another.

## 1. Review of the draft: what already exists

Much of M5-0, M5-B and M5-E is already in the tree. Building them again would repeat the pattern
the owner flagged on 2026-09-11 (verification tooling running ahead of the product).

| Draft item | Already in the repository | Gap that M5 should fill |
| --- | --- | --- |
| M5-0 prompt/policy/schema/code versions | `PROMPT_VERSION` (`milestone-4b2-v2`), eval reports carry `codeSha`, `policyHash`, `schemaHash`, `datasetVersion`/`datasetHash`, `metricVersion`, per-case `contractHash`; `pnpm eval --baseline` compares | A committed baseline report and one page that lists every feature's verification label |
| M5-0 "what is synthetic/live/not verified" | README M3/M4 sections, `MILESTONE_4B1/4B2.md`, `LIVE_MEASUREMENT.md`, `USAGE_CHECK.md` already state it per feature | Consolidate into one table with dates and SHAs |
| M5-B citation contract | B1 `EvidenceRef {source, path, quote}` with located exact-match validation, `uncertain` coercion, diagnostics in `unknowns`; M1 policy drops ungrounded positive matches; B2 wires it into the model path | Extend the locator grammar to retrieved evidence chunks; add citation metrics |
| M5-D metrics | Policy eval (28 cases, requirement-ID blocker recall, confusion matrix, human-review template); `measure:live` (latency, abort propagation, token counters, provider/model/upstream); `usage-check` telemetry per call | A **model-mode** eval runner (planned in M4 §6, never implemented) and a golden set that covers retrieval/citation cases |
| M5-E observability | `onResponse` telemetry (duration, finish status, usage, upstream provider, error class) on both providers; harness `OperationRecord`; usage-check per-call timings; fixed-message error sanitizing | A run ID that ties extraction, retrieval, model call, validation together, stage timings, failure counters, a local diagnostic view |
| Provider abstraction, fail-closed structured outputs | `contracts.ts` + OpenAI/OpenRouter adapters, `require_parameters`, schema re-validation | Nothing new |

Two draft items are **descoped or reshaped**:

- `get_application_history` as a model tool (M5-C). The draft itself says outcomes must never become
  fit evidence. Then the model must not be able to read them during assessment at all; exposing the
  tool and asking the model not to use it is the weakest possible guard. Application history stays a
  deterministic, separate view (M4-C). If a "why did this get rejected" feature is wanted later, it is
  a different tool with its own prompt, not part of assessment.
- Embedding retrieval and hybrid search (M5-A). Both need a separate model and provider choice
  (OpenAI embeddings, or OpenRouter's [embeddings API](https://openrouter.ai/docs/api_reference/embeddings),
  which exists but has not been exercised in this project), an extra transmission of the corpus, a
  budget, and index storage. M5 starts lexical-only and keeps the embedding adapter behind the same
  approval gate as every model call. Whether it is worth adding is decided from the lexical Recall@K
  numbers, not assumed.

## 2. Constraints the draft does not mention

- **Latency budget.** Retrieval and tools run inside `job_assess`/`job_recommend`. The batch deadline
  is 90 s (unmeasured on OpenAI, see #4), the MCP client default is 60 s per tool call, and the
  ChatGPT host has its own unknown limit. On the free OpenRouter endpoint one assessment already took
  67–81 s. Every slice that adds work inside a tool call must report its added latency from the
  usage check and must not make the single-call path slower than it is today by default.
- **Contract changes need widget bumps.** The v5→v6 lesson: any change to `FitAssessmentSchema`,
  `EvidenceRefSchema` enums or tool outputs that a strict parser could reject requires a new widget
  URI and a descriptor refresh, even when the change looks "looser".
- **Read contract vs generation contract.** Stored snapshots must keep loading; tightening goes into
  the draft schemas and prompts, not into the shared read schemas (the score lesson from #19).
- **Corpus privacy.** Committed corpus fixtures are synthetic. The owner's real blog posts and GitHub
  READMEs are public but still stay out of the repository as data; they can be indexed locally under
  `data/` (gitignored) with a documented removal path, like the database.
- **Provider parity.** Tool calling on OpenRouter depends on the routed endpoint. Tool use (M5-C) is
  OpenAI-first; the OpenRouter adapter keeps the single-call path and reports `not verified` for
  tools until measured.

## 3. Slices

Each slice is one PR (at most two). "Contract impact" lists everything a strict consumer, a stored
row or a prompt version would notice. Verification labels are what the PR may claim at merge.

### M5-0 — Freeze the baseline (1 PR, no runtime change)

Status: **done** — baseline frozen at `47e7c13` (`evals/baselines/m5-0/report.json`,
[MILESTONE_5_BASELINE.md](MILESTONE_5_BASELINE.md)); the owner's post-#19 usage-check re-run is
still pending and the baseline page says so.

- **Goal.** A comparable pre-M5 state.
- **Contract impact.** No runtime change. Adds `evals/baselines/m5-0/report.json` (policy eval
  output at the frozen SHA, synthetic only, committed on purpose) and `docs/MILESTONE_5_BASELINE.md`.
  One runner change: `compareReports` currently lists a `schemaHash` difference under
  `incompatibleReasons`, which would make this baseline unusable at the first M5 slice that touches
  `packages/shared/src/index.ts` (A adds a schema there, B widens two). The comparison keeps per-case `contractHash` as the
  authority and reports `schemaChanged: true` the way it already reports `policyChanged`, with a new
  `reportVersion`; `mode` and `metricVersion` stay hard incompatibilities.
- **Content of the baseline page.** Code SHA; `PROMPT_VERSION`; policy/schema hashes; dataset
  version and case count; SQLite migration version; widget URI; provider adapters and their pins;
  the first usage-check results file name and its per-call latencies (numbers only, no text); a
  table of every feature with `synthetic-verified` / `live-verified` / `not verified` and the SHA
  or run that supports the label.
- **Acceptance.** `pnpm eval --baseline evals/baselines/m5-0/report.json` reports 28 comparable
  cases and no regressions on `main`; a synthetic report with a different `schemaHash` but equal case
  hashes compares with `schemaChanged: true` and 28 comparable cases; the page has no feature
  without a label; no claim in it depends on memory. This policy baseline is compared only with
  policy-mode reports; model-mode reports (M5-D) get their own baseline when D lands.
- **Test/eval.** Existing suites plus the `schemaChanged` comparison cases. One test asserts the
  committed baseline is version-compatible with the current runner (so a future runner change is
  noticed).
- **Owner step (approval).** Re-run `pnpm usage-check` on the same three postings with the merged #19
  contracts and file the results as the behaviour baseline. Without it the page marks
  "post-#19 behaviour: not verified".

### M5-A — Evidence corpus and lexical retrieval (1–2 PRs)

Status: **done, lexical only** (branch `feat/m5-a-retrieval`). `EvidenceChunkSchema` in shared,
field and sentence chunkers, BM25 index with explicit misses, synthetic corpus of one profile plus
ten documents (four distractors), 36 authored queries, `pnpm eval:retrieval`. Numbers and the
M5-0 comparison result are on [MILESTONE_5_BASELINE.md](MILESTONE_5_BASELINE.md). A2 (embeddings)
stays closed until the owner decides §5.1.

- **Goal.** A retrieval layer over public-safe candidate evidence, measurable before any model sees it.
- **Design.** `EvidenceChunkSchema { id, sourceType: "profile" | "project" | "blog" | "synthetic",
  sourceId, locator, text (≤ 2,000 chars), metadata }` in shared. Chunk IDs are content hashes, so
  the same corpus yields the same ids on every run; whether a cited chunk belonged to *this* run is
  checked in M5-B against the run's retrieval trace, not by the hash. Two chunkers: field-level (one chunk per
  profile field or document section) and sentence-level. A lexical scorer (BM25 over tokenized text,
  in-process, no new service) with deterministic tie-breaking. Retrieval returns a trace
  `{ query, k, hits: [{ chunkId, score, rank }], misses }`; the trace is not part of any tool output
  yet.
- **Contract impact.** New shared schema (additive, no existing schema changes). New eval mode
  `pnpm eval:retrieval` with its own report version. No prompt change, no widget change, no DB
  migration (corpus fixtures live in `evals/fixtures/corpus/`; a local real corpus, if the owner builds
  one, lives under `data/corpus/` gitignored).
- **Acceptance.** Recall@K (K = 3, 5) over an authored set of at least 30 (query → relevant chunk
  ids) pairs on the synthetic corpus, reported per chunker; a retrieval miss is represented as an
  explicit empty hit list, never as a fabricated chunk; the same corpus and queries give identical
  scores on two runs (determinism test).
- **Test/eval.** Chunker tests (boundaries, IDs stable across runs, max length), scorer tests
  (exact term, stemming-free behaviour documented, tie order), Recall@K computation tests with a tiny
  hand-checked corpus, the eval report schema strict.
- **Not in A.** Embeddings, hybrid, reranking, any model call. A2 (embedding adapter) opens only if
  the owner approves an embeddings provider and cost, and only after A's numbers show where lexical
  fails.

### M5-B — Citations to retrieved evidence (1 PR)

- **Goal.** Important claims in an assessment point at a retrieved chunk, and a pointer that does
  not resolve is not evidence.
- **Design.** B is the first slice that puts retrieval on the assessment path: before the model
  call, `job_assess` and the recommendation batch run a deterministic retrieval (queries = the
  job's required and preferred requirement texts, fixed `k`) over the profile-derived corpus, and
  the retrieved chunks (id + text) are appended to the model input. The retrieval trace of that
  run is what citations resolve against; C later lets the model ask for more. Extend the B1 locator
  grammar: `EvidenceRef.source` gains `"evidence"` with `path = "chunk:<id>"`; `located()` gets an
  explicit `evidence` branch that resolves only `chunk:<id>` against **this run's** trace (today every
  non-candidate source falls through to the job paths, which must not accept an evidence ref), and
  validation requires the quote to equal the chunk text under `normalizeEvidence` (no substring
  matching, same as B1). `strongestMatches[].evidence` keeps its
  current profile-string grounding.

  Citations attach to claims, not to the result as a whole. Two claim kinds, two id rules:
  a match claim's id is `sha256(JSON.stringify(["match", requirementId ?? null,
  normalizeEvidence(requirement), normalizeEvidence(evidence)]))`; a requirement claim (a gap or a
  blocker, which the policy may copy between the two arrays) has the id `"req:" + requirementId`
  when an ID exists, else `"text:" + normalizeEvidence(requirement)`, so promotion does not change
  it. A new optional `citations` array on the fit result carries `{ claimId, ref: EvidenceRef }`.
  The M1 policy keeps citations consistent when it rewrites claims: a removed match takes its
  citations with it; `uniqueGaps` collapses a gap when its ID **or** its normalized text was already
  seen, and when it does, the citations of the collapsed gap are re-keyed to the surviving gap's
  `claimId`; a citation whose `claimId` matches no surviving claim is dropped. Every drop or re-key
  is recorded as a fixed sentence in `missingInformation` (the fit result has no `unknowns`; that
  list belongs to the screening context). The validator neutralizes invalid citations exactly as
  B1 does (drop, diagnose, lower confidence), never fails the fit.
- **Contract impact.** `EvidenceRefSchema` enum widens and `FitAssessmentSchema` gains an optional
  field. Both are shared read schemas, so this is an additive widening of the read contract: every
  stored snapshot still parses (test), no stored value is rewritten, and `schemaHash` changes (see
  M5-0). Strict old parsers reject the new enum value → **widget URI v7** and descriptor refresh.
  `PROMPT_VERSION` bump (assessment instructions gain the chunk grammar and the retrieved-evidence
  input). `ScreeningContextV1` stays `"1"`: its ref schema is the shared one and the new source
  value appears only in new writes. Added latency of the pre-retrieval is reported from the
  usage-check re-run (§2).
- **Acceptance.** Adversarial fixtures (nonexistent chunk id, quote from another chunk, quote
  altered by one negation, chunk from another run) all fail closed; a fixture with only valid
  citations passes unchanged; policy replay in the harness still equals the saved result; after the
  policy removes the first match or merges two blockers, no citation is attached to a different
  claim than the one it was produced for (regression fixture with a removed leading match and a
  dedup pair). The two metrics measure locator validity and coverage only; whether a cited sentence
  semantically supports the claim is not established by them and stays a human-review item.
- **Test/eval.** Validator unit tests mirroring `screening.test.ts`; policy-mode eval gains
  citation cases with expected `citationCorrectness` (valid ÷ supplied) and `unsupportedClaimRate`
  (claims with no resolvable citation ÷ claims, per `claimId`) computed deterministically from
  injected drafts; claim-id control cases: two matches on the same `requirementId` with different
  evidence get different ids, two ID-less matches with different requirement text get different
  ids, and a gap with an ID plus a blocker without one but with the same normalized text collapse to
  one claim whose surviving `claimId` carries both citation sets (the case that a `kind +
  requirementId ?? text` string concatenation gets wrong); a stored-snapshot fixture from before B
  parses unchanged; MCP integration test that outputs carry citations and the v7 URI.
- **Label at merge.** `synthetic-verified`. Whether a live model produces resolvable chunk ids is
  M5-D's question.

### M5-D — Minimal model-mode eval harness (1–2 PRs)

- **Goal.** Evaluate the real model path on a versioned golden set, with the same approval
  discipline as `measure:live`.
- **Design.** `pnpm eval --mode model` in the existing runner: for each golden case it runs
  extraction (profile and job) and assessment through the configured provider, then the
  deterministic pipeline, and records raw draft vs final result, per-call telemetry, and
  classification of failures (`schema_failure`, `refusal`, `truncation`, `timeout`,
  `tool_failure`, `citation_invalid`) as execution outcomes, never as `PASS`. The harness pieces are
  reused, not reimplemented: approval flags, hard call cap, CI refusal and base-URL refusal from
  `measure-live/gate.ts`, the pinned transport (`maxRetries: 0`, SDK logging off) and
  `assertRedacted` from `measure-live/report.ts`; `store: false` applies to the OpenAI path and the
  report keeps `store: "n/a"` for OpenRouter as today.
- **Gold contract (model mode is not policy mode).** Policy cases pair a fixed structured profile/JD
  with an *injected draft* and an expected post-policy result. In the 28-case dataset, four groups
  (12 cases) share identical profile/JD content once ids are ignored, and two of those groups carry
  conflicting expected verdicts because only the injected draft differs. Those expectations are
  contracts on the policy, not answers about the inputs, so they are **not** model gold, and the
  policy fixtures have no raw text behind them (profiles are built structurally with a placeholder
  `sourceHash`). A model-mode golden case is authored fresh: synthetic resume text and posting
  text; an expected verdict given as an allowed set (exact only when a reviewer signed it); expected
  required blockers by **requirement text**, never by fixture ID, because `toJob` assigns
  `job_<hash>_required_<n>` IDs at extraction time; forbidden claims; a human-review status that
  starts `pending`. Before scoring, the runner maps each extracted requirement to a gold requirement
  by unambiguous normalized-text equality and reports `requirementMatchRate`,
  `unmatchedGoldRequirements` and `unmatchedExtractedRequirements` as extraction outcomes. Blocker
  recall is reported twice: `blockerRecallMatched` over matched gold requirements only, and
  `blockerRecallAll` over all gold blockers with unmatched ones counted as misses, so an extraction
  miss cannot make recall look better; with zero matched requirements `blockerRecallMatched` is
  `null` (reported as N/A), never 1.0. An unmatched gold requirement is listed with the nearest
  extracted text and stays labelled `unmatched`: text equality cannot tell a paraphrase from a
  semantic miss, so the runner never classifies the cause, and the case's human-review status is
  where that call is made. Golden set: 30–50 authored cases whose structured shape
  mirrors the policy fixtures (so the same failure modes are covered), plus A–F scenario pairs and
  the M5-B citation cases.
- **Contract impact.** New report version and metric version; no runtime contract change.
- **Metrics.** Retrieval Recall@K (from A), citation correctness and unsupported-claim rate (from
  B), the two blocker recalls and the requirement match rate above (the policy-mode metric keyed by
  fixture ID is not used in model mode), schema-failure and refusal/truncation rates,
  latency per operation, provider-reported token counters. Human verdict agreement is reported only
  over cases whose review status is `reviewed`. Cost is never computed; the report links to the
  provider dashboard as `LIVE_MEASUREMENT.md` does.
- **Acceptance.** A model-mode report names provider, model, upstream, prompt/policy/schema/code
  versions and the golden-set hash; two reports on the same SHA and provider are comparable
  case-by-case; a case whose extraction failed is reported as extraction failure, not assessment
  failure; the runner refuses under CI/test env like the harness; extracting the same posting twice
  (fresh generated IDs each time) scores identically with a fake analyzer; a golden case whose
  extraction drops one of two gold blockers reports `blockerRecallMatched` 1.0 and
  `blockerRecallAll` 0.5, never a single number; a case with no matched requirement reports
  `blockerRecallMatched` as N/A; no golden case carries two conflicting gold verdicts for the same
  inputs.
- **Dependency on #4.** Latency and abort behaviour of the five-candidate batch stay in #4 via
  `measure:live`; model-mode eval is per case and does not re-measure the batch. #4's approved runs
  are the latency baseline this harness cites.
- **Label at merge.** The runner is `synthetic-verified` (fake analyzer end to end). Every number it
  produces is `live-verified` for the named provider only after an approved run.

### M5-E — Observability: one run ID through every stage (1 PR)

- **Goal.** Explain a slow, expensive, invalid or failed assessment stage by stage.
- **Design.** A `runId` created per tool call, threaded through analyzer telemetry (new optional
  field on `AnalyzerResponseEvent`), the retrieval trace, the validator diagnostics and the pipeline.
  Stage records: `extract`, `retrieve`, `model`, `validate`, each with start/duration/outcome.
  Counters: schema failures, refusals, truncations, timeouts, invalid citations, fallbacks, tool
  failures. Traces are kept in memory and optionally written under `data/traces/<runId>.json`
  (gitignored, 0o600, documented removal in `db:reset` or a `traces:clear` script) with no raw
  resume, no job text, no prompts and **no tool query text**: a model-written `search_evidence`
  query can copy career sentences or employer names from the inputs, so the persisted trace holds
  only a query hash, its length, hit ids and a fixed error class. Raw queries are available only in
  an explicit inspect mode with the same retention and removal rules as `measure:live --inspect`
  (an `inspection/` directory, 0o700, deleted with the run). A `pnpm diagnose <runId>` prints the
  stage table; the usage-check page links to it.
- **Contract impact.** Telemetry type gains optional fields (internal). No MCP output change unless
  the owner wants `runId` echoed in tool text for support; that would be additive text only.
- **Acceptance.** A failed usage-check step can be explained from its trace alone; the persisted
  trace of a successful run and of a failed run (including a failed tool query and its error)
  contains zero bytes of resume, posting or query text (sentinel tests on both paths); estimated
  cost never appears.
- **Test/eval.** Sentinel-leak tests like the harness; stage timing tests with a fake analyzer;
  removal-path test.

### M5-C — Bounded tool use in assessment (1–2 PRs, last, OpenAI-first)

- **Goal.** Let the assessment call request evidence instead of receiving everything up front,
  within a budget a reviewer can read.
- **Design.** One tool only: `search_evidence(query, k)` backed by M5-A. Responses API function
  tools on the OpenAI adapter; max 3 tool calls, per-call timeout as a share of the batch deadline,
  retries 0, and a fallback to the current no-tool path when the budget is exhausted or the tool
  errors. Two budgets are counted separately: **tool invocations** (≤ 3) and **model HTTP requests**
  (initial assessment + one follow-up per tool round + one pre-reserved fallback request). The
  fallback slot is part of the per-candidate upper bound, not extra; it runs under the same absolute
  deadline and AbortSignal as the batch, and if no request slot or no time remains the candidate
  ends as an explicit failure with zero additional HTTP requests. The tool trace (invocation count,
  query hash and length, hit ids, error class) is part of the run trace from M5-E and is what
  citations (M5-B) resolve against. The OpenRouter adapter does not get tools in this
  slice; it keeps the single call and reports tools as `not verified`.
- **Contract impact.** `PROMPT_VERSION` bump; no output schema change beyond the M5-B citations;
  no widget change; the `measure:live` and `usage-check` plans and caps count model HTTP requests
  with a per-candidate upper bound of `1 (extract) + 1 (assess) + maxToolCalls (follow-ups) + 1
  (fallback)`, and the approval screen shows that bound.
- **Acceptance.** Tool failure yields uncertainty, never fabricated evidence (adversarial fake
  tool that returns garbage or throws); the run never exceeds the configured request and time
  budget (fake clock test), including: the fallback slot is used at most once and, when the fallback
  itself fails, no further request is made; when the deadline expires before the fallback would
  start, it is not attempted and the candidate fails explicitly; the fallback observes the original
  deadline and AbortSignal; a reviewer
  can reconstruct every tool request from the trace by hash, count and hit ids; the no-tool path is
  byte-identical when tools are disabled (regression guard).
- **Label at merge.** `synthetic-verified`; live behaviour and its latency cost only after an
  approved run, and that cost decides whether tools stay on by default (they start off).

### M5-F — Portfolio evidence and failure write-up (docs + blog)

Architecture and data-flow page, the policy baseline (M5-0) compared with the post-M5 policy report
and the model-mode baseline (first D run) compared with the post-C model-mode report, at least one recorded
failure with its design change (the first usage check already supplies three), README positioning
that separates verified, synthetic-only and unverified, and the article "what broke when I added
retrieval". This slice has no code; it is the blog series continuing.

## 4. Order and gates

0 → A → B → D → E → C → F. Evidence quality must be measurable (A, B, D) before the model gets
autonomy (C). Slices that change the assessment path (B, C) are followed by a usage-check re-run on
the same inputs when a call is approved; a re-run that makes the three answers worse is reworked
before the next assessment-path slice merges. A, D and E may proceed on their own evals meanwhile.

## 5. Decisions the owner must make before M5-A

1. **Embeddings.** Lexical-only for M5, or approve an embeddings provider (which one, what budget)
   as a gated A2 after A's numbers.
2. **Tool use.** Keep M5-C in scope given the host/latency unknowns, or drop it and let M5 end at E.
3. **Corpus.** Synthetic-only in the repository; the owner's public writing indexed locally only.
   Confirm, or name what may be committed.

## 6. Issue boundaries

- #4 keeps the five-candidate batch and 90-second measurement; M5-D cites it and does not rebuild it.
- #5 keeps ChatGPT host verification; M5 changes to tool outputs (v7) add to its checklist.
- #6 keeps authentication, isolation and public release; M5 stays local and single-owner.

## 7. Agent execution contract

Before each slice, whichever agent implements it (Codex or Claude Code) reads `README.md`,
`docs/PROJECT_SPEC.md`, this file and the relevant issues; lists the contracts that change; keeps
the change to one reviewable PR; writes tests and evals before implementation; runs `pnpm build`,
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm eval`; and labels every claim
`synthetic-verified`, `live-verified` or `not verified`. Without explicit approval it does not
copy real personal data into fixtures, execute paid or external model calls, deploy publicly, add a
cloud or vector database service, switch models and call it an improvement, train fit labels from
outcomes, infer protected attributes, or turn market response into hiring probability.

## 8. Suggested parent issue

```text
[M5] Grounded GenAI application evidence: retrieval, citations, evals, observability, bounded tools
```

Body: this document's §0, §3 slice list and §5 decisions.
