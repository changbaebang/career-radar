import type { RetrievedEvidence } from "../../src/domain/evidence/retrieve.js";
import type { CandidateProfile, FitAssessment, JobPosting } from "@career-radar/shared";
import type { AnalyzerOperation, AnalyzerResponseEvent, CareerAnalyzer, JobExtraction, ProfileExtraction } from "../../src/ai/analyzer.js";
import type { SearchHit } from "../../src/infra/search/greenhouse.js";
import { expectedDescription, expectedJobId } from "./synthetic-inputs.js";

export type OperationStatus = "ok" | "error" | "aborted" | "unsettled" | "cap_refused";
export type Usage = { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens?: number; reasoningTokens?: number };

// One record per analyzer call. Contains timings, identifiers, counts and hashes only — never the
// request text, the extracted requirement strings or the assessment prose.
export type OperationRecord = {
  seq: number; runId: string; operation: AnalyzerOperation; candidateId: string; mappingError: boolean;
  startedPerf: number; settledPerf?: number; durationMs?: number; status: OperationStatus;
  errorClass?: string; httpStatus?: number; errorCode?: string; requestId?: string;
  responseId?: string; responseModel?: string; upstreamProvider?: string; responseStatus?: string; incompleteReason?: string;
  usage?: Usage; sdkDurationMs?: number; joinMismatch: boolean;
  settledAfterBatchReturn: boolean; abortToSettleMs?: number; waitedMs?: number;
  extraction?: { requiredCount: number; preferredCount: number; coreRequiredCount: number; responsibilitiesCount: number;
    technologiesCount: number; domainsCount: number; seniorityPresent: boolean; warningsCount: number };
};

export class HarnessCallCapError extends Error {
  constructor() { super("Model-call cap reached; the harness refused a further paid call."); this.name = "HarnessCallCapError"; }
}

export type Clock = () => number;

type Pending = { record: OperationRecord; promise: Promise<unknown>; signal?: AbortSignal };

// Wraps any CareerAnalyzer given to JobDiscovery.recommend(). Timing is taken with the wrapper's own
// .then/.catch so it survives recommend()'s Promise.race abandoning an in-flight call at the deadline.
export class MeasuredAnalyzer implements CareerAnalyzer {
  readonly records: OperationRecord[] = [];
  readonly drafts = new Map<number, FitAssessment>();
  readonly evidence = new Map<number, RetrievedEvidence>();
  readonly #inner: CareerAnalyzer;
  readonly #cap: number;
  readonly #clock: Clock;
  readonly #allowProfileExtraction: boolean;
  readonly #byDescription = new Map<string, string>();
  readonly #byJobId = new Map<string, string>();
  readonly #pending = new Map<number, Pending>();
  readonly #seenSignals = new WeakSet<AbortSignal>();
  readonly #abortedPerf = new WeakMap<AbortSignal, number>();
  readonly #hookQueue: AnalyzerResponseEvent[] = [];
  readonly #runAbortedPerf = new Map<string, number>();
  #seq = 0;
  #calls = 0;
  #runId = "setup";

  constructor(inner: CareerAnalyzer, options: { cap: number; clock?: Clock; hits?: SearchHit[]; allowProfileExtraction?: boolean }) {
    this.#inner = inner; this.#cap = options.cap; this.#clock = options.clock ?? (() => performance.now());
    this.#allowProfileExtraction = options.allowProfileExtraction ?? false;
    for (const hit of options.hits ?? []) this.registerHit(hit);
  }

  registerHit(hit: SearchHit): void {
    this.#byDescription.set(expectedDescription(hit), hit.candidate.candidateId);
    this.#byJobId.set(expectedJobId(hit), hit.candidate.candidateId);
  }
  beginRun(runId: string): void { this.#runId = runId; }
  get calls(): number { return this.#calls; }
  runRecords(runId: string): OperationRecord[] { return this.records.filter((r) => r.runId === runId); }
  abortedAt(signal: AbortSignal | undefined): number | undefined { return signal ? this.#abortedPerf.get(signal) : undefined; }
  // First abort observed while a run was active (recommend() creates one AbortController per batch).
  runAbortedAt(runId: string): number | undefined { return this.#runAbortedPerf.get(runId); }

  // Fed by OpenAICareerAnalyzer's onResponse hook. Calls are strictly sequential inside recommend(),
  // so events join to the oldest pending record of the same operation.
  onResponseEvent(event: AnalyzerResponseEvent): void {
    const pending = [...this.#pending.values()].find((p) => p.record.operation === event.operation && p.record.sdkDurationMs === undefined && !p.record.joinMismatch);
    if (!pending) { this.#hookQueue.push(event); return; }
    this.#join(pending.record, event);
  }

  #join(record: OperationRecord, event: AnalyzerResponseEvent): void {
    if (record.operation !== event.operation) { record.joinMismatch = true; return; }
    record.sdkDurationMs = event.durationMs;
    if (event.responseId) record.responseId = event.responseId;
    if (event.responseModel) record.responseModel = event.responseModel;
    if (event.upstreamProvider) record.upstreamProvider = event.upstreamProvider;
    if (event.requestId) record.requestId = event.requestId;
    if (event.responseStatus) record.responseStatus = event.responseStatus;
    if (event.incompleteReason) record.incompleteReason = event.incompleteReason;
    if (event.usage) record.usage = event.usage;
    if (event.error) {
      record.errorClass = event.error.name;
      if (event.error.status !== undefined) record.httpStatus = event.error.status;
      if (event.error.code !== undefined) record.errorCode = event.error.code;
      if (event.error.requestId !== undefined) record.requestId = event.error.requestId;
    }
  }

  extractProfile(resumeText: string, profileId?: string, signal?: AbortSignal): Promise<ProfileExtraction> {
    if (!this.#allowProfileExtraction) return Promise.reject(new Error("Profile extraction is disabled; pass --include-profile-extraction."));
    return this.#measure("extractProfile", "profile", signal, () => this.#inner.extractProfile(resumeText, profileId, signal));
  }

  extractJob(description: string, signal?: AbortSignal): Promise<JobExtraction> {
    const candidateId = this.#byDescription.get(description);
    return this.#measure("extractJob", candidateId, signal, () => this.#inner.extractJob(description, signal), (record, result) => {
      const job = result.job;
      record.extraction = {
        requiredCount: job.required.length, preferredCount: job.preferred.length,
        coreRequiredCount: job.required.filter((r) => r.importance === "core").length,
        responsibilitiesCount: job.responsibilities.length, technologiesCount: job.technologies.length,
        domainsCount: job.domains.length, seniorityPresent: job.seniority !== undefined, warningsCount: result.warnings.length,
      };
    });
  }

  assess(profile: CandidateProfile, job: JobPosting, signal?: AbortSignal, evidence?: RetrievedEvidence): Promise<FitAssessment> {
    const candidateId = this.#byJobId.get(job.id);
    return this.#measure("assess", candidateId, signal, () => this.#inner.assess(profile, job, signal, evidence), (record, result) => {
      this.drafts.set(record.seq, structuredClone(result));
      // M5-B: the retrieval this call saw, so the policy replay resolves the same chunk citations.
      if (evidence) this.evidence.set(record.seq, structuredClone(evidence));
    });
  }

  #measure<T>(operation: AnalyzerOperation, candidateId: string | undefined, signal: AbortSignal | undefined,
    call: () => Promise<T>, onOk?: (record: OperationRecord, result: T) => void): Promise<T> {
    const record: OperationRecord = {
      seq: ++this.#seq, runId: this.#runId, operation, candidateId: candidateId ?? "unknown", mappingError: candidateId === undefined,
      startedPerf: this.#clock(), status: "unsettled", joinMismatch: false, settledAfterBatchReturn: false,
    };
    this.records.push(record);
    this.#watch(signal);
    if (this.#calls >= this.#cap) {
      record.status = "cap_refused"; record.settledPerf = record.startedPerf; record.durationMs = 0; record.errorClass = "HarnessCallCapError";
      return Promise.reject(new HarnessCallCapError());
    }
    this.#calls++;
    const promise = call().then((result) => {
      this.#settle(record, signal, "ok");
      onOk?.(record, result);
      return result;
    }, (error: unknown) => {
      const name = typeof (error as { name?: unknown })?.name === "string" ? (error as { name: string }).name : "Error";
      const aborted = name === "APIUserAbortError" || name === "AbortError" || signal?.aborted === true;
      this.#settle(record, signal, aborted ? "aborted" : "error");
      if (record.errorClass === undefined) record.errorClass = name;
      throw error;
    });
    this.#pending.set(record.seq, { record, promise, signal });
    const queued = this.#hookQueue.findIndex((e) => e.operation === operation);
    if (queued >= 0) this.#join(record, this.#hookQueue.splice(queued, 1)[0]!);
    // The caller may abandon this promise (Promise.race); the wrapper keeps its own settled handler.
    promise.catch(() => undefined);
    return promise;
  }

  #settle(record: OperationRecord, signal: AbortSignal | undefined, status: OperationStatus): void {
    record.settledPerf = this.#clock();
    record.durationMs = record.settledPerf - record.startedPerf;
    record.status = status;
    const abortedAt = this.abortedAt(signal);
    if (abortedAt !== undefined && status === "aborted") record.abortToSettleMs = record.settledPerf - abortedAt;
    this.#pending.delete(record.seq);
  }

  #watch(signal: AbortSignal | undefined): void {
    if (!signal || this.#seenSignals.has(signal)) return;
    this.#seenSignals.add(signal);
    const runId = this.#runId;
    const mark = () => {
      const at = this.#clock();
      this.#abortedPerf.set(signal, at);
      if (!this.#runAbortedPerf.has(runId)) this.#runAbortedPerf.set(runId, at);
    };
    if (signal.aborted) { mark(); return; }
    signal.addEventListener("abort", mark, { once: true });
  }

  // After recommend() returned, wait (bounded) for calls it abandoned so their real duration is known.
  async settle(waitMs: number): Promise<void> {
    const pending = [...this.#pending.values()];
    if (pending.length === 0) return;
    const started = this.#clock();
    await Promise.race([
      Promise.allSettled(pending.map((p) => p.promise)),
      new Promise<void>((resolve) => { const t = setTimeout(resolve, waitMs); t.unref(); }),
    ]);
    for (const p of pending) {
      if (this.#pending.has(p.record.seq)) { p.record.status = "unsettled"; p.record.waitedMs = this.#clock() - started; }
      else p.record.settledAfterBatchReturn = true;
    }
  }
}
