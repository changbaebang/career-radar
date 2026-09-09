import { createHash } from "node:crypto";
import { CandidateProfileSchema, JobPostingSchema, type CandidateProfile, type JobPosting } from "@career-radar/shared";

export function hashSource(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}
export function stableId(prefix: "profile" | "job", source: string): string {
  return `${prefix}_${hashSource(source).slice(0, 16)}`;
}

export type StoreOptions = { maxEntries?: number; ttlMs?: number };
type Entry<T> = { value: T; expiresAt: number; timer: ReturnType<typeof setTimeout> };

// A fixed write TTL bounds retention even when the server receives no more requests.
// The cap applies independently to profiles and jobs; oldest writes are evicted first.
class BoundedRecords<T extends { id: string }> {
  readonly #entries = new Map<string, Entry<T>>();
  constructor(private readonly maxEntries: number, private readonly ttlMs: number) {}

  set(value: T): T {
    this.delete(value.id);
    if (this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.delete(oldest);
    }
    const timer = setTimeout(() => this.delete(value.id), this.ttlMs);
    timer.unref();
    this.#entries.set(value.id, { value, expiresAt: Date.now() + this.ttlMs, timer });
    return value;
  }

  get(id: string): T | undefined {
    const entry = this.#entries.get(id);
    if (entry && entry.expiresAt <= Date.now()) {
      this.delete(id);
      return undefined;
    }
    return entry?.value;
  }

  delete(id: string): void {
    const entry = this.#entries.get(id);
    if (entry) clearTimeout(entry.timer);
    this.#entries.delete(id);
  }

  clear(): void {
    for (const id of this.#entries.keys()) this.delete(id);
  }
}

export class CareerStore {
  readonly #profiles: BoundedRecords<CandidateProfile>;
  readonly #jobs: BoundedRecords<JobPosting>;

  constructor({ maxEntries = 100, ttlMs = 30 * 60 * 1000 }: StoreOptions = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error("maxEntries must be a positive integer.");
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 2_147_483_647) {
      throw new Error("ttlMs must be between 1 and 2147483647 milliseconds.");
    }
    this.#profiles = new BoundedRecords(maxEntries, ttlMs);
    this.#jobs = new BoundedRecords(maxEntries, ttlMs);
  }
  upsertProfile(profile: CandidateProfile): CandidateProfile {
    return this.#profiles.set(CandidateProfileSchema.parse(profile));
  }
  upsertJob(job: JobPosting): JobPosting {
    return this.#jobs.set(JobPostingSchema.parse(job));
  }
  getProfile(id: string): CandidateProfile | undefined { return this.#profiles.get(id); }
  getJob(id: string): JobPosting | undefined { return this.#jobs.get(id); }
  clear(): void { this.#profiles.clear(); this.#jobs.clear(); }
}
