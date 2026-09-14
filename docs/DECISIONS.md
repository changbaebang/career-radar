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

## ADR-0011: Discover publicly, assess privately, and never fill a verdict quota

**Status:** Accepted — Milestone 3 private prototype. Supersedes ADR-0010's search deferral only.

Keep the existing React widget archetype and add a `JobSearchProvider` abstraction with one official Greenhouse Job Board GET implementation. No new scaffold, broad scraper, search key, or alternative model provider. Only an explicit board token leaves the server; title/location filters run locally without looking up profiles. Canonical source links are derived from the board and provider post ID, not an arbitrary returned URL. The network boundary independently checks fixed HTTPS host, public DNS/IP pinning, redirects, content type, response size, and timeout.

`job_search` creates a bounded public-job snapshot, so its annotations describe ephemeral mutation and public internet access. Search results contain unassessed summaries and IDs, no raw JD/profile. `job_recommend` validates the entire selection and resolves source content server-side, runs the existing structured analyzer/policy for at most five jobs, and saves local immutable assessments. It is mutating, non-idempotent, and closed-world over this fixed snapshot. It does not create an application or send one. No standard company-knowledge `search`/`fetch` compatibility is claimed.

Rank **only within** the policy's verdict groups by confidence, contortion, then candidate ID. Return every assessed role in its verdict group; requested counts only report shortages. Keep shortages and model failures explicit. Configuration errors (such as a missing API key) fail the batch before any model call with their own message. Stop after an error, disable SDK retries for batch calls, propagate a 90-second abort signal, and permit one active batch per app. Original single-job calls retain their previous SDK defaults. No policy/prompt/model version was silently changed.

Public search snapshots expire after 30 minutes and are capped at ten; profile/assessment persistence still follows M2. Search-ingested job IDs include source URL and exact input content; changed content becomes a different record and old assessment snapshots remain unchanged. Search and pasted-JD identity are not deduplicated together. This is documented private-prototype behavior, not multi-user isolation.

Widget v3 adds grouped recommendations, evidence/gaps, explicit failure/shortage states, source times, and details. Search is data-only; recommendations follow the existing small combined analysis/render pattern. The widget retains the MCP result notification path and ChatGPT initial-output compatibility alias. Host initialization/interaction and public submission remain unverified follow-ups, not inferred from standalone demo success.

## ADR-0012: Separate fit evidence, screening context, and observed outcomes

**Status:** Proposed — M4 planning only; no runtime changes in this PR.

User feedback motivates explicit role-scope and career-story context plus stage-aware response reporting. Keep evidence-based fit, screening uncertainties, and reported hiring outcomes separate. Neither a rejection nor an interview automatically changes the stored fit verdict, and no outcome supplies a supervised fit label without independent human evidence review. Minimum years, missing title, leadership-to-IC transitions, and demographic proxies must not become automatic negative signals.

Prefer an optional versioned screening context, preserve existing free-text stages while adding a normalized projection, and use correction-safe events without copying private notes. Start with a local, no-API evaluation runner and synthetic fixtures; integrate schemas/prompts/UI and stage analytics in separate implementation PRs. Exact contracts, migration/deletion safeguards, metric definitions, and live-verification boundaries are in [MILESTONE_4.md](MILESTONE_4.md). Broader search, automatic applications, compensation inference, and policy learning from outcomes are deferred.

## ADR-0013: Make evidence retrievable and measurable before giving the model autonomy

**Status:** Proposed — M5 planning only; no runtime changes in this PR.

The owner wants the repository to be honest evidence of designing, evaluating and operating a grounded GenAI application, not of ML training or production RAG operations. The first usage check (2026-09-12) showed that the product loop works and that its failures are about evidence: an invented employer, an unanchored score, runaway reasoning. So M5 adds retrieval over a public-safe evidence corpus, extends the located-citation contract to retrieved chunks, and evaluates the real model path on a versioned golden set before any tool autonomy is added; bounded tool use comes last and OpenAI-first, and application outcomes are never exposed to the assessment model.

Every slice ends with the same usage check on the same inputs when a call is approved (a slice may merge as synthetic-verified before that), carries a `synthetic-verified` / `live-verified` / `not verified` label, and keeps read contracts stable while tightening only generation contracts. Embeddings, hybrid retrieval, cloud vector stores and multi-user deployment are deferred or gated on explicit approval. Slices, contract impact and acceptance criteria are in [MILESTONE_5.md](MILESTONE_5.md).
