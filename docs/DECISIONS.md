# Architectural Decisions

## ADR-0001: Start with the React widget archetype

**Status:** Accepted

Milestone 0 needs one read-only tool and one small React UI. A `react-widget` is therefore the smallest supported archetype. The repository uses split `server/` and `web/` packages so later milestones can introduce decoupled data and render tools without reorganizing the project now.

## ADR-0002: Use current MCP Apps metadata

**Status:** Accepted

The widget is registered with `text/html;profile=mcp-app`, linked from the tool through `_meta.ui.resourceUri`, and given an exact empty CSP allowlist. The ChatGPT-specific `openai/outputTemplate` field is included only as a compatibility alias.

## ADR-0003: Keep Milestone 0 independent of model calls

**Status:** Accepted

The first milestone proves the MCP-to-widget path using deterministic status data. OpenAI Responses API integration begins in Milestone 1, where model output can be validated against product schemas and eval fixtures.

## ADR-0004: Adapt a pinned official example

**Status:** Accepted

The server transport and MCP Apps resource/tool registration patterns are adapted from the official `openai/openai-apps-sdk-examples` repository at commit `18cc38e78a968712c357bacdc3c79fead5bfc6b4`. Only the minimal pattern needed by Career Radar is retained.

## ADR-0005: Keep Milestone 1 state ephemeral

**Status:** Superseded by ADR-0008 in Milestone 2

`profile_upsert` and `job_ingest` keep normalized records in process memory so `job_assess` can refer to stable IDs. Raw resume text is not retained. SQLite, migrations, application history, and cross-process persistence remain Milestone 2 work.

Each HTTP app owns its store. Profiles and jobs each have a 100-record cap and a fixed 30-minute TTL after their latest write. Reads do not extend retention; timers remove expired records even while idle, and exceeding the cap evicts the oldest write. Expired/evicted IDs require ingestion again. This bounds retention for private, single-owner development; it does not implement user authentication or isolation within an app.

## ADR-0006: Separate model judgment from deterministic safety policy

**Status:** Accepted

The Responses API produces strict Zod-validated structures with `store: false`. Server code adds deterministic IDs, `modelVersion`, and `promptVersion`, removes positive claims that do not map to candidate evidence, promotes missing core language/location/certification/education requirements to hard blockers, and prevents unsupported `REALISTIC` results.

Evidence must equal a candidate-profile evidence string after case/whitespace normalization. Substrings are rejected because they can drop negation or append invented achievements. A known requirement ID is authoritative; normalized preferred text is a fallback for missing/unknown IDs. Preferred hard blockers are downgraded to material gaps before blocker collection. These checks validate the structured profile, not the original resume or the semantic truth of the model's extraction. Policy evals do not measure live model accuracy.

## ADR-0007: Keep bounded analysis tools closed-world

**Status:** Partially superseded by ADR-0009 for URL ingestion

The three analysis tools send only supplied resume/JD/profile data to Responses API, with no web search, URL fetching, or external retrieval tools. Keep `openWorldHint: false`: an external API call alone does not imply open-ended access. Revisit this when URL ingestion/search is implemented. The [current official tool guide](https://developers.openai.com/plugins/plan/tools) distinguishes bounded external services from open-world operations.

The analyzer is created lazily once per HTTP app and reused across requests. Status/listing remain available without an API key; analysis reports an actionable configuration error when the key is absent.

## ADR-0008: Persist decisions and explicit outcomes in local SQLite

**Status:** Accepted — Milestone 2 prototype

Use Node's built-in SQLite (`node:sqlite`, Node >=22.13) with prepared values, foreign keys, transactional `user_version` migrations, WAL, and transactional application/event writes. Normal execution uses a gitignored file; tests and the offline demo use isolated databases. New database files are owner-only. The HTTP entry point binds to loopback for private use, and the app rejects any request whose `Host` (or browser `Origin`) is not a loopback address — comparing Origin to Host would let a DNS-rebinding page through. `pnpm db:reset` is the owner's wipe path; the event history excludes free-text notes. Existing files and backups still require the owner's permission/retention management. No authentication or multi-user isolation is implied.

This intentionally replaces the M1 30-minute TTL: records persist until the owner clears the database. Raw resumes are not retained, but structured profiles, assessments, and notes remain potentially sensitive and unencrypted.

`job_assess` now saves an immutable job/assessment snapshot and returns `assessmentId`; it is therefore mutating and non-idempotent. `application_save` accepts that ID rather than trusting a caller-supplied verdict, derives the profile/job association server-side, and preserves the initial decision for each profile/job pair. Retrying a save cannot undo a later interview/rejection. Updates allow explicit user corrections; identical updates create no extra event. Statuses are user-reported facts, not inferred transitions. `appliedAt` means first explicitly recorded `applied` time, not a reconstructed historical date.

Pipeline counts are deterministic and descriptive. Filters are inclusive last-update UTC timestamps, not applied-date cohorts. Counts include all matches; details return the latest 100. These are local, small-data operations, not a scalable analytics implementation.

## ADR-0009: Bounded public job-page reading with a pasted-text fallback

**Status:** Accepted — Milestone 2 prototype

`job_ingest` accepts exactly one text or URL. HTTPS hosts are explicitly allowlisted; every redirect repeats URL/DNS checks and the connection is pinned to a validated public IP while retaining hostname-based TLS validation. No auth/cookies are forwarded. Three redirects, 10 seconds total, 1 MB response, and 80,000 normalized characters bound the request. HTML is parsed without executing JavaScript; scripts/forms/navigation are removed. Dynamic/blocked/unreadable pages require pasted text, and successful extraction warns about possible boilerplate.

Fetching never uses candidate data. Retrieved text is untrusted input to the existing structured extraction prompt. Only `job_ingest` becomes open-world; other analysis remains bounded. This follows the [current OpenAI tool annotation guidance](https://developers.openai.com/plugins/plan/tools). The widget keeps standard MCP Apps resource metadata plus the existing ChatGPT compatibility alias, with a v2 resource URI for pipeline rendering. No new scaffold or job-search provider is introduced.

## ADR-0010: Show a truthful, keyless prototype before public hardening

**Status:** Accepted

`pnpm demo` reuses the React widget and real SQLite application operations with clearly labeled synthetic data and prewritten verdicts. It cannot instantiate an AI analyzer and does not read keys or the user database. The small outer demo page is not the ChatGPT host bridge, and successful local UI checks must not be reported as live model or ChatGPT validation. Search, authentication, public hosting/submission, and causal outcome analytics remain out of scope.
