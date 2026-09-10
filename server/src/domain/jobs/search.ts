import { randomUUID } from "node:crypto";
import {
  JobSearchInputSchema, JobSearchResultSchema, JobRecommendInputSchema, JobRecommendationsSchema,
  JobPostingSchema, type JobSearchResult, type JobRecommendations, type RecommendedJob,
} from "@career-radar/shared";
import type { CareerAnalyzer } from "../../ai/analyzer.js";
import type { JobSearchProvider, SearchHit } from "../../infra/search/greenhouse.js";
import { applyAssessmentPolicy } from "../assessment/policy.js";
import { CareerStore, stableId } from "../store.js";

const TTL_MS = 30 * 60_000;
type SearchSnapshot = { result: JobSearchResult; hits: SearchHit[]; timer: ReturnType<typeof setTimeout> };

export function groupRecommendations(
  items: RecommendedJob[], realisticCount: number, stretchCount: number, includePass: boolean,
): Pick<JobRecommendations, "available" | "shortfall" | "realistic" | "stretch" | "pass"> {
  const confidence = { high: 0, medium: 1, low: 2 };
  const contortion = { low: 0, medium: 1, high: 2 };
  const sorted = [...items].sort((a, b) => confidence[a.assessment.confidence] - confidence[b.assessment.confidence]
    || contortion[a.assessment.resumeContortion] - contortion[b.assessment.resumeContortion]
    || a.candidate.candidateId.localeCompare(b.candidate.candidateId));
  const realistic = sorted.filter((item) => item.assessment.verdict === "REALISTIC");
  const stretch = sorted.filter((item) => item.assessment.verdict === "STRETCH");
  const pass = sorted.filter((item) => item.assessment.verdict === "PASS");
  return {
    available: { realistic: realistic.length, stretch: stretch.length, pass: pass.length },
    shortfall: { realistic: Math.max(0, realisticCount - realistic.length), stretch: Math.max(0, stretchCount - stretch.length) },
    // Every assessed role is returned. The requested counts only drive `shortfall`; hiding paid
    // assessments would force a second batch (and a second model bill) just to see them.
    realistic, stretch, pass: includePass ? pass : [],
  };
}

// One instance per HTTP app, not per MCP request. The cache holds public jobs only.
export class JobDiscovery {
  readonly #searches = new Map<string, SearchSnapshot>();
  #busy = false;
  constructor(private readonly provider: JobSearchProvider, private readonly now: () => Date = () => new Date()) {}

  async search(raw: unknown): Promise<JobSearchResult> {
    const input = JobSearchInputSchema.parse(raw);
    const found = await this.provider.search(input);
    const searchId = `search_${randomUUID()}`;
    const result = JobSearchResultSchema.parse({
      kind: "job_search", searchId, provider: found.provider, sourceUrl: found.sourceUrl,
      retrievedAt: found.retrievedAt, expiresAt: new Date(this.now().getTime() + TTL_MS).toISOString(),
      matchedCount: found.matchedCount, candidates: found.hits.map((hit) => hit.candidate), warnings: found.warnings,
    });
    while (this.#searches.size >= 10) this.remove(this.#searches.keys().next().value!);
    const timer = setTimeout(() => this.remove(searchId), TTL_MS);
    timer.unref();
    this.#searches.set(searchId, { result, hits: structuredClone(found.hits), timer });
    return result;
  }

  private remove(id: string): void {
    const entry = this.#searches.get(id);
    if (entry) clearTimeout(entry.timer);
    this.#searches.delete(id);
  }
  close(): void { for (const id of this.#searches.keys()) this.remove(id); }

  async recommend(raw: unknown, store: CareerStore, createAnalyzer: () => CareerAnalyzer): Promise<JobRecommendations> {
    const input = JobRecommendInputSchema.parse(raw);
    if (new Set(input.candidateIds).size !== input.candidateIds.length) throw new Error("Select unique candidate IDs.");
    if (input.realisticCount + input.stretchCount > 5) throw new Error("Request at most five REALISTIC and STRETCH roles in total.");
    if (input.realisticCount + input.stretchCount === 0 && !input.includePass) throw new Error("Request at least one recommendation group or PASS explanations.");
    const snapshot = this.#searches.get(input.searchId);
    if (!snapshot || Date.parse(snapshot.result.expiresAt) <= this.now().getTime()) {
      this.remove(input.searchId);
      throw new Error("Search expired or was evicted. Call job_search again and use its candidate IDs.");
    }
    const hits = input.candidateIds.map((id) => snapshot.hits.find((hit) => hit.candidate.candidateId === id));
    if (hits.some((hit) => !hit)) throw new Error("Every candidate ID must belong to this search. Call job_search to choose valid IDs.");
    const profile = store.getProfile(input.candidateProfileId);
    if (!profile) throw new Error("Candidate profile not found. Call profile_upsert first.");
    // Configuration failures (for example a missing API key) must surface with their own message and
    // cost nothing; only per-job analysis failures are reported as batch failures below.
    const analyzer = createAnalyzer();
    if (this.#busy) throw new Error("A recommendation batch is already running. Wait for it before retrying.");
    this.#busy = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("Recommendation deadline exceeded.")), { once: true });
    });
    const items: RecommendedJob[] = [];
    const failures: JobRecommendations["failures"] = [];
    const warnings = [...snapshot.result.warnings,
      "Assessed only the selected jobs; every assessed role is returned. Requested counts only report shortfalls and never change verdicts. Ranking uses confidence, contortion, then ID, not hiring probability.",
      "Assessment snapshots are saved locally; no application was added or sent. Retrying performs new analysis and may incur model cost."];
    try {
      for (const hit of hits) {
        if (!hit) continue; // Membership was checked for the complete batch above.
        if (failures.length) {
          failures.push({ candidateId: hit.candidate.candidateId, message: "Not attempted after an earlier analysis failure. Select this ID explicitly to retry." });
          continue;
        }
        try {
          const description = `Greenhouse board token: ${hit.candidate.boardToken}\nTitle: ${hit.candidate.title}\nLocation: ${hit.candidate.location}\n\n${hit.description}`;
          // Bind identity to provider source + content, not an arbitrary model-generated ID.
          const jobId = stableId("job", `${hit.candidate.sourceUrl}\n${description}`);
          let job = store.getJob(jobId);
          if (!job) {
            const extracted = await Promise.race([analyzer.extractJob(description, controller.signal), aborted]);
            job = JobPostingSchema.parse({ ...extracted.job, id: jobId, title: hit.candidate.title,
              sourceUrl: hit.candidate.sourceUrl, location: hit.candidate.location || undefined, description });
            warnings.push(...extracted.warnings);
            // Public job text: persist as soon as it is extracted so a failed assessment does not
            // discard a paid extraction and a retry only re-runs the assessment.
            store.upsertJob(job);
          }
          const draft = await Promise.race([analyzer.assess(profile, job, controller.signal), aborted]);
          const assessment = applyAssessmentPolicy(profile, job, draft);
          controller.signal.throwIfAborted();
          const assessmentId = store.saveAssessment(profile.id, job, assessment);
          items.push({ candidate: hit.candidate, jobId: job.id, assessmentId, assessment });
        } catch {
          failures.push({ candidateId: hit.candidate.candidateId, message: "Analysis failed or timed out. Check model credit and network, then retry explicitly. This is not a PASS verdict." });
        }
      }
      return JobRecommendationsSchema.parse({
        kind: "job_recommendations", searchId: input.searchId, provider: snapshot.result.provider,
        sourceUrl: snapshot.result.sourceUrl, retrievedAt: snapshot.result.retrievedAt, assessedAt: this.now().toISOString(),
        requested: { realistic: input.realisticCount, stretch: input.stretchCount },
        ...groupRecommendations(items, input.realisticCount, input.stretchCount, input.includePass), failures, warnings,
      });
    } finally { clearTimeout(timer); this.#busy = false; }
  }
}
