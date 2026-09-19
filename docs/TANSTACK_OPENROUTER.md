# TanStack OpenRouter integration experiment

Base: `ecc36fd` (origin/main checked on 2026-09-18). No authorized live model run.
During the first full integration-test run, an old URL-string-only fetch stub missed
the SDK's Request object. One request carrying a fake key and a synthetic resume
reached OpenRouter and returned HTTP 401. No real key or personal data was used.
The stub is now Request-aware and Vitest's default fetch denies non-loopback targets.
The final suite uses explicit provider stubs / loopback only. This guard covers fetch
in workers, not arbitrary node:http calls or spawned child processes.

## Scope

Replace only `OpenRouterCareerAnalyzer`'s SDK request path with the official
`@tanstack/ai-openrouter` adapter. OpenAI Responses, prompts, draft/domain schemas,
policy, retrieval, citations, storage, MCP descriptors and widget URI are unchanged.
No Upstage/Liner adapter, streaming UI or extra agent loop is added.

Pinned dependencies: `@tanstack/ai@0.46.0`, `@tanstack/ai-openrouter@0.18.0`,
`@openrouter/sdk@0.13.20` (the adapter's transport SDK, also a direct dependency
for its public HTTPClient extension point). The `openai` package remains for the
unchanged OpenAI provider, strict schema conversion and stable error classification.

## Why not simply chat({ outputSchema })?

The installed `chat` engine prefers an adapter's `structuredOutputStream` even for
a collected non-streaming result. This experiment instead calls the adapter's
`structuredOutput` directly to preserve **one non-streaming HTTP request per operation**.
It uses the exported `adapter-internals/resolveDebugOption(false)` for a silent logger;
that lower-level dependency is deliberate, pinned and covered by tests, not a claim
that the high-level API is a drop-in replacement.

The adapter owns request mapping, strict-schema submission and JSON parsing. Career
Radar still validates the returned data with its existing Zod generation contract.
TanStack names schemas `structured_output` instead of operation-specific names.
Instructions/input and the strict schema content remain application-owned.

## Upstream findings and boundaries we cannot remove yet

In the installed non-streaming adapter source, `structuredOutput` returns data,
rawText and usage, but not response model, upstream provider, request ID or finish
reason. It also does not reject a valid JSON payload solely because its finish is
`length`/`error`, and its parse error can contain raw model text.

Source/version pointers for potential upstream reports:
- Stream preference: `@tanstack/ai@0.46.0/src/activities/chat/index.ts`.
- Missing metadata, finish validation and raw parse-error text:
  `@tanstack/ai-openrouter@0.18.0/src/adapters/text.ts`.
- Required envelope fields: `@openrouter/sdk@0.13.20/esm/models/chatresult.js`
  and its choice/message schemas require id, object, created, model,
  system_fingerprint (nullable but present), choice index and message role.
  Missing fields were reproduced with synthetic responses. Whether live responses
  omit them remains unverified; this is an issue candidate, not a proven provider bug.

The boundary now checks the SDK's exported inbound schema before handing it the
response. Envelope failures use a fixed envelopeMismatch message and provider_error
classification, separately from model-output schema failures. This classification
identifies the transport-contract boundary, not fault attribution to a specific party.
One outer observation covers SDK preparation, completion checks, SDK parsing and
generation-contract validation. Rejected calls emit one error event while retaining
available response counters; failure before fetch also emits one event.

Therefore a request-local HTTPClient boundary remains:

- Project metadata using the same `onResponse` contract before SDK normalization.
- Reject refusal, non-stop finishes, empty/malformed content with fixed messages.
- Normalize HTTP errors to existing safe classes; suppress other SDK/body messages.
- Pin endpoint, retries=none and SDK logging=off, ignoring inherited OpenAI settings.
- Keep an AbortSignal active through body consumption; caller cancellation composes
  with `transport.timeout`. No silent model substitution or retry is introduced.
- Isolate metadata per call, including concurrent calls on the shared analyzer.

The fixed endpoint and no-store-parameter semantics are unchanged. The full response
is held transiently in memory to feed the SDK; it is not logged or persisted here.
Only projected counters/identifiers go to telemetry. Retention by OpenRouter/upstream
providers is outside this code's control.

## Validation and decision

Keep the existing real-SDK/stubbed-fetch regression suite, adjusting transport-shaped
test doubles to accept Request objects and complete OpenRouter wire envelopes.
Additional tests cover valid-JSON non-stop finishes, silent loggers, no retry despite
options, concurrent metadata isolation, SDK-envelope errors, network error redaction,
and slow-body deadline/caller cancellation via real fetch to a loopback server.

Run typecheck, lint, build, all tests, policy baseline comparison, retrieval eval and
model-mode **dry run**. None proves live quality, provider routing support, latency,
or ChatGPT-host rendering. A future approved three-case run is separate work.

Verified on this branch: typecheck/lint/build passed; shared 7 + server 461 = 468
tests passed initially; review follow-up adds 8 tests (shared 7 + server 469 = 476).
Envelope/model failure classification follow-up adds 2 controls (7 + 471 = 478).
Policy evaluation passed 35/35 (M5-0: 28 compared, 7 added, no
regressions). Retrieval remained field 47/55 and 49/55, sentence 46/60 and 51/60.
The fake model-mode dry run assessed 33 cases in 99 simulated calls; this is runner
coverage, not provider validation. Frozen-lockfile installation also passed.

This is **not yet a code-reduction win**: safety/metadata glue and three dependencies
remain. Review the integration cost before merging. If that trade-off is unacceptable,
keep the previous direct adapter; the regression tests and SDK findings remain useful.

## Sources checked

- https://tanstack.com/ai/latest/docs/adapters/openrouter
- https://tanstack.com/ai/latest/docs/structured-outputs/one-shot
- Installed package source: `ai-openrouter/src/adapters/text.ts` and
  `ai/src/activities/chat/index.ts` at the versions above.
- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/reference

MCP/React contracts are unaffected, so no widget URI bump or descriptor refresh is
required by this diff. These links document the integration boundary, not host proof.
