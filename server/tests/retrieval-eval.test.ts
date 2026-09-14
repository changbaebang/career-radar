import { describe, expect, it } from "vitest";
import type { CandidateProfile } from "@career-radar/shared";
import { CHUNKERS, chunkProfile, type EvidenceDocument } from "../src/domain/evidence/chunk.js";
import { corpusDocuments, corpusProfile, CORPUS_VERSION } from "../../evals/fixtures/corpus/index.js";
import { QUERY_SET_VERSION, retrievalQueries, type RetrievalQuery } from "../../evals/fixtures/corpus/queries.js";
import {
  RetrievalReportSchema, buildChunks, recallAtK, resolveRelevance, runRetrievalEvaluation, renderRetrievalMarkdown,
} from "../../evals/retrieval.js";

const metadata = { codeSha: "a".repeat(40), dirty: false };

// A corpus small enough to check by hand.
const tinyProfile: CandidateProfile = {
  id: "tiny", headline: "Frontend engineer", roles: [], skills: ["React", "Terraform"], domains: [],
  leadership: [], customerFacing: [], aiEvidence: [], cloudEvidence: [], sourceHash: "b".repeat(64),
};
const tinyDocument: EvidenceDocument = { sourceType: "project", sourceId: "project:tiny", text: "Ran the React checkout. Wrote Terraform for the CDN." };
const tiny = { version: "tiny-v1", profile: tinyProfile, documents: [tinyDocument] };
const tinyQueries: RetrievalQuery[] = [
  { id: "t1", query: "React", relevant: [
    { sourceId: "profile:tiny", locator: "skills[0]", text: "React" },
    { sourceId: "project:tiny", locator: "section:0/sentence:0", text: "Ran the React checkout." },
  ] },
  { id: "t2", query: "Terraform CDN", relevant: [{ sourceId: "project:tiny", locator: "section:0/sentence:1", text: "Wrote Terraform for the CDN." }] },
];

describe("M5-A Recall@K", () => {
  it("is the share of relevant chunks inside the top K hits, hand-checked", () => {
    expect(recallAtK(["a", "b", "c"], ["b", "x", "a", "y", "c"], 3)).toEqual({ found: 2, relevant: 3, value: 2 / 3 });
    expect(recallAtK(["a", "b", "c"], ["b", "x", "a", "y", "c"], 5)).toEqual({ found: 3, relevant: 3, value: 1 });
    expect(recallAtK(["a"], [], 3)).toEqual({ found: 0, relevant: 1, value: 0 });
  });

  it("resolves a sentence locator to the sentence chunk and to the field chunk that contains it", () => {
    const sentence = buildChunks(tiny, "sentence");
    const field = buildChunks(tiny, "field");
    const sentenceIds = resolveRelevance(tinyQueries[0]!, sentence, sentence);
    const fieldIds = resolveRelevance(tinyQueries[0]!, field, sentence);
    expect(sentenceIds.problems).toEqual([]);
    expect(sentenceIds.ids).toHaveLength(2);
    expect(fieldIds.problems).toEqual([]);
    expect(fieldIds.ids).toEqual([field.find((c) => c.locator === "skills")!.id, field.find((c) => c.locator === "section:0")!.id].sort());
  });

  it("reports dataset problems instead of scoring against a missing or drifted sentence", () => {
    const sentence = buildChunks(tiny, "sentence");
    const missing: RetrievalQuery = { id: "bad", query: "x", relevant: [{ sourceId: "project:tiny", locator: "section:9/sentence:0", text: "nope" }] };
    const drifted: RetrievalQuery = { id: "drift", query: "x", relevant: [{ sourceId: "profile:tiny", locator: "skills[0]", text: "Reacts" }] };
    expect(resolveRelevance(missing, sentence, sentence).problems).toEqual(["bad: no sentence chunk at project:tiny section:9/sentence:0"]);
    expect(resolveRelevance(drifted, sentence, sentence).problems).toEqual(["drift: text drift at profile:tiny skills[0]"]);
    const report = runRetrievalEvaluation(tiny, { version: "tiny-v1", queries: [missing] }, metadata);
    expect(report.success).toBe(false);
    expect(report.problems).toEqual(["bad: no sentence chunk at project:tiny section:9/sentence:0"]);
  });

  it("produces a strict, deterministic report with hand-checked numbers on the tiny corpus", () => {
    const report = runRetrievalEvaluation(tiny, { version: "tiny-v1", queries: tinyQueries }, metadata);
    expect(report).toMatchObject({ reportKind: "retrieval-evaluation", reportVersion: 1, mode: "lexical", modelCalls: 0, queries: 2, deterministic: true, success: true, problems: [] });
    expect(report.chunkers.map((c) => c.chunker)).toEqual([...CHUNKERS]);
    const sentence = report.chunkers.find((c) => c.chunker === "sentence")!;
    // t1: both relevant chunks contain "react" and nothing else does -> 2/2; t2: 1/1. Micro 3/3, macro 1.
    expect(sentence.recall).toEqual([
      { k: 3, micro: { numerator: 3, denominator: 3, value: 1 }, macro: 1 },
      { k: 5, micro: { numerator: 3, denominator: 3, value: 1 }, macro: 1 },
    ]);
    expect(sentence.queriesWithoutHits).toEqual([]);
    expect(() => RetrievalReportSchema.parse({ ...report, extra: 1 })).toThrow();
    expect(renderRetrievalMarkdown(report)).toContain("## Chunker: field");
  });

  it("lists a query whose terms are all unknown as an explicit empty-hit miss", () => {
    const unknown: RetrievalQuery = { id: "u1", query: "kubernetes grafana", relevant: [{ sourceId: "profile:tiny", locator: "skills[1]", text: "Terraform" }] };
    const report = runRetrievalEvaluation(tiny, { version: "tiny-v1", queries: [unknown] }, metadata);
    for (const entry of report.chunkers) {
      expect(entry.queriesWithoutHits).toEqual(["u1"]);
      expect(entry.results[0]).toMatchObject({ hits: [], misses: ["kubernetes", "grafana"], recall: [{ k: 3, found: 0, relevant: 1, value: 0 }, { k: 5, found: 0, relevant: 1, value: 0 }] });
    }
    expect(report.success).toBe(true);
  });

  it("rejects duplicate query ids", () => {
    expect(() => runRetrievalEvaluation(tiny, { version: "tiny-v1", queries: [tinyQueries[0]!, tinyQueries[0]!] }, metadata)).toThrow("Duplicate query ids");
  });
});

describe("M5-A authored corpus and query set", () => {
  it("has at least 30 queries, unique ids, and every relevance entry resolves for both chunkers", () => {
    expect(retrievalQueries.length).toBeGreaterThanOrEqual(30);
    expect(new Set(retrievalQueries.map((q) => q.id)).size).toBe(retrievalQueries.length);
    const report = runRetrievalEvaluation({ version: CORPUS_VERSION, profile: corpusProfile, documents: corpusDocuments }, { version: QUERY_SET_VERSION, queries: retrievalQueries }, metadata);
    expect(report.problems).toEqual([]);
    expect(report).toMatchObject({ deterministic: true, success: true, queries: retrievalQueries.length });
    for (const entry of report.chunkers) for (const result of entry.results) expect(result.relevantChunkIds.length).toBeGreaterThan(0);
  });

  it("keeps the corpus synthetic: distractors are typed synthetic and the profile has no constraints chunk", () => {
    expect(corpusDocuments.filter((d) => d.sourceType === "synthetic").length).toBeGreaterThanOrEqual(3);
    expect(corpusDocuments.every((d) => d.sourceId.startsWith(`${d.sourceType}:`))).toBe(true);
    expect(chunkProfile(corpusProfile, "sentence").some((c) => c.locator.startsWith("constraints"))).toBe(false);
  });
});
