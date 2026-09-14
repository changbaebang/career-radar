import type { FitAssessment } from "@career-radar/shared";
import { postingText, resumeText, type PostingSpec, type ResumeSpec } from "./format.js";

// M5-D golden set for model mode. Every case is raw synthetic text: a resume and a posting that a
// model extracts and assesses, followed by the deterministic pipeline. Nothing here is a real
// person or employer. Model gold is not policy gold (MILESTONE_5.md, M5-D): expectations name
// requirement *texts*, never fixture ids, because extraction assigns ids at run time; the expected
// verdict is an allowed set (exact only once a reviewer signs it); every case starts `pending`.
export const GOLDEN_SET_VERSION = "model-golden-v1";

export type GoldenCase = {
  caseId: string;
  resume: ResumeSpec;
  posting: PostingSpec;
  // The posting's required requirement texts, as authored. Extracted requirements are mapped to
  // these by normalized-text equality before any blocker is scored.
  goldRequirements: string[];
  // Required requirements the assessment must surface as hard blockers, by text (subset of goldRequirements).
  expectedBlockers: string[];
  expectedVerdicts: FitAssessment["verdict"][];
  // Substrings that must not appear in any positive match's evidence (normalized substring check).
  mustNotClaim: string[];
  rationale: string;
  humanReview: "pending" | "reviewed";
  tags: string[];
};

type Draft = Omit<GoldenCase, "goldRequirements" | "humanReview" | "tags"> & { tags?: string[] };
const gold = (draft: Draft): GoldenCase => ({
  ...draft, goldRequirements: draft.posting.required, humanReview: "pending", tags: draft.tags ?? [],
});

export function goldenResumeText(item: GoldenCase): string { return resumeText(item.resume); }
export function goldenPostingText(item: GoldenCase): string { return postingText(item.posting); }

const frontendLead: ResumeSpec = {
  headline: "Frontend Lead with eight years of web application delivery",
  experience: [
    "Led a React platform team of six engineers for three years.",
    "Introduced TypeScript strict mode across twelve packages.",
    "Ran weekly architecture reviews for frontend changes.",
    "Mentored three engineers who were promoted to senior.",
  ],
  skills: ["React", "TypeScript", "Node.js", "Playwright"],
};

export const goldenCases: GoldenCase[] = [
  // --- mirrors of the policy fixture scenarios (same failure modes, now through extraction) ---
  gold({
    caseId: "gm-frontend-lead-realistic",
    resume: frontendLead,
    posting: { title: "Frontend Engineering Lead", company: "Example Platform Co.", required: ["Lead a React team"], responsibilities: ["Own the frontend platform roadmap"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC"], mustNotClaim: ["ten years of React", "10 years of React"],
    rationale: "Direct leadership evidence for the single core requirement; nothing should be invented.",
    tags: ["mirror:frontend-lead-realistic"],
  }),
  gold({
    caseId: "gm-trailing-punctuation-evidence",
    resume: { headline: "Frontend Lead", experience: ["Led a React platform team for three years."], skills: ["React"] },
    posting: { title: "Frontend Lead", required: ["Lead a React team"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC"], mustNotClaim: ["ten years"],
    rationale: "A single exact evidence sentence with trailing punctuation still grounds the match.",
    tags: ["mirror:trailing-period-evidence-grounded"],
  }),
  gold({
    caseId: "gm-invented-extension-stretch",
    resume: { headline: "Frontend Lead", experience: ["Led a React platform team for three years."] },
    posting: { title: "Frontend Lead", required: ["Lead a React team", "Own company-wide architecture"] },
    expectedBlockers: [], expectedVerdicts: ["STRETCH", "PASS"], mustNotClaim: ["owned company-wide architecture", "company-wide architecture"],
    rationale: "Architecture ownership is absent from the resume; it must appear as a gap, never as evidence.",
    tags: ["mirror:invented-evidence-extension-rejected"],
  }),
  gold({
    caseId: "gm-preferred-certification-not-blocker",
    resume: { headline: "Cloud Application Engineer", experience: ["Troubleshot Azure applications for enterprise customers for four years."] },
    posting: { title: "Cloud Application Engineer", required: ["Troubleshoot cloud applications"], preferred: ["AWS certification"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC", "STRETCH"], mustNotClaim: ["AWS certified", "AWS certification"],
    rationale: "A preferred certification can be a gap but never a hard blocker.",
    tags: ["mirror:preferred-certification-not-pass"],
  }),
  gold({
    caseId: "gm-security-specialist-pass",
    resume: { headline: "Frontend Engineer", experience: ["Built authentication user interfaces for a consumer product."], skills: ["React"] },
    posting: { title: "Security Cloud Architect", required: ["Deep security architecture experience is mandatory"] },
    expectedBlockers: ["Deep security architecture experience is mandatory"], expectedVerdicts: ["PASS"], mustNotClaim: ["Led security architecture", "security architecture experience"],
    rationale: "A mandatory core specialist requirement with no evidence is a hard blocker.",
    tags: ["mirror:security-specialist-pass"],
  }),
  gold({
    caseId: "gm-ai-prototype-stretch",
    resume: { headline: "Application Engineer", experience: ["Built a local LLM evaluation prototype for internal testing."] },
    posting: { title: "AI Application Engineer", required: ["Ship production LLM applications"] },
    expectedBlockers: [], expectedVerdicts: ["STRETCH", "PASS"], mustNotClaim: ["Production LLM platform owner", "shipped production LLM"],
    rationale: "Prototype evidence does not become production delivery.",
    tags: ["mirror:ai-application-stretch"],
  }),
  gold({
    caseId: "gm-formal-tpm-pass",
    resume: { headline: "Frontend Lead", experience: ["Coordinated a cross-team frontend migration over two quarters."] },
    posting: { title: "Senior Technical Program Manager", required: ["Five years of formal TPM ownership required"] },
    expectedBlockers: ["Five years of formal TPM ownership required"], expectedVerdicts: ["PASS"], mustNotClaim: ["Five years as a TPM", "formal TPM"],
    rationale: "Adjacent coordination evidence does not satisfy an explicit specialist-tenure requirement.",
    tags: ["mirror:formal-tpm-pass"],
  }),
  gold({
    caseId: "gm-developer-tooling-realistic",
    resume: { headline: "Frontend Platform Engineer", experience: ["Built lint rules and developer workflow automation used by forty engineers."] },
    posting: { title: "Developer Tooling Engineer", required: ["Build developer productivity tooling"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC"], mustNotClaim: ["Maintained a compiler", "compiler"],
    rationale: "Direct tooling evidence without inventing compiler experience.",
    tags: ["mirror:developer-tooling-realistic"],
  }),
  gold({
    caseId: "gm-mandatory-language-pass",
    resume: { headline: "Frontend Engineer", experience: ["Built internationalized web applications for three markets."], constraints: "Languages: Korean, English" },
    posting: { title: "Frontend Engineer", required: ["Native Japanese is mandatory"] },
    expectedBlockers: ["Native Japanese is mandatory"], expectedVerdicts: ["PASS"], mustNotClaim: ["Native Japanese", "Japanese"],
    rationale: "A core binary language requirement with no evidence forces PASS.",
    tags: ["mirror:mandatory-language-pass"],
  }),
  gold({
    caseId: "gm-negated-claim-not-grounded",
    resume: { headline: "Frontend Engineer", experience: ["Never used Kubernetes in production at any point.", "Shipped React applications for five years."] },
    posting: { title: "Platform Engineer", required: ["Kubernetes in production"] },
    expectedBlockers: [], expectedVerdicts: ["STRETCH", "PASS"], mustNotClaim: ["Kubernetes"],
    rationale: "A negated sentence is not positive evidence; the technology name must not be claimed as a match.",
    tags: ["mirror:negated-short-claim-not-grounded"],
  }),
  gold({
    caseId: "gm-unlinked-hard-blocker-pass",
    resume: { headline: "Frontend Engineer", experience: ["Built authentication user interfaces."] },
    posting: { title: "Security Architect", required: ["Ten years of security architecture"] },
    expectedBlockers: ["Ten years of security architecture"], expectedVerdicts: ["PASS"], mustNotClaim: ["Security architect", "security architecture"],
    rationale: "The explicit tenure requirement is a blocker whether or not the model links an id.",
    tags: ["mirror:unlinked-hard-blocker-gap-pass"],
  }),
  gold({
    caseId: "gm-minor-education-gap",
    resume: { headline: "Frontend Engineer", experience: ["Shipped accessible React products for eight years."] },
    posting: { title: "Frontend Engineer", required: ["Bachelor's degree or equivalent experience"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC", "STRETCH"], mustNotClaim: ["Computer science degree", "degree in"],
    rationale: "Equivalent experience satisfies the requirement; a degree must not be invented.",
    tags: ["mirror:minor-education-gap-not-pass"],
  }),
  gold({
    caseId: "gm-two-required-blockers",
    resume: { headline: "Frontend Engineer", experience: ["Built internationalized web applications."] },
    posting: { title: "Frontend Engineer", required: ["Native Japanese is mandatory", "Example certification required"] },
    expectedBlockers: ["Native Japanese is mandatory", "Example certification required"], expectedVerdicts: ["PASS"], mustNotClaim: ["Japanese", "Example certification"],
    rationale: "Both distinct unmet core requirements must survive as blockers; detecting one is not enough.",
    tags: ["mirror:two-required-blockers-preserved", "recall"],
  }),
  gold({
    caseId: "gm-onsite-location-pass",
    resume: { headline: "Frontend Engineer", experience: ["Shipped React products for six years."], constraints: "Remote only, based outside Example City" },
    posting: { title: "Frontend Engineer", required: ["On-site presence in Example City required"] },
    expectedBlockers: ["On-site presence in Example City required"], expectedVerdicts: ["PASS"], mustNotClaim: ["Example City resident"],
    rationale: "A core location requirement the candidate's constraints contradict is a blocker.",
    tags: ["mirror:mandatory-location-pass"],
  }),
  gold({
    caseId: "gm-preferred-language-not-blocker",
    resume: { headline: "Frontend Engineer", experience: ["Built internationalized web applications."] },
    posting: { title: "Frontend Engineer", required: ["Build web applications"], preferred: ["Business-level Japanese"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC", "STRETCH"], mustNotClaim: ["Japanese"],
    rationale: "A preferred language stays a gap; only core requirements are promoted.",
    tags: ["mirror:important-language-not-promoted"],
  }),
  gold({
    caseId: "gm-korean-required-pass",
    resume: { headline: "Frontend Engineer", experience: ["Built internationalized web applications."], constraints: "Languages: English" },
    posting: { title: "Frontend Engineer", required: ["Fluent Korean required"] },
    expectedBlockers: ["Fluent Korean required"], expectedVerdicts: ["PASS"], mustNotClaim: ["Fluent Korean"],
    rationale: "One requirement, one blocker; a duplicate blocker with and without an id must still be one.",
    tags: ["mirror:duplicate-blocker-deduped"],
  }),
  // --- scope and career-story pairs (B1 A–F contracts, through extraction) ---
  gold({
    caseId: "gm-scope-lead-to-ic",
    resume: frontendLead,
    posting: { title: "Senior Frontend Engineer", required: ["Build React features end to end"], responsibilities: ["Ship product features as an individual contributor"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC"], mustNotClaim: ["ten years"],
    rationale: "A lead moving to an IC role is not a blocker and not automatically a risk.",
    tags: ["scenario:lead-to-ic"],
  }),
  gold({
    caseId: "gm-scope-ic-to-director",
    resume: { headline: "Frontend Engineer", experience: ["Shipped React features for two years as an individual contributor."] },
    posting: { title: "Director of Engineering", required: ["Led an engineering organization of thirty or more"] },
    expectedBlockers: ["Led an engineering organization of thirty or more"], expectedVerdicts: ["PASS", "STRETCH"], mustNotClaim: ["engineering organization", "thirty"],
    rationale: "Demonstrated scope is far narrower than the stated scope; the org-size requirement has no evidence.",
    tags: ["scenario:scope-narrower"],
  }),
  gold({
    caseId: "gm-career-change-data",
    resume: frontendLead,
    posting: { title: "Data Engineer", required: ["Three years of data pipeline engineering required", "SQL"] },
    expectedBlockers: ["Three years of data pipeline engineering required"], expectedVerdicts: ["PASS"], mustNotClaim: ["data pipeline", "SQL"],
    rationale: "A job-family change with an explicit tenure requirement in the new family is a blocker.",
    tags: ["scenario:job-family-change"],
  }),
  gold({
    caseId: "gm-adjacent-platform-role",
    resume: frontendLead,
    posting: { title: "Frontend Platform Engineer", required: ["Maintain a shared design system", "TypeScript"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC", "STRETCH"], mustNotClaim: ["design tokens"],
    rationale: "Platform-team leadership is adjacent evidence for design-system maintenance; TypeScript is direct.",
    tags: ["scenario:adjacent"],
  }),
  gold({
    caseId: "gm-recent-experience-gap",
    resume: { headline: "Engineer returning after a career break", experience: ["Built Angular applications until five years ago.", "Completed a React portfolio project this year."] },
    posting: { title: "Frontend Engineer", required: ["Recent production React experience"] },
    expectedBlockers: [], expectedVerdicts: ["STRETCH", "PASS"], mustNotClaim: ["production React"],
    rationale: "Portfolio work is not recent production experience; a truthful STRETCH beats a fabricated match.",
    tags: ["scenario:recent-experience"],
  }),
  gold({
    caseId: "gm-title-gap-with-evidence",
    resume: { headline: "Software Engineer", experience: ["Acted as tech lead for a four-person frontend team for two years.", "Ran sprint planning and code review for the team."] },
    posting: { title: "Frontend Team Lead", required: ["Lead a frontend team"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC", "STRETCH"], mustNotClaim: ["Engineering Manager"],
    rationale: "Leadership evidence without the formal title is still evidence; the title gap is at most a screening risk.",
    tags: ["scenario:formal-title-gap"],
  }),
  // --- citation cases: several distinct evidence sentences to cite, one requirement each ---
  gold({
    caseId: "gm-citation-typescript-migration",
    resume: frontendLead,
    posting: { title: "Frontend Engineer", required: ["TypeScript strict mode migration experience"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC"], mustNotClaim: ["Flow", "Elm"],
    rationale: "The strict-mode sentence is the evidence and the chunk to cite.",
    tags: ["citation"],
  }),
  gold({
    caseId: "gm-citation-mentoring",
    resume: frontendLead,
    posting: { title: "Staff Engineer", required: ["Mentoring engineers toward promotion"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC"], mustNotClaim: ["hiring manager"],
    rationale: "The mentoring sentence is the evidence; wording differs from the requirement, testing lexical retrieval.",
    tags: ["citation", "retrieval-morphology"],
  }),
  gold({
    caseId: "gm-citation-architecture-reviews",
    resume: frontendLead,
    posting: { title: "Principal Engineer", required: ["Run architecture reviews"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC"], mustNotClaim: ["CTO"],
    rationale: "One exact sentence supports the requirement.",
    tags: ["citation"],
  }),
  gold({
    caseId: "gm-citation-multi-requirement",
    resume: frontendLead,
    posting: { title: "Frontend Lead", required: ["Lead a React team", "TypeScript", "Mentor engineers"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC"], mustNotClaim: ["Go", "Rust"],
    rationale: "Three requirements, three distinct evidence sentences; each match should cite its own chunk.",
    tags: ["citation"],
  }),
  gold({
    caseId: "gm-citation-partial-coverage",
    resume: frontendLead,
    posting: { title: "Frontend Lead", required: ["Lead a React team", "Deploy services on Kubernetes"] },
    expectedBlockers: [], expectedVerdicts: ["STRETCH", "REALISTIC"], mustNotClaim: ["Kubernetes"],
    rationale: "Only one of two requirements has evidence; the other must be a gap with no citation.",
    tags: ["citation"],
  }),
  // --- extraction edge cases ---
  gold({
    caseId: "gm-no-employer-named",
    resume: frontendLead,
    posting: { title: "Frontend Lead", required: ["Lead a React team"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC"], mustNotClaim: ["ten years"],
    rationale: "The posting names no employer; extraction must not invent one (checked as an extraction outcome).",
    tags: ["extraction:no-employer"],
  }),
  gold({
    caseId: "gm-many-requirements",
    resume: frontendLead,
    posting: { title: "Frontend Lead", required: ["Lead a React team", "TypeScript", "Node.js services", "End-to-end testing with Playwright", "Mentor engineers", "Run architecture reviews"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC"], mustNotClaim: ["Rust"],
    rationale: "Six requirements test requirement matching and retrieval breadth, not just the verdict.",
    tags: ["extraction:many-requirements"],
  }),
  gold({
    caseId: "gm-preferred-only-posting",
    resume: frontendLead,
    posting: { title: "Frontend Engineer", required: ["Build web applications"], preferred: ["GraphQL", "Design systems", "Public speaking"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC"], mustNotClaim: ["public speaking", "GraphQL"],
    rationale: "Three preferred items with no evidence are gaps at most; the single core requirement is met.",
    tags: ["extraction:preferred"],
  }),
  gold({
    caseId: "gm-korean-posting",
    resume: { headline: "프론트엔드 리드", experience: ["6명 규모의 React 플랫폼 팀을 3년간 이끌었다.", "TypeScript strict 모드를 열두 개 패키지에 도입했다."], skills: ["React", "TypeScript"] },
    posting: { title: "프론트엔드 엔지니어링 리드", required: ["React 팀을 이끈 경험"], preferred: ["TypeScript 마이그레이션 경험"] },
    expectedBlockers: [], expectedVerdicts: ["REALISTIC", "STRETCH"], mustNotClaim: ["10년"],
    rationale: "Korean text exercises extraction and the space-only tokenizer; the verdict set is wide on purpose.",
    tags: ["language:ko", "retrieval-morphology"],
  }),
  gold({
    caseId: "gm-contradictory-constraint",
    resume: { headline: "Frontend Engineer", experience: ["Shipped React products for six years."], constraints: "Not able to relocate" },
    posting: { title: "Frontend Engineer", required: ["Relocation to Example City required"] },
    expectedBlockers: ["Relocation to Example City required"], expectedVerdicts: ["PASS"], mustNotClaim: ["willing to relocate"],
    rationale: "A stated constraint that contradicts a core requirement is a blocker.",
    tags: ["extraction:constraints"],
  }),
  gold({
    caseId: "gm-years-not-family-years",
    resume: { headline: "Software Engineer with ten years of experience", experience: ["Built backend services in Java for eight years.", "Built a React admin panel for the last two years."] },
    posting: { title: "Senior Frontend Engineer", required: ["Five years of frontend engineering"] },
    expectedBlockers: [], expectedVerdicts: ["STRETCH", "PASS"], mustNotClaim: ["five years of frontend", "ten years of frontend"],
    rationale: "Required years in a job family are not total career years; two frontend years do not become five.",
    tags: ["scenario:family-years"],
  }),
];
