import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { FitAssessment } from "@career-radar/shared";
import type { CareerAnalyzer } from "../../ai/analyzer.js";
import { classifyFailure, type FailureClass } from "../../ai/failure-class.js";
import type { AnalyzerOperation, AnalyzerResponseEvent, ResponseHook } from "../../ai/telemetry.js";
import type { PipelineDiagnostics } from "../assessment/pipeline.js";
import type { RetrievedEvidence } from "../evidence/retrieve.js";

// M5-E run trace: one id per tool call, threaded through the analyzer telemetry, the retrieval
// trace and the pipeline diagnostics, so a slow, invalid or failed assessment can be explained
// stage by stage. A trace holds counts, hashes, ids, timings and fixed classes only: no resume,
// posting, prompt, query or evidence text, and no cost.
export const RUN_TRACE_VERSION = "run-trace-v1";

export type RunTool = "job_assess" | "job_recommend";
export type StageName = "extract" | "retrieve" | "model" | "validate" | "persist";
export type StageOutcome = "ok" | "error" | "aborted";
export type RunOutcome = "ok" | "failed" | "aborted" | "partial";

export type StageRecord = {
  stage: StageName; startedMs: number; durationMs: number; outcome: StageOutcome;
  // Recommendation batches: which candidate (0-based) the stage belongs to.
  item?: number;
  // Model stages: the analyzer operation, the SDK projection from the telemetry hook, and the failure class.
  operation?: AnalyzerOperation; failureClass?: FailureClass; errorName?: string;
  responseModel?: string; upstreamProvider?: string; incompleteReason?: string; usage?: AnalyzerResponseEvent["usage"];
  // Retrieve stages: each query as a hash of its text plus its length and hit ids (chunk ids are content hashes).
  retrieval?: { queries: number; chunks: number; missingTerms: number; queryDigests: { hash: string; length: number; hits: string[] }[] };
  // Validate stages: draft vs final as values and counts, plus what each pipeline stage did.
  validation?: {
    draftVerdict: FitAssessment["verdict"]; finalVerdict: FitAssessment["verdict"]; draftConfidence: FitAssessment["confidence"]; finalConfidence: FitAssessment["confidence"];
    citationsSupplied: number; citationsValid: number; diagnostics: PipelineDiagnostics;
  };
};

export type RunCounters = {
  modelCalls: number; schemaFailures: number; refusals: number; truncations: number; timeouts: number; providerErrors: number; otherFailures: number;
  invalidCitations: number; orphanCitations: number; rekeyedCitations: number; ungroundedMatchesRemoved: number; screeningContextDiscarded: number;
  // Reserved: no fallback path and no tool use exist (M5-C dropped); always 0.
  fallbacks: number; toolFailures: number;
};

export type RunTrace = {
  version: typeof RUN_TRACE_VERSION; runId: string; tool: RunTool; startedAt: string; endedAt: string; durationMs: number;
  outcome: RunOutcome; failureClass?: FailureClass; stages: StageRecord[]; counters: RunCounters;
};

const storage = new AsyncLocalStorage<RunTracer>();
export const currentTrace = (): RunTracer | undefined => storage.getStore();
export const runWithTrace = <T>(tracer: RunTracer, fn: () => Promise<T>): Promise<T> => storage.run(tracer, fn);
// Install once on a shared analyzer: every telemetry event is attributed to the run that is
// executing when it fires, without changing the analyzer's signature.
export const traceHook: ResponseHook = (event) => { currentTrace()?.attach(event); };

export const digestQuery = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export class RunTracer {
  readonly runId = randomUUID();
  readonly tool: RunTool;
  readonly #startedAt = new Date();
  readonly #origin = performance.now();
  readonly #stages: StageRecord[] = [];
  #item: number | undefined;

  constructor(tool: RunTool) { this.tool = tool; }

  // Recommendation batches call this per candidate so following stages carry the index.
  item(index: number | undefined): void { this.#item = index; }

  #now(): number { return Math.round(performance.now() - this.#origin); }
  #push(record: StageRecord): StageRecord { const stamped = { ...record, ...(this.#item === undefined ? {} : { item: this.#item }) }; this.#stages.push(stamped); return stamped; }

  // Times a synchronous or asynchronous stage; errors propagate after the stage is recorded. The
  // record is pushed before the work starts so the telemetry hook can find it while a call is open.
  async stage<T>(stage: StageName, run: () => T | Promise<T>, detail?: (result: T) => Partial<StageRecord>, init: Partial<StageRecord> = {}): Promise<T> {
    const record = this.#push({ stage, startedMs: this.#now(), durationMs: 0, outcome: "ok", ...init });
    try {
      const result = await run();
      Object.assign(record, { durationMs: this.#now() - record.startedMs }, detail ? detail(result) : {});
      return result;
    } catch (error) {
      const failureClass = classifyFailure(error);
      Object.assign(record, { durationMs: this.#now() - record.startedMs, outcome: failureClass === "timeout" ? "aborted" : "error", failureClass, errorName: error instanceof Error ? error.name : "Error" });
      throw error;
    }
  }

  retrieveDetail(evidence: RetrievedEvidence): Partial<StageRecord> {
    return { retrieval: {
      queries: evidence.traces.length, chunks: evidence.chunks.length, missingTerms: evidence.traces.reduce((n, trace) => n + trace.misses.length, 0),
      queryDigests: evidence.traces.map((trace) => ({ hash: digestQuery(trace.query), length: trace.query.length, hits: trace.hits.map((hit) => hit.chunkId) })),
    } };
  }

  validateDetail(draft: FitAssessment, final: FitAssessment, diagnostics: PipelineDiagnostics): Partial<StageRecord> {
    return { validation: {
      draftVerdict: draft.verdict, finalVerdict: final.verdict, draftConfidence: draft.confidence, finalConfidence: final.confidence,
      citationsSupplied: draft.citations?.length ?? 0, citationsValid: final.citations?.length ?? 0, diagnostics,
    } };
  }

  // Every analyzer call becomes an extract (profile/job) or model (assess) stage with its own timing
  // and failure class; the telemetry hook adds the SDK projection to the open stage of that operation.
  wrap(inner: CareerAnalyzer): CareerAnalyzer {
    const call = <T>(operation: AnalyzerOperation, run: () => Promise<T>) => this.stage(operation === "assess" ? "model" : "extract", run, undefined, { operation });
    return {
      extractProfile: (text, id, signal) => call("extractProfile", () => inner.extractProfile(text, id, signal)),
      extractJob: (description, signal) => call("extractJob", () => inner.extractJob(description, signal)),
      assess: (profile, job, signal, evidence) => call("assess", () => inner.assess(profile, job, signal, evidence)),
    };
  }

  attach(event: AnalyzerResponseEvent): void {
    event.runId = this.runId;
    const open = [...this.#stages].reverse().find((record) => record.operation === event.operation && record.durationMs === 0 && record.usage === undefined);
    if (!open) return;
    if (event.responseModel) open.responseModel = event.responseModel;
    if (event.upstreamProvider) open.upstreamProvider = event.upstreamProvider;
    if (event.incompleteReason) open.incompleteReason = event.incompleteReason;
    if (event.usage) open.usage = event.usage;
  }

  finish(outcome: RunOutcome, error?: unknown): RunTrace {
    const endedAt = new Date();
    const failures = (kind: FailureClass) => this.#stages.filter((record) => record.failureClass === kind).length;
    const validations = this.#stages.map((record) => record.validation?.diagnostics).filter((d): d is PipelineDiagnostics => d !== undefined);
    const sum = (pick: (d: PipelineDiagnostics) => number) => validations.reduce((n, d) => n + pick(d), 0);
    const counters: RunCounters = {
      modelCalls: this.#stages.filter((record) => record.operation !== undefined).length,
      schemaFailures: failures("schema_failure"), refusals: failures("refusal"), truncations: failures("truncation"), timeouts: failures("timeout"),
      providerErrors: failures("provider_error"), otherFailures: failures("other"),
      invalidCitations: sum((d) => d.citationsInvalid), orphanCitations: sum((d) => d.citationsOrphaned), rekeyedCitations: sum((d) => d.citationsRekeyed),
      ungroundedMatchesRemoved: sum((d) => d.ungroundedMatchesRemoved), screeningContextDiscarded: validations.filter((d) => d.screeningContextDiscarded).length,
      fallbacks: 0, toolFailures: 0,
    };
    return {
      version: RUN_TRACE_VERSION, runId: this.runId, tool: this.tool, startedAt: this.#startedAt.toISOString(), endedAt: endedAt.toISOString(),
      durationMs: Math.max(0, endedAt.getTime() - this.#startedAt.getTime()), outcome,
      ...(error !== undefined ? { failureClass: classifyFailure(error) } : {}), stages: this.#stages.map((record) => ({ ...record })), counters,
    };
  }
}
