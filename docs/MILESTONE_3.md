# Milestone 3 — Bounded search and honest recommendations

Status: implemented and locally verified as a draft. Base: `5af06c3` (M2 merged). Private, single-owner prototype; not a public release. Live model and ChatGPT-host validation remain pending.

## Revised plan — 2026-09-10

Live Responses API and ChatGPT-host verification remain separate follow-ups. This milestone must not depend on paid calls for development checks, substitute a free model silently, or claim synthetic results are live AI results.

1. Add one `JobSearchProvider`: the official public Greenhouse Job Board GET API. No API key, scraping framework, application submission, or whole-market search.
2. Search one explicitly named board. Filter title keywords and location **locally**; only the board token goes to Greenhouse. Do not derive queries from raw resumes or send candidate profiles to the search provider.
3. Return at most 10 candidate summaries with provider, canonical source URL, retrieval time, and optional provider update time. Search ordering is discovery, not fit scoring. Missing or old update dates do not mean a role is open or closed.
4. Assess at most 5 explicitly selected candidate IDs from a server-held search snapshot. Reuse structured extraction and the existing evidence policy, save immutable assessment snapshots, and return every assessed role grouped as REALISTIC/STRETCH plus optional PASS explanations. Requested counts only report shortfalls; never relabel to fill a quota.
5. Extend the existing React widget with a compact recommendation view and a keyless synthetic demo. Keep the existing server/web structure and M2 storage/access controls.
6. Validate schemas, provider boundaries, cache expiry, ranking, shortages, partial failures, MCP chaining, and demo rendering. Publish a normal PR; do not merge.

## Tool plan

| Tool | Inputs | Outputs / side effects |
| --- | --- | --- |
| `job_search` | board token, optional title/location filters, limit ≤10 | Unassessed candidates + search ID; creates an ephemeral snapshot, public internet read; no model calls or profile lookup |
| `job_recommend` | profile ID, search ID, 1–5 candidate IDs, requested group sizes, include PASS | Grounded recommendations + assessment IDs; model calls and local job/assessment writes, no new search or employer contact |

These are product decision tools, not a company-knowledge connector: no claim of standard `search`/`fetch` compatibility. Search is data-only; the final recommendation tool renders the widget, following the existing compact combined assessment pattern rather than introducing a new rendering store.

## Acceptance and reporting

- Search previews are not assessments; fit labels only come after the existing policy.
- Same-label ordering: higher confidence, lower contortion, then stable candidate ID. No score or hiring probability.
- Candidate IDs must belong to the selected search; validate the whole selection before any model call or write.
- Search snapshots: process-local, 30-minute expiry, maximum 10 snapshots, maximum 10 jobs each. No profile or resume in this cache. Restart/expiry/eviction requires a new search.
- Recommendation snapshots persist in the existing SQLite store and follow its reset/backup/privacy limitations.
- Model errors are explicit failures, not PASS or empty success; stop further model calls after a failure. Preserve already completed results. One batch at a time, 90-second overall deadline, at most 10 model operations.
- Widget shows retrieval time separately from provider update time and warns that status may change.
- No paid calls, real resumes, public deployment, or host success claims in this development run.

## Current sources

Checked 2026-09-10: [Greenhouse public GET API](https://docs.greenhouse.io/job-board.html), [OpenAI tools](https://developers.openai.com/plugins/plan/tools), [MCP server](https://developers.openai.com/plugins/build/mcp-server), [UI](https://developers.openai.com/plugins/build/chatgpt-ui), [examples](https://developers.openai.com/plugins/build/examples), [reference](https://developers.openai.com/plugins/reference).

## Validation — 2026-09-10

Directly executed on the M3 PR working tree (Node 24, pnpm 10):

- `pnpm typecheck` and `pnpm lint`: pass. Type checks include shared/server tests, scripts, and policy evals.
- `pnpm test`: **111 pass** (7 shared + 104 server). All model responses and security test inputs are synthetic. The first sandboxed attempt could not bind loopback (`EPERM`); the subsequent loopback-enabled run passed.
- `pnpm eval`: **16 pass**, deterministic policy fixtures only. This is not model accuracy or semantic prompt-injection validation.
- `pnpm build`: shared, widget, and server pass. `pnpm install --frozen-lockfile`: pass; no dependency or lockfile changes.
- Provider unit/transport checks: malformed tokens, local filters, public IP pinning, mixed/private DNS, redirects, HTTP errors, content type/encoding, streaming size, DNS deadline, duplicate IDs, prospect posts, malformed/unknown dates, HTML cleanup, and redacted failures.
- Recommendation checks: server-held ID membership, complete-batch validation, expiry/eviction/app-instance separation, policy-before-ranking, quota shortfall with every assessed role returned, hidden PASS counts, explicit saving/retry preservation, partial failures, overlap rejection, abort propagation, and no SDK retry for batch calls.
- HTTP/MCP: search → recommend → explicit save works across per-request MCP servers with an injected synthetic provider/analyzer. The running standalone demo also advertised all nine tools and returned M3 status through a real MCP client.
- **Live public retrieval only:** at `2026-09-10T02:44:17.791Z`, the `greenhouse` board returned 19 readable posts; the requested top 3 contained 6,892 / 6,892 / 6,406 description characters. Source and update times were present. No profile, key, or model call was involved. Other boards were not live-tested.
- **Standalone browser rendering:** recommendation groups, the intentional REALISTIC shortage, separate source times, and all-failed presentation rendered at loopback port 8002. Screenshot and accessibility tree inspected. Synthetic/prewritten results only; not ChatGPT iframe validation. Mobile viewport, external-link opening, and keyboard interactions were not manually exercised.

## Change-impact / Radar review notes

Scope: `LOCAL_DRAFT`, one local owner, synthetic analysis and public job data. This is an implementation self-check using the Radar review concerns, not an independent review or public approval.

| Consumer | Change / evidence | Remaining boundary |
| --- | --- | --- |
| Shared schemas → MCP → widget | Additive search/recommendation contracts; status is M3; tests and actual MCP descriptors checked | Refresh host metadata for widget v3 |
| Analyzer → single-job and batch callers | Optional abort signal; batch disables retry; single-job defaults and prompt/model/policy unchanged | Actual provider cancellation and model output quality untested |
| HTTP app → per-request MCP server | One discovery instance per app; search IDs survive tool calls; local Host/Origin gate unchanged | No user authentication or multi-user isolation |
| Recommendation → SQLite → application tools | Server-issued assessment IDs, explicit application save, first-decision/retry behavior covered | Existing persistent/unencrypted data and reset/backup caveats apply |
| Demo → widget | Ranking/shortage/failure views reuse shared contracts and existing visual language | Standalone demo is not the ChatGPT host bridge |

No additional blocking regression was found in the exercised local scope. A direct loopback browser render smoke was used instead of a hosted E2E workflow. The implementation kept the existing app architecture, made new data/render responsibilities explicit, and separated empty/failed result states.

## Follow-up gate

Before calling this personally live-verified: use an explicitly authorized synthetic profile with a funded model, inspect extraction and policy independently, refresh the ChatGPT app descriptors, then test tool selection, confirmation, initialization, follow-up IDs, error recovery, and widget links/interaction in the actual host. Verify small-screen and keyboard behavior there. Public release additionally needs authentication/isolation, privacy/retention policy, hosting, and submission review. No merge, public deployment, or public-readiness claim is part of M3 implementation.
