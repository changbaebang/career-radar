import type { CandidateProfile, FitAssessment, JobPosting } from "@career-radar/shared";

export type EvalCase = {
  caseId: string;
  profile: CandidateProfile;
  job: JobPosting;
  draftAssessment: FitAssessment;
  expectedVerdict: FitAssessment["verdict"];
  expectHardBlocker: boolean;
  expectedHardBlockerCount?: number;
  mustNotClaim: string[];
};

function profile(caseId: string, headline: string, evidence: string[]): CandidateProfile {
  return {
    id: `profile_${caseId}`,
    headline,
    roles: [{ company: "Example Company", title: headline, responsibilities: evidence, evidence }],
    skills: [], domains: [], leadership: [], customerFacing: [], aiEvidence: [], cloudEvidence: [],
    sourceHash: "a".repeat(64),
  };
}

function job(caseId: string, title: string, requirement: JobPosting["required"][number]): JobPosting {
  return {
    id: `job_${caseId}`, company: "Example Employer", title,
    description: `${title}: ${requirement.text}`, required: [requirement], preferred: [],
    responsibilities: [], roleFamily: title, domains: [], technologies: [],
  };
}

function assessment(
  verdict: FitAssessment["verdict"],
  evidence: string | null,
  gap: FitAssessment["gaps"][number] | null,
  contortion: FitAssessment["resumeContortion"] = "low",
): FitAssessment {
  return {
    verdict, confidence: "medium", resumeContortion: contortion,
    strongestMatches: evidence === null ? [] : [{
      requirementId: "req_1", requirement: "Core requirement", evidence,
      source: { company: "Example Company" }, strength: "direct",
    }],
    gaps: gap === null ? [] : [gap], hardBlockers: [], interviewRisks: [],
    recommendation: verdict === "PASS" ? "Do not prioritize this role." : "Consider applying with a truthful story.",
    missingInformation: [], modelVersion: "eval-model", promptVersion: "eval-prompt",
  };
}

const gap = (requirement: string, severity: FitAssessment["gaps"][number]["severity"]) => ({
  requirementId: "req_1", requirement, reason: "No direct evidence", severity,
});

export const evalCases: EvalCase[] = [
  {
    caseId: "invented-evidence-extension-rejected",
    profile: profile("inflated", "Frontend Lead", ["Led a React platform team for three years"]),
    job: job("inflated", "Frontend Lead", { id: "req_1", text: "Lead a React team", type: "leadership", importance: "core" }),
    draftAssessment: assessment("REALISTIC", "Led a React platform team for three years and owned company-wide architecture", null),
    expectedVerdict: "STRETCH", expectHardBlocker: false, mustNotClaim: ["owned company-wide architecture"],
  },
  ...[undefined, "preferred_1"].map((requirementId): EvalCase => ({
    caseId: `preferred-hard-blocker-${requirementId ?? "unlinked"}-excluded`,
    profile: profile("preferred", "Frontend Engineer", ["Built reliable React applications"]),
    job: {
      ...job("preferred", "Frontend Engineer", { id: "req_1", text: "Build React applications", type: "technology", importance: "core" }),
      preferred: [{ id: "preferred_1", text: "AWS certification preferred", type: "certification", importance: "nice_to_have" }],
    },
    draftAssessment: {
      ...assessment("REALISTIC", "Built reliable React applications", null),
      gaps: [{ requirementId, requirement: "AWS certification preferred", reason: "Not listed", severity: "hard_blocker" }],
      hardBlockers: [{ requirementId, requirement: "AWS certification preferred", reason: "Not listed", severity: "hard_blocker" }],
    },
    expectedVerdict: "REALISTIC", expectHardBlocker: false, expectedHardBlockerCount: 0, mustNotClaim: ["AWS certified"],
  })),
  {
    caseId: "frontend-lead-realistic",
    profile: profile("frontend", "Frontend Lead", ["Led a React platform team"]),
    job: job("frontend", "Frontend Engineering Lead", { id: "req_1", text: "Lead a React team", type: "leadership", importance: "core" }),
    draftAssessment: assessment("REALISTIC", "Led a React platform team", null),
    expectedVerdict: "REALISTIC", expectHardBlocker: false, mustNotClaim: ["10 years of React"],
  },
  {
    caseId: "solution-architect-stretch",
    profile: profile("sa", "Cloud-facing Application Engineer", ["Advised enterprise customers on Azure application incidents"]),
    job: job("sa", "Solutions Architect", { id: "req_1", text: "Design customer cloud architectures", type: "customer", importance: "core" }),
    draftAssessment: assessment("STRETCH", "Advised enterprise customers on Azure application incidents", gap("Formal solution architecture history", "material"), "medium"),
    expectedVerdict: "STRETCH", expectHardBlocker: false, mustNotClaim: ["AWS architect for five years"],
  },
  {
    caseId: "security-specialist-pass",
    profile: profile("security", "Frontend Engineer", ["Built authentication user interfaces"]),
    job: job("security", "Security Cloud Architect", { id: "req_1", text: "Deep security architecture experience is mandatory", type: "role_experience", importance: "core" }),
    draftAssessment: assessment("STRETCH", "Built authentication user interfaces", gap("Deep security architecture experience", "hard_blocker"), "high"),
    expectedVerdict: "PASS", expectHardBlocker: true, mustNotClaim: ["Led security architecture"],
  },
  {
    caseId: "ai-application-stretch",
    profile: profile("ai", "Application Engineer", ["Built a local LLM evaluation prototype"]),
    job: job("ai", "AI Application Engineer", { id: "req_1", text: "Ship production LLM applications", type: "technology", importance: "core" }),
    draftAssessment: assessment("STRETCH", "Built a local LLM evaluation prototype", gap("Production LLM delivery", "material"), "medium"),
    expectedVerdict: "STRETCH", expectHardBlocker: false, mustNotClaim: ["Production LLM platform owner"],
  },
  {
    caseId: "formal-tpm-pass",
    profile: profile("tpm", "Frontend Lead", ["Coordinated a cross-team frontend migration"]),
    job: job("tpm", "Senior Technical Program Manager", { id: "req_1", text: "Five years of formal TPM ownership required", type: "role_experience", importance: "core" }),
    draftAssessment: assessment("STRETCH", "Coordinated a cross-team frontend migration", gap("Five years of formal TPM ownership", "hard_blocker"), "high"),
    expectedVerdict: "PASS", expectHardBlocker: true, mustNotClaim: ["Five years as a TPM"],
  },
  {
    caseId: "developer-tooling-realistic",
    profile: profile("tooling", "Frontend Platform Engineer", ["Built lint rules and developer workflow automation"]),
    job: job("tooling", "Developer Tooling Engineer", { id: "req_1", text: "Build developer productivity tooling", type: "technology", importance: "core" }),
    draftAssessment: assessment("REALISTIC", "Built lint rules and developer workflow automation", null),
    expectedVerdict: "REALISTIC", expectHardBlocker: false, mustNotClaim: ["Maintained a compiler"],
  },
  {
    caseId: "preferred-certification-not-pass",
    profile: profile("cert", "Cloud Application Engineer", ["Troubleshot Azure applications for customers"]),
    job: {
      ...job("cert", "Cloud Application Engineer", { id: "req_1", text: "Troubleshoot cloud applications", type: "customer", importance: "core" }),
      preferred: [{ id: "preferred_1", text: "AWS certification preferred", type: "certification", importance: "nice_to_have" }],
    },
    draftAssessment: {
      ...assessment("REALISTIC", "Troubleshot Azure applications for customers", null),
      gaps: [{ requirementId: "preferred_1", requirement: "AWS certification preferred", reason: "Not listed", severity: "material" }],
    },
    expectedVerdict: "REALISTIC", expectHardBlocker: false, mustNotClaim: ["AWS certified"],
  },
  {
    caseId: "mandatory-language-pass",
    profile: profile("language", "Frontend Engineer", ["Built internationalized web applications"]),
    job: job("language", "Frontend Engineer", { id: "req_1", text: "Native Japanese is mandatory", type: "language", importance: "core" }),
    draftAssessment: assessment("STRETCH", "Built internationalized web applications", gap("Native Japanese is mandatory", "material")),
    expectedVerdict: "PASS", expectHardBlocker: true, mustNotClaim: ["Native Japanese"],
  },
  {
    // Policy regression: a short claim must not be grounded by a longer profile sentence that merely contains it.
    caseId: "negated-short-claim-not-grounded",
    profile: profile("negated", "Frontend Engineer", ["Never used Kubernetes in production at any point"]),
    job: job("negated", "Platform Engineer", { id: "req_1", text: "Kubernetes", type: "technology", importance: "core" }),
    draftAssessment: assessment("REALISTIC", "Kubernetes", null),
    expectedVerdict: "STRETCH", expectHardBlocker: false, mustNotClaim: ["Kubernetes"],
  },
  {
    // Policy regression: a hard_blocker gap without a matching requirement ID must still force PASS.
    caseId: "unlinked-hard-blocker-gap-pass",
    profile: profile("unlinked", "Frontend Engineer", ["Built authentication user interfaces"]),
    job: job("unlinked", "Security Architect", { id: "req_1", text: "Ten years of security architecture", type: "role_experience", importance: "core" }),
    draftAssessment: {
      ...assessment("REALISTIC", "Built authentication user interfaces", null),
      gaps: [{ requirement: "Ten years of security architecture", reason: "No security architecture history", severity: "hard_blocker" }],
    },
    expectedVerdict: "PASS", expectHardBlocker: true, expectedHardBlockerCount: 1, mustNotClaim: ["Security architect"],
  },
  {
    // Policy regression: a minor gap on a core binary requirement must not be promoted to a hard blocker.
    caseId: "minor-education-gap-not-pass",
    profile: profile("education", "Frontend Engineer", ["Shipped accessible React products for eight years"]),
    job: job("education", "Frontend Engineer", { id: "req_1", text: "Bachelor's degree or equivalent experience", type: "education", importance: "core" }),
    draftAssessment: assessment("REALISTIC", "Shipped accessible React products for eight years", gap("Bachelor's degree", "minor")),
    expectedVerdict: "REALISTIC", expectHardBlocker: false, expectedHardBlockerCount: 0, mustNotClaim: ["Computer science degree"],
  },
  {
    // Policy regression: the same requirement reported without an ID and promoted with an ID must dedupe to one blocker.
    caseId: "duplicate-blocker-deduped",
    profile: profile("duplicate", "Frontend Engineer", ["Built internationalized web applications"]),
    job: job("duplicate", "Frontend Engineer", { id: "req_1", text: "Fluent Korean required", type: "language", importance: "core" }),
    draftAssessment: {
      ...assessment("STRETCH", "Built internationalized web applications", gap("Fluent Korean required", "material")),
      hardBlockers: [{ requirement: "Fluent Korean required", reason: "No Korean evidence", severity: "hard_blocker" }],
    },
    expectedVerdict: "PASS", expectHardBlocker: true, expectedHardBlockerCount: 1, mustNotClaim: ["Fluent Korean"],
  },
];
