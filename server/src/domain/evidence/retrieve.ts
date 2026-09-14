import type { CandidateProfile, EvidenceChunk, JobPosting } from "@career-radar/shared";
import { chunkDocument, chunkProfile, type EvidenceDocument } from "./chunk.js";
import { EvidenceIndex, type RetrievalTrace } from "./lexical.js";

// M5-B pre-retrieval on the assessment path. Deterministic and model-free: before the model is
// called, the job's requirement texts are run as queries over the candidate's evidence corpus
// (the profile's sentence-level chunks, plus any local documents the caller supplies), and the
// union of hits is what the model may cite. The trace of this run is the only thing a
// `chunk:<id>` citation resolves against (screening.ts); a hash alone proves nothing.
export const RETRIEVAL_K = 3;

export type RetrievedEvidence = {
  version: "retrieval-v1";
  k: number;
  // Retrieved chunks in first-hit order (query order, then rank), each id once.
  chunks: EvidenceChunk[];
  traces: RetrievalTrace[];
};

export function retrieveEvidence(profile: CandidateProfile, job: JobPosting, documents: EvidenceDocument[] = [], k = RETRIEVAL_K): RetrievedEvidence {
  const corpus = [...chunkProfile(profile, "sentence"), ...documents.flatMap((document) => chunkDocument(document, "sentence"))];
  const index = new EvidenceIndex(corpus);
  const queries = [...job.required, ...job.preferred].map((requirement) => requirement.text);
  const traces = queries.map((query) => index.search(query, k));
  const seen = new Set<string>();
  const chunks: EvidenceChunk[] = [];
  for (const trace of traces) {
    for (const hit of trace.hits) {
      if (seen.has(hit.chunkId)) continue;
      const chunk = index.chunk(hit.chunkId);
      if (chunk) { seen.add(hit.chunkId); chunks.push(chunk); }
    }
  }
  return { version: "retrieval-v1", k, chunks, traces };
}

// Lookup used by the validators: chunk id → exact chunk text, for this run only.
export function evidenceTextById(evidence: Pick<RetrievedEvidence, "chunks"> | undefined): Map<string, string> {
  return new Map((evidence?.chunks ?? []).map((chunk) => [chunk.id, chunk.text]));
}
