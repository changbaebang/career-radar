# Model providers

Career Radar calls a model for three operations: resume extraction, job extraction and fit
assessment (which also produces the screening context). The prompts, the structured-output draft
schemas and the mapping to domain types are provider-neutral (`server/src/ai/contracts.ts`), so a
result's `promptVersion` means the same instructions on every provider. What differs per provider
is the transport and how strictly the endpoint enforces the output schema.

| `CAREER_RADAR_PROVIDER` | Adapter | Endpoint | Model | Key |
| --- | --- | --- | --- | --- |
| `openai` (default) | `OpenAICareerAnalyzer` | OpenAI Responses API, `store: false` | `OPENAI_MODEL` or `gpt-5-mini` | `OPENAI_API_KEY` |
| `openrouter` | `OpenRouterCareerAnalyzer` | `https://openrouter.ai/api/v1/chat/completions` (fixed in code) | `OPENROUTER_MODEL` (required, no default); optional `OPENROUTER_REASONING_EFFORT` (reasoning intensity, not a token cap) | `OPENROUTER_API_KEY` |

Selection is explicit. An unknown value fails with a fixed message; there is no fallback from one
provider to another and no automatic model substitution.

## Why a second provider

The #4 live measurement and the model-mode evaluations need approved calls. A metered or free
route lets the pipeline be exercised end to end before OpenAI credit exists; since 2026-09-14
(ADR-0014) the free route is the project's verification provider, not a stopgap. A result produced
this way is evidence **for that endpoint only**: `modelVersion` records
`openrouter/<model>@<upstream provider>` so nobody mistakes it for an OpenAI observation. Latency,
usage and quality measured on one provider do not verify another.

## OpenRouter specifics

- **Structured outputs vary by endpoint, not only by model.** The request sends
  `response_format: { type: "json_schema", json_schema: { strict: true, ... } }` and the routing
  preference `provider: { require_parameters: true }`, so OpenRouter only routes to endpoints that
  accept `response_format`. Some endpoints still treat the schema as a hint, so the adapter parses
  the returned content itself and validates it against the draft schema. Refusals, truncated
  responses (`finish_reason` other than `stop`), non-JSON content and schema mismatches fail
  closed with fixed messages that never echo the content. Pick a model whose supported parameters
  list `structured_outputs` ([OpenRouter docs](https://openrouter.ai/docs/guides/features/structured-outputs)).
- **Errors are sanitized on both adapters.** An SDK HTTP or transport error is replaced by a fixed
  message that keeps only the error class, HTTP status, provider error code and request ID, because
  a provider's error body can echo request input or internal diagnostics into an MCP response.
  Cancellation keeps its own error identity.
- **No `store` parameter exists on this endpoint.** The OpenAI adapter sends `store: false`; the
  OpenRouter request has no equivalent, so the live report records `store: "n/a"`. Retention follows
  your OpenRouter provider-routing and data settings, not this request.
- **Retries and logging** follow the same transport options as the OpenAI adapter: batch calls send
  `maxRetries: 0`, and the live harness and the usage check pin retries and SDK logging off for every
  request; the usage check also bounds each request at 5 minutes. A `finish_reason` of `error` from the
  upstream endpoint is reported as its own fixed message, distinct from truncation.
- **Free is not private.** The resume text and the public job descriptions leave the machine on
  either provider. OpenRouter forwards them to the upstream provider that serves the chosen model;
  review that provider's data policy and your OpenRouter privacy settings before a live run. The
  request carries the `X-OpenRouter-Title: Career Radar` attribution header and nothing else about
  the user.
- **Reasoning effort (opt-in).** `OPENROUTER_REASONING_EFFORT=none|minimal|low|medium|high|xhigh|max`
  sends OpenRouter's `reasoning.effort`, which asks the model for less or more reasoning; it is not a
  fixed token cap, and whether it actually lowers the reasoning tokens that ran to tens of thousands per
  call on the free endpoints tried so far is unverified. The value is a request parameter, so under
  `require_parameters` routing it also excludes endpoints that do not accept it, and an unsupported
  value fails closed at startup. Unset by default.
- **Telemetry** maps `prompt_tokens`/`completion_tokens` to the same `onResponse` event shape and adds
  `upstreamProvider` (the endpoint OpenRouter routed to, or `unknown`), so
  `pnpm measure:live --provider openrouter` records per-call usage and upstream provider the same way. Cost is still not
  computed; confirm it in the OpenRouter dashboard.

## What this does not establish

Nothing here claims model quality. The adapter is verified with the real SDK and a stubbed fetch:
request shape, header and routing flags, mapping of a valid draft, and every fail-closed path. A
live call on any provider happens only through the harness after explicit approval, and its
report says which provider and model produced it.
