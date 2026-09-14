import { describe, expect, it } from "vitest";
import type { EvidenceChunk } from "@career-radar/shared";
import { chunkId } from "../src/domain/evidence/chunk.js";
import { EvidenceIndex, SCORER_VERSION, TOKENIZER_VERSION, tokenize } from "../src/domain/evidence/lexical.js";

function chunk(locator: string, text: string, sourceId = "synthetic:t"): EvidenceChunk {
  const base = { sourceType: "synthetic" as const, sourceId, locator, text };
  return { ...base, id: chunkId(base) };
}

describe("M5-A tokenizer", () => {
  it("lower-cases, NFKC-normalizes, splits on non-letters/digits, keeps numbers, no stop words", () => {
    expect(tokenize("Node.js/TypeScript, React! 12 years")).toEqual(["node", "js", "typescript", "react", "12", "years"]);
    expect(tokenize("Ｒｅａｃｔ　ＮａｔｉｖＥ")).toEqual(["react", "native"]);
    expect(tokenize("리액트 경험과 TypeScript.")).toEqual(["리액트", "경험과", "typescript"]);
    expect(tokenize("a the of")).toEqual(["a", "the", "of"]);
    expect(tokenize("   ")).toEqual([]);
    expect([TOKENIZER_VERSION, SCORER_VERSION]).toEqual(["lexical-tokenizer-v1", "bm25-v1"]);
  });
});

describe("M5-A BM25 index", () => {
  const chunks = [
    chunk("a", "Built the React checkout and payment pages."),
    chunk("b", "Maintained the Node.js backend service."),
    chunk("c", "Led a platform team of six engineers."),
    chunk("d", "A React Native app shows predictions to field testers."),
  ];
  const index = new EvidenceIndex(chunks);

  it("ranks chunks containing the exact term first and reports absent terms as misses", () => {
    const trace = index.search("React checkout", 3);
    expect(trace.k).toBe(3);
    expect(trace.hits[0]!.chunkId).toBe(chunks[0]!.id);
    expect(trace.hits.map((h) => h.rank)).toEqual([1, 2]);
    expect(trace.hits.map((h) => h.chunkId)).toEqual([chunks[0]!.id, chunks[3]!.id]);
    expect(trace.misses).toEqual([]);
    expect(index.search("React kubernetes", 5).misses).toEqual(["kubernetes"]);
  });

  it("is stemming-free: 'engineers' does not match 'engineer' and the miss is explicit", () => {
    const single = new EvidenceIndex([chunk("e", "One engineer on call.")]);
    expect(single.search("engineers", 3)).toEqual({ query: "engineers", k: 3, hits: [], misses: ["engineers"] });
    expect(single.search("engineer", 3).hits).toHaveLength(1);
  });

  it("returns an empty hit list, never a fabricated chunk, when no query term is indexed", () => {
    const trace = index.search("kubernetes terraform", 5);
    expect(trace.hits).toEqual([]);
    expect(trace.misses).toEqual(["kubernetes", "terraform"]);
  });

  it("breaks ties on chunk id and reproduces scores and ranks across index builds", () => {
    const twins = [chunk("x", "Same evidence sentence."), chunk("y", "Same evidence sentence."), chunk("z", "Other text.")];
    const sorted = [...twins.slice(0, 2)].sort((a, b) => (a.id < b.id ? -1 : 1)).map((c) => c.id);
    const first = new EvidenceIndex(twins).search("evidence sentence", 3);
    const second = new EvidenceIndex([...twins].reverse()).search("evidence sentence", 3);
    expect(first.hits.map((h) => h.chunkId)).toEqual(sorted);
    expect(first.hits[0]!.score).toBe(first.hits[1]!.score);
    expect(second.hits).toEqual(first.hits);
  });

  it("deduplicates repeated query terms, truncates to k, and rejects a bad k", () => {
    expect(index.search("react react react", 5).hits[0]!.score).toBe(index.search("react", 5).hits[0]!.score);
    expect(index.search("react node platform", 2).hits).toHaveLength(2);
    expect(() => index.search("react", 0)).toThrow("k must be a positive integer");
    expect(() => index.search("react", 1.5)).toThrow("k must be a positive integer");
  });

  it("scores a rare term above a term present in every chunk", () => {
    const common = [chunk("p", "team alpha"), chunk("q", "team beta"), chunk("r", "team gamma")];
    const scored = new EvidenceIndex(common);
    expect(scored.search("gamma", 3).hits[0]!.score).toBeGreaterThan(scored.search("team", 3).hits[0]!.score);
  });

  it("refuses duplicate chunk ids and exposes size, terms and lookup", () => {
    expect(() => new EvidenceIndex([chunks[0]!, chunks[0]!])).toThrow("Duplicate evidence chunk id");
    expect(index.size).toBe(4);
    expect(index.termCount).toBeGreaterThan(10);
    expect(index.chunk(chunks[2]!.id)?.locator).toBe("c");
    expect(index.chunk("0".repeat(64))).toBeUndefined();
  });
});
