# M4-B1 — Located evidence and structured input identity

Base: M4-C merge `5fe22ba` (#13). Owner approved the #8/#9 recommendations on
2026-09-11. Private, single-owner **LOCAL_DRAFT** only. No real resumes, private DB
inspection, model calls, extraction/assessment prompt changes, automatic applications
or public deployment. Existing React widget + MCP server layout is retained.

## Decisions (#8 and #9)

- Validate references against the inputs available at write time, not a future
  overwrite of the profile ID. Do not add a profile copy to each assessment.
- Record structured input identity separately from raw resume `sourceHash`.
- Resolve the specified source/path first, then reuse M1 `normalizeEvidence` and
  exact text equality. Matching a sentence elsewhere in the profile/JD is insufficient.
- Missing either candidate or job evidence, or **any** failed reference, coerces
  `seniorityFit`/`careerStoryRisk` to `uncertain` with low confidence. Unsupported
  explanation/question text is replaced by neutral clarification copy. Valid refs
  may remain visible but do not rescue a judgment with another invalid ref.
- Individual risks have no uncertain severity: exclude failed entries from the
  actionable list and retain a bounded, non-quoting reason in `unknowns`. No silent
  drop and no unsupported confident risk. Both sources are required for these too.

## B1 is an opt-in library contract, not a new tool result

`ScreeningContextV1Schema` (`version: "1"`) and `ScreeningAssessmentSchema` are exported
from shared. The latter extends the old fit shape with optional `screeningContext`.
The existing `FitAssessmentSchema`, model structured-output schema and all MCP tool
outputs remain unchanged. Old strict consumers would reject the new field, so the
server **does not produce, persist or emit screeningContext yet**. An absent context
means not evaluated, not low risk. Supplying a new envelope to current snapshot
storage is rejected by the existing strict fit schema.

`validateScreeningContext` / `validateScreeningAssessment` are pure opt-in functions
used by synthetic tests now. B2 must call the validator with the captured inputs
before writing/exposing context; merely importing the schema is not validation.
The validator never takes outcomes as input or changes score, verdict, fit confidence,
contortion, blockers, recommendation order or assessment prompt/model versions.

The widget remains v4: no rendering/bridge/descriptor/annotation or tool schema
change. Shared exports may alter bundle bytes, but do not introduce new UI behavior.
B2 must update the producer, storage, output contracts and UI together, use a v5+
resource URI and refresh ChatGPT descriptors. #4's separately approved live check
remains its gate. B1 does not make funded model testing unnecessary.

## Reference grammar and limits

| Source | Allowed paths (zero-based indices) |
| --- | --- |
| candidate | `headline`, `skills[i]`, `domains[i]`, `leadership[i]`, `customerFacing[i]`, `aiEvidence[i]`, `cloudEvidence[i]`, `roles[i].title`, `roles[i].responsibilities[j]`, `roles[i].evidence[j]` |
| job | `description`, `required[i].text`, `preferred[i].text`, `responsibilities[i]` |

No generic object traversal, URLs, negative/leading-zero indices, dates, employer
names, constraints, yearsExperience, prototype properties or unlisted fields.
Indices must exist in the exact input. A preferred quote with a required path fails.
Normalization preserves M1 behavior: lower case, collapsed whitespace and enclosing
quotes/trailing punctuation. A normalized empty string is never evidence. A whole
description must match; sentence extraction/substring matching is not supported.

Candidate title/headline/skill/domain tokens alone cannot support a seniority
comparison or seniority-mismatch risk: at least one located role responsibility,
role evidence or leadership entry is required along with job evidence.

This is **location/text validation, not semantic entailment**. Even an allowed
evidence field can contain a years-only sentence, or a grounded quote can be attached
to a wrong interpretation. B1 does not detect all such errors, infer intent, assess
scope from minimum years, or prove a model will avoid demographic proxies. A–F
tests preserve manually authored judgments and exercise bad/missing references;
they do not certify full A–F model behavior. Semantic paired evals and human labels
remain necessary before producer integration.

Bounds: 160-character paths, 16,000-character quotes, 2,000-character explanations
and questions, 8 refs per judgment/risk, 8 risks, 32 unknowns of at most 500 characters.
Unknown versions, unexpected keys and bound violations fail closed. If adding
validation reasons exceeds the unknowns bound, validation fails rather than truncating
reasons. Future callers must handle validation errors without logging source content.

## Identity and storage

New assessment snapshots include optional `inputIdentity`:

```ts
{ version: "structured-input-v1", profileHash: "<SHA-256>", jobHash: "<SHA-256>" }
```

Hash schema-validated input JSON with recursively sorted object keys and a version
prefix. Omit undefined object properties, retain array order and exact strings.
The profile hash covers all current structured fields, including raw `sourceHash`;
the job hash covers the exact normalized job passed to assessment. Same resume text
with different extracted structure yields a different profile hash.

`saveAssessment` now takes the captured profile object rather than only its ID.
Both job_assess and job_recommend pass the object used by the analyzer; storage does
not re-read a profile that may have changed while awaiting analysis. It stores the
digest, not the extra profile body. Existing job/fit snapshots and FK checks remain.

Hashes identify structured content only. The current profile schema has no extraction
model/prompt provenance; identical structured outputs from different extraction
versions intentionally share a hash. Assessment model/prompt versions remain on the
fit result. This is not complete extraction-run provenance, anonymization, encryption,
or a way to reconstruct the missing old profile. Replays use synthetic fixtures.

Old snapshots without identity remain readable and are **not backfilled** from the
current profile. Malformed present identities fail validation. No new SQL table,
migration or schema-version increment: SQLite migration version remains 2. Existing
clear/reset covers identity-bearing snapshots; events and tool outputs do not gain
identity/profile copies. No raw resume or additional file artifact is stored.

## Verification

Run: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm eval --no-save`, `pnpm build`.

Current implementation check: 189 tests (shared 7 + server 182), including 27 new
screening-contract tests and 5 identity/storage tests; 28/28 existing policy cases,
`modelCalls: 0`, human fit-label review still pending for all 28. A–C authored scope/
intent pairs and D–F variants of existing policy fixtures exercise reference contracts,
not model detection. Existing 16 original fixtures and M1 policy are unchanged.

Direct tests cover wrong location/source, negation cutting, fabricated extensions,
normal punctuation controls, missing evidence, neutral downgrade, risk exclusion
with diagnostics, unchanged base fit, old/new strict payloads, same-source/different-
structure identity, captured input versus overwrite, legacy snapshot loading and
reset. MCP integration checks descriptors/results still omit the new context and
identity fields. Existing dependencies reused; no lockfile/dependency change.

No new browser smoke: rendering/bridge behavior is unchanged. No real ChatGPT host,
live provider or personal-data test. App-specific self-review uses the local Radar
review criteria (not a public claim of platform review approval).

## Official contract references

Checked 2026-09-11: preserve existing tool output contracts and version UI resources
when introducing new producer/consumer behavior in B2.

- [MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [UI bridge](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Tool definitions](https://developers.openai.com/plugins/plan/tools)
- [Reference](https://developers.openai.com/plugins/reference)
