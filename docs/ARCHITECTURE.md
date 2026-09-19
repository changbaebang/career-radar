# Architecture and data flow (as of M5-E)

One page for a reader who wants to know what runs where, which parts are deterministic, and what
never leaves the machine. Everything here is in the tree; nothing depends on a live run. The
product specification is [PROJECT_SPEC.md](PROJECT_SPEC.md); decisions are in
[DECISIONS.md](DECISIONS.md); what has actually been verified, and how, is in
[MILESTONE_5_BASELINE.md](MILESTONE_5_BASELINE.md).

## Shape

```text
ChatGPT (MCP client)  ──HTTP /mcp──▶  server/  (express + MCP SDK, loopback only)
                                        │
        ui://career-radar/widget-v7 ◀───┤  web/  React widget (strict parser of tool output)
                                        │
                                        ├─ domain/store        SQLite (node:sqlite, WAL)  data/career-radar.db
                                        ├─ ai/                 OpenAI (Responses API) | OpenRouter (chat/completions via @tanstack/ai-openrouter + request-local HTTP client boundary)
                                        ├─ domain/evidence     chunkers + BM25 retrieval (deterministic, model-free)
                                        ├─ domain/assessment   M1 policy → citation validator → screening validator
                                        └─ domain/trace        run id, stage records, data/traces/<runId>.json
packages/shared/   zod read contracts shared by server, widget and evals
evals/             policy eval, retrieval eval, model-mode eval (golden set), committed baselines
server/scripts/    measure:live harness, usage-check, diagnose, db:reset, traces:clear
```

Three packages in one pnpm workspace. `packages/shared` holds the **read contracts**: every
structure the widget, the store and the evals accept (`CandidateProfile`, `JobPosting`,
`FitAssessment` with citations and screening context, application records). The **generation
contracts** the model is asked to fill (`server/src/ai/contracts.ts`) differ from the read contracts
on purpose, in both directions: `score` is an integer in generation and may be a stored fraction in
reading; citation bounds (reference length, claim id length, count) exist only in the read contract
and are applied per citation when a draft is mapped, so one out-of-bounds citation is dropped with a
fixed note and lowered confidence instead of failing the assessment (M5-B lesson). A draft that
violates the generation contract itself still fails to parse, and that failure is an execution
outcome, not a verdict.

## One assessment, stage by stage

`job_assess(candidateProfileId, jobId)` is the core path; `job_recommend` runs the same stages per
selected candidate with a batch deadline.

1. **Inputs from the store.** The structured profile and posting were saved by `profile_upsert`
   and `job_ingest` (both model extractions from raw text; the raw resume is never stored, the
   posting text is, because it is public). Ids are content hashes (`stableId`).
2. **Retrieve (deterministic).** The posting's requirement texts are run as BM25 queries over the
   profile's sentence chunks (`domain/evidence`). The result is the run's *retrieval trace*: the
   chunks the model may cite, plus per-query hits and missing terms. A `chunk:<id>` is a content
   hash, so it is a stable identifier; whether a chunk belongs to this run is decided only by the
   trace.
3. **Model (one call).** The analyzer sends the profile, the posting and the retrieved chunks and
   receives a draft: verdict, confidence, matches, gaps, hard blockers, per-claim citations, optional
   screening context. Provider is `openai` or `openrouter` (`ai/provider.ts`), never a silent
   fallback between them. Transport pins (`maxRetries: 0`, SDK logging off) and per-call deadlines
   that cover the response body are the callers' responsibility (harness, usage check, model eval).
4. **Validate (deterministic).** `finalizeAssessmentDetailed` runs the M1 policy (ungrounded matches
   removed, binary core gaps promoted to hard blockers, PASS whenever a blocker exists, verdict and
   confidence adjusted, citations re-keyed or orphaned along with the claims), then the citation
   validator (a citation survives only if its reference resolves against this run's inputs or
   retrieval trace and its quote equals that text), then the screening-context validator (values
   without a located reference degrade to `uncertain`). Each stage reports what it did as counts;
   the fixed sentences it adds to `missingInformation` are the reader's trace of the same events,
   never the evaluation's source of truth.
5. **Persist and answer.** The final assessment is saved as a snapshot; the tool returns the
   structured result (rendered by the widget) and a one-line text that ends with the run id.
6. **Trace.** Every stage above is a record under one run id (`domain/trace`), with the analyzer's
   telemetry attributed to the open model stage through `AsyncLocalStorage`. Traces hold timings,
   counts, hashes, ids and fixed classes only, and go to `data/traces/` (removed by `pnpm db:reset`
   or `pnpm traces:clear`). `pnpm diagnose <runId>` prints the stage table.

Applications (`application_save`, `application_update`, `pipeline_summary`) record decisions and
observed outcomes next to the assessment snapshot; outcomes never feed back into assessment.

## What is deterministic and what is not

| Layer | Deterministic? | Verified by |
| --- | --- | --- |
| Extraction (profile, posting) | No — model | Model-mode eval (extraction outcomes), usage check |
| Retrieval | Yes | `pnpm eval:retrieval` (Recall@K over authored queries) |
| Draft assessment | No — model | Model-mode eval (golden set), usage check |
| Policy, citation and screening validation | Yes | `pnpm eval` (policy cases with injected drafts), unit tests |
| Trace, store, HTTP gate | Yes | Unit and integration tests |

The model is asked for judgment; the code decides what counts as evidence and what a failure is.
A model failure (schema, refusal, truncation, timeout, provider error) is an execution outcome and
is never turned into a verdict.

## Where data goes

What is transmitted, by path and by call:

| Path | Who receives the inputs | Gate |
| --- | --- | --- |
| ChatGPT host → this server | ChatGPT processes the conversation, the tool inputs and the tool results under its own terms before and after the server does; the server then sends the model calls below to the configured provider | The host's own user consent; no CLI flag and no CI refusal on this path (`server/src/index.ts` → `createHttpApp` → `createAnalyzerFromEnv`) |
| Configured provider (`docs/PROVIDERS.md`) | OpenAI directly, or OpenRouter (through the TanStack AI adapter, `docs/TANSTACK_OPENROUTER.md`), which forwards to the upstream endpoint that serves the model (recorded per call as `upstreamProvider`) | Provider choice is explicit, never a silent fallback; the OpenRouter SDK's retries and loggers are pinned off |
| `pnpm eval --mode model` | Same provider path | `--approve-transmission`; refused under CI/test; hard ceiling of 150 calls; OpenRouter live only with a `:free` model id unless `--approve-model-cost`; `--provider openai` needs the cost flag |
| `pnpm measure:live` | Same provider path | `--approve-network` (search only) and `--approve-model-cost` plus a typed call cap for model calls; refused under CI/test; hard ceiling of 40 calls; no `:free` check — the configured model runs |
| `pnpm usage-check` | Same provider path | `--approve-transmission` only: no CI/test refusal and no `:free` check — the configured provider and model run; bounded by at most five postings and a per-call deadline |

Per call: `profile_upsert` sends the **raw resume text**; `job_ingest` sends the **posting text**;
`job_assess` and the recommendation batch send the **structured profile, the structured posting and
the retrieved chunks** (sentences from the profile). A free tier is still a transmission.

What is kept, and where:

| Data | Where | Removal |
| --- | --- | --- |
| Structured profile, postings (text included, they are public), assessment snapshots, applications, events | `data/career-radar.db` (gitignored) | `pnpm db:reset` |
| Run traces: timings, counts, hashes, ids, fixed classes; no input text | `data/traces/` (gitignored) | `pnpm traces:clear`, `pnpm db:reset` |
| Usage-check results and page inputs; `measure:live --inspect` inspection directory (model drafts and extraction results, 0700) | `data/usage-check/`, the run's `inspection/` (gitignored) | Delete the run directory |
| Evaluation and measurement reports (counts, hashes, fixed strings) | `evals/reports/` (gitignored) | Delete the run directory |
| API keys | `.env.local` (gitignored, 0600), by the owner | Rotate or delete the file |
| Synthetic fixtures, the golden set, and the committed policy baselines — these carry the **full synthetic profile, posting and injected-draft texts** in `cases[].fixture` and the policy's output sentences in `cases[].actual` | Repository | Committed on purpose; nothing in them is about a real person |

Not kept by this code: the raw resume text after extraction, prompts, and model-written free text
in traces and aggregate reports; the CLIs print fixed refusal strings, never argv or env values.
Local removal says nothing about retention by ChatGPT, OpenAI, OpenRouter or the upstream endpoint;
their policies apply to everything transmitted.

## Evaluation and measurement tools

| Command | What it runs | Model calls |
| --- | --- | --- |
| `pnpm eval` | 35 policy cases: injected drafts through the deterministic pipeline; compares with a committed baseline | 0 |
| `pnpm eval:retrieval` | Recall@3/5 of BM25 over the synthetic corpus, per chunker | 0 |
| `pnpm eval --mode model` | 33 golden cases through extraction, retrieval, assessment and the pipeline; dry run with a fake analyzer unless `--approve-transmission` | 0 (dry) / ≤ 3 per case (live) |
| `pnpm usage-check` | One profile and up to five postings through the real MCP tools; a local results page | ≤ 1 + 2 per posting (approved) |
| `pnpm measure:live` | The five-candidate recommendation batch under its 90-second deadline | ≤ 40 (approved) |
| `pnpm diagnose` | Reads a run trace | 0 |

Numbers from a live command are evidence for the named provider, model and endpoint only.
