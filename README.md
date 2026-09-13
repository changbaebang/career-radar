# Career Radar

[한국어](README.ko.md) | English

Career Radar is an evidence-based career decision tool. It is designed to help a candidate decide whether a role is `REALISTIC`, `STRETCH`, or `PASS` without inventing experience or turning a fit label into a hiring probability.

This is a **Milestone 3 early prototype**: bounded Greenhouse board discovery, small-set evidence recommendations, allowed public job URLs, local SQLite decisions, and application tracking. It is a private toy project, not a whole-market search engine or public hiring-prediction service.

## One-minute demo — no key or API cost

```bash
pnpm install
pnpm demo
```

Open [the local demo](http://127.0.0.1:8001) to inspect three verdict cards and a pipeline. The interview button updates the real SQLite store used by the demo and refreshes the widget.

Open [recommendations](http://127.0.0.1:8001/?view=recommendations) for grouped verdicts with an intentional shortage, or [analysis failure](http://127.0.0.1:8001/?view=failure) to see how failure differs from PASS. `DEMO_PORT=8002 pnpm demo` runs alongside an older demo. Source links in this synthetic demo are placeholders, not real vacancies.

All demo profiles, jobs, and prewritten verdicts are **synthetic**, not live model results or proof of accuracy. The demo reads no API keys or user database; its in-memory SQLite data resets on restart. Use `pnpm dev` for real analysis.

## Architecture

The initial archetype is a **React widget** with a split `server/` and `web/` layout. That is the smallest current shape that satisfies the React UI requirement. The structure leaves room for the decoupled data/render pattern in later milestones without adding those tools now.

```text
career-radar/
  server/           # MCP server and /health endpoint
  web/              # React widget bundled by Vite
  packages/shared/  # Shared Zod schema and TypeScript types
  docs/             # Product specification and decisions
  data/             # Gitignored local SQLite database
```

The MCP implementation started from the official OpenAI examples at commit `18cc38e78a968712c357bacdc3c79fead5bfc6b4`. It now provides a status tool, eight product tools, and assessment/recommendation/pipeline views. Search is data-only; final recommendations use the existing combined analysis/widget pattern.

## Requirements

- Node.js 22.13 or newer (Node 24 recommended; uses built-in `node:sqlite`)
- pnpm 10

## Local development

```bash
pnpm install
pnpm dev
```

The server starts on `http://localhost:8000` by default:

- MCP endpoint: `http://localhost:8000/mcp`
- HTTP readiness endpoint: `http://localhost:8000/health`

Copy `.env.example` to the gitignored `.env.local` and set `OPENAI_API_KEY`. `OPENAI_MODEL` is optional and defaults to `gpt-5-mini`. The server loads this file locally; credentials never enter the widget. `CAREER_RADAR_PROVIDER=openrouter` with `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` selects the OpenRouter adapter instead; see [model providers](docs/PROVIDERS.md) for what a result from another provider does and does not prove.

## Checks

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm eval
```

## Single-job assessment

In a ChatGPT conversation with the app enabled:

1. Provide resume text so ChatGPT can call `profile_upsert`.
2. Provide one job description or allowed public URL so it can call `job_ingest`.
3. Ask whether the role is realistic so it can call `job_assess` with the returned profile and job IDs.

4. Ask to save the job: `application_save` accepts the server-issued `assessmentId`.
5. Report an application, interview, rejection, withdrawal, or offer via `application_update`. No application is sent to an employer.
6. Ask for `pipeline_summary` to see the current pipeline widget.

URL fetching allows HTTPS on `boards.greenhouse.io`, `job-boards.greenhouse.io`, `jobs.lever.co`, and `jobs.ashbyhq.com`. It checks every redirect/DNS result, pins a public IP for the connection, and limits total time to 10 seconds, response size to 1 MB, and redirects to three. No JavaScript, login, discovery, or access-control bypass. Paste the JD when a page cannot be read; review extracted text for navigation/consent boilerplate.

Normal execution persists structured profiles, jobs, assessment snapshots, applications, and events in `data/career-radar.db`. Override with `CAREER_RADAR_DB_PATH`; migrations run on startup. This **replaces M1's 30-minute memory retention**: data no longer expires automatically. Raw resumes are not retained, but structured data, assessments, and notes can still contain personal information. The database is unencrypted. To wipe every record, stop the server and run `pnpm db:reset` (clears all tables, then vacuums the file and truncates the WAL); delete the database and its matching `-wal`/`-shm` files if you want no file left at all. The event history keeps status transitions only — notes are not copied into it, so clearing notes removes them. The HTTP server only answers requests whose `Host` (and browser `Origin`, when present) is a loopback address. Move the database separately and securely when changing machines/accounts.

Repeated saves preserve the initial decision and current application status; use `application_update` for changes. Job identity is a hash of the normalized description, so reading the same URL twice can produce a second job (and a second application) if the page text changed. Explicit user corrections are allowed. `appliedAt` records the first transition to `applied`, not an inferred historical application date. Omitted stage/notes are preserved; empty strings clear them. Date filters use inclusive last-update timestamps, not application cohorts. Counts cover all matching applications; details are limited to the latest 100 and the widget shows 10.

This version is for one owner's local/private development. It does not authenticate users or isolate their data within an app; do not deploy it as a public or shared multi-user service.

## Search and recommendations — M3

1. Name a Greenhouse board token (from its public board URL): “Search the `greenhouse` board for engineer roles.” `job_search({boardToken: "greenhouse", titleKeywords: "engineer", limit: 5})` reads the official public GET API with **no model or API key**. It does not discover companies automatically. Ask for the board token if it is unknown.
2. Optional title keywords (all words) and a location substring are filtered locally. Only the board token goes to Greenhouse; neither filters nor resume/profile data are sent. Results are limited to 10, sorted by provider update time, and are **unassessed**. This is not keyword-based fit scoring.
3. After `profile_upsert`, ask to assess 1–5 returned candidate IDs with `job_recommend`, providing the returned `searchId` and profile ID. It can use up to 10 **paid OpenAI operations**. Select explicit IDs; no automatic crawling or retry loop.
4. Set target counts for REALISTIC/STRETCH roles (at most five combined) and choose whether to include PASS explanations. Targets only report shortfalls, not cap returned results: all assessed REALISTIC/STRETCH roles are returned, even above a target or when that target is zero. Missing results stay missing. Failures are not PASS. The first failure stops further model calls; successful items remain available. Same-label ranking uses confidence, contortion, then stable ID—not scores or hiring odds.
5. Save a returned `assessmentId` only when you want a pipeline entry. Recommendations save analysis snapshots, not applications, and never contact employers.

Search snapshots are public-job-only process memory: 30 minutes, at most 10 searches × 10 jobs. Restart, expiry, or eviction requires `job_search` again. One recommendation batch runs at a time with a 90-second deadline. Repeating it creates new assessments and may cost more. Extracted jobs reuse existing normalization for identical source+content; changed source/content yields a new job ID (separate from M2 pasted-JD identity).

Successful extraction is saved even if assessment fails, so retrying that job skips extraction. Retrying the whole batch still reassesses previously successful jobs; select only failed or unattempted IDs to avoid that repeated work. Actual cost savings and whether five jobs finish within 90 seconds have not been measured with a live model. `pnpm measure:live` ([docs/LIVE_MEASUREMENT.md](docs/LIVE_MEASUREMENT.md)) is the harness for that measurement: a dry run by default, and no paid call without explicit double approval plus a typed confirmation.

The provider reads only `boards-api.greenhouse.io`, validates/pins public DNS addresses, refuses redirects, and caps requests at 10 seconds and 5 MB. It omits prospect posts and unreadable descriptions. Source links are constructed on `job-boards.greenhouse.io`; arbitrary provider `absolute_url` values are not followed. Unsupported boards need pasted-JD analysis.

Retrieval time, provider update time (or unknown), and assessment time are distinct. Neither a recent fetch nor an update timestamp guarantees that a job is still open. Consult the source before applying. Detailed plan and verification: [Milestone 3](docs/MILESTONE_3.md).

## Connect from ChatGPT

1. Start the local server with `pnpm dev`.
2. Create an [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) targeting `http://localhost:8000/mcp`. This is recommended for development because it does not expose the local server to the public internet.
3. In ChatGPT, enable Developer Mode under **Settings → Security and login**.
4. Open **ChatGPT Plugins**, create a developer-mode app, and select the Secure MCP Tunnel. A public development endpoint such as `https://example.ngrok.app/mcp` can be used instead.
5. Ask ChatGPT to show the Career Radar status.
6. Refresh the app connection after changing MCP tool or resource metadata.

Secure MCP Tunnel is for development and private connectivity, not public Plugin submission. Public submission requires a stable public HTTPS MCP endpoint.

Keep the OpenAI API key used by the tunnel in a server-process environment variable, never in the React widget or committed files. A gitignored `.env.local` is suitable for local development. Use a GitHub Actions Secret only if a workflow actually runs the tunnel or deployment. When moving to another OpenAI account, create a new key and tunnel there, then refresh the ChatGPT app connection; the repository remains portable.

## Current scope

Implemented:

- pnpm workspace
- shared Zod status schema
- stateless Streamable HTTP MCP endpoint
- `career_radar_status` read-only tool
- `profile_upsert`, URL/text `job_ingest`, and `job_assess` tools
- `application_save`, `application_update`, and `pipeline_summary` tools
- `job_search` and `job_recommend`, with bounded snapshots, explicit shortages/failures, and source times
- SQLite migrations, persistent decisions, and application event history
- OpenAI Responses API structured outputs validated with Zod
- deterministic evidence-grounding and hard-blocker post-processing
- MCP Apps UI resource with a Job Assessment Card
- 28 synthetic policy contracts (the original 16 retained), with versioned local JSON/Markdown reports and baseline comparison
- lint, typecheck, build, and unit-test scripts

Not implemented yet:

- broad cross-provider/whole-market job search
- public deployment, user authentication, automated applications
- M2/M3 live-model and ChatGPT-host end-to-end validation (separate from live public search and local synthetic checks)

See [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) for the milestone plan.

`pnpm typecheck` includes tests and eval fixtures as well as server/widget code. `pnpm eval` checks only deterministic policy behavior without calling a model; its metrics are not model accuracy. Evidence matching uses the structured profile and does not guarantee extraction accuracy against the original resume.

### M4-A evaluation tooling

`pnpm eval` saves a unique run under ignored `evals/reports/`. Use `--no-save` for
checks only, or `--baseline evals/reports/<run>/report.json` to compare unchanged
case contracts. Reports show counts/denominators, N/A for empty denominators,
errors/skips, required-blocker IDs and dataset/policy/schema/code versions.
All 28 human fit-label reviews remain pending; passing policy contracts does not
complete that review or demonstrate new screening/model behavior. See the
[evaluation guide](evals/README.md) and [human-review template](evals/REVIEW_TEMPLATE.md).
Reports are separate files and are not removed by `pnpm db:reset`.

### M4-C stage-aware feedback

Record explicitly reported stages and optional occurrence dates with `application_update`.
`historyMode` defaults to `"append"` (a new progression); pass `"replace"` only for an
explicit correction — it supersedes the **whole prior outcome history** for aggregation. Notes-only edits retain
history. Stage clearing retracts previous reach; unknown stages/dates are not inferred.
`pipeline_summary` shows stage reach, current coverage and last-update exclusions without
changing fit verdicts or claiming probabilities. [Contract and examples](docs/MILESTONE_4C.md).
Widget URI is now v6 (v5 for M4-B2, v6 once `company` became optional): refresh ChatGPT descriptors before testing. Local synthetic checks do
not establish actual host/model behavior. No API calls are required for this slice.

### M4-B1 evidence contract

The screening context schema and located-reference validator are implemented.
Missing/invalid evidence produces uncertainty, not a verdict/ranking penalty. New
assessment snapshots record hashes of the actual structured profile/JD inputs, without
adding a profile copy. Old snapshots stay readable and are not backfilled. Hashes do
not restore missing inputs or record extraction-run provenance. [B1 contract and limits](docs/MILESTONE_4B1.md).

### M4-B2 screening context in the model path (synthetic-verified; live gated)

The assessment call now also produces screening context (role scope, career-story
clarification, cited screening risks, unknowns) in the same model operation, so batch call
counts do not change. Prompt version is `milestone-4b2-v1`. Before storage or output the
context is validated against the exact inputs the model received: unverified references
become `uncertain` with neutral text, and a context outside the contract is dropped with a
note. The widget (URI v5) shows the context separately from fit evidence and interview
risks; absence renders as not evaluated. Whether the live model actually cites correct
locations or keeps judgments uncertain is **not** established here: model-mode evals are not
implemented in the runner yet, and they and the #4 live measurement run only after explicit cost approval. [B2 notes](docs/MILESTONE_4B2.md).

### Model providers (synthetic-verified)

The prompts and output contracts are provider-neutral. Besides the default OpenAI Responses
API, `CAREER_RADAR_PROVIDER=openrouter` routes the same three operations through OpenRouter's
Chat Completions endpoint with strict JSON-schema output and `require_parameters` routing; the
adapter re-validates every response and fails closed on refusals, truncation or schema
mismatch. `modelVersion` records `openrouter/<model>@<upstream provider>`, so a result proves only
that endpoint. `pnpm measure:live --provider openrouter` measures that path after the same
approval flow. No provider was called for this slice. [Details](docs/PROVIDERS.md).

### Usage check (first round done)

`pnpm usage-check --job <url|file> ...` puts one profile (the synthetic resume by default) and
up to five postings through the real MCP tools with the configured provider and serves a local
page with the widget output per posting. Without `--approve-transmission` it only prints what
would be transmitted. The point is to read the result and answer three questions about whether it
helps prioritize; see [USAGE_CHECK.md](docs/USAGE_CHECK.md), including why a local run still
transmits the inputs. The first round (synthetic profile, three public postings, OpenRouter free
models) led to three contract changes: a posting that does not name the employer keeps `company`
absent instead of letting the model fill it in (widget URI v6, since the v5 widget parses strictly),
newly generated `score` values are integers on a stated 0-100 scale while stored fractions stay
readable, and `OPENROUTER_REASONING_EFFORT` adjusts reasoning intensity (whether it actually lowers
reasoning tokens is unverified). Prompt version is `milestone-4b2-v2`.

### M5 (planned)

A reviewed plan for a grounded-evidence milestone (retrieval over a synthetic corpus, citations to
retrieved chunks, a model-mode eval harness, run-level observability, bounded tool use last) is in
[MILESTONE_5.md](docs/MILESTONE_5.md) with ADR-0013. Nothing from it is implemented yet.

## Documentation references

- [Plugin quickstart](https://developers.openai.com/plugins/build/app-quickstart)
- [Define tools](https://developers.openai.com/plugins/plan/tools)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Add UI to an MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Connect and test a Plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Plugin reference](https://developers.openai.com/plugins/reference)
