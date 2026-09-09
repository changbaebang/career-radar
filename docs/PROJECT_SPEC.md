# Career Radar - Codex Project Spec

**Status:** v0.1 implementation brief  
**Primary goal:** Build a real AI application that helps a candidate turn a resume, live job descriptions, and application outcomes into evidence-based career decisions.  
**Initial user:** the project owner; local/private use first.  
**Target surface:** ChatGPT Plugin with an MCP server and optional React UI.  
**Implementation stack:** TypeScript / Node.js / React.  
**Working title:** Career Radar

---

## 1. Product idea

Career Radar is not a generic "resume score" app.

It should model a real job-search decision workflow:

1. Ingest a resume and turn it into a structured candidate profile.
2. Accept a job URL or pasted job description.
3. Compare the job to the candidate profile using explicit evidence.
4. Classify the opportunity as:
   - **REALISTIC** - strong alignment; worth prioritizing.
   - **STRETCH** - meaningful gaps, but there is a credible story for applying.
   - **PASS** - one or more hard requirements or core-role expectations are too far from current evidence.
5. Explain the classification with:
   - matching evidence from the resume,
   - missing evidence,
   - hard blockers,
   - interview risks,
   - "how much resume contortion would be required."
6. Save the application and later record outcomes.
7. Use the accumulated decisions and outcomes as an eval dataset, not as vague memory.

The product should help answer questions such as:

- "Find roles I should actually apply to this week."
- "Give me two realistic roles and one stretch role."
- "Is this role a real fit, or am I rewriting my resume too aggressively?"
- "Which career direction is getting market response?"
- "What changed in my pipeline after five rejections and two interviews?"

---

## 2. Why this project matters

The project should demonstrate more than a prompt wrapper.

It should show:

- LLM-assisted structured extraction from an unstructured resume.
- Retrieval and normalization of job descriptions.
- Structured, evidence-based model outputs.
- Tool design and MCP integration.
- A useful interactive ChatGPT UI.
- Persistent application state.
- A human feedback loop.
- Evals and regression tests.
- Privacy-aware handling of resume data.
- Product judgment around uncertainty and false confidence.

A successful portfolio story is:

> I built a ChatGPT plugin that converts resumes and job descriptions into evidence-based career decisions, tracks outcomes, and evaluates the reliability of the model's REALISTIC / STRETCH / PASS classifications. I designed the MCP tools, structured model outputs, UI, persistence, and eval loop.

---

## 3. Product principles

### 3.1 Evidence over persuasion

Never invent missing experience to make a job look like a match.

Every positive claim must point to candidate evidence. If evidence does not exist, say so.

### 3.2 A label is not a hiring probability

REALISTIC does not mean "you will pass the resume screen." It means "the current resume can credibly explain why this role fits without major distortion."

Do not display fake probabilities such as "87% chance of getting hired."

### 3.3 Hard requirements matter

A job can have high keyword overlap and still be PASS if a hard requirement is missing.

Examples:

- mandatory domain expertise,
- mandatory language,
- mandatory location/work authorization,
- many years in a specific job family rather than general years of experience,
- a required security/data/ML specialty that is central to the job.

### 3.4 Preserve uncertainty

The model may return `confidence: low | medium | high`.

Low-confidence decisions should explicitly ask for missing evidence rather than silently assuming it.

### 3.5 Local-first privacy

A resume contains PII. In the MVP:

- keep persistence local,
- store a structured profile rather than the raw resume whenever possible,
- make raw-resume retention optional,
- never send candidate data to unrelated third parties,
- redact or omit phone/address from eval fixtures.

---

## 4. Scope

### v0.1 - Build this first

The first useful product must support:

1. Candidate profile creation from resume text.
2. Job input from:
   - pasted JD text, or
   - a job URL that the server can fetch.
3. Job normalization into a structured schema.
4. Evidence-based fit analysis.
5. REALISTIC / STRETCH / PASS classification.
6. A ChatGPT UI card that shows:
   - verdict,
   - strongest matches,
   - critical gaps,
   - hard blockers,
   - interview risks,
   - recommendation.
7. Save a job to a local application tracker.
8. Automated tests for schemas and deterministic business rules.
9. A small eval fixture set.

### Explicitly out of scope for v0.1

Do not build these yet:

- broad live web job discovery,
- automated application submission,
- resume rewriting,
- cover-letter generation,
- user accounts,
- multi-user SaaS,
- billing,
- public Plugin Directory submission,
- complex vector database/RAG infrastructure,
- model fine-tuning.

These are later milestones.

---

## 5. Primary user flows

### Flow A - Analyze a single job

User:
> Here is my resume. Analyze this job: <URL>

System:

1. Resolve or create candidate profile.
2. Fetch and normalize the JD.
3. Evaluate fit.
4. Show a concise card.
5. Allow "Save to pipeline."

Expected output:

**AWS Sr. Solutions Architect, eCommerce**  
**STRETCH**

Strong evidence
- Commerce product experience
- Enterprise Azure customer troubleshooting/advisory
- Engineering team leadership

Critical gaps
- Formal Solutions Architect title/history
- AWS service depth beyond existing hands-on experience

Resume contortion
- Low to moderate

Recommendation
- Apply. Use application architecture and customer engineering as the bridge; do not claim AWS depth that is not present.

### Flow B - Compare roles

User:
> Compare these three jobs. I only want one realistic role and one stretch role.

Return a ranked comparison based on the same scoring/evidence model.

### Flow C - Update application result

User:
> Furiosa rejected me at resume screen.

Update the application status and capture an outcome event.

Do not automatically conclude "AI roles are impossible." Aggregate multiple outcomes before surfacing directional signals.

### Flow D - Review pipeline signal

User:
> What is my job search telling me right now?

Example signal:

- Engineering leadership roles: 1/2 interview movement
- TPM transition roles: 0/2 resume screens
- Pure AI application roles: 0/2 resume screens
- Solutions/customer architecture: still pending

This is descriptive analytics, not causal certainty.

---

## 6. Classification framework

Use a weighted fit model only as an internal support mechanism. The final label must also respect hard blockers.

Suggested dimensions:

| Dimension | Weight | What it means |
|---|---:|---|
| Core role/function | 25 | Is the candidate already doing substantially similar work? |
| Domain/problem space | 20 | Commerce, developer tooling, cloud support, AI apps, etc. |
| Technical evidence | 20 | Required stack and architecture evidence |
| Seniority/leadership | 15 | Scope, mentoring, team/technical leadership |
| Customer/stakeholder | 10 | Customer-facing, advisory, cross-functional work |
| Recent/relevant evidence | 10 | Is there recent proof, not only old exposure? |

Suggested label logic:

### REALISTIC
- overall evidence is strong,
- no central hard blocker,
- the role can be explained using the current resume with little rewriting,
- key requirements have direct examples.

### STRETCH
- there is a credible bridge from current experience,
- one or more material gaps exist,
- the candidate may be changing job family or domain,
- the resume can remain truthful without pretending to have missing expertise.

### PASS
- a central hard requirement is missing, or
- the role requires a different professional identity that the current evidence cannot support, or
- a convincing application would require substantial resume distortion.

### Resume contortion

Return:

- `low` - normal tailoring only.
- `medium` - needs careful reframing but remains natural.
- `high` - would require overclaiming, burying the real career story, or pretending adjacent exposure is direct experience.

A high-contortion result should strongly push toward PASS.

---

## 7. Core data models

Use Zod schemas and share them between server, UI, and tests.

### CandidateProfile

```ts
type CandidateProfile = {
  id: string;
  headline: string;
  yearsExperience?: number;
  roles: Array<{
    company: string;
    title: string;
    start?: string;
    end?: string;
    responsibilities: string[];
    evidence: string[];
  }>;
  skills: string[];
  domains: string[];
  leadership: string[];
  customerFacing: string[];
  aiEvidence: string[];
  cloudEvidence: string[];
  constraints?: {
    locations?: string[];
    remotePreference?: string;
    languages?: string[];
  };
  sourceHash: string;
};
```

### JobPosting

```ts
type JobPosting = {
  id: string;
  company: string;
  title: string;
  location?: string;
  sourceUrl?: string;
  description: string;
  required: Requirement[];
  preferred: Requirement[];
  responsibilities: string[];
  roleFamily: string;
  domains: string[];
  technologies: string[];
  seniority?: string;
};
```

### Requirement

```ts
type Requirement = {
  id: string;
  text: string;
  type:
    | "role_experience"
    | "domain"
    | "technology"
    | "leadership"
    | "customer"
    | "education"
    | "language"
    | "location"
    | "certification"
    | "other";
  importance: "core" | "important" | "nice_to_have";
};
```

### FitAssessment

```ts
type FitAssessment = {
  verdict: "REALISTIC" | "STRETCH" | "PASS";
  confidence: "low" | "medium" | "high";
  resumeContortion: "low" | "medium" | "high";
  score?: number;
  strongestMatches: EvidenceMatch[];
  gaps: Gap[];
  hardBlockers: Gap[];
  interviewRisks: string[];
  recommendation: string;
  missingInformation: string[];
  modelVersion: string;
  promptVersion: string;
};
```

### EvidenceMatch

```ts
type EvidenceMatch = {
  requirementId?: string;
  requirement: string;
  evidence: string;
  source: {
    company?: string;
    role?: string;
    project?: string;
  };
  strength: "direct" | "adjacent" | "weak";
};
```

### Application

```ts
type Application = {
  id: string;
  jobId: string;
  candidateProfileId: string;
  status:
    | "discovered"
    | "saved"
    | "applied"
    | "interview"
    | "rejected"
    | "withdrawn"
    | "offer";
  verdictAtDecision: "REALISTIC" | "STRETCH" | "PASS";
  appliedAt?: string;
  updatedAt: string;
  outcomeStage?: string;
  notes?: string;
};
```

---

## 8. MCP tool plan

Keep each tool focused. Use explicit schemas and accurate annotations.

### `profile_upsert`

Use this when a user provides or updates a resume and Career Radar needs a structured candidate profile.

Input:
- resume text
- optional profile id

Output:
- structured candidate profile
- extraction warnings

Mutation: yes  
Open-world access: no

### `job_ingest`

Use this when the user provides a job URL or job-description text and the app needs a normalized JobPosting.

Input:
- `url?`
- `text?`

Output:
- normalized job posting
- source URL
- parsing warnings

Mutation: may cache normalized job  
Open-world access: yes when URL is used

### `job_assess`

Use this when a normalized job and candidate profile are available and the user wants an evidence-based fit decision.

Input:
- candidate profile id
- job id
- optional decision policy

Output:
- FitAssessment

Mutation: no  
Open-world access: no

### `application_save`

Use this when the user wants to add a job to the local pipeline or mark it applied.

Input:
- job id
- profile id
- status
- assessment snapshot

Output:
- saved application

Mutation: yes

### `application_update`

Use this when the user reports an interview, rejection, withdrawal, or offer.

Input:
- application id
- new status
- stage
- optional notes

Output:
- updated application

Mutation: yes

### `pipeline_summary`

Use this when the user wants to understand current application status and directional market signals.

Input:
- optional date window

Output:
- counts by status
- counts by role family
- verdict vs outcome table
- cautiously worded observations

Mutation: no

---

## 9. Model responsibilities

The model should be used for:

1. Resume-to-profile extraction.
2. JD normalization.
3. Evidence matching.
4. Gap classification.
5. Final REALISTIC / STRETCH / PASS decision.
6. Natural-language explanation.

Do not use the model for:

- primary-key generation,
- deterministic status transitions,
- date arithmetic,
- database consistency,
- URL allow/deny checks,
- score aggregation that can be implemented deterministically.

Use structured outputs for model-generated schemas.

Every assessment prompt must include these rules:

1. Never infer an experience merely because a nearby technology appears.
2. Distinguish direct experience from adjacent exposure.
3. Required years in a specific job family are not interchangeable with total career years.
4. Do not turn a preferred qualification into a hard blocker.
5. Do not hide a central gap because the candidate is senior.
6. Cite the resume evidence used for each important match.
7. If information is missing, say it is missing.
8. A truthful STRETCH is better than a fabricated REALISTIC.

---

## 10. Architecture

### Primary archetype

**React widget + MCP server, decoupled data/render pattern.**

Repository shape:

```text
career-radar/
  AGENTS.md
  README.md
  docs/
    PROJECT_SPEC.md
    DECISIONS.md
  server/
    src/
      index.ts
      mcp/
        tools/
      domain/
        assessment/
        profiles/
        jobs/
        applications/
      ai/
        client.ts
        prompts/
        schemas/
      infra/
        db/
        fetch/
    tests/
  web/
    src/
      components/
      views/
      bridge/
    vite.config.ts
  packages/
    shared/
      src/
        schemas.ts
        types.ts
  evals/
    fixtures/
    expected/
    run-evals.ts
  data/
    .gitkeep
  package.json
  pnpm-workspace.yaml
```

### Technology choices

- TypeScript everywhere.
- Node.js MCP server.
- React widget bundled with Vite.
- Zod for shared schemas.
- SQLite for local persistence in MVP.
- Vitest for unit/integration tests.
- OpenAI Responses API for server-side structured model calls.
- Keep model id configurable through environment variables.
- Do not put API keys in the client/widget.

### Important OpenAI implementation rule

OpenAI's current documentation presents this surface under **Plugins**, with an MCP server and optional UI. Before writing or changing integration code, Codex must read the current OpenAI documentation and follow current metadata, bridge, tool annotation, CSP, and resource-registration patterns rather than copying an old Apps SDK snippet.

---

## 11. UI requirements

The first widget should be deliberately small.

### Job Assessment Card

Show:

- company + role title,
- verdict badge,
- confidence,
- resume contortion,
- strongest three matches,
- top three gaps,
- hard blockers if any,
- recommendation,
- actions:
  - Save
  - Mark Applied
  - Ask "Why not REALISTIC?"
  - Ask "What evidence would change this decision?"

Do not show a giant 100-point score as the dominant UI.

### Comparison view - later

For 2-5 jobs:

| Job | Verdict | Best evidence | Biggest gap | Contortion |
|---|---|---|---|---|

The user should be able to choose "one realistic + one stretch" without reading long prose.

---

## 12. Persistence

Use SQLite in local/private MVP.

Suggested tables:

- `candidate_profiles`
- `jobs`
- `assessments`
- `applications`
- `application_events`
- `eval_cases`

Store:

- structured profile JSON,
- normalized job JSON,
- assessment JSON,
- prompt/model version,
- timestamps.

Prefer not to store:

- raw resume PDF/docx,
- phone number,
- home address,
- unnecessary PII.

If raw text is retained for debugging, make it an explicit development flag.

---

## 13. Evals

Evals are a first-class feature, not a final polish task.

Start with 20-30 hand-labeled historical or synthetic cases.

Each fixture should contain:

```json
{
  "caseId": "case-001",
  "profile": "...",
  "job": "...",
  "expectedVerdict": "STRETCH",
  "mustFindGaps": ["formal SA experience", "AWS service depth"],
  "mustNotClaim": ["5+ years AWS architecture"],
  "notes": "Credible application story without inventing cloud depth."
}
```

Track at least:

### 13.1 Verdict agreement
How often does the model match the human label?

### 13.2 Hard-blocker recall
Did the model notice a central mandatory gap?

This matters more than overall score agreement.

### 13.3 False-REALISTIC rate
How often did the system call a clearly poor fit REALISTIC?

This is the most dangerous product failure because it encourages wasted applications and resume distortion.

### 13.4 Evidence grounding
Can every major positive claim be traced to actual resume evidence?

### 13.5 Regression stability
When prompts or models change, do previously correct cases remain acceptable?

Keep prompt versions and model versions in every result.

---

## 14. Seed eval categories

Create representative cases for:

1. Frontend engineering lead role with strong direct leadership and React evidence -> REALISTIC.
2. Commerce solution architecture role with commerce + cloud advisory but no formal SA title -> STRETCH.
3. Security CSA requiring deep M365/security experience -> PASS.
4. Pure AI application engineer requiring production LLM delivery -> STRETCH or PASS depending on evidence.
5. TPM role requiring long formal TPM history -> STRETCH/PASS.
6. Developer tooling role where frontend/platform/tooling evidence is strong -> REALISTIC/STRETCH.
7. Role with a preferred certification only -> must not become PASS solely because certification is missing.
8. Role with a mandatory language/location requirement not met -> PASS.

Do not encode the project owner's real name, phone, address, or employer-confidential details into public fixtures.

---

## 15. Milestones

### Milestone 0 - Scaffold

Definition of done:

- pnpm workspace builds,
- MCP server runs,
- one read-only health/demo tool works,
- React widget resource renders,
- lint/test scripts work,
- README contains local run steps.

### Milestone 1 - Single-job assessment

Definition of done:

- candidate profile can be created from resume text,
- job can be ingested from pasted text,
- model returns strict FitAssessment,
- widget renders the assessment,
- unit tests cover schemas and hard-blocker logic,
- at least 8 eval fixtures exist.

Do not add web job search before this works.

### Milestone 2 - Job URL + pipeline

Definition of done:

- server fetches allowed public job URLs,
- JD is normalized,
- application can be saved/updated,
- pipeline summary works,
- SQLite migrations/tests exist.

### Milestone 3 - Search and recommendation

Definition of done:

- a job-search provider abstraction exists,
- searches can return candidate jobs,
- the app can rank a small set and return:
  - N REALISTIC,
  - N STRETCH,
  - optional PASS explanations.
- search source and freshness are visible.

Avoid brittle site-specific scraping as the primary architecture.

### Milestone 4 - Eval and feedback loop

Definition of done:

- 20-30+ eval cases,
- command-line eval runner,
- verdict agreement report,
- hard-blocker recall,
- false-REALISTIC rate,
- regression comparison by prompt/model version.

### Milestone 5 - Portfolio/public hardening

Only after the product is useful privately:

- auth decision,
- privacy policy,
- data retention controls,
- production hosting,
- CSP/domain configuration,
- submission review requirements,
- public documentation,
- demo video/screenshots.

---

## 16. Non-goals and anti-patterns

Codex must reject or flag implementations that do the following:

- keyword-count-only matching,
- a single unexplained 0-100 score,
- "87% hiring probability,"
- fabricated candidate experience,
- automatic resume rewriting before fit is understood,
- pretending total software experience equals years as an architect/TPM/ML engineer,
- storing API keys in frontend code,
- sending raw resumes to random services,
- building a large agent framework before the single-job flow works,
- adding vector DB/RAG because it sounds AI-native rather than because it is needed,
- scraping many job sites before URL/text analysis is reliable,
- treating rejection outcomes as proof of causal skill gaps.

---

## 17. AGENTS.md rules for Codex

Create an `AGENTS.md` in the repository with these rules:

1. Read `docs/PROJECT_SPEC.md` before changing product behavior.
2. Before changing OpenAI Plugin/MCP/UI integration code, fetch current OpenAI docs.
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

---

## 18. First Codex prompt

Use this exact prompt to start the repository:

```text
Use $build-chatgpt-app with $openai-docs.

We are building a ChatGPT Plugin called "Career Radar".
Read the attached PROJECT_SPEC.md completely before writing code.

Goal for this task: implement Milestone 0 only.

Requirements:
- Classify the app as the smallest appropriate ChatGPT plugin archetype.
- Use current OpenAI Plugin/MCP/UI documentation, not deprecated snippets.
- TypeScript / Node.js MCP server.
- React widget using the current supported MCP/ChatGPT UI bridge.
- pnpm workspace with server, web, and packages/shared.
- Zod shared schemas.
- Vitest.
- Add AGENTS.md using the rules in PROJECT_SPEC.md.
- Add one small read-only demo/health tool and one minimal widget so the end-to-end MCP + UI path can be tested.
- Add README instructions for local development and ChatGPT connection/testing.
- Do not implement resume parsing, job analysis, search, persistence, or application tracking yet.
- Keep the scaffold intentionally small.

Before coding:
1. Read the current OpenAI Plugin quickstart, tool-planning, MCP server, UI, and reference docs.
2. State the chosen archetype and repo approach in 5-10 lines.
3. Inspect the repository before creating files.

After coding:
1. Run install/build/typecheck/test.
2. Report exact commands and results.
3. List changed files.
4. Call out any current-doc behavior or metadata that differs from older Apps SDK examples.
5. Stop after Milestone 0 is complete.
```

---

## 19. Second Codex prompt - Milestone 1

After Milestone 0 works:

```text
Read PROJECT_SPEC.md and AGENTS.md.

Implement Milestone 1 only: single-job assessment.

Add:
- CandidateProfile, JobPosting, Requirement, FitAssessment, EvidenceMatch Zod schemas.
- profile_upsert from resume text.
- job_ingest for pasted job-description text only.
- job_assess using an OpenAI Responses API structured output.
- strict evidence-grounding rules from PROJECT_SPEC.md.
- deterministic hard-blocker post-processing where appropriate.
- a compact React Job Assessment Card.
- unit tests.
- at least 8 eval fixtures and a simple eval runner.

Important:
- Do not implement job web search.
- Do not implement automatic resume rewriting.
- Do not claim hiring probabilities.
- Do not fabricate missing candidate experience.
- Record modelVersion and promptVersion.
- Make the model id configurable.

Before changing code, re-check current OpenAI docs relevant to structured outputs, tool usage, and Plugin UI integration.
At the end, run lint/typecheck/tests/evals and report results.
```

---

## 20. Definition of a strong v0.1 demo

A demo is strong when the user can upload or provide resume content, paste a real JD, and see a result like:

**Microsoft Apps & AI Solution Architect**  
**STRETCH - medium confidence**

Why it fits
- Direct Azure enterprise troubleshooting/advisory evidence.
- Direct application engineering evidence in React/Node.js.
- Direct technical leadership evidence.

Why it is a stretch
- No long formal Solution Architect career history.
- Limited evidence of production enterprise AI solution delivery.
- Missing direct evidence for several data/AI platform requirements.

Resume contortion: **medium**

Recommendation:
Apply only if the candidate wants the architecture transition. Keep the application story anchored in application engineering + Azure customer advisory; do not rewrite the resume as if the candidate were already a 10-year AI solution architect.

The app succeeds when this explanation is reproducible, grounded, testable, and useful - not when it produces an impressive-looking score.

---

## 21. Current OpenAI references

Codex must check the latest documentation at implementation time. As of 2026-09-09, the former Apps SDK documentation routes to the current **Plugins** documentation.

- Quickstart: https://developers.openai.com/plugins/build/app-quickstart
- Define tools: https://developers.openai.com/plugins/plan/tools
- Build an MCP server: https://developers.openai.com/plugins/build/mcp-server
- Add UI to MCP server: https://developers.openai.com/plugins/build/chatgpt-ui
- Plugin reference: https://developers.openai.com/plugins/reference

Treat these links as starting points, not frozen implementation specifications.

---

## 22. Final instruction to Codex

Build a useful small product first.

Do not optimize for "looking AI."

Optimize for:
- truthful evidence,
- repeatable decisions,
- good tool boundaries,
- measurable eval quality,
- privacy,
- and a workflow a real job seeker would voluntarily use every week.
