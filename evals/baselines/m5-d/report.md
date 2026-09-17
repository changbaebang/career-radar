# Career Radar model-mode evaluation

Live run on openrouter (dots-studio/dots-3-note-preview:free); numbers are live-verified for this provider and model only. Failures are execution outcomes, never PASS. Cost is never computed.

- Code: 6afcd0a7ae5aabd4cd68e86252961417e541499b; dirty worktree: false; prompt: milestone-5b-v1; policy 0ea62b26888a…; schema 2b73bd1a46f3…
- Golden set: model-golden-v1 (dc5268eb011e…), 33 cases; model calls 109 / cap 147; cut by the per-call deadline 5; unsettled 0
- Provider: openrouter; requested model dots-studio/dots-3-note-preview:free; response models dots-studio/dots-3-note-preview:free; upstream AtlasCloud; store n/a; retries 0; SDK log off
- Golden-set problems: 0; model-written strings redacted: 0; resumed from 2026-09-16T00:32:06.801Z (16 cases rerun, 2 rounds)

## Metrics

| Measure | Value |
| --- | --- |
| Outcomes | assessed 28, extraction failed 5, assessment failed 0, not attempted 0 |
| Requirement match rate (gold matched by exact normalized text) | 38 / 39 = 97.4% |
| Blocker recall over matched gold requirements | 10 / 10 = 100.0% |
| Blocker recall over all gold blockers (unmatched count as misses) | 10 / 10 = 100.0% |
| Verdict in gold allowed set (all assessed) | 18 / 28 = 64.3% |
| Verdict agreement over reviewed cases only | 0 / 0 = N/A |
| Invented employers / forbidden positive claims | 0 / 0 |
| Verdict changed by the policy (draft → final) | 16 / 28 = 57.1% |
| Cases with pipeline diagnostics: ungrounded match removed; citation rekeyed / orphan / invalid; screening context discarded | 16; 1 / 16 / 15; 0 |
| Schema failure / refusal / truncation / timeout rates | 0.0% / 0.0% / 0.0% / 15.2% |
| Citation correctness (valid ÷ supplied) / unsupported claim rate | 60 / 174 = 34.5% / 15 / 37 = 40.5% |
| Latency ms (min / median / max): extractProfile | 30 / 8614 / 300003 |
| Latency ms: extractJob | 8833 / 14700 / 300006 |
| Latency ms: assess | 38229 / 58318 / 93370 |
| Provider-reported tokens (in / out / total; reasoning) over 88 of 109 calls | 39292 / 225074 / 264366; 195864 |

## Cases

| Case | Outcome | Failure | Draft → final verdict | In gold set | Req. match | Blocker recall matched / all | Citations valid / supplied | Notes | Unmatched gold |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gm-frontend-lead-realistic | assessed |  | STRETCH → STRETCH | false | 1 / 1 = 100.0% | N/A / N/A | 7 / 7 | none | none |
| gm-trailing-punctuation-evidence | assessed |  | STRETCH → STRETCH | false | 1 / 1 = 100.0% | N/A / N/A | 0 / 7 | ungroundedMatchRemoved, citationOrphan, citationInvalid | none |
| gm-invented-extension-stretch | assessed |  | PASS → PASS | true | 2 / 2 = 100.0% | N/A / N/A | 3 / 3 | none | none |
| gm-preferred-certification-not-blocker | assessed |  | STRETCH → STRETCH | true | 1 / 1 = 100.0% | N/A / N/A | 0 / 7 | ungroundedMatchRemoved, citationOrphan, citationInvalid | none |
| gm-security-specialist-pass | assessed |  | REALISTIC → PASS | true | 1 / 1 = 100.0% | 1/1 / 1/1 | 0 / 8 | citationInvalid | none |
| gm-ai-prototype-stretch | assessed |  | STRETCH → PASS | true | 1 / 1 = 100.0% | N/A / N/A | 4 / 7 | ungroundedMatchRemoved, citationOrphan | none |
| gm-formal-tpm-pass | assessed |  | STRETCH → PASS | true | 1 / 1 = 100.0% | 1/1 / 1/1 | 4 / 8 | citationInvalid | none |
| gm-developer-tooling-realistic | assessed |  | STRETCH → STRETCH | false | 1 / 1 = 100.0% | N/A / N/A | 0 / 8 | ungroundedMatchRemoved, citationOrphan, citationInvalid | none |
| gm-mandatory-language-pass | assessed |  | REALISTIC → PASS | true | 1 / 1 = 100.0% | 1/1 / 1/1 | 4 / 6 | ungroundedMatchRemoved, citationOrphan | none |
| gm-negated-claim-not-grounded | assessed |  | REALISTIC → PASS | true | 1 / 1 = 100.0% | N/A / N/A | 0 / 0 | none | none |
| gm-unlinked-hard-blocker-pass | assessed |  | REALISTIC → PASS | true | 1 / 1 = 100.0% | 1/1 / 1/1 | 3 / 6 | citationInvalid | none |
| gm-minor-education-gap | assessed |  | STRETCH → STRETCH | true | 1 / 1 = 100.0% | N/A / N/A | 0 / 4 | ungroundedMatchRemoved, citationOrphan, citationInvalid | none |
| gm-two-required-blockers | assessed |  | STRETCH → PASS | true | 2 / 2 = 100.0% | 2/2 / 2/2 | 4 / 13 | ungroundedMatchRemoved, citationOrphan, citationInvalid | none |
| gm-onsite-location-pass | assessed |  | REALISTIC → PASS | true | 1 / 1 = 100.0% | 1/1 / 1/1 | 4 / 4 | none | none |
| gm-preferred-language-not-blocker | assessed |  | STRETCH → STRETCH | true | 1 / 1 = 100.0% | N/A / N/A | 1 / 7 | ungroundedMatchRemoved, citationOrphan, citationInvalid | none |
| gm-korean-required-pass | assessed |  | REALISTIC → PASS | true | 1 / 1 = 100.0% | 1/1 / 1/1 | 3 / 6 | ungroundedMatchRemoved, citationOrphan, citationInvalid | none |
| gm-scope-lead-to-ic | assessed |  | STRETCH → STRETCH | false | 1 / 1 = 100.0% | N/A / N/A | 3 / 6 | ungroundedMatchRemoved, citationOrphan | none |
| gm-scope-ic-to-director | extraction_failed | timeout |  |  |  |  |  |  |  |
| gm-career-change-data | assessed |  | REALISTIC → PASS | true | 2 / 2 = 100.0% | 1/1 / 1/1 | 7 / 10 | citationRekeyed, citationInvalid | none |
| gm-adjacent-platform-role | extraction_failed | timeout |  |  |  |  |  |  |  |
| gm-recent-experience-gap | assessed |  | REALISTIC → PASS | true | 1 / 1 = 100.0% | N/A / N/A | 0 / 7 | ungroundedMatchRemoved, citationOrphan, citationInvalid | none |
| gm-title-gap-with-evidence | extraction_failed | timeout |  |  |  |  |  |  |  |
| gm-citation-typescript-migration | extraction_failed | timeout |  |  |  |  |  |  |  |
| gm-citation-mentoring | assessed |  | STRETCH → STRETCH | false | 1 / 1 = 100.0% | N/A / N/A | 0 / 4 | ungroundedMatchRemoved, citationOrphan | none |
| gm-citation-architecture-reviews | assessed |  | STRETCH → STRETCH | false | 1 / 1 = 100.0% | N/A / N/A | 4 / 5 | citationInvalid | none |
| gm-citation-multi-requirement | assessed |  | STRETCH → PASS | false | 3 / 3 = 100.0% | N/A / N/A | 0 / 13 | ungroundedMatchRemoved, citationOrphan | none |
| gm-citation-partial-coverage | assessed |  | STRETCH → PASS | false | 2 / 2 = 100.0% | N/A / N/A | 5 / 7 | citationInvalid | none |
| gm-no-employer-named | extraction_failed | timeout |  |  |  |  |  |  |  |
| gm-many-requirements | assessed |  | STRETCH → STRETCH | false | 6 / 6 = 100.0% | N/A / N/A | 0 / 0 | none | none |
| gm-preferred-only-posting | assessed |  | REALISTIC → STRETCH | false | 1 / 1 = 100.0% | N/A / N/A | 0 / 5 | ungroundedMatchRemoved, citationOrphan | none |
| gm-korean-posting | assessed |  | STRETCH → STRETCH | true | 0 / 1 = 0.0% | N/A / N/A | 0 / 4 | ungroundedMatchRemoved, citationOrphan | React 팀을 이끈 경험 → React 팀을 이끌은 경험 |
| gm-contradictory-constraint | assessed |  | REALISTIC → PASS | true | 1 / 1 = 100.0% | 1/1 / 1/1 | 4 / 6 | ungroundedMatchRemoved, citationOrphan | none |
| gm-years-not-family-years | assessed |  | REALISTIC → PASS | true | 1 / 1 = 100.0% | N/A / N/A | 0 / 6 | citationInvalid | none |
