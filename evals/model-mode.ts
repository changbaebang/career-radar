import { z } from "zod";
import type { FitAssessment, JobPosting } from "@career-radar/shared";
import type { CareerAnalyzer } from "../server/src/ai/analyzer.js";
import { withCallDeadline } from "../server/src/ai/deadline.js";
import { classifyFailure, type FailureClass } from "../server/src/ai/failure-class.js";
import type { AnalyzerResponseEvent } from "../server/src/ai/telemetry.js";
import { normalizeEvidence } from "../server/src/domain/assessment/normalize.js";
import { finalizeAssessmentDetailed, type PipelineDiagnostics } from "../server/src/domain/assessment/pipeline.js";
import { tokenize } from "../server/src/domain/evidence/lexical.js";
import { retrieveEvidence } from "../server/src/domain/evidence/retrieve.js";
import { assertRedacted } from "../server/scripts/measure-live/report.js";
import { citationCounts, digest, ratio } from "./evaluate.js";
import { goldenPostingText, goldenResumeText, type GoldenCase } from "./fixtures/golden/index.js";

// M5-D model-mode evaluation. Each golden case runs extraction (profile, job) and assessment
// through an analyzer, then the deterministic pipeline (retrieval, policy, citation and context
// validation). Failures are execution outcomes, never PASS. Numbers under the fake analyzer verify
// the runner; numbers under a real provider are `live-verified` for that provider and model only.
export const MODEL_REPORT_VERSION = 3;
export const MODEL_METRIC_VERSION = "model-metrics-v1";
export const CALLS_PER_CASE = 3;
// How long to wait for calls still in flight after a deadline abort before the report is assembled.
export const SETTLE_GRACE_MS = 10_000;

// The failure classifier is shared with the run trace: server/src/ai/failure-class.ts.
export { classifyFailure, type FailureClass };
export type CaseOutcome = "assessed" | "extraction_failed" | "assessment_failed" | "not_attempted";
export type Stage = "extractProfile" | "extractJob" | "assess";

// Pipeline diagnostics as short codes. They come from what each stage reports it did
// (finalizeAssessmentDetailed), never from the fixed sentences in missingInformation: the model's own
// missingInformation entries are kept verbatim there, so a sentence match cannot prove the stage ran.
// Notes added inside the adapter mapping (citation bounds, producer-side context discard) are not
// attributable from the evaluation path and are not reported.
export const NOTE_CODES = ["ungroundedMatchRemoved", "citationRekeyed", "citationOrphan", "citationInvalid", "screeningContextDiscarded"] as const;
export type NoteCode = (typeof NOTE_CODES)[number];
export function noteCodes(diagnostics: PipelineDiagnostics): NoteCode[] {
  return NOTE_CODES.filter((code) => ({
    ungroundedMatchRemoved: diagnostics.ungroundedMatchesRemoved > 0, citationRekeyed: diagnostics.citationsRekeyed > 0, citationOrphan: diagnostics.citationsOrphaned > 0,
    citationInvalid: diagnostics.citationsInvalid > 0, screeningContextDiscarded: diagnostics.screeningContextDiscarded,
  })[code]);
}
const NoteCodeSchema = z.enum(NOTE_CODES);
const NoteCountsSchema = z.object({ ungroundedMatchRemoved: z.number().int(), citationRekeyed: z.number().int(), citationOrphan: z.number().int(), citationInvalid: z.number().int(), screeningContextDiscarded: z.number().int() }).strict();
const RatioSchema = z.object({ numerator: z.number().int(), denominator: z.number().int(), value: z.number().nullable() }).strict();
const TelemetrySchema = z.object({
  operation: z.enum(["extractProfile", "extractJob", "assess"]), outcome: z.enum(["ok", "error"]), durationMs: z.number(),
  responseModel: z.string().optional(), upstreamProvider: z.string().optional(), incompleteReason: z.string().optional(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), totalTokens: z.number(), cachedInputTokens: z.number().optional(), reasoningTokens: z.number().optional() }).strict().optional(),
  errorName: z.string().optional(),
}).strict();
const CaseSchema = z.object({
  caseId: z.string().min(1), goldHash: z.string().regex(/^[a-f0-9]{64}$/), humanReview: z.enum(["pending", "reviewed"]),
  outcome: z.enum(["assessed", "extraction_failed", "assessment_failed", "not_attempted"]),
  failedStage: z.enum(["extractProfile", "extractJob", "assess"]).optional(),
  failureClass: z.enum(["schema_failure", "refusal", "truncation", "timeout", "tool_failure", "provider_error", "other"]).optional(),
  calls: z.number().int().nonnegative(),
  extraction: z.object({
    requiredExtracted: z.number().int(), preferredExtracted: z.number().int(),
    companyNamedInPosting: z.boolean(), companyExtracted: z.boolean(), inventedEmployer: z.boolean(),
    requirementMatchRate: RatioSchema, matchedGold: z.array(z.string()),
    unmatchedGold: z.array(z.object({ text: z.string(), nearestExtracted: z.string().nullable() }).strict()),
    unmatchedExtracted: z.array(z.string()),
  }).strict().optional(),
  assessment: z.object({
    verdict: z.enum(["REALISTIC", "STRETCH", "PASS"]), verdictInAllowedSet: z.boolean(), confidence: z.enum(["low", "medium", "high"]),
    // The model's draft before the deterministic pipeline, as counts, so a verdict change can be attributed to the policy.
    draft: z.object({ verdict: z.enum(["REALISTIC", "STRETCH", "PASS"]), confidence: z.enum(["low", "medium", "high"]), matches: z.number().int(), gaps: z.number().int(), hardBlockers: z.number().int(), citations: z.number().int() }).strict(),
    final: z.object({ matches: z.number().int(), gaps: z.number().int(), hardBlockers: z.number().int() }).strict(),
    notes: z.array(NoteCodeSchema),
    hardBlockers: z.array(z.string()),
    blockerRecallMatched: z.object({ found: z.number().int(), matched: z.number().int(), value: z.number().nullable() }).strict(),
    blockerRecallAll: z.object({ found: z.number().int(), all: z.number().int(), value: z.number().nullable() }).strict(),
    spuriousBlockers: z.number().int(), forbiddenClaims: z.number().int(),
    citations: z.object({ supplied: z.number().int(), valid: z.number().int(), claims: z.number().int(), unsupported: z.number().int() }).strict(),
    // Validator-attributed: at least one supplied citation did not resolve for this run.
    citationInvalid: z.boolean(),
    retrieval: z.object({ queries: z.number().int(), chunks: z.number().int(), missingTerms: z.number().int() }).strict(),
  }).strict().optional(),
  telemetry: z.array(TelemetrySchema),
}).strict();

const LatencySchema = z.object({ count: z.number().int(), minMs: z.number().nullable(), medianMs: z.number().nullable(), maxMs: z.number().nullable() }).strict();

export const ModelEvalReportSchema = z.object({
  reportKind: z.literal("model-evaluation"),
  reportVersion: z.literal(MODEL_REPORT_VERSION), metricVersion: z.literal(MODEL_METRIC_VERSION), mode: z.literal("model"),
  execution: z.enum(["dry-run", "live"]),
  provider: z.string().min(1), requestedModel: z.string().min(1), responseModels: z.array(z.string()), upstreamProviders: z.array(z.string()),
  promptVersion: z.string().min(1), policyHash: z.string().regex(/^[a-f0-9]{64}$/), schemaHash: z.string().regex(/^[a-f0-9]{64}$/),
  codeSha: z.string().min(1), dirty: z.boolean(), generatedAt: z.string().datetime(),
  goldenSetVersion: z.string().min(1), goldenSetHash: z.string().regex(/^[a-f0-9]{64}$/),
  selectedCases: z.number().int(), callCap: z.number().int(), modelCalls: z.number().int(),
  // Calls cut by the per-call deadline, and calls still unsettled after the grace period (expected 0).
  abortedCalls: z.number().int(), unsettledCalls: z.number().int(),
  transport: z.object({ maxRetries: z.literal(0), logLevel: z.literal("off"), timeoutMs: z.number().int().optional() }).strict(),
  store: z.union([z.literal(false), z.literal("n/a")]),
  approvals: z.object({ transmission: z.boolean() }).strict(),
  problems: z.array(z.string()),
  cases: z.array(CaseSchema),
  metrics: z.object({
    outcomes: z.object({ assessed: z.number().int(), extractionFailed: z.number().int(), assessmentFailed: z.number().int(), notAttempted: z.number().int() }).strict(),
    requirementMatchRate: RatioSchema,
    blockerRecallMatched: RatioSchema, blockerRecallAll: RatioSchema,
    goldVerdictAgreement: RatioSchema, humanVerdictAgreement: RatioSchema,
    inventedEmployers: z.number().int(), forbiddenClaims: z.number().int(),
    verdictChangedByPolicy: RatioSchema, noteCounts: NoteCountsSchema,
    schemaFailureRate: RatioSchema, refusalRate: RatioSchema, truncationRate: RatioSchema, timeoutRate: RatioSchema,
    citationCorrectness: RatioSchema, unsupportedClaimRate: RatioSchema,
    latency: z.object({ extractProfile: LatencySchema, extractJob: LatencySchema, assess: LatencySchema }).strict(),
    usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), totalTokens: z.number(), reasoningTokens: z.number().nullable(), reportedCalls: z.number().int(), calls: z.number().int() }).strict(),
  }).strict(),
  success: z.boolean(),
}).strict();
export type ModelEvalReport = z.infer<typeof ModelEvalReportSchema>;
export type ModelCaseResult = z.infer<typeof CaseSchema>;

export type ModelRunOptions = {
  execution: "dry-run" | "live";
  provider: string; requestedModel: string; store: false | "n/a";
  transport: { maxRetries: 0; logLevel: "off"; timeoutMs?: number };
  approvals: { transmission: boolean };
  callCap: number;
  // Per-call deadline covering headers and body: each call gets its own AbortSignal (the SDK timeout
  // alone stops at the response headers). Absent means no deadline (tests only).
  callTimeoutMs?: number;
  metadata: { codeSha: string; dirty: boolean; policyHash: string; schemaHash: string; promptVersion: string };
  goldenSetVersion: string;
  // The analyzer is created with the runner's telemetry hook so every call is recorded without content.
  createAnalyzer: (onResponse: (event: AnalyzerResponseEvent) => void) => CareerAnalyzer;
  log?: (line: string) => void;
};

// Golden-set integrity, checked before any call: ids unique, blockers subset of requirements, no two
// cases with identical inputs and different verdict sets (that would be a contract, not gold).
export function validateGoldenSet(cases: GoldenCase[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const byInput = new Map<string, GoldenCase>();
  for (const item of cases) {
    if (ids.has(item.caseId)) problems.push(`${item.caseId}: duplicate case id`);
    ids.add(item.caseId);
    if (item.expectedVerdicts.length === 0) problems.push(`${item.caseId}: empty expected verdict set`);
    for (const blocker of item.expectedBlockers) if (!item.goldRequirements.includes(blocker)) problems.push(`${item.caseId}: expected blocker is not a gold requirement`);
    const key = digest({ resume: goldenResumeText(item), posting: goldenPostingText(item) });
    const twin = byInput.get(key);
    if (twin && digest([...twin.expectedVerdicts].sort()) !== digest([...item.expectedVerdicts].sort())) problems.push(`${item.caseId}: conflicting gold verdicts with ${twin.caseId} for identical inputs`);
    byInput.set(key, item);
  }
  return problems;
}

export function goldHash(item: GoldenCase): string {
  return digest({ resume: goldenResumeText(item), posting: goldenPostingText(item), goldRequirements: item.goldRequirements,
    expectedBlockers: item.expectedBlockers, expectedVerdicts: item.expectedVerdicts, mustNotClaim: item.mustNotClaim });
}

const STOP = new Set(["a", "an", "the", "of", "for", "to", "in", "on", "and", "or", "with", "is", "are"]);
const contentTokens = (text: string) => new Set(tokenize(text).filter((token) => token.length >= 3 && !STOP.has(token)));
function nearest(text: string, candidates: string[]): string | null {
  const wanted = contentTokens(text);
  let best: { text: string; score: number } | undefined;
  for (const candidate of candidates) {
    const score = [...contentTokens(candidate)].filter((token) => wanted.has(token)).length;
    if (score > 0 && (!best || score > best.score)) best = { text: candidate, score };
  }
  return best?.text ?? null;
}

// Requirement mapping: unambiguous normalized-text equality only. Text equality cannot tell a
// paraphrase from a semantic miss, so the cause of an unmatched requirement is never classified.
function matchRequirements(item: GoldenCase, job: JobPosting) {
  const extracted = job.required.map((requirement) => ({ id: requirement.id, text: requirement.text, key: normalizeEvidence(requirement.text) }));
  const matchedGold: string[] = [];
  const matchedIds = new Map<string, string>(); // gold text → extracted requirement id
  const unmatchedGold: { text: string; nearestExtracted: string | null }[] = [];
  const usedIds = new Set<string>();
  for (const gold of item.goldRequirements) {
    const key = normalizeEvidence(gold);
    const hits = extracted.filter((requirement) => requirement.key === key);
    if (hits.length === 1) { matchedGold.push(gold); matchedIds.set(gold, hits[0]!.id); usedIds.add(hits[0]!.id); }
    else unmatchedGold.push({ text: gold, nearestExtracted: nearest(gold, extracted.map((requirement) => requirement.text)) });
  }
  const unmatchedExtracted = extracted.filter((requirement) => !usedIds.has(requirement.id)).map((requirement) => requirement.text);
  return { matchedGold, matchedIds, unmatchedGold, unmatchedExtracted };
}

function latency(events: AnalyzerResponseEvent[], operation: Stage) {
  const values = events.filter((event) => event.operation === operation).map((event) => event.durationMs).sort((a, b) => a - b);
  const median = values.length ? values[Math.floor((values.length - 1) / 2)]! : null;
  return { count: values.length, minMs: values.length ? Math.round(values[0]!) : null, medianMs: median === null ? null : Math.round(median), maxMs: values.length ? Math.round(values[values.length - 1]!) : null };
}

const project = (event: AnalyzerResponseEvent) => ({
  operation: event.operation, outcome: event.outcome, durationMs: Math.round(event.durationMs),
  ...(event.responseModel ? { responseModel: event.responseModel } : {}),
  ...(event.upstreamProvider ? { upstreamProvider: event.upstreamProvider } : {}),
  ...(event.incompleteReason ? { incompleteReason: event.incompleteReason } : {}),
  ...(event.usage ? { usage: event.usage } : {}),
  ...(event.error ? { errorName: event.error.name } : {}),
});

export async function runModelEvaluation(cases: GoldenCase[], options: ModelRunOptions): Promise<ModelEvalReport> {
  const problems = validateGoldenSet(cases);
  const events: AnalyzerResponseEvent[] = [];
  const results: ModelCaseResult[] = [];
  let calls = 0;
  const log = options.log ?? (() => undefined);
  // Integrity problems stop the run before the analyzer exists: zero calls, every case not attempted.
  const deadline = options.callTimeoutMs ? withCallDeadline(options.callTimeoutMs) : undefined;
  const created = problems.length ? undefined : options.createAnalyzer((event) => { events.push(event); });
  const analyzer = created && deadline ? deadline.wrap(created) : created;
  for (const item of cases) {
    const base = { caseId: item.caseId, goldHash: goldHash(item), humanReview: item.humanReview };
    if (!analyzer) { results.push({ ...base, outcome: "not_attempted", calls: 0, telemetry: [] }); continue; }
    const caseEvents: AnalyzerResponseEvent[] = [];
    const before = events.length;
    const attempt = async <T>(stage: Stage, call: () => Promise<T>): Promise<T> => {
      if (calls >= options.callCap) throw new CapReached(stage);
      calls++;
      return call();
    };
    let failedStage: Stage | undefined;
    try {
      let profile, job;
      try {
        failedStage = "extractProfile";
        profile = (await attempt("extractProfile", () => analyzer.extractProfile(goldenResumeText(item)))).profile;
        failedStage = "extractJob";
        job = (await attempt("extractJob", () => analyzer.extractJob(goldenPostingText(item)))).job;
      } catch (error) {
        if (error instanceof CapReached) throw error;
        caseEvents.push(...events.slice(before));
        results.push({ ...base, outcome: "extraction_failed", failedStage, failureClass: classifyFailure(error, caseEvents.at(-1)), calls: events.length - before, telemetry: caseEvents.map(project) });
        log(`${item.caseId}: extraction failed at ${failedStage}`);
        continue;
      }
      const mapping = matchRequirements(item, job);
      const extraction = {
        requiredExtracted: job.required.length, preferredExtracted: job.preferred.length,
        companyNamedInPosting: item.posting.company !== undefined, companyExtracted: job.company !== undefined,
        inventedEmployer: item.posting.company === undefined && job.company !== undefined,
        requirementMatchRate: ratio(mapping.matchedGold.length, item.goldRequirements.length),
        matchedGold: mapping.matchedGold, unmatchedGold: mapping.unmatchedGold, unmatchedExtracted: mapping.unmatchedExtracted,
      };
      const evidence = retrieveEvidence(profile, job);
      let draft: FitAssessment;
      try {
        failedStage = "assess";
        draft = await attempt("assess", () => analyzer.assess(profile, job, undefined, evidence));
      } catch (error) {
        if (error instanceof CapReached) throw error;
        caseEvents.push(...events.slice(before));
        results.push({ ...base, outcome: "assessment_failed", failedStage: "assess", failureClass: classifyFailure(error, caseEvents.at(-1)), calls: events.length - before, extraction, telemetry: caseEvents.map(project) });
        log(`${item.caseId}: assessment failed`);
        continue;
      }
      const { assessment: final, diagnostics } = finalizeAssessmentDetailed(profile, job, draft, evidence);
      const blockerTexts = final.hardBlockers.map((blocker) => normalizeEvidence(blocker.requirement));
      const blockerIds = new Set(final.hardBlockers.map((blocker) => blocker.requirementId).filter((id): id is string => id !== undefined));
      const isFound = (gold: string) => blockerTexts.includes(normalizeEvidence(gold)) || (mapping.matchedIds.has(gold) && blockerIds.has(mapping.matchedIds.get(gold)!));
      const matchedBlockers = item.expectedBlockers.filter((gold) => mapping.matchedGold.includes(gold));
      const foundMatched = matchedBlockers.filter(isFound).length;
      const foundAll = item.expectedBlockers.filter(isFound).length;
      const expectedKeys = new Set(item.expectedBlockers.map(normalizeEvidence));
      const expectedIds = new Set(item.expectedBlockers.map((gold) => mapping.matchedIds.get(gold)).filter(Boolean));
      const spurious = final.hardBlockers.filter((blocker) => !expectedKeys.has(normalizeEvidence(blocker.requirement)) && !(blocker.requirementId && expectedIds.has(blocker.requirementId))).length;
      const forbidden = item.mustNotClaim.filter((claim) => final.strongestMatches.some((match) => normalizeEvidence(match.evidence).includes(normalizeEvidence(claim)))).length;
      const notes = noteCodes(diagnostics);
      caseEvents.push(...events.slice(before));
      results.push({
        ...base, outcome: "assessed", calls: events.length - before, extraction,
        assessment: {
          verdict: final.verdict, verdictInAllowedSet: item.expectedVerdicts.includes(final.verdict), confidence: final.confidence,
          draft: { verdict: draft.verdict, confidence: draft.confidence, matches: draft.strongestMatches.length, gaps: draft.gaps.length, hardBlockers: draft.hardBlockers.length, citations: draft.citations?.length ?? 0 },
          final: { matches: final.strongestMatches.length, gaps: final.gaps.length, hardBlockers: final.hardBlockers.length }, notes,
          hardBlockers: final.hardBlockers.map((blocker) => blocker.requirement),
          blockerRecallMatched: { found: foundMatched, matched: matchedBlockers.length, value: matchedBlockers.length ? foundMatched / matchedBlockers.length : null },
          blockerRecallAll: { found: foundAll, all: item.expectedBlockers.length, value: item.expectedBlockers.length ? foundAll / item.expectedBlockers.length : null },
          spuriousBlockers: spurious, forbiddenClaims: forbidden,
          citations: citationCounts(draft, final),
          citationInvalid: diagnostics.citationsInvalid > 0,
          retrieval: { queries: evidence.traces.length, chunks: evidence.chunks.length, missingTerms: evidence.traces.reduce((n, trace) => n + trace.misses.length, 0) },
        },
        telemetry: caseEvents.map(project),
      });
      log(`${item.caseId}: ${final.verdict}${item.expectedVerdicts.includes(final.verdict) ? "" : " (outside gold set)"}`);
    } catch (error) {
      if (!(error instanceof CapReached)) throw error;
      results.push({ ...base, outcome: "not_attempted", calls: events.length - before, telemetry: events.slice(before).map(project) });
      log(`${item.caseId}: not attempted (call cap ${options.callCap} reached)`);
    }
  }
  const unsettledCalls = deadline ? await deadline.settle(SETTLE_GRACE_MS) : 0;
  const abortedCalls = deadline?.aborted ?? 0;
  const assessed = results.filter((result) => result.assessment);
  const extracted = results.filter((result) => result.extraction);
  const attempted = results.filter((result) => result.outcome !== "not_attempted");
  const sum = <T>(items: T[], pick: (item: T) => number) => items.reduce((n, item) => n + pick(item), 0);
  const failures = (kind: FailureClass) => attempted.filter((result) => result.failureClass === kind).length;
  const reviewed = assessed.filter((result) => result.humanReview === "reviewed");
  const usageEvents = events.filter((event) => event.usage);
  const reasoning = usageEvents.filter((event) => event.usage?.reasoningTokens !== undefined);
  const report = {
    reportKind: "model-evaluation" as const, reportVersion: MODEL_REPORT_VERSION, metricVersion: MODEL_METRIC_VERSION, mode: "model" as const,
    execution: options.execution, provider: options.provider, requestedModel: options.requestedModel,
    responseModels: [...new Set(events.map((event) => event.responseModel).filter((model): model is string => Boolean(model)))].sort(),
    upstreamProviders: [...new Set(events.map((event) => event.upstreamProvider).filter((upstream): upstream is string => Boolean(upstream)))].sort(),
    promptVersion: options.metadata.promptVersion, policyHash: options.metadata.policyHash, schemaHash: options.metadata.schemaHash,
    codeSha: options.metadata.codeSha, dirty: options.metadata.dirty, generatedAt: new Date().toISOString(),
    goldenSetVersion: options.goldenSetVersion, goldenSetHash: digest(cases.map(goldHash)),
    selectedCases: cases.length, callCap: options.callCap, modelCalls: calls, abortedCalls, unsettledCalls,
    transport: options.transport, store: options.store, approvals: options.approvals, problems,
    cases: results,
    metrics: {
      outcomes: { assessed: assessed.length, extractionFailed: results.filter((r) => r.outcome === "extraction_failed").length,
        assessmentFailed: results.filter((r) => r.outcome === "assessment_failed").length, notAttempted: results.filter((r) => r.outcome === "not_attempted").length },
      requirementMatchRate: ratio(sum(extracted, (r) => r.extraction!.requirementMatchRate.numerator), sum(extracted, (r) => r.extraction!.requirementMatchRate.denominator)),
      blockerRecallMatched: ratio(sum(assessed, (r) => r.assessment!.blockerRecallMatched.found), sum(assessed, (r) => r.assessment!.blockerRecallMatched.matched)),
      blockerRecallAll: ratio(sum(assessed, (r) => r.assessment!.blockerRecallAll.found), sum(assessed, (r) => r.assessment!.blockerRecallAll.all)),
      goldVerdictAgreement: ratio(assessed.filter((r) => r.assessment!.verdictInAllowedSet).length, assessed.length),
      humanVerdictAgreement: ratio(reviewed.filter((r) => r.assessment!.verdictInAllowedSet).length, reviewed.length),
      inventedEmployers: extracted.filter((r) => r.extraction!.inventedEmployer).length,
      forbiddenClaims: sum(assessed, (r) => r.assessment!.forbiddenClaims),
      verdictChangedByPolicy: ratio(assessed.filter((r) => r.assessment!.verdict !== r.assessment!.draft.verdict).length, assessed.length),
      noteCounts: Object.fromEntries(NOTE_CODES.map((code) => [code, assessed.filter((r) => r.assessment!.notes.includes(code)).length])) as Record<NoteCode, number>,
      schemaFailureRate: ratio(failures("schema_failure"), attempted.length), refusalRate: ratio(failures("refusal"), attempted.length),
      truncationRate: ratio(failures("truncation"), attempted.length), timeoutRate: ratio(failures("timeout"), attempted.length),
      citationCorrectness: ratio(sum(assessed, (r) => r.assessment!.citations.valid), sum(assessed, (r) => r.assessment!.citations.supplied)),
      unsupportedClaimRate: ratio(sum(assessed, (r) => r.assessment!.citations.unsupported), sum(assessed, (r) => r.assessment!.citations.claims)),
      latency: { extractProfile: latency(events, "extractProfile"), extractJob: latency(events, "extractJob"), assess: latency(events, "assess") },
      usage: { inputTokens: sum(usageEvents, (e) => e.usage!.inputTokens), outputTokens: sum(usageEvents, (e) => e.usage!.outputTokens), totalTokens: sum(usageEvents, (e) => e.usage!.totalTokens),
        reasoningTokens: reasoning.length ? sum(reasoning, (e) => e.usage!.reasoningTokens!) : null, reportedCalls: usageEvents.length, calls },
    },
    success: problems.length === 0 && results.every((result) => result.outcome !== "not_attempted"),
  };
  return ModelEvalReportSchema.parse(report);
}

class CapReached extends Error { constructor(readonly stage: Stage) { super("model call cap reached"); this.name = "CapReached"; } }

// Reports never carry resume text, evidence sentences or posting prose; requirement texts are the
// authored gold and may appear. Fragments shorter than 8 characters are ignored by assertRedacted.
export function modelReportForbiddenFragments(cases: GoldenCase[]): string[] {
  return cases.flatMap((item) => [goldenResumeText(item), goldenPostingText(item), item.resume.headline, ...item.resume.experience, ...(item.posting.responsibilities ?? [])]);
}
export function assertModelReportRedacted(serialized: string, cases: GoldenCase[]): void {
  assertRedacted(serialized, modelReportForbiddenFragments(cases));
}

const COMPARISON_NOTE = "Case-by-case comparison on the same provider, model, prompt and golden set. A changed outcome under a live model is a model-path observation, not a policy regression.";

export function compareModelReports(current: ModelEvalReport, baseline: unknown) {
  // An older report version is reported as incompatible instead of failing the strict parse.
  if ((baseline as { reportVersion?: unknown } | null)?.reportVersion !== MODEL_REPORT_VERSION) {
    return { compatible: false, incompatibleReasons: ["reportVersion"], compared: 0, outcomeChanged: [] as string[], verdictChanged: [] as string[], blockerRecallAllChanged: [] as string[],
      baselineCodeSha: "unknown", currentCodeSha: current.codeSha, note: COMPARISON_NOTE };
  }
  const previous = ModelEvalReportSchema.parse(baseline);
  const incompatibleReasons = (["reportVersion", "metricVersion", "mode", "provider", "requestedModel", "promptVersion", "goldenSetHash"] as const)
    .filter((key) => current[key] !== previous[key]);
  const before = new Map(previous.cases.map((result) => [result.caseId, result]));
  const comparable = incompatibleReasons.length ? [] : current.cases.filter((result) => before.get(result.caseId)?.goldHash === result.goldHash);
  const changed = (pick: (result: ModelCaseResult) => unknown) => comparable.filter((result) => JSON.stringify(pick(result)) !== JSON.stringify(pick(before.get(result.caseId)!))).map((result) => result.caseId);
  return {
    compatible: incompatibleReasons.length === 0 && comparable.length > 0, incompatibleReasons, compared: comparable.length,
    outcomeChanged: changed((result) => result.outcome), verdictChanged: changed((result) => result.assessment?.verdict ?? null),
    blockerRecallAllChanged: changed((result) => result.assessment?.blockerRecallAll.value ?? null),
    baselineCodeSha: previous.codeSha, currentCodeSha: current.codeSha,
    note: COMPARISON_NOTE,
  };
}
export type ModelComparison = ReturnType<typeof compareModelReports>;

const cell = (value: string) => value.replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
const percent = (r: { value: number | null }) => r.value === null ? "N/A" : `${(r.value * 100).toFixed(1)}%`;
const fraction = (r: { numerator: number; denominator: number; value: number | null }) => `${r.numerator} / ${r.denominator} = ${percent(r)}`;

export function renderModelMarkdown(report: ModelEvalReport, comparison?: ModelComparison): string {
  const m = report.metrics;
  const lines = [
    "# Career Radar model-mode evaluation", "",
    `${report.execution === "dry-run" ? "Dry run with the golden fake analyzer: these numbers verify the runner, not any model." : `Live run on ${report.provider} (${report.requestedModel}); numbers are live-verified for this provider and model only.`} Failures are execution outcomes, never PASS. Cost is never computed.`, "",
    `- Code: ${report.codeSha}; dirty worktree: ${report.dirty}; prompt: ${report.promptVersion}; policy ${report.policyHash.slice(0, 12)}…; schema ${report.schemaHash.slice(0, 12)}…`,
    `- Golden set: ${report.goldenSetVersion} (${report.goldenSetHash.slice(0, 12)}…), ${report.selectedCases} cases; model calls ${report.modelCalls} / cap ${report.callCap}; cut by the per-call deadline ${report.abortedCalls}; unsettled ${report.unsettledCalls}`,
    `- Provider: ${report.provider}; requested model ${report.requestedModel}; response models ${report.responseModels.join(", ") || "n/a"}; upstream ${report.upstreamProviders.join(", ") || "n/a"}; store ${String(report.store)}; retries ${report.transport.maxRetries}; SDK log ${report.transport.logLevel}`,
    `- Golden-set problems: ${report.problems.length}${report.problems.length ? " (no model call was made)" : ""}`, "",
    "## Metrics", "", "| Measure | Value |", "| --- | --- |",
    `| Outcomes | assessed ${m.outcomes.assessed}, extraction failed ${m.outcomes.extractionFailed}, assessment failed ${m.outcomes.assessmentFailed}, not attempted ${m.outcomes.notAttempted} |`,
    `| Requirement match rate (gold matched by exact normalized text) | ${fraction(m.requirementMatchRate)} |`,
    `| Blocker recall over matched gold requirements | ${fraction(m.blockerRecallMatched)} |`,
    `| Blocker recall over all gold blockers (unmatched count as misses) | ${fraction(m.blockerRecallAll)} |`,
    `| Verdict in gold allowed set (all assessed) | ${fraction(m.goldVerdictAgreement)} |`,
    `| Verdict agreement over reviewed cases only | ${fraction(m.humanVerdictAgreement)} |`,
    `| Invented employers / forbidden positive claims | ${m.inventedEmployers} / ${m.forbiddenClaims} |`,
    `| Verdict changed by the policy (draft → final) | ${fraction(m.verdictChangedByPolicy)} |`,
    `| Cases with pipeline diagnostics: ungrounded match removed; citation rekeyed / orphan / invalid; screening context discarded | ${m.noteCounts.ungroundedMatchRemoved}; ${m.noteCounts.citationRekeyed} / ${m.noteCounts.citationOrphan} / ${m.noteCounts.citationInvalid}; ${m.noteCounts.screeningContextDiscarded} |`,
    `| Schema failure / refusal / truncation / timeout rates | ${percent(m.schemaFailureRate)} / ${percent(m.refusalRate)} / ${percent(m.truncationRate)} / ${percent(m.timeoutRate)} |`,
    `| Citation correctness (valid ÷ supplied) / unsupported claim rate | ${fraction(m.citationCorrectness)} / ${fraction(m.unsupportedClaimRate)} |`,
    `| Latency ms (min / median / max): extractProfile | ${m.latency.extractProfile.minMs ?? "n/a"} / ${m.latency.extractProfile.medianMs ?? "n/a"} / ${m.latency.extractProfile.maxMs ?? "n/a"} |`,
    `| Latency ms: extractJob | ${m.latency.extractJob.minMs ?? "n/a"} / ${m.latency.extractJob.medianMs ?? "n/a"} / ${m.latency.extractJob.maxMs ?? "n/a"} |`,
    `| Latency ms: assess | ${m.latency.assess.minMs ?? "n/a"} / ${m.latency.assess.medianMs ?? "n/a"} / ${m.latency.assess.maxMs ?? "n/a"} |`,
    `| Provider-reported tokens (in / out / total; reasoning) over ${m.usage.reportedCalls} of ${m.usage.calls} calls | ${m.usage.inputTokens} / ${m.usage.outputTokens} / ${m.usage.totalTokens}; ${m.usage.reasoningTokens ?? "n/a"} |`, "",
    "## Cases", "", "| Case | Outcome | Failure | Draft → final verdict | In gold set | Req. match | Blocker recall matched / all | Citations valid / supplied | Notes | Unmatched gold |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.cases.map((c) => `| ${cell(c.caseId)} | ${c.outcome} | ${c.failureClass ?? ""} | ${c.assessment ? `${c.assessment.draft.verdict} → ${c.assessment.verdict}` : ""} | ${c.assessment ? c.assessment.verdictInAllowedSet : ""} | ${c.extraction ? fraction(c.extraction.requirementMatchRate) : ""} | ${c.assessment ? `${c.assessment.blockerRecallMatched.value === null ? "N/A" : c.assessment.blockerRecallMatched.found + "/" + c.assessment.blockerRecallMatched.matched} / ${c.assessment.blockerRecallAll.value === null ? "N/A" : c.assessment.blockerRecallAll.found + "/" + c.assessment.blockerRecallAll.all}` : ""} | ${c.assessment ? `${c.assessment.citations.valid} / ${c.assessment.citations.supplied}` : ""} | ${c.assessment ? c.assessment.notes.join(", ") || "none" : ""} | ${c.extraction ? cell(c.extraction.unmatchedGold.map((u) => `${u.text} → ${u.nearestExtracted ?? "none"}`).join("; ")) || "none" : ""} |`), "",
  ];
  if (report.problems.length) lines.push("## Golden-set problems", "", ...report.problems.map((p) => `- ${cell(p)}`), "");
  if (comparison) lines.push("## Baseline comparison", "",
    `Compatible: ${comparison.compatible}; comparable cases: ${comparison.compared}; incompatible reasons: ${comparison.incompatibleReasons.join(", ") || "none"}.`,
    `- outcome changed: ${comparison.outcomeChanged.join(", ") || "none"}`, `- verdict changed: ${comparison.verdictChanged.join(", ") || "none"}`,
    `- blocker recall (all) changed: ${comparison.blockerRecallAllChanged.join(", ") || "none"}`, "", comparison.note, "");
  return lines.join("\n");
}
