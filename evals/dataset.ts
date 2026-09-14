import type { Citation, EvidenceRef, FitAssessment } from "@career-radar/shared";
import { matchClaimId, requirementClaimId } from "../server/src/domain/assessment/claims.js";
import { chunkId } from "../server/src/domain/evidence/chunk.js";
import { retrieveEvidence } from "../server/src/domain/evidence/retrieve.js";
import { evalCases as legacyCases, type EvalCase } from "./fixtures/cases.js";

// v3: M5-B citation cases added (adversarial refs, removed-match and dedup-pair regressions).
export const DATASET_VERSION = "synthetic-policy-v3";
export type PolicyCase = EvalCase & {
  rationale: string;
  provenance: "synthetic-policy-contract";
  humanReview: "pending" | "accepted";
  expectedBlockerIds: string[];
  requiredEvidence: string[];
  skipReason?: string;
  // M5-B: stated only on citation cases (valid citations after policy + validation; output claims without one).
  expectedValidCitations?: number;
  expectedUnsupportedClaims?: number;
};

// Expected required-requirement IDs for the legacy fixtures. Explicit per case; nothing is inferred.
const legacyBlockerIds: Record<string, string[]> = {
  "security-specialist-pass": ["req_1"], "formal-tpm-pass": ["req_1"], "mandatory-language-pass": ["req_1"],
  "unlinked-hard-blocker-gap-pass": ["req_1"], "duplicate-blocker-deduped": ["req_1"],
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

function annotate(fixture: EvalCase, rationale: string, requiredEvidence: string[], expectedBlockerIds: string[]): PolicyCase {
  return { ...fixture, rationale, provenance: "synthetic-policy-contract", humanReview: "pending", expectedBlockerIds, requiredEvidence };
}

function variant(id: string, source: string, rationale: string, change: (fixture: EvalCase) => void,
  requiredEvidence: string[] = [], expectedBlockerIds: string[] = []): PolicyCase {
  const fixture = base(source);
  fixture.caseId = id;
  change(fixture);
  return annotate(fixture, rationale, requiredEvidence, expectedBlockerIds);
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
    }, [], ["req_1"]),
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
    }, [], ["preferred_1"]),
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
    }, [], ["req_1", "req_2"]),
];

// M5-B citation cases. Chunk ids are resolved from the fixture's own deterministic retrieval at
// build time (never hand-copied); a case whose evidence sentence is not retrieved fails loudly.
const chunkRef = (id: string, quote: string): EvidenceRef => ({ source: "evidence", path: `chunk:${id}`, quote });
function retrievedChunk(fixture: EvalCase, text: string) {
  const chunk = retrieveEvidence(fixture.profile, fixture.job).chunks.find((candidate) => candidate.text === text);
  if (!chunk) throw new Error(`Citation case ${fixture.caseId}: '${text}' is not retrieved for its job`);
  return chunk;
}
function cite(fixture: EvalCase, citations: Citation[], expectedValidCitations: number, expectedUnsupportedClaims: number, rationale: string,
  requiredEvidence: string[] = [], expectedBlockerIds: string[] = []): PolicyCase {
  fixture.draftAssessment.citations = citations;
  return { ...annotate(fixture, rationale, requiredEvidence, expectedBlockerIds), expectedValidCitations, expectedUnsupportedClaims };
}
const realisticMatch = () => base("frontend-lead-realistic").draftAssessment.strongestMatches[0]!;
const leadSentence = "Led a React platform team";
const citationCases: PolicyCase[] = [
  (() => {
    const f = base("frontend-lead-realistic"); f.caseId = "citation-valid-chunk-kept";
    const chunk = retrievedChunk(f, leadSentence);
    return cite(f, [{ claimId: matchClaimId(realisticMatch()), ref: chunkRef(chunk.id, chunk.text) }], 1, 0,
      "A citation to a chunk retrieved in this run with the exact chunk text survives policy and validation unchanged.", [leadSentence]);
  })(),
  (() => {
    const f = base("frontend-lead-realistic"); f.caseId = "citation-nonexistent-chunk-dropped";
    return cite(f, [{ claimId: matchClaimId(realisticMatch()), ref: chunkRef("0".repeat(64), leadSentence) }], 0, 1,
      "A chunk id that no run produced is not evidence; the citation is dropped and the claim is unsupported.", [leadSentence]);
  })(),
  (() => {
    const f = base("frontend-lead-realistic"); f.caseId = "citation-quote-from-other-chunk-dropped";
    const other = retrievedChunk(f, "Frontend Lead");
    return cite(f, [{ claimId: matchClaimId(realisticMatch()), ref: chunkRef(other.id, leadSentence) }], 0, 1,
      "A retrieved chunk id with the quote of a different chunk is dropped: quotes must equal the cited chunk's text.", [leadSentence]);
  })(),
  (() => {
    const f = base("frontend-lead-realistic"); f.caseId = "citation-negated-quote-dropped";
    const chunk = retrievedChunk(f, leadSentence);
    return cite(f, [{ claimId: matchClaimId(realisticMatch()), ref: chunkRef(chunk.id, `Never ${leadSentence.charAt(0).toLowerCase()}${leadSentence.slice(1)}`) }], 0, 1,
      "A quote altered by one negation no longer equals the chunk text and is dropped.", [leadSentence]);
  })(),
  (() => {
    const f = base("frontend-lead-realistic"); f.caseId = "citation-chunk-from-other-run-dropped";
    const foreign = chunkId({ sourceType: "profile", sourceId: "profile:someone-else", locator: "roles[0].evidence[0]", text: leadSentence });
    return cite(f, [{ claimId: matchClaimId(realisticMatch()), ref: chunkRef(foreign, leadSentence) }], 0, 1,
      "A content hash computed for another corpus resolves nothing here: membership in this run's trace, not the hash, makes a chunk citable.", [leadSentence]);
  })(),
  (() => {
    const f = base("invented-evidence-extension-rejected"); f.caseId = "citation-removed-match-keeps-valid-one";
    const invented = f.draftAssessment.strongestMatches[0]!;
    const valid = { ...invented, evidence: leadEvidence };
    f.draftAssessment.strongestMatches = [invented, valid];
    f.expectedVerdict = "REALISTIC";
    const chunk = retrievedChunk(f, leadEvidence);
    return cite(f, [
      { claimId: matchClaimId(invented), ref: chunkRef(chunk.id, chunk.text) },
      { claimId: matchClaimId(valid), ref: chunkRef(chunk.id, chunk.text) },
    ], 1, 0, "The removed leading match takes its citation with it; the surviving match keeps its own and no citation moves to another claim.", [leadEvidence]);
  })(),
  (() => {
    const f = base("duplicate-blocker-deduped"); f.caseId = "citation-dedup-pair-rekeyed";
    const candidate: EvidenceRef = { source: "candidate", path: "roles[0].evidence[0]", quote: "Built internationalized web applications" };
    const gap = f.draftAssessment.gaps[0]!;
    const blocker = f.draftAssessment.hardBlockers[0]!;
    return cite(f, [
      { claimId: requirementClaimId(gap), ref: candidate },
      { claimId: requirementClaimId(blocker), ref: { source: "job", path: "required[0].text", quote: "Fluent Korean required" } },
    ], 2, 1, "An ID-less model blocker merged into the promoted gap hands its citation to the surviving req: claim; the uncited match stays unsupported.", [], ["req_1"]);
  })(),
];

// These are explicit policy contracts, not human-reviewed hiring/fit labels.
// New human review remains pending until a person records the review template.
export const policyCases: PolicyCase[] = [
  ...legacyCases.map((fixture) => {
    const rationale = rationales[fixture.caseId];
    if (!rationale) throw new Error(`Missing rationale: ${fixture.caseId}`);
    const validMatches: FitAssessment["strongestMatches"] =
      ["invented-evidence-extension-rejected", "negated-short-claim-not-grounded"].includes(fixture.caseId)
        ? [] : fixture.draftAssessment.strongestMatches;
    return annotate(fixture, rationale, validMatches.map((match) => match.evidence), legacyBlockerIds[fixture.caseId] ?? []);
  }),
  ...newCases,
  ...citationCases,
];
