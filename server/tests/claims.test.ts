import { describe, expect, it } from "vitest";
import { TEXT_HASH_CLAIM_PREFIX, claimIds, matchClaimId, requirementClaimId } from "../src/domain/assessment/claims.js";
import { groundedAssessment } from "./discovery-fixtures.js";

describe("M5-B claim ids", () => {
  const base = { requirementId: "req_1", requirement: "Lead a React team", evidence: "Led a React platform team" };

  it("hashes match claims over a serialized tuple: same requirement, different evidence → different ids", () => {
    const a = matchClaimId(base);
    const b = matchClaimId({ ...base, evidence: "Mentored three engineers" });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
    // The string-concatenation formula (kind + requirementId ?? text + ...) collapsed these to one id.
    expect(matchClaimId(base)).toBe(a);
  });

  it("keeps ID-less matches on different requirement text apart, and normalizes text", () => {
    const first = matchClaimId({ requirement: "Lead a React team", evidence: "Led a React platform team" });
    const second = matchClaimId({ requirement: "Mentor engineers", evidence: "Led a React platform team" });
    expect(first).not.toBe(second);
    expect(matchClaimId({ requirement: "  LEAD a React   team.", evidence: "“Led a React platform team.”" })).toBe(first);
    // A null-vs-absent requirementId is one claim; an ID is not confused with the text of another claim.
    expect(matchClaimId({ requirementId: "req_1", requirement: "x", evidence: "y" })).not.toBe(matchClaimId({ requirement: "req_1", evidence: "y" }));
  });

  it("keys requirement claims by requirement id, else by normalized text, so promotion does not change them", () => {
    expect(requirementClaimId({ requirementId: "req_1", requirement: "Anything" })).toBe("req:req_1");
    expect(requirementClaimId({ requirement: "Deep security architecture experience." })).toBe("text:deep security architecture experience");
    expect(requirementClaimId({ requirementId: "req_1", requirement: "A" })).toBe(requirementClaimId({ requirementId: "req_1", requirement: "B" }));
  });

  it("falls back to a hashed text key when the normalized requirement would not fit the claim id bound", () => {
    const long = requirementClaimId({ requirement: "r".repeat(196) });
    expect(long.startsWith(TEXT_HASH_CLAIM_PREFIX)).toBe(true);
    expect(long.length).toBeLessThanOrEqual(200);
    expect(requirementClaimId({ requirement: "r".repeat(196) })).toBe(long);
    expect(requirementClaimId({ requirement: "r".repeat(197) })).not.toBe(long);
    expect(requirementClaimId({ requirement: "r".repeat(195) })).toBe(`text:${"r".repeat(195)}`);
  });

  it("collects every claim id a result carries, across matches, gaps and blockers", () => {
    const ids = claimIds({ ...groundedAssessment, gaps: [{ requirementId: "req_9", requirement: "X", reason: "r", severity: "material" }],
      hardBlockers: [{ requirement: "Certification required", reason: "r", severity: "hard_blocker" }] });
    expect(ids.has("req:req_9")).toBe(true);
    expect(ids.has("text:certification required")).toBe(true);
    expect([...ids].some((id) => /^[a-f0-9]{64}$/.test(id))).toBe(groundedAssessment.strongestMatches.length > 0);
  });
});
