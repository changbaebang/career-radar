import type { FitAssessment } from "@career-radar/shared";
import { evalCases as legacyCases, type EvalCase } from "./fixtures/cases.js";

export const DATASET_VERSION = "synthetic-policy-v2";
export type PolicyCase = EvalCase & {
  rationale: string;
  provenance: "synthetic-policy-contract";
  humanReview: "pending" | "accepted";
  expectedBlockerIds: string[];
  requiredEvidence: string[];
  skipReason?: string;
};

const rationales: Record<string, string> = {
  "trailing-period-evidence-grounded": "A trailing period must preserve an otherwise exact evidence sentence.",
  "invented-evidence-extension-rejected": "An invented extension invalidates the sole match; unsupported REALISTIC becomes STRETCH.",
  "preferred-hard-blocker-unlinked-excluded": "A preferred qualification is excluded by its text when no ID is supplied.",
  "preferred-hard-blocker-preferred_1-excluded": "A preferred requirement ID cannot become a hard blocker.",
  "frontend-lead-realistic": "Preserve a supported draft with no blocker and low contortion.",
  "solution-architect-stretch": "Preserve the draft's material role gap and medium-contortion STRETCH; no new expertise is inferred.",
  "security-specialist-pass": "The draft explicitly identifies a core specialist hard blocker; policy must force PASS.",
  "ai-application-stretch": "Prototype evidence does not invent production delivery; preserve the draft's material gap.",
  "formal-tpm-pass": "An explicit specialist-tenure hard blocker forces PASS despite adjacent coordination evidence.",
  "developer-tooling-realistic": "Preserve direct tooling evidence without inventing compiler experience.",
  "preferred-certification-not-pass": "A material preferred-certification gap alone cannot force PASS.",
  "mandatory-language-pass": "Promote a material gap on a core binary language requirement.",
  "negated-short-claim-not-grounded": "A technology name cut from a negative sentence is not an exact evidence match.",
  "unlinked-hard-blocker-gap-pass": "Preserve an explicit unlinked hard blocker; absence of ID must not suppress PASS.",
  "minor-education-gap-not-pass": "A minor gap is not promoted even for a core binary requirement.",
  "duplicate-blocker-deduped": "An unlinked model blocker and a linked promoted gap for the same requirement yield one blocker.",
};

function base(id: string): EvalCase {
  const fixture = legacyCases.find((item) => item.caseId === id);
  if (!fixture) throw new Error(`Missing fixture: ${id}`);
  return structuredClone(fixture);
}

function annotate(fixture: EvalCase, rationale: string, requiredEvidence: string[] = []): PolicyCase {
  return { ...fixture, rationale, provenance: "synthetic-policy-contract", humanReview: "pending",
    expectedBlockerIds: fixture.expectHardBlocker ? ["req_1"] : [], requiredEvidence };
}

function variant(id: string, source: string, rationale: string, change: (fixture: EvalCase) => void,
  requiredEvidence: string[] = []): PolicyCase {
  const fixture = base(source);
  fixture.caseId = id;
  change(fixture);
  return annotate(fixture, rationale, requiredEvidence);
}

const leadEvidence = "Led a React platform team for three years";
const newCases: PolicyCase[] = [
  variant("case-whitespace-evidence-preserved", "trailing-period-evidence-grounded",
    "Case and whitespace changes preserve exact evidence after normalization.", (f) => {
      f.draftAssessment.strongestMatches[0].evidence = "  LED a React   platform team for three years  ";
    }, [leadEvidence]),
  variant("curly-quotes-evidence-preserved", "trailing-period-evidence-grounded",
    "Wrapping quotes and trailing punctuation must not discard a valid sentence.", (f) => {
      f.draftAssessment.strongestMatches[0].evidence = `“${leadEvidence}.”`;
    }, [leadEvidence]),
  variant("positive-production-evidence-control", "negated-short-claim-not-grounded",
    "Normal control: an explicit production statement survives; policy does not ban the technology itself.", (f) => {
      const evidence = "Operated Kubernetes services in production";
      f.profile.roles[0].responsibilities = [evidence]; f.profile.roles[0].evidence = [evidence];
      f.draftAssessment.strongestMatches[0].evidence = evidence;
      f.expectedVerdict = "REALISTIC"; f.mustNotClaim = ["Never used Kubernetes"];
    }, ["Operated Kubernetes services in production"]),
  variant("mixed-evidence-preserves-valid-match", "invented-evidence-extension-rejected",
    "Remove the invented match but preserve the valid one; one bad claim must not erase all support.", (f) => {
      f.draftAssessment.strongestMatches.push({ ...f.draftAssessment.strongestMatches[0], evidence: leadEvidence });
      f.expectedVerdict = "REALISTIC";
    }, [leadEvidence]),
  variant("high-contortion-downgrades-realistic", "frontend-lead-realistic",
    "High contortion changes REALISTIC to STRETCH even with grounded evidence.", (f) => {
      f.draftAssessment.resumeContortion = "high"; f.expectedVerdict = "STRETCH";
    }, ["Led a React platform team"]),
  variant("medium-contortion-keeps-supported-verdict", "frontend-lead-realistic",
    "Normal control: medium contortion alone does not trigger the high-contortion policy.", (f) => {
      f.draftAssessment.resumeContortion = "medium";
    }, ["Led a React platform team"]),
  variant("mandatory-location-pass", "mandatory-language-pass",
    "A material unmet core location requirement is another binary hard blocker.", (f) => {
      f.job.required[0] = { id: "req_1", text: "On-site presence in Example City required", type: "location", importance: "core" };
      f.job.description = f.job.required[0].text;
      f.draftAssessment.gaps[0].requirement = f.job.required[0].text;
    }),
  variant("important-language-not-promoted", "mandatory-language-pass",
    "Only core binary requirements are automatically promoted; an important material gap stays STRETCH.", (f) => {
      f.job.required[0].importance = "important";
      f.expectedVerdict = "STRETCH"; f.expectHardBlocker = false; f.expectedHardBlockerCount = 0;
    }),
  variant("required-certification-control", "preferred-certification-not-pass",
    "Paired requirement change: the same certification gap becomes core/required and must force PASS.", (f) => {
      const certificate = f.job.preferred[0];
      f.job.preferred = []; f.job.required.push({ ...certificate, importance: "core" });
      f.expectedVerdict = "PASS"; f.expectHardBlocker = true;
    }),
  variant("formal-tpm-preferred-control", "formal-tpm-pass",
    "Paired preferred classification removes the explicit blocker; high contortion still prevents REALISTIC.", (f) => {
      f.job.preferred = [{ ...f.job.required[0], importance: "nice_to_have" }]; f.job.required = [];
      f.expectedVerdict = "STRETCH"; f.expectHardBlocker = false; f.expectedHardBlockerCount = 0;
    }),
  variant("prototype-invented-production-claim", "ai-application-stretch",
    "An injected claim of production ownership is absent from prototype evidence and must be removed.", (f) => {
      f.draftAssessment.verdict = "REALISTIC";
      f.draftAssessment.strongestMatches[0].evidence = "Production LLM platform owner";
    }),
  variant("two-required-blockers-preserved", "mandatory-language-pass",
    "Both distinct unmet core requirements must survive; detecting just any blocker is insufficient.", (f) => {
      f.job.required.push({ id: "req_2", text: "Example certification required", type: "certification", importance: "core" });
      f.draftAssessment.gaps.push({ requirementId: "req_2", requirement: "Example certification required", reason: "No certification evidence", severity: "material" });
      f.expectedHardBlockerCount = 2;
    }),
];
newCases.find((f) => f.caseId === "required-certification-control")!.expectedBlockerIds = ["preferred_1"];
newCases.find((f) => f.caseId === "two-required-blockers-preserved")!.expectedBlockerIds = ["req_1", "req_2"];

// These are explicit policy contracts, not human-reviewed hiring/fit labels.
// New human review remains pending until a person records the review template.
export const policyCases: PolicyCase[] = [
  ...legacyCases.map((fixture) => {
    const rationale = rationales[fixture.caseId];
    if (!rationale) throw new Error(`Missing rationale: ${fixture.caseId}`);
    const validMatches: FitAssessment["strongestMatches"] =
      ["invented-evidence-extension-rejected", "negated-short-claim-not-grounded"].includes(fixture.caseId)
        ? [] : fixture.draftAssessment.strongestMatches;
    return annotate(fixture, rationale, validMatches.map((match) => match.evidence));
  }),
  ...newCases,
];
