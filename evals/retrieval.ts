import { z } from "zod";
import type { CandidateProfile, EvidenceChunk } from "@career-radar/shared";
import { canonical } from "../server/src/domain/assessment/input-identity.js";
import {
  CHUNK_ID_VERSION, CHUNKERS, chunkDocument, chunkProfile, type Chunker, type EvidenceDocument,
} from "../server/src/domain/evidence/chunk.js";
import { EvidenceIndex, SCORER_VERSION, TOKENIZER_VERSION } from "../server/src/domain/evidence/lexical.js";
import { digest, ratio, type RunMetadata } from "./evaluate.js";
import type { RetrievalQuery } from "./fixtures/corpus/queries.js";

// M5-A retrieval evaluation: Recall@K of lexical retrieval over a synthetic corpus, per chunker.
// No model call. Relevance is authored as sentence locators (fixtures/corpus/queries.ts) and
// resolved to chunk ids here, so the same query set scores both chunkers without hand-copied hashes.
export const RETRIEVAL_REPORT_VERSION = 1;
export const RETRIEVAL_METRIC_VERSION = "retrieval-metrics-v1";
export const RECALL_KS = [3, 5] as const;

export type RetrievalCorpus = { version: string; profile: CandidateProfile; documents: EvidenceDocument[] };
export type QuerySet = { version: string; queries: RetrievalQuery[] };

const RatioSchema = z.object({ numerator: z.number().int(), denominator: z.number().int(), value: z.number().nullable() }).strict();
const HitSchema = z.object({ chunkId: z.string().regex(/^[a-f0-9]{64}$/), score: z.number(), rank: z.number().int().positive() }).strict();

export const RetrievalReportSchema = z.object({
  reportKind: z.literal("retrieval-evaluation"),
  reportVersion: z.literal(RETRIEVAL_REPORT_VERSION),
  metricVersion: z.literal(RETRIEVAL_METRIC_VERSION),
  mode: z.literal("lexical"),
  tokenizerVersion: z.literal(TOKENIZER_VERSION), scorerVersion: z.literal(SCORER_VERSION), chunkIdVersion: z.literal(CHUNK_ID_VERSION),
  corpusVersion: z.string().min(1), corpusHash: z.string().regex(/^[a-f0-9]{64}$/),
  querySetVersion: z.string().min(1), querySetHash: z.string().regex(/^[a-f0-9]{64}$/),
  codeSha: z.string().min(1), dirty: z.boolean(), generatedAt: z.string().datetime(),
  modelCalls: z.literal(0),
  queries: z.number().int().nonnegative(),
  chunkers: z.array(z.object({
    chunker: z.enum(CHUNKERS),
    chunks: z.number().int().nonnegative(), terms: z.number().int().nonnegative(),
    // micro: found relevant chunks over all relevant chunks; macro: mean of per-query recall.
    recall: z.array(z.object({ k: z.number().int().positive(), micro: RatioSchema, macro: z.number().nullable() }).strict()),
    queriesWithoutHits: z.array(z.string()),
    results: z.array(z.object({
      queryId: z.string().min(1), query: z.string().min(1),
      // Empty only when a relevance entry failed to resolve; that run is reported as a dataset problem.
      relevantChunkIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
      hits: z.array(HitSchema),
      // value is null (N/A) when any relevance entry of the query failed to resolve.
      recall: z.array(z.object({ k: z.number().int().positive(), found: z.number().int().nonnegative(), relevant: z.number().int().nonnegative(), value: z.number().nullable() }).strict()),
      misses: z.array(z.string()),
    }).strict()),
  }).strict()),
  // Dataset problems (a relevant locator that no longer resolves) make the run unusable, not a low score.
  problems: z.array(z.string()),
  deterministic: z.boolean(),
  success: z.boolean(),
}).strict();
export type RetrievalReport = z.infer<typeof RetrievalReportSchema>;

export function buildChunks(corpus: RetrievalCorpus, chunker: Chunker): EvidenceChunk[] {
  return [...chunkProfile(corpus.profile, chunker), ...corpus.documents.flatMap((document) => chunkDocument(document, chunker))];
}

const baseLocator = (locator: string) => locator.replace(/\/part:\d+$/, "");

// A relevant sentence resolves to: the sentence chunk with that locator, or the field/section chunk
// whose locator is the prefix of it and whose text contains the sentence (a split part is relevant
// only when it holds the sentence). The sentence chunker output is the authority for the text check.
export function resolveRelevance(query: RetrievalQuery, chunks: EvidenceChunk[], sentenceChunks: EvidenceChunk[]): { ids: string[]; problems: string[] } {
  const ids = new Set<string>();
  const problems: string[] = [];
  for (const entry of query.relevant) {
    const authority = sentenceChunks.find((c) => c.sourceId === entry.sourceId && c.locator === entry.locator);
    if (!authority) { problems.push(`${query.id}: no sentence chunk at ${entry.sourceId} ${entry.locator}`); continue; }
    if (authority.text !== entry.text) { problems.push(`${query.id}: text drift at ${entry.sourceId} ${entry.locator}`); continue; }
    const matches = chunks.filter((c) => c.sourceId === entry.sourceId && c.text.includes(entry.text)
      && (c.locator === entry.locator || entry.locator.startsWith(`${baseLocator(c.locator)}[`) || entry.locator.startsWith(`${baseLocator(c.locator)}/`)));
    if (!matches.length) problems.push(`${query.id}: ${entry.sourceId} ${entry.locator} resolves to no chunk`);
    for (const match of matches) ids.add(match.id);
  }
  return { ids: [...ids].sort(), problems };
}

export function recallAtK(relevantIds: readonly string[], hitIds: readonly string[], k: number): { found: number; relevant: number; value: number } {
  const top = new Set(hitIds.slice(0, k));
  const found = relevantIds.filter((id) => top.has(id)).length;
  return { found, relevant: relevantIds.length, value: relevantIds.length ? found / relevantIds.length : 0 };
}

const NOT_APPLICABLE = (k: number) => ({ k, found: 0, relevant: 0, value: null });

function evaluateChunker(corpus: RetrievalCorpus, querySet: QuerySet, chunker: Chunker) {
  const chunks = buildChunks(corpus, chunker);
  const sentenceChunks = chunker === "sentence" ? chunks : buildChunks(corpus, "sentence");
  const index = new EvidenceIndex(chunks);
  const maxK = Math.max(...RECALL_KS);
  // Relevance is resolved for every query before anything is scored. A query with an unresolved
  // entry gets N/A, not a score over the entries that happened to resolve, and the chunker's
  // aggregate is N/A as well: a partially valid query set is a dataset problem, not a lower number.
  const resolved = querySet.queries.map((query) => ({ query, ...resolveRelevance(query, chunks, sentenceChunks) }));
  const problems = resolved.flatMap((entry) => entry.problems);
  const results = resolved.map(({ query, ids, problems: queryProblems }) => {
    const trace = index.search(query.query, maxK);
    const hitIds = trace.hits.map((hit) => hit.chunkId);
    return {
      queryId: query.id, query: query.query, relevantChunkIds: ids, hits: trace.hits,
      recall: RECALL_KS.map((k) => queryProblems.length ? NOT_APPLICABLE(k) : { k, ...recallAtK(ids, hitIds, k) }),
      misses: trace.misses,
    };
  });
  const recall = RECALL_KS.map((k) => {
    if (problems.length || !results.length) return { k, micro: ratio(0, 0), macro: null };
    const perQuery = results.map((r) => r.recall.find((entry) => entry.k === k)!);
    return {
      k,
      micro: ratio(perQuery.reduce((n, r) => n + r.found, 0), perQuery.reduce((n, r) => n + r.relevant, 0)),
      macro: perQuery.reduce((n, r) => n + (r.value ?? 0), 0) / perQuery.length,
    };
  });
  return {
    chunker, chunks: index.size, terms: index.termCount, recall,
    queriesWithoutHits: results.filter((r) => r.hits.length === 0).map((r) => r.queryId),
    results, problems,
  };
}

export function runRetrievalEvaluation(corpus: RetrievalCorpus, querySet: QuerySet, metadata: Pick<RunMetadata, "codeSha" | "dirty">): RetrievalReport {
  if (new Set(querySet.queries.map((q) => q.id)).size !== querySet.queries.length) throw new Error("Duplicate query ids");
  const run = () => CHUNKERS.map((chunker) => evaluateChunker(corpus, querySet, chunker));
  const first = run();
  // Determinism: a second build and search over the same corpus must reproduce every score and rank.
  const second = run();
  const strip = (entries: ReturnType<typeof run>) => entries.map(({ chunker, chunks, terms, recall, queriesWithoutHits, results }) =>
    ({ chunker, chunks, terms, recall, queriesWithoutHits, results }));
  const deterministic = canonical(strip(first)) === canonical(strip(second));
  const problems = [...new Set(first.flatMap((entry) => entry.problems))];
  const report = {
    reportKind: "retrieval-evaluation" as const,
    reportVersion: RETRIEVAL_REPORT_VERSION, metricVersion: RETRIEVAL_METRIC_VERSION, mode: "lexical" as const,
    tokenizerVersion: TOKENIZER_VERSION, scorerVersion: SCORER_VERSION, chunkIdVersion: CHUNK_ID_VERSION,
    corpusVersion: corpus.version, corpusHash: digest({ profile: corpus.profile, documents: corpus.documents }),
    querySetVersion: querySet.version, querySetHash: digest(querySet.queries),
    codeSha: metadata.codeSha, dirty: metadata.dirty, generatedAt: new Date().toISOString(),
    modelCalls: 0 as const,
    queries: querySet.queries.length,
    chunkers: strip(first),
    problems, deterministic,
    success: problems.length === 0 && deterministic && querySet.queries.length > 0,
  };
  return RetrievalReportSchema.parse(report);
}

const cell = (value: string) => value.replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
const percent = (value: number | null) => value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;

export function renderRetrievalMarkdown(report: RetrievalReport): string {
  const found = (r: RetrievalReport["chunkers"][number]["results"][number], k: number) => {
    const entry = r.recall.find((x) => x.k === k);
    return entry?.value === null ? "N/A" : String(entry?.found ?? 0);
  };
  const lines = [
    "# Career Radar retrieval evaluation (lexical)", "",
    "Synthetic corpus, BM25 in-process; model calls: **0**. Recall@K says how much of the authored evidence the top K chunks contain; it is not evidence quality or live model behaviour.", "",
    `- Code: ${report.codeSha}; dirty worktree: ${report.dirty}`,
    `- Corpus: ${report.corpusVersion} (${report.corpusHash}); queries: ${report.querySetVersion} (${report.querySetHash}), ${report.queries} queries`,
    `- Tokenizer: ${report.tokenizerVersion}; scorer: ${report.scorerVersion}; chunk ids: ${report.chunkIdVersion}; report: ${report.reportVersion}; metrics: ${report.metricVersion}`,
    `- Deterministic across two runs: ${report.deterministic}; dataset problems: ${report.problems.length}`, "",
  ];
  if (report.problems.length) lines.push("## Dataset problems (recall is N/A until these are fixed)", "", ...report.problems.map((p) => `- ${cell(p)}`), "");
  for (const entry of report.chunkers) {
    lines.push(`## Chunker: ${entry.chunker}`, "", `Chunks: ${entry.chunks}; indexed terms: ${entry.terms}; queries without any hit: ${entry.queriesWithoutHits.join(", ") || "none"}`, "",
      "| K | Micro recall (found / relevant) | Macro recall (mean per query) |", "| --- | --- | --- |",
      ...entry.recall.map((r) => `| ${r.k} | ${r.micro.numerator} / ${r.micro.denominator} = ${percent(r.micro.value)} | ${percent(r.macro)} |`), "",
      "| Query | Text | Relevant | Found@3 | Found@5 | Missing terms |", "| --- | --- | --- | --- | --- | --- |",
      ...entry.results.map((r) => `| ${r.queryId} | ${cell(r.query)} | ${r.relevantChunkIds.length} | ${found(r, 3)} | ${found(r, 5)} | ${cell(r.misses.join(", ")) || "none"} |`), "");
  }
  return lines.join("\n");
}
