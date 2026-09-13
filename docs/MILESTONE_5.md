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
  recording whether the change helped a person prioritize. A slice that cannot be exercised through
  the product is not done.
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
- Embedding retrieval and hybrid search (M5-A). Both need an external embeddings call (a paid
  OpenAI path or a provider that OpenRouter does not offer) plus storage. M5 starts lexical-only and
  keeps the embedding adapter behind the same approval gate as every model call. Whether it is worth
  adding is decided from the lexical Recall@K numbers, not assumed.

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

- **Goal.** A comparable pre-M5 state.
- **Contract impact.** None. Adds `evals/baselines/m5-0/report.json` (policy eval output at the
  frozen SHA, synthetic only, committed on purpose) and `docs/MILESTONE_5_BASELINE.md`.
- **Content of the baseline page.** Code SHA; `PROMPT_VERSION`; policy/schema hashes; dataset
  version and case count; SQLite migration version; widget URI; provider adapters and their pins;
  the first usage-check results file name and its per-call latencies (numbers only, no text); a
  table of every feature with `synthetic-verified` / `live-verified` / `not verified` and the SHA
  or run that supports the label.
- **Acceptance.** `pnpm eval --baseline evals/baselines/m5-0/report.json` reports 28 comparable
  cases and no regressions on `main`; the page has no feature without a label; no claim in it depends
  on memory.
- **Test/eval.** Existing suites unchanged. One test asserts the committed baseline is
  version-compatible with the current runner (so a future runner change is noticed).
- **Owner step (approval).** Re-run `pnpm usage-check` on the same three postings with the merged #19
  contracts and file the results as the behaviour baseline. Without it the page marks
  "post-#19 behaviour: not verified".

### M5-A — Evidence corpus and lexical retrieval (1–2 PRs)

- **Goal.** A retrieval layer over public-safe candidate evidence, measurable before any model sees it.
- **Design.** `EvidenceChunkSchema { id, sourceType: "profile" | "project" | "blog" | "synthetic",
  sourceId, locator, text (≤ 2,000 chars), metadata }` in shared. Chunk IDs are content hashes so a
  citation cannot point at a chunk that was not in the run. Two chunkers: field-level (one chunk per
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
- **Design.** Extend the B1 locator grammar: `EvidenceRef.source` gains `"evidence"` with
  `path = "chunk:<id>"`; validation requires the id to be in **this run's** retrieval trace and the
  quote to equal the chunk text under `normalizeEvidence` (no substring matching, same as B1).
  `strongestMatches[].evidence` keeps its current profile-string grounding; a new optional
  `citations` array on the fit result carries chunk refs for matches, gaps and blockers. The
  validator neutralizes invalid citations exactly as B1 does (drop, diagnose in `unknowns`, lower
  confidence), never fails the fit.
- **Contract impact.** `EvidenceRefSchema` enum widens and `FitAssessmentSchema` gains an optional
  field → **widget URI v7** and descriptor refresh; `PROMPT_VERSION` bump (assessment instructions
  gain the chunk grammar); `ScreeningContextV1` stays `"1"` because the ref schema is shared and the
  new source value is additive for new writers only — old snapshots never contain it. Read contracts
  untouched.
- **Acceptance.** Adversarial fixtures (nonexistent chunk id, quote from another chunk, quote
  altered by one negation, chunk from another run) all fail closed; a fixture with only valid
  citations passes unchanged; policy replay in the harness still equals the saved result.
- **Test/eval.** Validator unit tests mirroring `screening.test.ts`; policy-mode eval gains
  citation cases with expected `citationCorrectness` (valid ÷ supplied) and `unsupportedClaimRate`
  (claims without any resolvable citation ÷ claims) computed deterministically from injected drafts;
  MCP integration test that outputs carry citations and the v7 URI.
- **Label at merge.** `synthetic-verified`. Whether a live model produces resolvable chunk ids is
  M5-D's question.

### M5-D — Minimal model-mode eval harness (1–2 PRs)

- **Goal.** Evaluate the real model path on a versioned golden set, with the same approval
  discipline as `measure:live`.
- **Design.** `pnpm eval --mode model` in the existing runner: for each golden case it runs
  extraction (profile and job) and assessment through the configured provider, then the
  deterministic pipeline, and records raw draft vs final result, per-call telemetry, and
  classification of failures (`schema_failure`, `refusal`, `truncation`, `timeout`,
  `tool_failure`, `citation_invalid`) as execution outcomes, never as `PASS`. Approval, hard call
  cap, `store: false`, retries off, base-URL refusal and redaction are reused from the harness
  (`gate.ts`), not reimplemented. Golden set: the 28 policy cases' inputs plus authored A–F scenario
  pairs and the M5-B citation cases, 30–50 total, each with a human-review status field that stays
  `pending` until a person fills it.
- **Contract impact.** New report version and metric version; no runtime contract change.
- **Metrics.** Retrieval Recall@K (from A), citation correctness and unsupported-claim rate (from
  B), hard-blocker recall by requirement ID (existing), schema-failure and refusal/truncation rates,
  latency per operation, provider-reported token counters. Human verdict agreement is reported only
  over cases whose review status is `reviewed`. Cost is never computed; the report links to the
  provider dashboard as `LIVE_MEASUREMENT.md` does.
- **Acceptance.** A model-mode report names provider, model, upstream, prompt/policy/schema/code
  versions and the golden-set hash; two reports on the same SHA and provider are comparable
  case-by-case; a case whose extraction failed is reported as extraction failure, not assessment
  failure; the runner refuses under CI/test env like the harness.
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
  resume, no job text, no prompts; identifiers, counters and durations only. A `pnpm diagnose
  <runId>` prints the stage table; the usage-check page links to it.
- **Contract impact.** Telemetry type gains optional fields (internal). No MCP output change unless
  the owner wants `runId` echoed in tool text for support; that would be additive text only.
- **Acceptance.** A failed usage-check step can be explained from its trace alone; the trace of a
  successful run contains zero bytes of resume or posting text (sentinel test); estimated cost never
  appears.
- **Test/eval.** Sentinel-leak tests like the harness; stage timing tests with a fake analyzer;
  removal-path test.

### M5-C — Bounded tool use in assessment (1–2 PRs, last, OpenAI-first)

- **Goal.** Let the assessment call request evidence instead of receiving everything up front,
  within a budget a reviewer can read.
- **Design.** One tool only: `search_evidence(query, k)` backed by M5-A. Responses API function
  tools on the OpenAI adapter; max 3 tool calls, per-call timeout as a share of the batch deadline,
  retries 0, and a fallback to the current no-tool path when the budget is exhausted or the tool
  errors. The tool trace (calls, queries, hit ids, errors) is part of the run trace from M5-E and
  is what citations (M5-B) resolve against. The OpenRouter adapter does not get tools in this
  slice; it keeps the single call and reports tools as `not verified`.
- **Contract impact.** `PROMPT_VERSION` bump; no output schema change beyond the M5-B citations;
  no widget change; harness call plan must count tool round-trips (the `measure:live` plan and cap
  logic need a per-candidate upper bound of `2 + maxToolCalls`).
- **Acceptance.** Tool failure yields uncertainty, never fabricated evidence (adversarial fake
  tool that returns garbage or throws); the run never exceeds the configured call and time budget
  (fake clock test); a reviewer can reconstruct every tool request from the trace; the no-tool path
  is byte-identical when tools are disabled (regression guard).
- **Label at merge.** `synthetic-verified`; live behaviour and its latency cost only after an
  approved run, and that cost decides whether tools stay on by default (they start off).

### M5-F — Portfolio evidence and failure write-up (docs + blog)

Architecture and data-flow page, baseline-vs-M5 eval comparison (from D), at least one recorded
failure with its design change (the first usage check already supplies three), README positioning
that separates verified, synthetic-only and unverified, and the article "what broke when I added
retrieval". This slice has no code; it is the blog series continuing.

## 4. Order and gates

0 → A → B → D → E → C → F. Evidence quality must be measurable (A, B, D) before the model gets
autonomy (C). Each merge is followed by a usage-check re-run on the same inputs when a call is
approved; a slice whose re-run makes the three usage-check answers worse is reverted or reworked
before the next slice starts.

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
