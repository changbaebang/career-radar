# M4-A — Policy evaluation foundation

Implementation base: `c286587` (PR #7). Scope is the common first slice of both
orders in [#11](https://github.com/changbaebang/career-radar/issues/11). This PR
does not settle the C/B order or close design issues #8–11.

## Implemented

- Keep the original 16 policy fixtures unchanged; annotate their intent and add
  12 synthetic policy variants (28 total). Each has rationale, explicit expected
  required-blocker IDs and positive-evidence requirements where applicable.
- Versioned report/dataset/metrics, structured input and case hashes, code SHA,
  dirty state and policy/schema content hashes. Save the injected draft separately
  from the post-policy output; fixture model/prompt labels are not live executions.
- Numerator/denominator metrics, N/A for empty denominators, confusion matrix,
  error/skip coverage, missing/spurious/duplicate blocker IDs, positive-evidence checks.
- Local JSON/Markdown run artifacts, no overwrite of existing run directories,
  validated baseline projection and same-contract comparison with explicit
  added/removed/modified/incompatible cases.
- Human review template and explicit pending status; no outcome-derived labels.

Usage and exact metric/comparison/retention definitions: [evals/README.md](../evals/README.md).

## Decisions limited to this slice

1. Policy-only CLI. No model mode, private data import, provider fallback or paid calls.
2. New JSON contract is `reportVersion: 2`, `policy-metrics-v2`. Each case carries a
   `contractHash` (inputs, injected draft, expectations) and a separate `annotationHash`
   (rationale, review state, provenance); baselines compare contracts only, so accepting a
   human review or editing prose does not drop a case from comparison. Legacy aggregate-only
   or v1 reports cannot be reconstructed; generate a new baseline.
3. Allow comparison across policy revisions when schemas/metrics and per-case
   contracts match. Disclose policy changes; never compute cross-dataset quality gains.
4. An ID-less legacy blocker is matched only by unique full required-text equality,
   counted separately as text-resolved. Wrong supplied IDs are not repaired; policy
   outputs are not changed. This is evaluator matching, not a new app grounding rule.
5. Reports live outside SQLite; ignored local files require separate deletion.
6. Root `@career-radar/shared` workspace dev dependency supports runtime schema
   imports from root-level evals. No external dependency version changes.

## Verification boundary

Run root `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm eval` and
a saved-baseline comparison. Tests cover denominator changes, partial/wrong/duplicate
blockers, failure versus verdict, required evidence retention, compatibility and CLI
file/exit behavior. Root typecheck already includes eval sources and tests.

Browser smoke is not required: no server tool, policy implementation, DB or widget
consumer changes. `applyAssessmentPolicy` is imported by the new harness but unchanged.

Implementation verification (2026-09-11): root typecheck/lint/build passed;
138 tests passed (shared 7 + server 131, including 26 new evaluator/CLI tests);
28 policy cases passed; saved-report comparison covered 28 unchanged contracts
with no regressions; offline frozen-lockfile installation passed. Model calls: 0.
Human-reviewed fit agreement remains 0/0 (N/A). The CLI reports 9/9 expected
blockers found (one resolved by exact text), PASS→REALISTIC 0/8 and
non-REALISTIC→REALISTIC 0/16. These are synthetic policy results, not model accuracy.

## Still pending

- All 28 cases are policy contracts with rationale; **human fit-label review is pending**.
  This does not satisfy the full milestone's reviewed-fit dataset requirement.
- M4-B screening context, source/path verification and prompt/UI integration.
- M4-C stage normalization, history semantics and analytics.
- Actual model/ChatGPT-host verification (#4/#5) and public readiness (#6).

Do not present a passing deterministic report as M4 completion or live model quality.
