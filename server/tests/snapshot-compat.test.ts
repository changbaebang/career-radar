import { describe, expect, it } from "vitest";
import { FitAssessmentSchema, type FitAssessment } from "@career-radar/shared";
import { CareerStore } from "../src/domain/store.js";
import { retrieveEvidence } from "../src/domain/evidence/retrieve.js";
import { finalizeAssessment } from "../src/domain/assessment/pipeline.js";
import { matchClaimId } from "../src/domain/assessment/claims.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";

// Literal snapshots as earlier versions wrote them. They must keep parsing and round-tripping
// unchanged: M5-B widened the read contract additively (a new enum value, a new optional field).
const preB2Snapshot = {
  verdict: "STRETCH", confidence: "medium", resumeContortion: "medium", score: 0.65,
  strongestMatches: [{ requirementId: "req_1", requirement: "Lead a React team", evidence: "Led a React platform team", source: { company: "Example Company" }, strength: "direct" }],
  gaps: [{ requirementId: "req_1", requirement: "Lead a React team", reason: "Scope unclear", severity: "material" }],
  hardBlockers: [], interviewRisks: ["Scope"], recommendation: "Consider applying.", missingInformation: [],
  modelVersion: "gpt-synthetic", promptVersion: "milestone-4a",
};
const preBSnapshot = {
  ...preB2Snapshot, score: 65, promptVersion: "milestone-4b2-v2",
  screeningContext: {
    version: "1",
    seniorityFit: { value: "aligned", explanation: "Scope matches.", confidence: "medium", evidence: [
      { source: "candidate", path: "roles[0].evidence[0]", quote: "Led a React platform team" }, { source: "job", path: "required[0].text", quote: "Lead a React team" }] },
    careerStoryRisk: { value: "low", explanation: "Continuous.", confidence: "medium", evidence: [
      { source: "candidate", path: "roles[0].evidence[0]", quote: "Led a React platform team" }, { source: "job", path: "required[0].text", quote: "Lead a React team" }] },
    screeningRisks: [], unknowns: [],
  },
};

describe("M5-B read contract: stored snapshots from before citations", () => {
  it.each([["pre-B2 (no screening context, fractional score)", preB2Snapshot], ["pre-M5-B (B2 context, candidate/job refs)", preBSnapshot]])("parses a %s snapshot unchanged and round-trips it through the store", (_label, snapshot) => {
    const parsed = FitAssessmentSchema.parse(snapshot);
    expect(parsed).toEqual(snapshot);
    expect(parsed.citations).toBeUndefined();
    const store = new CareerStore();
    try {
      store.upsertProfile(syntheticProfile); store.upsertJob(syntheticJob);
      const id = store.saveAssessment(syntheticProfile, syntheticJob, parsed);
      // The stored snapshot is read back through the application flow, as the app does.
      expect(store.saveApplication({ assessmentId: id, status: "saved" }).verdictAtDecision).toBe(snapshot.verdict);
    } finally { store.close(); }
  });

  it("round-trips a new result with an evidence citation and keeps the trace-scoped reference verbatim", () => {
    const evidence = retrieveEvidence(syntheticProfile, syntheticJob);
    const chunk = evidence.chunks.find((c) => c.text === "Led a React platform team")!;
    const draft: FitAssessment = { ...FitAssessmentSchema.parse(preBSnapshot), citations: [
      { claimId: matchClaimId(preBSnapshot.strongestMatches[0]!), ref: { source: "evidence", path: `chunk:${chunk.id}`, quote: chunk.text } },
    ] };
    const final = finalizeAssessment(syntheticProfile, syntheticJob, draft, evidence);
    expect(final.citations).toHaveLength(1);
    expect(FitAssessmentSchema.parse(JSON.parse(JSON.stringify(final)))).toEqual(final);
    const store = new CareerStore();
    try {
      store.upsertProfile(syntheticProfile); store.upsertJob(syntheticJob);
      const id = store.saveAssessment(syntheticProfile, syntheticJob, final);
      expect(store.saveApplication({ assessmentId: id, status: "saved" }).verdictAtDecision).toBe(final.verdict);
    } finally { store.close(); }
  });
});
