import { createHash } from "node:crypto";
import {
  CandidateProfileSchema, EvidenceChunkSchema,
  type CandidateProfile, type EvidenceChunk, type EvidenceSourceType,
} from "@career-radar/shared";
import { canonical } from "../assessment/input-identity.js";

// M5-A chunkers. Two granularities over the same inputs:
// - "field": one chunk per profile field (a role's evidence list is one chunk) or per document
//   section (a paragraph).
// - "sentence": one chunk per profile leaf string (the B1-locatable evidence sentences) or per
//   document sentence.
// Chunk ids are content hashes over provenance and text, so the same corpus yields the same ids on
// every run and a citation cannot name a chunk that was not built for the run.
export const CHUNK_ID_VERSION = "evidence-chunk-v1";
export const MAX_CHUNK_CHARS = 2000;
export const CHUNKERS = ["field", "sentence"] as const;
export type Chunker = (typeof CHUNKERS)[number];

export type EvidenceDocument = {
  sourceType: Exclude<EvidenceSourceType, "profile">;
  sourceId: string;
  text: string;
  metadata?: Record<string, string>;
};

export function chunkId(chunk: Omit<EvidenceChunk, "id" | "metadata">): string {
  const { sourceType, sourceId, locator, text } = chunk;
  return createHash("sha256")
    .update(`${CHUNK_ID_VERSION}\n${canonical({ sourceType, sourceId, locator, text })}`)
    .digest("hex");
}

// Naive and documented: a sentence ends at ".", "!" or "?" followed by whitespace. Abbreviations
// such as "e.g." split; the synthetic corpus avoids them and the split is deterministic either way.
export function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

// A section is a paragraph (blank-line separated). Heading-only paragraphs (`# Title`) are dropped:
// they are labels, not evidence. Line breaks inside a paragraph are spaces.
export function splitSections(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p && !/^#{1,6}\s/.test(p));
}

function build(base: Omit<EvidenceChunk, "id">): EvidenceChunk {
  return EvidenceChunkSchema.parse({ ...base, id: chunkId(base) });
}

// Texts above MAX_CHUNK_CHARS are split at sentence boundaries into parts (`<locator>/part:<n>`);
// a single sentence longer than the limit is cut at the limit. Both cases are explicit in the locator.
function bounded(base: Omit<EvidenceChunk, "id">): EvidenceChunk[] {
  if (base.text.length <= MAX_CHUNK_CHARS) return [build(base)];
  const parts: string[] = [];
  let current = "";
  for (const sentence of splitSentences(base.text)) {
    const pieces = sentence.length > MAX_CHUNK_CHARS
      ? Array.from({ length: Math.ceil(sentence.length / MAX_CHUNK_CHARS) }, (_, i) => sentence.slice(i * MAX_CHUNK_CHARS, (i + 1) * MAX_CHUNK_CHARS))
      : [sentence];
    for (const piece of pieces) {
      if (current && `${current} ${piece}`.length > MAX_CHUNK_CHARS) { parts.push(current); current = piece; }
      else current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts.map((text, index) => build({ ...base, locator: `${base.locator}/part:${index}`, text }));
}

const FLAT_FIELDS = ["skills", "domains", "leadership", "customerFacing", "aiEvidence", "cloudEvidence"] as const;

// Profile chunks cover exactly the leaves the B1 locator grammar can resolve (`located()` in
// screening.ts): headline, the flat evidence arrays, role titles, responsibilities and evidence.
// Constraints and yearsExperience are policy inputs, not evidence sentences, and are not chunked.
export function chunkProfile(input: CandidateProfile, chunker: Chunker): EvidenceChunk[] {
  const profile = CandidateProfileSchema.parse(input);
  const sourceId = `profile:${profile.id}`;
  const piece = (locator: string, text: string) => bounded({ sourceType: "profile", sourceId, locator, text });
  const list = (locator: string, items: string[]) =>
    chunker === "field"
      ? (items.length ? piece(locator, items.join(" ")) : [])
      : items.flatMap((text, index) => piece(`${locator}[${index}]`, text));
  return [
    ...piece("headline", profile.headline),
    ...FLAT_FIELDS.flatMap((field) => list(field, profile[field])),
    ...profile.roles.flatMap((role, index) => [
      ...piece(`roles[${index}].title`, role.title),
      ...list(`roles[${index}].responsibilities`, role.responsibilities),
      ...list(`roles[${index}].evidence`, role.evidence),
    ]),
  ];
}

export function chunkDocument(document: EvidenceDocument, chunker: Chunker): EvidenceChunk[] {
  const { sourceType, sourceId, metadata } = document;
  return splitSections(document.text).flatMap((section, s) => {
    const base = { sourceType, sourceId, ...(metadata ? { metadata } : {}) };
    if (chunker === "field") return bounded({ ...base, locator: `section:${s}`, text: section });
    return splitSentences(section).flatMap((sentence, i) => bounded({ ...base, locator: `section:${s}/sentence:${i}`, text: sentence }));
  });
}
