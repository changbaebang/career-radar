import { CandidateProfileSchema, FitAssessmentSchema, JobPostingSchema, type CandidateProfile, type FitAssessment, type JobPosting } from "@career-radar/shared";
import type { CareerAnalyzer, JobExtraction, ProfileExtraction } from "../../src/ai/analyzer.js";
import { matchClaimId } from "../../src/domain/assessment/claims.js";
import type { RetrievedEvidence } from "../../src/domain/evidence/retrieve.js";
import { hashSource, stableId } from "../../src/domain/store.js";
import { SYNTHETIC_EVIDENCE_SENTINEL, measurementProfile } from "./synthetic-inputs.js";
import type { Scenario } from "./gate.js";

// Dry-run stand-in for the OpenAI analyzer. Never touches the network; honours AbortSignal like the
// SDK does (rejects with an AbortError) so abort propagation can be exercised without a model.
export class FakeCareerAnalyzer implements CareerAnalyzer {
  readonly #scenario: Scenario;
  readonly #delayMs: number;
  #assessedJobs: string[] = [];
  #failedOnce = new Set<string>();
  #stalledOnce = new Set<string>();

  constructor(scenario: Scenario = "ok", delayMs = 20) { this.#scenario = scenario; this.#delayMs = delayMs; }

  async extractProfile(resumeText: string, profileId?: string, signal?: AbortSignal): Promise<ProfileExtraction> {
    await this.#wait(signal);
    const profile = CandidateProfileSchema.parse({ ...measurementProfile, id: profileId ?? stableId("profile", resumeText), sourceHash: hashSource(resumeText) });
    return { profile, warnings: ["synthetic extraction"] };
  }

  async extractJob(description: string, signal?: AbortSignal): Promise<JobExtraction> {
    const id = stableId("job", description);
    if (this.#scenario === "stall" && this.#nthDistinct(id, "extract") === 2 && !this.#stalledOnce.has(id)) {
      this.#stalledOnce.add(id);
      await this.#never(signal); // resolves only through abort
    }
    await this.#wait(signal);
    const title = /^Title: (.+)$/m.exec(description)?.[1] ?? "Synthetic role";
    const job = JobPostingSchema.parse({
      id, company: "Synthetic Employer", title, description, roleFamily: "Frontend Engineering",
      required: [{ id: `${id}_required_1`, text: "Lead a React team", type: "leadership", importance: "core" }],
      preferred: [], responsibilities: ["Mentor engineers"], domains: [], technologies: ["React"],
    });
    return { job, warnings: [] };
  }

  async assess(profile: CandidateProfile, job: JobPosting, signal?: AbortSignal, evidence?: RetrievedEvidence): Promise<FitAssessment> {
    const nth = this.#nthDistinct(job.id, "assess");
    await this.#wait(signal);
    if (this.#scenario === "fail-at-3" && nth === 3 && !this.#failedOnce.has(job.id)) {
      this.#failedOnce.add(job.id);
      throw new Error("SYNTHETIC_PROVIDER_FAILURE");
    }
    const sentence = profile.leadership[0] ?? profile.roles[0]?.evidence[0] ?? SYNTHETIC_EVIDENCE_SENTINEL;
    const match = { requirementId: job.required[0]?.id, requirement: job.required[0]?.text ?? "Lead a React team", evidence: sentence, source: {}, strength: "direct" as const };
    // M5-B: cite the retrieved chunk that carries the evidence sentence, when this run retrieved it.
    const chunk = evidence?.chunks.find((candidate) => candidate.text === sentence);
    return FitAssessmentSchema.parse({
      verdict: "REALISTIC", confidence: "medium", resumeContortion: "low",
      strongestMatches: [match],
      citations: chunk ? [{ claimId: matchClaimId(match), ref: { source: "evidence", path: `chunk:${chunk.id}`, quote: chunk.text } }] : [],
      gaps: [], hardBlockers: [], interviewRisks: [], missingInformation: [],
      recommendation: `${SYNTHETIC_EVIDENCE_SENTINEL} synthetic recommendation; not a model output.`,
      modelVersion: "synthetic-no-model", promptVersion: "synthetic-harness-v1",
    });
  }

  #extractOrder: string[] = [];
  #nthDistinct(id: string, kind: "extract" | "assess"): number {
    const list = kind === "extract" ? this.#extractOrder : this.#assessedJobs;
    if (!list.includes(id)) list.push(id);
    return list.indexOf(id) + 1;
  }

  #wait(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(abortError()); return; }
      const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, this.#delayMs);
      function onAbort() { clearTimeout(timer); reject(abortError()); }
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  #never(signal?: AbortSignal): Promise<never> {
    return new Promise((_resolve, reject) => {
      if (signal?.aborted) { reject(abortError()); return; }
      signal?.addEventListener("abort", () => reject(abortError()), { once: true });
    });
  }
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
