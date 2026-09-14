import { describe, expect, it } from "vitest";
import type { JobPosting } from "@career-radar/shared";
import { chunkProfile } from "../src/domain/evidence/chunk.js";
import { RETRIEVAL_K, evidenceTextById, retrieveEvidence } from "../src/domain/evidence/retrieve.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";

describe("M5-B pre-retrieval on the assessment path (deterministic, model-free)", () => {
  it("runs every required and preferred requirement text as a query over the profile's sentence chunks", () => {
    const job: JobPosting = { ...syntheticJob, preferred: [{ id: "pref_1", text: "React experience", type: "technology", importance: "nice_to_have" }] };
    const evidence = retrieveEvidence(syntheticProfile, job);
    expect(evidence).toMatchObject({ version: "retrieval-v1", k: RETRIEVAL_K });
    expect(evidence.traces.map((trace) => trace.query)).toEqual(["Lead a React team", "React experience"]);
    for (const trace of evidence.traces) expect(trace.hits.length).toBeLessThanOrEqual(RETRIEVAL_K);
    const corpus = chunkProfile(syntheticProfile, "sentence");
    for (const chunk of evidence.chunks) expect(corpus.some((c) => c.id === chunk.id)).toBe(true);
  });

  it("returns each chunk once, in first-hit order (query order, then rank), and is reproducible", () => {
    const first = retrieveEvidence(syntheticProfile, syntheticJob);
    const second = retrieveEvidence(structuredClone(syntheticProfile), structuredClone(syntheticJob));
    expect(second).toEqual(first);
    const ids = first.chunks.map((chunk) => chunk.id);
    expect(new Set(ids).size).toBe(ids.length);
    const expectedOrder: string[] = [];
    for (const trace of first.traces) for (const hit of trace.hits) if (!expectedOrder.includes(hit.chunkId)) expectedOrder.push(hit.chunkId);
    expect(ids).toEqual(expectedOrder);
    expect(first.chunks.map((chunk) => chunk.text)).toContain("Led a React platform team");
  });

  it("includes local documents when supplied and yields an empty retrieval for a job without requirements", () => {
    const withDocument = retrieveEvidence(syntheticProfile, syntheticJob, [{ sourceType: "project", sourceId: "project:local", text: "Led a React team migration." }]);
    expect(withDocument.chunks.some((chunk) => chunk.sourceId === "project:local")).toBe(true);
    const empty = retrieveEvidence(syntheticProfile, { ...syntheticJob, required: [], preferred: [] });
    expect(empty).toMatchObject({ chunks: [], traces: [] });
    expect(evidenceTextById(empty).size).toBe(0);
    expect(evidenceTextById(undefined).size).toBe(0);
  });

  it("maps retrieved chunk ids to their exact text for the validators", () => {
    const evidence = retrieveEvidence(syntheticProfile, syntheticJob);
    const texts = evidenceTextById(evidence);
    expect(texts.size).toBe(evidence.chunks.length);
    for (const chunk of evidence.chunks) expect(texts.get(chunk.id)).toBe(chunk.text);
  });
});
