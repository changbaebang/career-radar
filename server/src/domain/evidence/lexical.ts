import type { EvidenceChunk } from "@career-radar/shared";

// M5-A lexical retrieval: BM25 over tokenized chunk text, in-process, no service, no model call.
//
// Tokenizer: NFKC-normalized, lower-cased, split on anything that is not a letter or a digit
// (Unicode-aware). No stemming, no stop words: "engineer" and "engineers" are different terms and
// "a"/"the" are indexed like any other term. Korean text splits at spaces and punctuation only.
// These limits are deliberate; the retrieval eval reports where they fail before any embedding
// adapter is considered (M5 plan, A2 gate).
export const TOKENIZER_VERSION = "lexical-tokenizer-v1";
export const SCORER_VERSION = "bm25-v1";

export function tokenize(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export type RetrievalHit = { chunkId: string; score: number; rank: number };
// `misses` lists query terms absent from the index. A query whose terms are all misses returns an
// empty `hits` list: a retrieval miss is explicit, never a fabricated chunk.
export type RetrievalTrace = { query: string; k: number; hits: RetrievalHit[]; misses: string[] };

export type Bm25Options = { k1?: number; b?: number };

type Posting = { chunkIndex: number; termFrequency: number };

export class EvidenceIndex {
  readonly #chunks: EvidenceChunk[];
  readonly #byId = new Map<string, EvidenceChunk>();
  readonly #postings = new Map<string, Posting[]>();
  readonly #lengths: number[];
  readonly #averageLength: number;
  readonly #k1: number;
  readonly #b: number;

  constructor(chunks: EvidenceChunk[], options: Bm25Options = {}) {
    this.#k1 = options.k1 ?? 1.2;
    this.#b = options.b ?? 0.75;
    this.#chunks = [...chunks];
    for (const chunk of this.#chunks) {
      if (this.#byId.has(chunk.id)) throw new Error(`Duplicate evidence chunk id: ${chunk.id}`);
      this.#byId.set(chunk.id, chunk);
    }
    this.#lengths = this.#chunks.map((chunk, chunkIndex) => {
      const terms = tokenize(chunk.text);
      const counts = new Map<string, number>();
      for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
      for (const [term, termFrequency] of counts) {
        const list = this.#postings.get(term) ?? [];
        list.push({ chunkIndex, termFrequency });
        this.#postings.set(term, list);
      }
      return terms.length;
    });
    const total = this.#lengths.reduce((sum, length) => sum + length, 0);
    this.#averageLength = this.#chunks.length ? total / this.#chunks.length : 0;
  }

  get size(): number { return this.#chunks.length; }
  get termCount(): number { return this.#postings.size; }
  chunk(id: string): EvidenceChunk | undefined { return this.#byId.get(id); }
  chunks(): EvidenceChunk[] { return [...this.#chunks]; }

  // Standard BM25 idf: ln(1 + (N - df + 0.5) / (df + 0.5)). Query terms are deduplicated, so a
  // repeated query word does not count twice. Ties break on chunk id (ascending) so ranks are
  // stable across runs and machines.
  search(query: string, k: number): RetrievalTrace {
    if (!Number.isInteger(k) || k < 1) throw new Error("k must be a positive integer");
    const terms = [...new Set(tokenize(query))];
    const misses = terms.filter((term) => !this.#postings.has(term));
    const scores = new Map<number, number>();
    const total = this.#chunks.length;
    for (const term of terms) {
      const postings = this.#postings.get(term);
      if (!postings) continue;
      const idf = Math.log(1 + (total - postings.length + 0.5) / (postings.length + 0.5));
      for (const { chunkIndex, termFrequency } of postings) {
        const length = this.#lengths[chunkIndex] ?? 0;
        const normalized = termFrequency * (this.#k1 + 1)
          / (termFrequency + this.#k1 * (1 - this.#b + this.#b * (this.#averageLength ? length / this.#averageLength : 0)));
        scores.set(chunkIndex, (scores.get(chunkIndex) ?? 0) + idf * normalized);
      }
    }
    const ranked = [...scores.entries()]
      .map(([chunkIndex, score]) => ({ chunkId: this.#chunks[chunkIndex]!.id, score }))
      .sort((a, b) => b.score - a.score || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0))
      .slice(0, k)
      .map((hit, index) => ({ ...hit, rank: index + 1 }));
    return { query, k, hits: ranked, misses };
  }
}
