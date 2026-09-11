# M4-B2 — Screening context in the model path

Base: #15 merge `cf3185b`. Owner decision on 2026-09-11: implement B2 now and keep every real
API call (live smoke, model-mode producer evals) on hold until cost approval. Private,
single-owner **LOCAL_DRAFT**. Everything below was verified with synthetic inputs and a fake or
mocked analyzer; no model was called and no real resume was used.

## What changes

- **One assessment call produces the screening context.** The `assess` structured output gains a
  `screeningContext` draft (seniority fit, career-story risk, screening risks, unknowns, each with
  located evidence references). No second model operation: the recommendation batch still makes
  at most two calls per candidate, so the #4 measurement plan and the 90-second budget are unchanged.
  `PROMPT_VERSION` is now `milestone-4b2-v1`; every new assessment records it.
- **Producer normalization in the analyzer.** The draft becomes a `version: "1"` context. A context
  outside the B1 bounds (more than 8 refs/risks, more than 32 producer unknowns, over-long text)
  is dropped and a fixed note is appended to `missingInformation`; the fit result never fails
  because of the context.
- **One deterministic pipeline.** `finalizeAssessment` in `server/src/domain/assessment/pipeline.ts`
  applies the M1 policy and then the B1 located-reference validator against the exact profile and
  job the model received. Unverified references degrade judgments to `uncertain` with neutral
  copy; a validator rejection drops the context with the same note. `job_assess`, `job_recommend`
  and the live-measurement replay all use this function, so a saved result always equals the
  pipeline over the captured draft.
- **Contract.** `FitAssessmentSchema` carries the optional `screeningContext`; absence means not
  evaluated, never low risk. `ScreeningAssessmentSchema` is kept as an alias. Old snapshots stay
  readable and are not backfilled. Unknown versions and extra keys still fail closed.
- **Widget v5.** `CAREER_RADAR_WIDGET_URI` is `ui://career-radar/widget-v5.html`; the v4 widget
  parses strictly and would reject the new field, so ChatGPT descriptors must be refreshed. The
  assessment card and each recommended job show a "Screening context" section: role scope and
  career-story pills (uncertain styled distinctly), explanations, an optional clarification
  question, cited references and unknowns behind a disclosure, and a fixed note that the context
  never changes the verdict or ranking. Absent context renders "Not evaluated". Interview risks
  remain a separate list. Status now reports Milestone 4 and the new capabilities.

## Prompt rules added (assessment call)

Located references only (`headline`, `skills[i]`, `domains[i]`, `leadership[i]`,
`customerFacing[i]`, `aiEvidence[i]`, `cloudEvidence[i]`, `roles[i].title`,
`roles[i].responsibilities[j]`, `roles[i].evidence[j]`; `required[i].text`,
`preferred[i].text`, `responsibilities[i]`), zero-based against the supplied JSON, quote equal
to the field. Scope comparisons need a role responsibility/evidence or leadership entry plus a
job requirement/responsibility, otherwise `uncertain`; years, titles and headlines alone prove
nothing. Lead-to-IC or job-family moves are not automatic risks; unknown intent yields one
clarification question, not an invented motivation. Risks cite both sources or are omitted and
must not repeat interview risks. No demographic proxies. Missing facts go to `unknowns`.

The prompt asks for these rules; it does not prove the model follows them. That is the
model-mode producer evaluation (A–F), which needs two things that are both still open: the
evaluation runner has no model mode yet (policy mode only), and running it costs approved calls.

## Verification (synthetic only)

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm eval --no-save`, `pnpm build` on this branch.
Server tests 262 → 272: producer mapping and discard paths with a mocked SDK, the pipeline
(policy first, uncertainty coercion, absence, discard note once, policy independence), MCP
integration (v5 URI, advertised output schema, an unsupported scope claim coerced to uncertain
in a real tool call without echoing its text), the recommendation batch, store round-trip and
legacy snapshots. Policy eval 28/28 with unchanged case contract hashes.

Local browser smoke: the built `widget.js` was loaded in a real browser from a loopback page
that set `window.openai.toolOutput` to synthetic assessment results (evaluated, uncertain,
absent) and a recommendation batch; the section rendered in all four states. This is not a
ChatGPT host check (#5) and screenshots are not committed.

## Still gated (not claimed)

- Live model behaviour: whether the model cites correct locations, keeps scope judgments
  uncertain without evidence, or avoids proxies. Model-mode A–F evals still have to be
  implemented in the runner and, like the #4 live measurement, run only after explicit cost approval; the harness's `policyInspection` now
  replays this pipeline so those runs will also check saved-result integrity.
- Real ChatGPT host rendering and descriptor refresh (#5).
- `compensation_scope`, ranking or verdict changes from context, new tools, resume rewriting.

## Official contract references

Checked 2026-09-11 (unchanged from B1): [MCP server](https://developers.openai.com/plugins/build/mcp-server),
[UI bridge](https://developers.openai.com/plugins/build/chatgpt-ui),
[Tool definitions](https://developers.openai.com/plugins/plan/tools),
[Reference](https://developers.openai.com/plugins/reference).
