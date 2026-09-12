# Live batch measurement harness (issue #4)

`pnpm measure:live` measures how the recommendation batch (`JobDiscovery.recommend()`) behaves against the real Responses API: whether five candidates finish inside `RECOMMEND_DEADLINE_MS` (90 s), how long each extraction and assessment takes, how quickly the deadline abort propagates, what a retry re-spends, and what usage the API reports. It exists because those numbers have not been measured yet; the 90 s budget is still a stated assumption (README M3 section, `docs/MILESTONE_3.md`, ADR-0011).

A single run is evidence, not a decision. The report says so, and the decision fields stay empty until the owner has three approved runs.

## What the harness never does

- **No paid call without a double opt-in.** `--approve-network` and `--approve-model-cost` must both be on argv, and the run then prints the plan and waits for one stdin line that must equal the printed call cap. Any other input declines with exit 3 and zero calls.
- **The environment can refuse, never grant.** `CI`, `GITHUB_ACTIONS`, `VITEST`, `NODE_ENV=test` and `CAREER_RADAR_DB_PATH` each refuse an approved mode. Nothing in `.env.local` or the shell can turn a dry run into a live run; `.env.local` is only read after the confirmation line, for the key and `OPENAI_MODEL`.
- **Hard ceiling of 40 model calls per invocation.** The per-run cap defaults to the planned upper bound (two calls per candidate per batch, plus one optional profile extraction) and can only be lowered with `--max-model-calls`. The wrapper refuses the 41st call before it reaches the SDK.
- **No application data.** The harness never opens `data/career-radar.db`; it uses a temporary SQLite file (or `inspection/harness.db` with `--inspect`) and a synthetic, invented profile. The job descriptions are public Greenhouse postings fetched through the same SSRF-safe provider the server uses.
- **Reports hold counters, hashes and identifiers only.** No job description text, no resume text, no extracted requirement strings, no assessment prose, no key, no model request or response bodies. A redaction check runs over the serialized report before anything is written; report directories are `0o700`, files `0o600`, and `evals/reports/` is git-ignored.
- **SDK transport pinned.** Every harness request, including the optional profile extraction, is made with SDK retries off (one attempt per counted call) and SDK logging off, so `OPENAI_LOG=debug` cannot print request bodies. A live run is refused while `OPENAI_BASE_URL` is set in the shell or in `.env.local`, so requests can only go to `https://api.openai.com/v1`; the report records these three settings.
- **No money figures.** `billing.monetaryCostConfirmed` is always `false`; token counters are API-reported usage, not a bill. Call-count differences between runs are integers, never percentages.

## Modes

| argv | mode | network | model calls |
| --- | --- | --- | --- |
| (no approval flag) | dry run: fixture provider + fake analyzer, full A/B/C flow | none | 0 |
| `--approve-network` | search only: one Greenhouse GET, prints the plan | one public GET | 0 |
| `--approve-network --approve-model-cost` | live: plan, typed confirmation, then paid calls | Greenhouse GET + api.openai.com | at most the cap |

The dry run is the default so `pnpm measure:live` is always safe to type. `--scenario fail-at-3` and `--scenario stall --deadline-ms <= 10000` exercise the failure and abort paths without a model; both flags are refused in approved modes.

## Running

```bash
pnpm measure:live                                   # dry run, saved under evals/reports/dry-run-<timestamp>-<uuid>/
pnpm measure:live --no-save --scenario fail-at-3    # dry run, nothing written
pnpm measure:live --approve-network                 # free: search + plan, no key needed
pnpm measure:live --approve-network --approve-model-cost   # live: type the printed cap to proceed
```

Flags: `--provider openai|openrouter` (default `openai`; the plan names the destination, and OpenRouter needs `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in `.env.local`, see [PROVIDERS.md](PROVIDERS.md)), `--board-token` (default `greenhouse`), `--title-keywords`, `--location`, `--limit 1..10`, `--candidate-ids a,b,c` (at most 5), `--deadline-ms` (default 90000, max 600000), `--retry-mode failed-only|all|none`, `--forced-abort-ms` (adds run C, must be below the deadline), `--include-profile-extraction` (+1 call), `--max-model-calls`, `--settle-wait-ms` (default 30000), `--output DIR` (must not exist; relative to the current directory like `pnpm eval`; `pnpm measure:live -- --output DIR` also works, the forwarded `--` is ignored), `--inspect` (keeps drafts and the SQLite file under `inspection/`), `--no-save` and `--scenario` (dry run only), `--help`.

## A live run, step by step (owner)

1. Put `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`) in `.env.local`. The harness reads it only after the confirmation line and removes the key from its own environment right after constructing the analyzer.
2. Run `pnpm measure:live --approve-network --approve-model-cost`. The free Greenhouse search runs first and the plan is printed: search id and expiry, each selected candidate with title, location and description length, the model and prompt version, the runs (A at the production deadline, B retry, optional C forced abort), the model-call upper bound and the cap.
3. Type the cap number exactly and press Enter. Anything else declines.
4. Run A executes the batch at `--deadline-ms`; run B retries failed and not-attempted candidates (or all, or none); run C, if requested, forces an abort at `--forced-abort-ms` to time abort propagation against a real in-flight request. After each batch the harness waits up to `--settle-wait-ms` for a request the batch abandoned at the deadline so its real duration is known.
5. Ctrl-C writes a partial report (exit 130) that includes every call recorded so far: finished batches as usual and the batch in progress with `recommendOutcome: "interrupted"`, its completed calls and the in-flight one as `unsettled`. That in-flight request may still be billed with its usage unrecorded; the report says so.
6. A report names its provider and model; numbers from `--provider openrouter` describe that endpoint only and do not verify the OpenAI path. Read `report.md`, paste `issue-comment.md` into issue #4, and confirm the cost for the run window in the OpenAI usage dashboard. Repeat on other days or boards until three approved runs exist, then fill the decision section and update every place the budget is stated (`report.links.budgetStatedIn`).

Exit codes: `0` complete, `1` finished but the reconciliation found an inconsistency (report status `incomplete`; read `reconciliation.errors`), `2` refused or invalid, `3` confirmation declined (zero calls), `130` interrupted.

## Reading the report

- **Operations** are one row per analyzer call with a sequence number, candidate, start offset, duration, status (`ok`, `error`, `aborted`, `unsettled`, `cap_refused`), error class, HTTP status, request id, response id, response model and usage. Timing comes from the wrapper's own promise handlers, so it survives the batch abandoning a call at the deadline. The SDK-side duration from the analyzer's `onResponse` hook is joined to the same row; a join mismatch is a reconciliation error.
- **Candidates** carry the outcome (`completed`, `failed`, `not_attempted`), the cache category (`extracted_and_assessed`, `extraction_cache_hit_assessed`, `extraction_only_then_failed`, `not_attempted`, `assess_rerun_of_completed`, `cap_refused`), whether the store already held the job before the batch, and a policy replay check: the saved assessment must equal `applyAssessmentPolicy` over the captured model draft.
- **What-if** sums the sequential timeline; `wouldFinishWithin` is `true` only from an exact sum of successful calls. Any aborted, failed or unsettled call turns it into a lower bound with `"unknown"`.
- **Abort propagation** reports when the deadline fired, how long `recommend()` took to return afterwards, which call was in flight, and how long after the abort that call actually settled.
- **Budget observation** restates the deadline, run A's total, the headroom and the per-operation durations. `runsRequiredBeforeDecision` is 3 and `decision.recommendedDeadlineMs` stays `null`.
- Dry-run timings are fake delays and say nothing about model latency; they only prove the pipeline, the accounting and the redaction.

## Files

- `server/scripts/measure-live/gate.ts`: argv parsing, mode resolution, refusals, confirmation rule (pure, unit-tested).
- `server/scripts/measure-live/measured-analyzer.ts`: the `CareerAnalyzer` wrapper that records timings, joins hook events, enforces the cap and settles abandoned calls.
- `server/scripts/measure-live/timeline.ts`: outcome classification, cache accounting, what-if, abort latency, usage sums, policy replay.
- `server/scripts/measure-live/run.ts`: search, run A/B/C orchestration, reconciliation.
- `server/scripts/measure-live/report.ts`: strict report schema, Markdown and issue-comment rendering, redaction check, file writing.
- `server/scripts/measure-live/synthetic-inputs.ts`, `fake-analyzer.ts`: the invented profile, the fixture provider and the no-model analyzer used by the dry run.
- `server/scripts/measure-live/cli.ts`: the entry point; the only file that touches stdin, the environment, the key or the file system for reports.
- Tests: `server/tests/measure-live-*.test.ts`, `server/tests/analyzer-telemetry.test.ts`, and the `deadlineMs` cases in `server/tests/discovery.test.ts`.
