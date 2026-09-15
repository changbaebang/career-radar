# Career Radar policy evaluation

Synthetic policy execution only; model calls: **0**. Not hiring probability or live model accuracy.

- Code: 99b2eede8421103770f1683dba0ddb6595120315; dirty worktree: false
- Dataset: synthetic-policy-v3 (06f591305c68eb91b417c4b9240a26cb89d0b0657934bcdc327363a7d0dccb3f)
- Metrics: policy-metrics-v2; report: 3
- Policy hash: 0ea62b26888a4e1a0cf2b5e979b05bfe3863a741bbe1e356d99b13a436c92fb0; schema hash: 2b73bd1a46f3d6aa548353b2917a01e768e0b8433ba0d90eb89e78a816318924
- Fixture model/prompt labels: eval-model / eval-prompt (not executed)
- Cases: 35; evaluated: 35; passed: 35; failed: 0; errors: 0; skipped: 0
- Human review pending: 35. Policy expectations are not automatically human fit labels.

## Metrics

| Measure | Count | Value |
| --- | --- | --- |
| Execution coverage | 35 / 35 | 100.0% |
| Policy verdict agreement | 35 / 35 | 100.0% |
| Human-reviewed verdict agreement | 0 / 0 | N/A |
| Required-blocker recall (resolved IDs) | 10 / 10 | 100.0% |
| Expected PASS → REALISTIC / evaluated expected PASS | 0 / 9 | 0.0% |
| Expected non-REALISTIC → REALISTIC / evaluated expected non-REALISTIC | 0 / 17 | 0.0% |
| Legacy PASS → REALISTIC / all cases (diagnostic only) | 0 / 35 | 0.0% |
| Citation correctness (valid ÷ supplied, M5-B) | 4 / 9 | 44.4% |
| Unsupported claim rate (claims without a citation ÷ claims, M5-B) | 48 / 51 | 94.1% |

Unlinked blockers resolved by unique exact required text: 1. These are not model-supplied IDs.
Positive evidence check failures: 0. Screening-context checks are not implemented.

## Confusion matrix

Rows = policy expected; columns = actual. Errors/skips excluded and counted above.

| Expected | REALISTIC | STRETCH | PASS |
| --- | --- | --- | --- |
| REALISTIC | 18 | 0 | 0 |
| STRETCH | 0 | 8 | 0 |
| PASS | 0 | 0 | 9 |

## Cases

| Case | Status | Expected | Actual | Checks / execution |
| --- | --- | --- | --- | --- |
| trailing-period-evidence-grounded | passed | REALISTIC | REALISTIC | OK |
| invented-evidence-extension-rejected | passed | STRETCH | STRETCH | OK |
| preferred-hard-blocker-unlinked-excluded | passed | REALISTIC | REALISTIC | OK |
| preferred-hard-blocker-preferred_1-excluded | passed | REALISTIC | REALISTIC | OK |
| frontend-lead-realistic | passed | REALISTIC | REALISTIC | OK |
| solution-architect-stretch | passed | STRETCH | STRETCH | OK |
| security-specialist-pass | passed | PASS | PASS | OK |
| ai-application-stretch | passed | STRETCH | STRETCH | OK |
| formal-tpm-pass | passed | PASS | PASS | OK |
| developer-tooling-realistic | passed | REALISTIC | REALISTIC | OK |
| preferred-certification-not-pass | passed | REALISTIC | REALISTIC | OK |
| mandatory-language-pass | passed | PASS | PASS | OK |
| negated-short-claim-not-grounded | passed | STRETCH | STRETCH | OK |
| unlinked-hard-blocker-gap-pass | passed | PASS | PASS | OK |
| minor-education-gap-not-pass | passed | REALISTIC | REALISTIC | OK |
| duplicate-blocker-deduped | passed | PASS | PASS | OK |
| case-whitespace-evidence-preserved | passed | REALISTIC | REALISTIC | OK |
| curly-quotes-evidence-preserved | passed | REALISTIC | REALISTIC | OK |
| positive-production-evidence-control | passed | REALISTIC | REALISTIC | OK |
| mixed-evidence-preserves-valid-match | passed | REALISTIC | REALISTIC | OK |
| high-contortion-downgrades-realistic | passed | STRETCH | STRETCH | OK |
| medium-contortion-keeps-supported-verdict | passed | REALISTIC | REALISTIC | OK |
| mandatory-location-pass | passed | PASS | PASS | OK |
| important-language-not-promoted | passed | STRETCH | STRETCH | OK |
| required-certification-control | passed | PASS | PASS | OK |
| formal-tpm-preferred-control | passed | STRETCH | STRETCH | OK |
| prototype-invented-production-claim | passed | STRETCH | STRETCH | OK |
| two-required-blockers-preserved | passed | PASS | PASS | OK |
| citation-valid-chunk-kept | passed | REALISTIC | REALISTIC | OK |
| citation-nonexistent-chunk-dropped | passed | REALISTIC | REALISTIC | OK |
| citation-quote-from-other-chunk-dropped | passed | REALISTIC | REALISTIC | OK |
| citation-negated-quote-dropped | passed | REALISTIC | REALISTIC | OK |
| citation-chunk-from-other-run-dropped | passed | REALISTIC | REALISTIC | OK |
| citation-removed-match-keeps-valid-one | passed | REALISTIC | REALISTIC | OK |
| citation-dedup-pair-rekeyed | passed | PASS | PASS | OK |
