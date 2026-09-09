# Career Radar Codex Rules

1. Read `docs/PROJECT_SPEC.md` before changing product behavior.
2. Before changing OpenAI Plugin, MCP, or UI integration code, fetch the current official OpenAI documentation.
3. Prefer the smallest implementation that completes the active milestone.
4. Do not implement future milestones unless explicitly requested.
5. Never fabricate candidate facts in fixtures, prompts, demos, or UI.
6. Keep resume PII out of logs and test fixtures.
7. Model outputs must validate against Zod schemas.
8. Business rules that can be deterministic should not be delegated to the LLM.
9. Every model-generated assessment must record `modelVersion` and `promptVersion`.
10. New assessment behavior requires an eval case or test.
11. Run lint, typecheck, unit tests, and milestone-specific evals before finishing a task.
12. Summarize changed files, architectural decisions, unresolved risks, and test results at the end of each Codex task.
