# Career Radar policy evaluation

Synthetic policy execution only; model calls: **0**. Not hiring probability or live model accuracy.

- Code: 47e7c13ec412c902ddae6cd9ba46c05e9700981c; dirty worktree: false
- Dataset: synthetic-policy-v2 (c685971017902d7e21251301dcdb8e47567341cebbec338210d66c025f462c54)
- Metrics: policy-metrics-v2; report: 3
- Policy hash: c32f094edb818e2daa158bc61f8414584abe6b04f209debef2338249b09e24fc; schema hash: 0e6a63c3e7afe7ad1c7869960bac72424f27cb38f11eafe5155caab189fc36a8
- Fixture model/prompt labels: eval-model / eval-prompt (not executed)
- Cases: 28; evaluated: 28; passed: 28; failed: 0; errors: 0; skipped: 0
- Human review pending: 28. Policy expectations are not automatically human fit labels.

## Metrics

| Measure | Count | Value |
| --- | --- | --- |
| Execution coverage | 28 / 28 | 100.0% |
| Policy verdict agreement | 28 / 28 | 100.0% |
| Human-reviewed verdict agreement | 0 / 0 | N/A |
| Required-blocker recall (resolved IDs) | 9 / 9 | 100.0% |
| Expected PASS → REALISTIC / evaluated expected PASS | 0 / 8 | 0.0% |
| Expected non-REALISTIC → REALISTIC / evaluated expected non-REALISTIC | 0 / 16 | 0.0% |
| Legacy PASS → REALISTIC / all cases (diagnostic only) | 0 / 28 | 0.0% |

Unlinked blockers resolved by unique exact required text: 1. These are not model-supplied IDs.
Positive evidence check failures: 0. Screening-context checks are not implemented.

## Confusion matrix

Rows = policy expected; columns = actual. Errors/skips excluded and counted above.

| Expected | REALISTIC | STRETCH | PASS |
| --- | --- | --- | --- |
| REALISTIC | 12 | 0 | 0 |
| STRETCH | 0 | 8 | 0 |
| PASS | 0 | 0 | 8 |

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
