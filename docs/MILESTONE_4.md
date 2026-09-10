# Milestone 4 — Evaluation and stage-aware feedback

**Status:** proposed implementation plan, not implemented. Baseline: `0aeb5e4` (M3 merged). Scope: private, single-owner use. This planning PR changes documentation only; it does not add schemas, migrations, fixtures, model calls, or new UI.

## 1. Product question and evidence boundary

Owner-supplied job-search feedback motivates a distinction between:

- **Fit assessment:** can the supplied career evidence truthfully support this job's requirements and scope?
- **Market response:** what stages did the owner's recorded applications reach?

A technically credible fit can still have uncertain role scope or an unexplained career transition. A rejection does not tell us why it happened. Progress to an interview is an observed progression, not proof that the original verdict or every supporting claim was correct.

The source feedback mixes prior assessments and human interpretation; it is not a verified dataset of this app's live model outputs. Do not claim that historical decisions came from a particular app/model/prompt version without provenance. Unknown provenance stays unknown.

Only generalized design lessons belong in this repository. Do not copy the feedback attachment, personal career chronology, exact experience totals, employer-specific outcomes, application counts, or private resume/JD excerpts into this plan, fixtures, PR text, or logs. A changed employer name alone is not sufficient anonymization. The synthetic scenarios below specify independent test contracts, not a reconstruction of the owner's history. This task does not import real cases into any DB.

## 2. Already implemented versus missing

Verified against the baseline source, not an assertion of live model quality:

| Area | Existing M1–M3 | M4 gap |
| --- | --- | --- |
| Fit result | Verdict, confidence, contortion, matches, gaps/blockers, free-text interview risks, model/prompt versions | Evidence-bound scope/trajectory context separate from verdict |
| Role evidence | Candidate roles/evidence; JD responsibilities, roleFamily, optional seniority | No normalized, versioned scope comparison |
| Outcomes | Status, optional free-text `outcomeStage`; explicit corrections; notes excluded from new events | Stage vocabulary, stage-aware history projection, explicit occurrence/provenance semantics |
| Summary | Current status/roleFamily/verdict × status counts; filter by last update | Historical stage progression and clearly defined cohorts/unknowns |
| Snapshots | Job and assessment snapshot, profile ID; profile can be overwritten | Immutable evaluation input/version for reproducible runs |
| Evals | 16 synthetic policy fixtures; CLI JSON aggregate; nonzero exit on failure | 24–30+ cases, case-level metrics, saved runs and regression comparison |
| Feedback | User-reported support data, not human-reviewed fit labels | Explicit reviewer annotation → synthetic regression case workflow |

Source entry points: `packages/shared/src/index.ts`, `server/src/domain/store.ts`, `server/src/infra/db/migrations.ts`, `server/src/ai/analyzer.ts`, `evals/run-evals.ts`, and `evals/fixtures/cases.ts`. Existing `outcomeStage` is not a missing field: M4 must improve its meaning without silently replacing historical text.

## 3. Invariants

1. Never implement `rejected → lower verdict`, automatically relabel a saved decision, or use hiring outcomes as fit-training labels.
2. Keep `hard blocker`, `material gap`, `screening risk`, and `unknown preference` distinct. Screening risks do not automatically change score/verdict/ranking or become blockers.
3. Minimum experience is a lower bound, not a target range or an upper limit. Compare demonstrated responsibility, autonomy, ownership, technical depth, mentoring, and organizational scope. Missing JD scope is uncertainty, not evidence of overqualification.
4. Do not use age, graduation year, gender, school prestige, or protected/sensitive demographic proxies in assessment or response analytics. Career years may establish an explicit experience requirement, never infer age. Do not infer salary expectations from seniority, title, or past employer.
5. A lead-to-IC transition is not inherently negative. Ask whether the move is intentional when relevant; never invent the candidate's intention or state it as a fact in suggested copy.
6. Transferable responsibilities can support a role without the exact title. Explicit, central job-family experience requirements still matter; total engineering years and personal prototypes cannot substitute for required specialist years or production delivery.
7. One outcome is an observation. Repeated comparable outcomes can motivate a hypothesis for human review, not a causal conclusion. No unsupported universal sample threshold or automated policy update.
8. Preserve both positive progression and rejection stages. Prevent false confidence and unjustified pessimism alike. Missing outcome information is not a rejection.

## 4. Proposed minimum schema additions

These are design contracts for subsequent implementation PRs, not current tool fields. Keep new analysis in one optional, versioned `screeningContext` object on `FitAssessment` instead of a second fit score. Absence on historical results means **not evaluated**, not low risk. Strict Zod schemas and consumers must be updated together; adding an optional field does not make an old strict parser forward-compatible.

```ts
type EvidenceRef = {
  source: "candidate" | "job";
  path: string; // validated locator in the immutable input, not an arbitrary URL
  quote: string; // verified against that located source
};

type ScreeningContextV1 = {
  version: "1";
  seniorityFit: {
    value: "aligned" | "underleveled" | "overleveled" | "uncertain";
    explanation: string;
    evidence: EvidenceRef[];
    confidence: "low" | "medium" | "high";
  };
  careerStoryRisk: {
    value: "low" | "medium" | "high" | "uncertain";
    explanation: string;
    evidence: EvidenceRef[];
    clarificationQuestion?: string;
    confidence: "low" | "medium" | "high";
  };
  screeningRisks: Array<{
    type: "seniority_mismatch" | "job_family_transition" | "career_story"
      | "domain_depth" | "recent_experience" | "formal_title_gap";
    severity: "low" | "medium" | "high";
    explanation: string;
    evidence: EvidenceRef[];
    confidence: "low" | "medium" | "high";
  }>;
  unknowns: string[];
};
```

- `underleveled` and `overleveled` describe the **candidate's demonstrated scope relative to the role**, not the candidate's worth. Non-uncertain scope judgments require cited candidate and JD scope; title/years alone cannot support them. A deliberately narrow, explicit role scope may support a mismatch risk. Absence of architecture/mentoring language alone does not.
- `careerStoryRisk` describes an evidence-backed need for clarification, not a prediction of recruiter behavior. Add `uncertain` to the supplied three-level proposal to avoid forcing a risk judgment when facts are missing. No automatic `medium` for former leads applying as ICs; an explicitly explained transition may remain low.
- Screening risks must carry verified references and be bounded in count/text length by the eventual schema. Missing/invalid evidence must not become a confident risk. Retain uncertainty rather than synthesizing supporting facts. Evidence location checks are not proof of semantic truth; paired evals are still required.
- Defer `compensation_scope` until explicit candidate preferences and advertised compensation/scope inputs exist. Unknown recruiter preferences belong in `unknowns`, not a scored `unknown` risk.
- Keep existing `interviewRisks` for compatibility. UI should distinguish interview preparation from screening context and avoid duplicating the same warning. No automatic verdict downgrade or ranking change is part of M4.

### Stage-aware outcomes

Keep `Application.status` unchanged and preserve the existing free-text `outcomeStage`. Propose an optional `normalizedOutcomeStage` with:

```text
resume_screen | recruiter_screen | coding_test | technical_interview
| hiring_manager_interview | final_interview | offer | unknown
```

Use `status: rejected` plus `normalizedOutcomeStage: resume_screen` for a reported resume-screen rejection. Use `unknown` for a rejection with no reliable stage; do not mix `resume_screen_rejected` into the stage enum. Withdrawal stays a status and may retain a known stage. Omitted input preserves prior state; explicit clearing must clear the associated normalized projection as well. Conflicting status/stage reports require validation or clarification, not guessed reconciliation.

For new outcome history, record a versioned event with `applicationId`, status, normalized stage, `recordedAt`, optional `occurredAt`, and provenance (`user_report` or `legacy_mapping`). Recording time is not the historical time of an interview/rejection. Unknown occurrence dates remain unknown. Do not copy notes, resume/profile content, or arbitrary private evidence into events.

The implementation must specify correction/retraction semantics before aggregating: corrected facts supersede prior interpretations rather than counting as additional applications or permanently inflating stage reach. Preserve the original decision verdict; corrections to outcomes and reviewer annotations are separate records. Do not assume every employer uses every stage or the same order.

### Backward compatibility and privacy

- Append a migration; do not rewrite released migrations or reset the owner's database. Exercise upgrade/restart/rollback and old JSON loading on an isolated synthetic DB.
- Retain raw historical stage text; map only a small, reviewed alias list deterministically. Ambiguous/empty legacy stages remain unknown. No model-based bulk inference or invented dates.
- Existing snapshots lack the historical profile body. Do not fetch a now-updated profile and claim it was the original input. Mark such cases non-reproducible unless the owner explicitly supplies a verified original.
- Use immutable synthetic profile/JD fixtures first. A private eval capture requires explicit selection and local-only storage with retention/reset coverage; do not duplicate every user's profile into every event for convenience. Hashes identify input versions but do not replace missing input content or anonymize it.
- Every new persistent table must be included in `clear`/`db:reset` in FK-safe order and covered by deletion tests; file-backed reports require their own documented removal path. No real-data export to Git or CI artifacts by default.

## 5. Keep response analytics descriptive

M4's first breakdowns should be small: `verdictAtDecision × stage`, `roleFamily × screening progression`, and direct-role versus transition only where explicitly classified. Preserve missing classification as unknown. Defer a broad level/domain/seniorityFit cross-tab dashboard until the fields have trustworthy coverage and stable definitions.

- Count distinct application IDs, not event rows. Repeated updates/retries do not increase N; document that a changed source/content may currently create another job/application ID. Do not claim cross-posting deduplication or count unique real-world opportunities.
- Report total applications, known relevant outcomes, pending, unknown-stage, and excluded records with the chosen time window. If displaying a rate, show the numerator/denominator and eligibility definition beside it. Zero eligible records means N/A, not 0% or 100%.
- Explicitly reported post-screen progression can establish progression without fabricating an intermediate event/date. Current `rejected` alone cannot establish resume rejection; pending/withdrawn/unknown cases must not be silently counted as screening failures.
- Existing `from`/`to` filter **last update**, not an application cohort. Keep that contract or add an explicit mode; never silently reinterpret it. A future cohort mode must use recorded application dates and show unknown dates separately. Occurrence-time reports must exclude/count unknown occurrence dates explicitly.
- Prefer factual wording such as “recorded interview progression in n of N applications; m stages unknown.” Do not label a role family “promising” or infer why screening failed from counts alone.
- Hypotheses have supporting observations, counterexamples, unknowns, and a review question. Outcome counts alone must never trigger `overleveled`, a formal-title gap, or a model/policy revision. Multiple applications remain a small self-selected sample, not independent controlled trials.

## 6. Evaluation and human-feedback plan

### Separate three evidence layers

1. **Policy mode (default, no API):** known profile/JD/model-draft fixtures → deterministic post-processing. Existing 16 fixtures belong here; they do not test whether a model notices a career-story issue.
2. **Model mode (explicit opt-in):** synthetic inputs → configured extraction/assessment → policy. Record provider/model, prompt/policy/schema/dataset version, code SHA, and evaluated operation. Timeouts, refusals, malformed results, and skipped cases are execution outcomes, not PASS labels. No silent free-provider substitution or automatic paid retry.
3. **Outcome analytics tests:** synthetic stage history → deterministic aggregates and corrections. These are not fit-accuracy cases.

### Metrics and reproducibility

- Grow the policy/assessment suite to 24–30+ reviewed cases, retaining all existing regressions. Count analytics cases separately. Each exact-verdict fixture needs a human rationale; ambiguous discovery examples are not ready-made ground truth.
- Verdict agreement compares only reviewed, comparable labels. Report a confusion matrix, evaluated/failed/skipped counts, and coverage; unknown or allowed-set exploratory cases are separate from exact agreement.
- Replace the current “any blocker exists in a blocker case” measure with requirement-ID matching: expected required blockers found / expected required blockers, with missing and spurious IDs and duplicate handling. Empty denominator is N/A. Keep a legacy case-detection measure only if explicitly named.
- Name false-REALISTIC measures precisely. Report expected-PASS → REALISTIC / expected-PASS cases, and expected-non-REALISTIC → REALISTIC / expected-non-REALISTIC cases separately, with raw counts. The current runner divides PASS → REALISTIC by all cases; version the metric change rather than comparing the two definitions as a quality gain.
- Validate positive-match and screening-risk evidence separately. Case fixtures include required references, forbidden claims, and normal counterexamples; string grounding alone does not validate extraction semantics.
- Save per-case input/version identifiers, expected/actual results, raw model draft versus post-policy result (synthetic runs only by default), failures, and aggregate JSON plus Markdown. Compare compatible datasets/metric versions by case ID; report added/removed cases and incompatible runs explicitly.
- Human corrections contain the reviewed expected label/risk, evidence/rationale, provenance, and review version. A rejected application can nominate a case for review, never supply its label. Keep outcomes hidden during the initial fit-label review where practical to reduce hindsight bias.
- Promote a private observation only through explicit human review and a newly authored synthetic counterpart. Test the new failure and a normal control before changing policy. Do not implement online learning or automatic threshold tuning.

## 7. Synthetic scenario contracts

These scenarios intentionally omit the owner's exact history, employers, dates, counts, and experience totals. Fixtures will be authored in implementation PRs, with independent inputs and fixed expected outputs after review.

| Case | Controlled inputs | Required assertion / normal control |
| --- | --- | --- |
| A — strong technical fit, underspecified scope | Experienced engineer; matching stack; JD states only a minimum experience requirement and tasks | Keep otherwise supported fit; `seniorityFit: uncertain`. No over-level conclusion from minimum years or omitted senior language. A paired JD with explicit narrower scope may surface a mismatch risk, never automatic PASS |
| B — minimum years with broad scope | Matching architecture, ownership, mentoring evidence; JD explicitly expects these responsibilities | Scope may be aligned despite a modest experience minimum; years-only over-level warning forbidden |
| C — lead to hands-on IC | Direct implementation evidence plus prior leadership | No automatic penalty. Unknown intent yields a clarification question, not a fabricated motivation; paired explicit intent can remove the clarification need |
| D — engineering coordination versus specialist program role | Transferable leadership; no direct specialist program tenure; variants make that requirement mandatory or preferred | Total engineering years do not satisfy specialist years. Exact STRETCH/PASS expectation depends on the reviewed mandatory/core requirement; preferred title alone is not a blocker |
| E — customer-facing UI delivery without matching title | Direct UI integration/prototyping/customer collaboration evidence; title is not a mandatory requirement | Missing the formal title alone cannot lower otherwise supported fit; scope/evidence control the result |
| F — prototype versus production delivery | Personal prototype evidence; JD explicitly requires production operations/delivery | No invention of production experience. Paired required/preferred versions receive separately reviewed expected verdicts |
| G — same fit, different stage outcome | Identical initial fit; independently authored resume rejection and final-interview rejection events | Stored verdict unchanged; stage-aware summaries distinguish them and do not infer a rejection cause |
| H — missing/corrected history | Unknown-stage rejection, pending/withdrawn, duplicate updates, corrected stages and unknown dates | Correct N/unknowns/coverage; no double count, invented progression, hidden exclusions, or causal signal |

## 8. Small implementation PRs

| Slice | Included | Exit gate |
| --- | --- | --- |
| M4-A — evaluation foundation | Versioned fixtures/run reports, metric definitions, baseline comparison, human-review template; retain current policy behavior | Existing regressions + expanded reviewed cases pass; incompatible comparisons and empty denominators tested; no API needed |
| M4-B — screening context | Optional versioned schema, evidence validators, prompt integration, readable uncertainty UI; A–F contract tests | New/legacy payload tests, no risk-driven verdict/ranking downgrade, no proxy inference, prompt/schema version update; synthetic versus live results explicitly separated |
| M4-C — stage-aware feedback | Additive migration/event semantics, normalized stages, correction-safe aggregates, compact pipeline reporting; G–H tests | Old DB upgrade + clear/reset tests; distinct application counts, stage/date unknowns, original decision preserved; no automatic policy learning |

M4-A must not claim A–F model-behavior success just by adding expected objects: until M4-B executes the relevant producer/validator, those are planned contracts, not passing model evals. M4-B and M4-C need a concise schema/consumer review before coding, especially stage clearing/corrections and the optional strict output shape.

Each implementation PR runs lint, typecheck, tests and relevant evals. Runtime UI changes require a real local browser smoke; ChatGPT integration changes require checking current official docs and refreshed host verification. No new search providers, auto-application, resume rewriting, demographic analytics, generalized agent framework, or dashboard expansion.

## 9. Explicit follow-ups and completion language

- [#4: live model and 90-second batch budget](https://github.com/changbaebang/career-radar/issues/4): execute only after explicit cost/transmission approval. Measure actual completion/cancellation/cost, not mock-call savings. A different provider proves only its own path.
- [#5: ChatGPT host and widget flow](https://github.com/changbaebang/career-radar/issues/5): actual tool selection, state/error recovery and UI interaction remain separate from standalone synthetic rendering.
- [#6: privacy, authentication and isolation](https://github.com/changbaebang/career-radar/issues/6): M5/public-release gate. Do not accept other users' private data in the unauthenticated prototype.

M4 can deliver a locally verified evaluation/feedback system while funded model/host checks remain pending, but must report that boundary rather than claim measured model quality or public readiness. M4 completion requires the implemented slices' evidence; merging this planning PR alone completes no runtime milestone.
