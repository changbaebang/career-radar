import { createHash } from "node:crypto";
import { CandidateProfileSchema, JobPostingSchema, type CandidateProfile, type JobPosting } from "@career-radar/shared";

export function hashSource(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}
export function stableId(prefix: "profile" | "job", source: string): string {
  return `${prefix}_${hashSource(source).slice(0, 16)}`;
}
export class CareerStore {
  readonly #profiles = new Map<string, CandidateProfile>();
  readonly #jobs = new Map<string, JobPosting>();
  upsertProfile(profile: CandidateProfile): CandidateProfile {
    const parsed = CandidateProfileSchema.parse(profile); this.#profiles.set(parsed.id, parsed); return parsed;
  }
  upsertJob(job: JobPosting): JobPosting {
    const parsed = JobPostingSchema.parse(job); this.#jobs.set(parsed.id, parsed); return parsed;
  }
  getProfile(id: string): CandidateProfile | undefined { return this.#profiles.get(id); }
  getJob(id: string): JobPosting | undefined { return this.#jobs.get(id); }
  clear(): void { this.#profiles.clear(); this.#jobs.clear(); }
}
