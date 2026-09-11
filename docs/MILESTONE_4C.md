# M4-C — Stage-aware feedback

Implementation base: M4-A merge `f097295`. Private, single-owner prototype.
No API requests, real resumes, private DB access, model/prompt/policy changes or automated applications.

## Decisions and consumer contract

Owner confirmed #10(a), existing `application_events` JSON extension, and #11,
A → C → B1 → B2, on 2026-09-11. B1's temporarily unused contract is acceptable;
B2 still requires #4's separately approved live measurement. #8/#9 remain open.

Shared application schemas gain optional normalized stage, occurrence time, provenance,
revision and history mode; old application JSON remains readable. Pipeline output gains
optional `stageSummary` v1. New widget accepts old summaries too; the old strict widget
does not accept new fields, so the resource URI is now **widget-v4.html**. Refresh
ChatGPT descriptors before host testing. B2 must use a later URI (v5+), not reuse v4.
No new MCP tools or external domains. Existing update tool remains destructive/mutating,
summary read-only. Existing React widget + MCP bridge retained, not rescaffolded.

## Update and correction semantics

`application_update` still requires `applicationId` and `status`.

- `stage` remains free text. New reports recognize only exact normalized tokens or
  `resume screen`, `recruiter screen`, `coding test`, `technical`, `technical interview`,
  `hiring manager interview`, `final interview`, `offer` (trim/case insensitive).
  Other text stays visible but has normalized stage `unknown`; no fuzzy/model mapping.
- `normalizedOutcomeStage` supplies an explicitly reported enum; mismatching known
  text/enum or incompatible status/stage combinations are rejected transactionally.
- Omitted stage/notes preserve them. Empty stage clears its normalized projection;
  null normalized stage clears raw stage too. Changing normalized stage alone clears
  stale raw text. Clearing stage supersedes the previous active history.
- `occurredAt` is a reported UTC occurrence time, never the recording clock.
  Null clears it. Omission preserves it for the same status/stage, but a different
  status/stage resets it to unknown. Future times are rejected. No intermediate dates.
- `historyMode: append` keeps independently reported progression in the same revision.
- `historyMode: replace` (default for old callers) starts a new revision on changed
  outcome facts; an explicit replace after append can also retract old history while
  keeping current facts. **All earlier outcome facts are superseded**, not one event.
  Clarify this scope with the user; targeted event editing is deferred. To re-establish
  a valid history, append only explicitly confirmed facts after replacement.
- Notes-only edits do not start a revision. Identical immediate retries are no-ops.
  This is not request-ID deduplication of delayed retries after intervening updates.
- Original assessment snapshot and decision verdict are never changed by outcomes.

Example, with an existing synthetic `applicationId`:

```json
{"applicationId":"<returned ID>","status":"interview","normalizedOutcomeStage":"technical_interview","historyMode":"append"}
```

To correct that history to a resume-screen rejection:

```json
{"applicationId":"<returned ID>","status":"rejected","normalizedOutcomeStage":"resume_screen","occurredAt":null,"historyMode":"replace"}
```

## Storage and legacy behavior

Migration 1 is untouched. Migration 2 adds an application/event index. V2 events
contain `eventVersion: 2`, application ID, revision, status, normalized stage,
`provenance`, `recordedAt`, and optional `occurredAt`. No notes, free stage text,
company/title, resume, profile, JD or assessment copies are added to new events.
This is an additive change; existing rows are not rewritten or deleted on upgrade.

Legacy rows have unknown normalized stage/date and `legacy_mapping`. Their text is
preserved on the application, not guessed into a timeline. V1 did not distinguish
correction from progression, so only the latest legacy snapshot can contribute when
there are no explicit reports in the active revision. An explicit legacy `interview`
status can establish progression, but no named stage or intermediate event is invented.
Unknown event versions fail closed. Superseded rows remain audit records until reset;
stage clearing is projection retraction, **not physical history deletion**.
`clear` and `db:reset` include all revisions. Tests use isolated temporary SQLite files.

## Summary definitions

All counts use distinct stored application IDs, not events or deduplicated real-world
opportunities. No ratios/hiring probabilities, outcome-derived fit labels or causes.

- `from`/`to`: inclusive **last updated** filter, unchanged. `excludedByWindow` counts
  applications outside it. Active histories of included applications are considered
  in full; this is not an occurrence-time window or application cohort.
- Current coverage: total, known/unknown stage and known/unknown occurrence date.
- Pending = discovered + saved + applied + interview. Withdrawn is separately shown.
- Resume-screen rejection = current rejected + explicitly normalized resume_screen.
  Unknown-stage rejected is separate; other rejection stages are not resume failures.
- `stageReach`: count distinct applications explicitly recorded at each named stage
  in the active revision. Do not infer skipped/intermediate stages or a stage order.
- `recordedProgression`: active reported interview/offer status or a named post-resume
  stage. May overlap pending/withdrawn/unknown-stage; the counts are not disjoint bins.
- `verdictStages`: original verdict × **current** stage. `roleProgression`: total,
  recorded progression and current unknown stages per stored role family.
- No direct-role/transition inference; that classification is not collected yet.
- All matching applications contribute counts; details retain the existing 100-row
  cap (widget shows 10). Empty results are zero counts; no undefined rate is shown.

## Verification

2026-09-11 implementation check: **155 tests passed (shared 7 + server 148)**,
including 14 new outcome tests; **28/28 policy contracts** passed with `modelCalls: 0`.
Typecheck, lint, build and diff whitespace checks passed. Existing dependencies were
reused; no dependency/lockfile change. Initial sandbox socket/IPC `EPERM` checks were
rerun with local-server permission. A test unused binding was corrected before commit.

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm eval --no-save`, `pnpm build`.
Outcome analytics G/H tests are separate from 28 deterministic fit-policy contracts.
Tests cover same-fit/different-stage rejection, append/dedup, replacement/retraction,
unknown dates, notes exclusion, last-update windows, conflicts, old DB loading,
append-only migration rollback, reset/restart and old widget payload compatibility.
MCP integration exercises normalization/correction/output schemas with an injected
synthetic analyzer; it does not call a provider.

Local demo: `DEMO_PORT=8004 pnpm demo` uses an in-memory synthetic store and disables
AI calls. On the pipeline page, use the interview button then the correction button;
progression should go from 0 to 1 to 0 while the original verdict stays REALISTIC.
Actual ChatGPT host refresh/interaction (#5) and live model measurement (#4) remain
unverified. Authentication/isolation (#6) is still a public-release gate.

Standalone browser checked on 2026-09-11: 0 → 1 → 0 recorded progression across
interview then resume-rejection correction; original REALISTIC unchanged. At 390×844,
no horizontal overflow, normalized stage and unknown dates visible. This is synthetic
HTML/demo-button rendering, not the ChatGPT tool-selection/bridge lifecycle.
No application console errors after the correction; the initial navigation requested
an unprovided favicon (404), unrelated to the widget.

## Official references checked for this change

- [Define tools](https://developers.openai.com/plugins/plan/tools)
- [MCP server and versioned UI resources](https://developers.openai.com/plugins/build/mcp-server)
- [UI bridge](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Examples](https://developers.openai.com/plugins/build/examples)
- [Reference](https://developers.openai.com/plugins/reference)
