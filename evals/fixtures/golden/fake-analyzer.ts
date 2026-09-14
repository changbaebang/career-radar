import { CandidateProfileSchema, FitAssessmentSchema, JobPostingSchema, type CandidateProfile, type FitAssessment, type JobPosting } from "@career-radar/shared";
import type { CareerAnalyzer, JobExtraction, ProfileExtraction } from "../../../server/src/ai/analyzer.js";
import type { AnalyzerResponseEvent } from "../../../server/src/ai/telemetry.js";
import { OPENROUTER_ERRORS } from "../../../server/src/ai/openrouter.js";
import { matchClaimId } from "../../../server/src/domain/assessment/claims.js";
import { normalizeEvidence } from "../../../server/src/domain/assessment/normalize.js";
import type { RetrievedEvidence } from "../../../server/src/domain/evidence/retrieve.js";
import { tokenize } from "../../../server/src/domain/evidence/lexical.js";
import { hashSource, stableId } from "../../../server/src/domain/store.js";
import { parsePosting, parseResume } from "./format.js";

// Deterministic stand-in for a model over the golden text format. It verifies the model-mode runner
// end to end without a network: extraction parses the format, assessment is a fixed token-overlap
// rule, citations name the retrieved chunk that carries the evidence sentence. Its verdicts are not
// gold and are not meant to agree with the golden set; the runner's numbers under this fake are a
// check of the runner, not of any model.
export type FakeFailure =
  | { stage: "extractProfile" | "extractJob" | "assess"; kind: "truncation" | "schema_failure" | "refusal" | "timeout" | "provider_error" | "other" };

export type GoldenFakeOptions = {
  // caseKey → failure to raise on that case's call; the key is the resume/posting text's stableId prefix, see keyFor().
  failures?: Map<string, FakeFailure>;
  // Drop the n-th required requirement (0-based), or every one ("all"), at extraction for the postings whose key is listed.
  dropRequirement?: Map<string, number | "all">;
  // Appended to generated ids so two runs get fresh ids for the same texts (scores must not depend on ids).
  idSalt?: string;
  // Invent an employer for postings that name none (an extraction defect the runner must count).
  inventEmployer?: boolean;
  // Cite a chunk id that this run never retrieved (the validator must drop it and note it).
  badCitation?: boolean;
  // Give every match an evidence sentence that is not in the profile (the policy must remove it).
  ungroundedEvidence?: boolean;
  onResponse?: (event: AnalyzerResponseEvent) => void;
  // Simulated latency per call; it ends early with an AbortError when the call's signal fires.
  delayMs?: number;
};

// Text key used to target failures at a case: a content hash prefix, independent of any id salt.
export const keyFor = (text: string) => hashSource(text).slice(0, 16);

const STOP = new Set(["a", "an", "the", "of", "for", "to", "in", "on", "and", "or", "with", "is", "are", "required", "mandatory", "experience", "years"]);
const content = (text: string) => new Set(tokenize(text).filter((token) => token.length >= 3 && !STOP.has(token)));
const overlap = (a: string, b: string) => { const x = content(a), y = content(b); return [...x].filter((t) => y.has(t)).length; };

function abortError(): Error { const error = new Error("The operation was aborted"); error.name = "AbortError"; return error; }
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class GoldenFakeAnalyzer implements CareerAnalyzer {
  readonly #options: GoldenFakeOptions;
  constructor(options: GoldenFakeOptions = {}) { this.#options = options; }

  #fail(stage: FakeFailure["stage"], key: string): void {
    const failure = this.#options.failures?.get(key);
    if (!failure || failure.stage !== stage) return;
    switch (failure.kind) {
      case "truncation": throw new Error(OPENROUTER_ERRORS.truncated);
      case "schema_failure": throw new Error(OPENROUTER_ERRORS.schemaMismatch);
      case "refusal": throw new Error(OPENROUTER_ERRORS.refused);
      case "timeout": throw abortError();
      case "provider_error": { const error = new Error("synthetic provider request failed (HTTP 500)"); error.name = "InternalServerError"; throw error; }
      default: throw new Error("synthetic unclassified failure");
    }
  }

  async #observe<T>(operation: AnalyzerResponseEvent["operation"], key: string, signal: AbortSignal | undefined, call: () => T): Promise<T> {
    const startedAt = performance.now();
    try {
      if (signal?.aborted) throw abortError();
      if (this.#options.delayMs) await sleep(this.#options.delayMs, signal);
      this.#fail(operation, key);
      const result = call();
      this.#options.onResponse?.({ operation, requestedModel: "golden-fake", durationMs: performance.now() - startedAt, outcome: "ok",
        responseModel: "golden-fake", upstreamProvider: "fake", usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } });
      return result;
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      this.#options.onResponse?.({ operation, requestedModel: "golden-fake", durationMs: performance.now() - startedAt, outcome: "error", error: { name } });
      throw error;
    }
  }

  extractProfile(resumeText: string, profileId?: string, signal?: AbortSignal): Promise<ProfileExtraction> {
    return this.#observe("extractProfile", keyFor(resumeText), signal, () => {
      const spec = parseResume(resumeText);
      const profile = CandidateProfileSchema.parse({
        id: profileId ?? `${stableId("profile", resumeText)}${this.#options.idSalt ?? ""}`, headline: spec.headline,
        roles: [{ company: "Synthetic Employer", title: spec.headline, responsibilities: spec.experience, evidence: spec.experience }],
        skills: spec.skills ?? [], domains: [], leadership: [], customerFacing: [], aiEvidence: [], cloudEvidence: [],
        ...(spec.constraints ? { constraints: { locations: [spec.constraints] } } : {}),
        sourceHash: hashSource(resumeText),
      });
      return { profile, warnings: [] };
    });
  }

  extractJob(description: string, signal?: AbortSignal): Promise<JobExtraction> {
    return this.#observe("extractJob", keyFor(description), signal, () => {
      const spec = parsePosting(description);
      const id = `${stableId("job", description)}${this.#options.idSalt ?? ""}`;
      const drop = this.#options.dropRequirement?.get(keyFor(description));
      const required = drop === "all" ? [] : spec.required.filter((_, index) => index !== drop);
      const typed = (text: string) => ({
        text, type: /japanese|korean|language/i.test(text) ? "language" as const : /city|relocat|on-site/i.test(text) ? "location" as const
          : /certif/i.test(text) ? "certification" as const : /degree/i.test(text) ? "education" as const : /lead|mentor|organization/i.test(text) ? "leadership" as const : "technology" as const,
        importance: "core" as const,
      });
      const job = JobPostingSchema.parse({
        id, ...(spec.company ? { company: spec.company } : this.#options.inventEmployer ? { company: "Invented Corp" } : {}), title: spec.title, description, roleFamily: spec.title,
        required: required.map((text, index) => ({ id: `${id}_required_${index + 1}`, ...typed(text) })),
        preferred: (spec.preferred ?? []).map((text, index) => ({ id: `${id}_preferred_${index + 1}`, ...typed(text), importance: "nice_to_have" as const })),
        responsibilities: spec.responsibilities ?? [], domains: [], technologies: [],
      });
      return { job, warnings: [] };
    });
  }

  assess(profile: CandidateProfile, job: JobPosting, signal?: AbortSignal, evidence?: RetrievedEvidence): Promise<FitAssessment> {
    return this.#observe("assess", keyFor(job.description), signal, () => {
      const sentences = profile.roles.flatMap((role) => role.evidence);
      const negated = (sentence: string) => /\bnever\b|\bnot\b/i.test(sentence);
      const matches: FitAssessment["strongestMatches"] = [];
      const gaps: FitAssessment["gaps"] = [];
      for (const requirement of job.required) {
        const best = sentences.filter((s) => !negated(s)).map((s) => ({ s, n: overlap(requirement.text, s) })).sort((a, b) => b.n - a.n)[0];
        if (best && best.n >= 1) matches.push({ requirementId: requirement.id, requirement: requirement.text, evidence: this.#options.ungroundedEvidence ? "Invented evidence sentence that the profile does not contain." : best.s, source: {}, strength: best.n >= 2 ? "direct" : "adjacent" });
        else gaps.push({ requirementId: requirement.id, requirement: requirement.text, reason: "No evidence sentence overlaps this requirement.",
          severity: /mandatory|required|years of|organization/i.test(requirement.text) ? "hard_blocker" : "material" });
      }
      for (const requirement of job.preferred) {
        if (!sentences.some((s) => overlap(requirement.text, s) >= 1)) gaps.push({ requirementId: requirement.id, requirement: requirement.text, reason: "No evidence for this preferred item.", severity: "minor" });
      }
      const chunks = new Map((evidence?.chunks ?? []).map((chunk) => [normalizeEvidence(chunk.text), chunk]));
      const citations = matches.flatMap((match) => {
        if (this.#options.badCitation) return [{ claimId: matchClaimId(match), ref: { source: "evidence" as const, path: `chunk:${"f".repeat(64)}`, quote: match.evidence } }];
        const chunk = chunks.get(normalizeEvidence(match.evidence));
        return chunk ? [{ claimId: matchClaimId(match), ref: { source: "evidence" as const, path: `chunk:${chunk.id}`, quote: chunk.text } }] : [];
      });
      const verdict = gaps.some((gap) => gap.severity === "hard_blocker") ? "PASS" : matches.length === job.required.length && matches.length > 0 ? "REALISTIC" : "STRETCH";
      return FitAssessmentSchema.parse({
        verdict, confidence: "medium", resumeContortion: "low", strongestMatches: matches, gaps, hardBlockers: [], interviewRisks: [],
        recommendation: "Synthetic fake recommendation; not a model output.", missingInformation: [], citations,
        modelVersion: "golden-fake", promptVersion: "golden-fake-prompt",
      });
    });
  }
}
