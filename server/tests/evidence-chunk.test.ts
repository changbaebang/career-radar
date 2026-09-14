import { describe, expect, it } from "vitest";
import { EvidenceChunkSchema, type CandidateProfile } from "@career-radar/shared";
import {
  CHUNK_ID_VERSION, MAX_CHUNK_CHARS, chunkDocument, chunkId, chunkProfile, splitSections, splitSentences,
} from "../src/domain/evidence/chunk.js";
import { corpusDocuments, corpusProfile } from "../../evals/fixtures/corpus/index.js";

// The B1 candidate locator grammar (located() in screening.ts). Sentence-level profile chunks must
// stay inside it so M5-B can relate a chunk to a candidate path.
const B1_LOCATOR = /^(headline|(skills|domains|leadership|customerFacing|aiEvidence|cloudEvidence)\[\d+\]|roles\[\d+\]\.(title|(responsibilities|evidence)\[\d+\]))$/;

describe("M5-A profile chunker", () => {
  it("field level: one chunk per field, role lists joined; sentence level: one chunk per leaf", () => {
    const field = chunkProfile(corpusProfile, "field");
    const sentence = chunkProfile(corpusProfile, "sentence");
    // headline + 6 flat fields + 3 roles x (title, responsibilities, evidence)
    expect(field).toHaveLength(16);
    // headline + 10 skills + 3 domains + 2 leadership + 1 + 1 + 1 + roles (7 + 6 + 3)
    expect(sentence).toHaveLength(35);
    expect(field.find((c) => c.locator === "roles[1].evidence")?.text)
      .toBe(corpusProfile.roles[1]!.evidence.join(" "));
    expect(sentence.find((c) => c.locator === "roles[1].evidence[2]")?.text).toBe(corpusProfile.roles[1]!.evidence[2]);
    for (const chunk of sentence) expect(chunk.locator).toMatch(B1_LOCATOR);
    for (const chunk of [...field, ...sentence]) expect(() => EvidenceChunkSchema.parse(chunk)).not.toThrow();
  });

  it("does not chunk constraints or yearsExperience (policy inputs, not evidence sentences)", () => {
    const texts = chunkProfile(corpusProfile, "sentence").map((c) => c.text);
    expect(texts).not.toContain("Seoul");
    expect(texts).not.toContain("hybrid");
    expect(texts.some((t) => /\b12\b/.test(t))).toBe(false);
  });

  it("ids are content hashes: stable across runs, unique, and sensitive to text and provenance", () => {
    const first = chunkProfile(corpusProfile, "sentence");
    const second = chunkProfile(structuredClone(corpusProfile), "sentence");
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
    expect(new Set(first.map((c) => c.id)).size).toBe(first.length);
    for (const chunk of first) expect(chunk.id).toMatch(/^[a-f0-9]{64}$/);
    const edited: CandidateProfile = structuredClone(corpusProfile);
    edited.skills[0] = "Reacts";
    const changed = chunkProfile(edited, "sentence");
    const diff = changed.filter((c, i) => c.id !== first[i]!.id);
    expect(diff.map((c) => c.locator)).toEqual(["skills[0]"]);
    const base = { sourceType: "profile" as const, sourceId: "profile:x", locator: "headline", text: "Same text" };
    expect(chunkId(base)).not.toBe(chunkId({ ...base, sourceId: "profile:y" }));
    expect(chunkId(base)).not.toBe(chunkId({ ...base, locator: "skills[0]" }));
    expect(CHUNK_ID_VERSION).toBe("evidence-chunk-v1");
  });

  it("skips empty lists at field level instead of emitting an empty chunk", () => {
    const sparse: CandidateProfile = { ...structuredClone(corpusProfile), aiEvidence: [], cloudEvidence: [], roles: [] };
    const locators = chunkProfile(sparse, "field").map((c) => c.locator);
    expect(locators).toEqual(["headline", "skills", "domains", "leadership", "customerFacing"]);
  });
});

describe("M5-A document chunker", () => {
  it("splits paragraphs into sections, drops heading-only paragraphs, and sentences on . ! ?", () => {
    expect(splitSections("# Title\n\nFirst para line one\nline two.\n\n\n## Sub\n\nSecond para."))
      .toEqual(["First para line one line two.", "Second para."]);
    expect(splitSentences("One. Two! Three? Four")).toEqual(["One.", "Two!", "Three?", "Four"]);
    expect(splitSentences("  spaced   out.  ")).toEqual(["spaced out."]);
  });

  it("produces section and sentence locators, carries metadata, and keeps documents apart", () => {
    const document = corpusDocuments[0]!;
    const sections = chunkDocument(document, "field");
    const sentences = chunkDocument(document, "sentence");
    expect(sections.map((c) => c.locator)).toEqual(["section:0", "section:1"]);
    expect(sentences.map((c) => c.locator)).toEqual([
      "section:0/sentence:0", "section:0/sentence:1", "section:0/sentence:2", "section:1/sentence:0", "section:1/sentence:1",
    ]);
    expect(sections[0]!.text).toBe(sentences.slice(0, 3).map((c) => c.text).join(" "));
    for (const chunk of [...sections, ...sentences]) {
      expect(chunk).toMatchObject({ sourceType: "project", sourceId: "project:design-system", metadata: { title: "Shared design system" } });
    }
    expect(chunkDocument({ sourceType: "blog", sourceId: "blog:empty", text: "# Only a heading\n\n" }, "field")).toEqual([]);
    const all = corpusDocuments.flatMap((d) => chunkDocument(d, "sentence"));
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it("splits text above the chunk limit at sentence boundaries with explicit part locators", () => {
    const sentence = "This sentence has exactly fifty characters in it!!";
    expect(sentence).toHaveLength(50);
    const text = Array.from({ length: 90 }, () => sentence).join(" "); // 4589 chars, one paragraph
    const parts = chunkDocument({ sourceType: "synthetic", sourceId: "synthetic:long", text }, "field");
    expect(parts.map((c) => c.locator)).toEqual(["section:0/part:0", "section:0/part:1", "section:0/part:2"]);
    for (const part of parts) {
      expect(part.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(part.text.endsWith("!!")).toBe(true);
    }
    expect(parts.map((c) => c.text).join(" ")).toBe(text);
    const unbroken = "x".repeat(MAX_CHUNK_CHARS + 500);
    const cut = chunkDocument({ sourceType: "synthetic", sourceId: "synthetic:unbroken", text: unbroken }, "sentence");
    expect(cut.map((c) => [c.locator, c.text.length])).toEqual([["section:0/sentence:0/part:0", MAX_CHUNK_CHARS], ["section:0/sentence:0/part:1", 500]]);
  });
});
