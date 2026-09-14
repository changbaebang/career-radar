import { describe, expect, it } from "vitest";
import { FitAssessmentSchema, type CandidateProfile, type Citation, type FitAssessment } from "@career-radar/shared";
import { CITATION_INVALID_DROPPED, CITATION_ORPHAN_DROPPED, CITATION_REKEYED, validateCitations } from "../src/domain/assessment/citations.js";
import { matchClaimId, requirementClaimId } from "../src/domain/assessment/claims.js";
import { finalizeAssessment } from "../src/domain/assessment/pipeline.js";
import { applyAssessmentPolicy } from "../src/domain/assessment/policy.js";
import { chunkId, chunkProfile } from "../src/domain/evidence/chunk.js";
import { retrieveEvidence } from "../src/domain/evidence/retrieve.js";
import { groundedAssessment } from "./discovery-fixtures.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";

const evidence = retrieveEvidence(syntheticProfile, syntheticJob);
const ledChunk = evidence.chunks.find((chunk) => chunk.locator === "roles[0].evidence[0]")!;
// A retrieved chunk that is not the match sentence (the "Frontend Lead" headline/title): with k = 3 the
// skills[0] chunk ("React") is not retrieved for this job, which is itself the point of trace-scoped ids.
const otherChunk = evidence.chunks.find((chunk) => chunk.text !== "Led a React platform team")!;
const match = groundedAssessment.strongestMatches[0]!;
const matchId = matchClaimId(match);
const chunkRef = (id: string, quote: string) => ({ source: "evidence" as const, path: `chunk:${id}`, quote });
const withCitations = (citations: Citation[], overrides: Partial<FitAssessment> = {}): FitAssessment =>
  FitAssessmentSchema.parse({ ...groundedAssessment, confidence: "high", citations, ...overrides });

describe("M5-B citation validator (this run's retrieval trace, exact quotes, fail closed)", () => {
  it("retrieves the profile sentences the match evidence comes from", () => {
    expect(ledChunk.text).toBe(match.evidence);
    expect(otherChunk.text).toBe("Frontend Lead");
    expect(evidence.chunks.some((chunk) => chunk.locator === "skills[0]")).toBe(false);
  });

  it("keeps a citation whose chunk was retrieved in this run and whose quote equals the chunk text", () => {
    const input = withCitations([{ claimId: matchId, ref: chunkRef(ledChunk.id, "  led a React platform team.  ") }]);
    const result = validateCitations(syntheticProfile, syntheticJob, input, evidence);
    expect(result).toEqual(input);
    expect(result.confidence).toBe("high");
  });

  it.each([
    ["nonexistent chunk id", chunkRef("0".repeat(64), ledChunk.text)],
    ["quote taken from another chunk", chunkRef(otherChunk.id, ledChunk.text)],
    ["quote altered by one negation", chunkRef(ledChunk.id, "Never led a React platform team")],
    ["chunk id from another run's corpus with its exact text", (() => {
      const other: CandidateProfile = { ...syntheticProfile, id: "profile_other", roles: [{ ...syntheticProfile.roles[0]!, evidence: ["Led a React platform team"] }] };
      const foreign = chunkProfile(other, "sentence").find((chunk) => chunk.locator === "roles[0].evidence[0]")!;
      expect(foreign.id).not.toBe(ledChunk.id);
      return chunkRef(foreign.id, foreign.text);
    })()],
    ["evidence source with a candidate path", { source: "evidence" as const, path: "roles[0].evidence[0]", quote: ledChunk.text }],
    ["candidate path that does not exist", { source: "candidate" as const, path: "roles[3].evidence[0]", quote: ledChunk.text }],
  ])("drops a citation with a %s, says so once, and lowers confidence without touching the fit", (_label, ref) => {
    const input = withCitations([{ claimId: matchId, ref }]);
    const result = validateCitations(syntheticProfile, syntheticJob, input, evidence);
    expect(result.citations).toEqual([]);
    expect(result.confidence).toBe("low");
    expect(result.missingInformation.filter((note) => note === CITATION_INVALID_DROPPED)).toHaveLength(1);
    expect(result.missingInformation.join(" ")).not.toContain("Never led");
    expect({ ...result, citations: undefined, confidence: undefined, missingInformation: undefined })
      .toEqual({ ...input, citations: undefined, confidence: undefined, missingInformation: undefined });
  });

  it("fails closed for every chunk citation when the run has no retrieval trace", () => {
    const input = withCitations([{ claimId: matchId, ref: chunkRef(ledChunk.id, ledChunk.text) }]);
    expect(validateCitations(syntheticProfile, syntheticJob, input).citations).toEqual([]);
    expect(finalizeAssessment(syntheticProfile, syntheticJob, input).citations).toEqual([]);
    expect(finalizeAssessment(syntheticProfile, syntheticJob, input, evidence).citations).toHaveLength(1);
  });

  it("validates candidate and job citations through the B1 locator grammar", () => {
    const input = withCitations([
      { claimId: matchId, ref: { source: "candidate", path: "roles[0].evidence[0]", quote: "Led a React platform team" } },
      { claimId: matchId, ref: { source: "job", path: "required[0].text", quote: "Lead a React team" } },
      { claimId: matchId, ref: { source: "job", path: "roles[0].evidence[0]", quote: "Led a React platform team" } },
    ]);
    const result = validateCitations(syntheticProfile, syntheticJob, input, evidence);
    expect(result.citations?.map((c) => c.ref.source)).toEqual(["candidate", "job"]);
    expect(result.confidence).toBe("low");
  });

  it("drops a citation whose claim is not in the result, without lowering confidence", () => {
    const input = withCitations([{ claimId: "req:missing", ref: chunkRef(ledChunk.id, ledChunk.text) }]);
    const result = validateCitations(syntheticProfile, syntheticJob, input, evidence);
    expect(result.citations).toEqual([]);
    expect(result.confidence).toBe("high");
    expect(result.missingInformation).toContain(CITATION_ORPHAN_DROPPED);
    expect(result.missingInformation).not.toContain(CITATION_INVALID_DROPPED);
  });

  it("leaves a result without citations untouched (pre-M5-B snapshots)", () => {
    const input = FitAssessmentSchema.parse({ ...groundedAssessment });
    expect(input.citations).toBeUndefined();
    expect(validateCitations(syntheticProfile, syntheticJob, input, evidence)).toEqual(input);
    expect(finalizeAssessment(syntheticProfile, syntheticJob, input, evidence).citations).toBeUndefined();
  });
});

describe("M5-B citations follow the M1 policy's rewrites", () => {
  it("a removed ungrounded match takes its citation with it; the valid match keeps its own", () => {
    const invented = { ...match, evidence: "Led a React platform team and shipped a compiler" };
    const draft = withCitations([
      { claimId: matchClaimId(invented), ref: chunkRef(ledChunk.id, ledChunk.text) },
      { claimId: matchId, ref: chunkRef(ledChunk.id, ledChunk.text) },
    ], { strongestMatches: [invented, match] });
    const result = applyAssessmentPolicy(syntheticProfile, syntheticJob, draft);
    expect(result.strongestMatches).toEqual([match]);
    expect(result.citations).toEqual([{ claimId: matchId, ref: chunkRef(ledChunk.id, ledChunk.text) }]);
    expect(result.missingInformation).toContain(CITATION_ORPHAN_DROPPED);
    expect(result.missingInformation).not.toContain(CITATION_REKEYED);
  });

  it("re-keys the citations of a collapsed ID-less blocker to the surviving gap with an ID", () => {
    const gap = { requirementId: "req_1", requirement: "Lead a React team", reason: "No lead evidence", severity: "hard_blocker" as const };
    const blocker = { requirement: "lead a react team.", reason: "Model blocker", severity: "hard_blocker" as const };
    const draft = withCitations([
      { claimId: requirementClaimId(gap), ref: chunkRef(ledChunk.id, ledChunk.text) },
      { claimId: requirementClaimId(blocker), ref: chunkRef(otherChunk.id, otherChunk.text) },
    ], { strongestMatches: [], gaps: [gap], hardBlockers: [blocker], verdict: "STRETCH" });
    expect(requirementClaimId(blocker)).toBe("text:lead a react team");
    const result = applyAssessmentPolicy(syntheticProfile, syntheticJob, draft);
    expect(result.hardBlockers).toHaveLength(1);
    expect(result.hardBlockers[0]!.requirementId).toBe("req_1");
    expect(result.citations?.map((c) => c.claimId)).toEqual(["req:req_1", "req:req_1"]);
    expect(result.citations?.map((c) => c.ref.path)).toEqual([`chunk:${ledChunk.id}`, `chunk:${otherChunk.id}`]);
    expect(result.missingInformation).toContain(CITATION_REKEYED);
    expect(result.missingInformation).not.toContain(CITATION_ORPHAN_DROPPED);
    // Then the validator resolves both against this run's trace.
    expect(finalizeAssessment(syntheticProfile, syntheticJob, draft, evidence).citations).toHaveLength(2);
  });

  it("keeps a promoted gap's citation under the same id in gaps and hardBlockers", () => {
    const gap = { requirementId: "req_1", requirement: "Lead a React team", reason: "No lead evidence", severity: "hard_blocker" as const };
    const draft = withCitations([{ claimId: "req:req_1", ref: chunkRef(ledChunk.id, ledChunk.text) }], { strongestMatches: [], gaps: [gap], hardBlockers: [], verdict: "STRETCH" });
    const result = applyAssessmentPolicy(syntheticProfile, syntheticJob, draft);
    expect(result.verdict).toBe("PASS");
    expect(result.citations).toEqual(draft.citations);
    expect(result.missingInformation).not.toContain(CITATION_REKEYED);
  });
});

describe("M5-B chunk ids are content hashes, membership is the trace's job", () => {
  it("computes the same id for the same chunk anywhere, which is why the validator checks the trace", () => {
    const { id: _id, metadata: _m, ...base } = ledChunk;
    void _id; void _m;
    expect(chunkId(base)).toBe(ledChunk.id);
  });
});
