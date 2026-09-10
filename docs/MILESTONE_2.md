# Milestone 2 — Job URL + application pipeline

Career Radar is an early, private-use prototype: decide whether a job is worth applying to, save that decision, and record what happened next. The UI remains English; localization is deferred.

## Demo in one minute

1. Run `pnpm install` and `pnpm demo` (Node >=22.13).
2. Open `http://127.0.0.1:8001`.
3. Inspect REALISTIC / STRETCH / PASS cards.
4. Return to the pipeline and click the interview button.
5. Observe the first application's status change; refresh to confirm it remains changed.

This demo uses **synthetic data and prewritten assessments**, not a live AI model. SQLite writes and widget rendering are real. The demo database is in memory and resets when the process stops. It does not read user data or API keys.

For real use, run `pnpm dev` with a server-side API key, refresh the ChatGPT app's MCP descriptors, then use `profile_upsert → job_ingest → job_assess → application_save → application_update → pipeline_summary`. Only explicitly provided public URLs are fetched; this milestone does not discover jobs or submit applications.

## Validation — 2026-09-10

- `pnpm typecheck`: passed, including tests, eval fixtures, and the demo script.
- `pnpm lint`: passed.
- `pnpm build`: passed for shared/server/web.
- `pnpm test`: 65 passed (4 shared + 61 server).
- `pnpm eval`: 16 deterministic policy fixtures passed; not live model accuracy.
- SQLite: close/reopen persistence, migration versioning, snapshot preservation, retry safety, event rollback, date filters, and missing-reference checks passed.
- MCP HTTP: profile/text ingestion/assessment/save/update/summary sequence passed with an injected synthetic analyzer. URL normalization/source preservation used an injected fetch response.
- URL safety: host/scheme/credentials/port checks, private/mixed DNS results, redirect revalidation, size/content rejection, and timeout checks passed.
- Live URL read: the new fetcher read [one public Lever Frontend Engineer posting](https://jobs.lever.co/zopa/f7d223f5-8542-4e44-b21f-6b8e9d9929a1), returned 6,393 readable characters and preserved the source URL. No candidate data or model call was involved. Other supported hosts were not live-tested.
- Local browser: pipeline rendered; clicking changed `applied → interview`; the assessment card rendered. This used the standalone demo, **not the ChatGPT host**.
- Not run: live Responses API generation, OpenRouter generation, manual ChatGPT-host verification, public deployment/submission.

## Change impact

Base: `main` at `3aaeb019ab790f6bab8a9f74173e0c127e8b593c`.

- Shared Zod schemas feed the MCP outputs and widget; existing assessment results remain parseable because `assessmentId` is additive/optional in the shared view schema. The actual assessment handler always returns a saved ID.
- `CareerStore` consumers are the HTTP/MCP entry points, analyzer ID helpers, tests, and standalone demo. The file-backed entry point replaces M1's ephemeral state; tests remain isolated.
- Widget v2 supports pipeline data and keeps the existing assessment/status paths. Existing ChatGPT connections need a descriptor refresh.
- Existing evidence policy and model prompts were not changed. No additional blocking regression was found by the local checks; live-model/host compatibility remains unverified.
- Change-impact checks traced shared contracts and storage consumers. A direct localhost browser click/re-entry smoke verified the demo flow.

## Intentional limits

- Single-owner, loopback/private use only. No user authentication or multi-user data isolation.
- Persistent, unencrypted local records; the old 30-minute TTL no longer applies. Review privacy/backup/reset guidance in the README.
- URL fetching uses an explicit allowlist and does not execute JavaScript. Pasted text is the fallback for unsupported, blocked, or dynamic pages. Extracted text may contain boilerplate.
- Summary dates filter last-update time, not an application-date cohort. Counts are descriptive; outcomes do not prove why an employer made a decision.
- Search/recommendations, resume tailoring, automatic applications, public hosting, and Korean/English UI localization are not part of M2.

## Short introduction (Korean)

> 이력서에 맞춰 무조건 지원을 권하는 대신, 지원할 만한 공고인지 먼저 판단하는 Career Radar를 만들고 있습니다. 요구사항을 Markdown 명세로 정리하고 Codex로 MCP 서버와 React 위젯을 구현했습니다. 이번에는 공고 URL 읽기, 판정 저장, 지원·면접·탈락 기록까지 연결했습니다. 아직 직접 써보며 다듬는 초기 프로토타입이고, 공개 데모용 화면은 합성 데이터로 동작합니다.
