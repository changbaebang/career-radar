import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  CandidateProfileSchema, JobPostingSchema, FitAssessmentSchema, ApplicationSchema,
  ApplicationSaveInputSchema, ApplicationUpdateInputSchema, PipelineInputSchema, PipelineSummarySchema,
  ApplicationStatusSchema, VerdictSchema, AssessmentInputIdentitySchema,
  type CandidateProfile, type JobPosting, type FitAssessment, type Application,
  type ApplicationSaveInput, type ApplicationUpdateInput, type PipelineInput, type PipelineSummary,
} from "@career-radar/shared";
import { migrate } from "../infra/db/migrations.js";
import { assessmentInputIdentity } from "./assessment/input-identity.js";
import { outcomeEvent, readOutcomeEvent, summarizeStages, updateOutcome, withOutcomeDefaults } from "./outcomes.js";

export function hashSource(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}
export function stableId(prefix: "profile" | "job", source: string): string {
  return `${prefix}_${hashSource(source).slice(0, 16)}`;
}

const SnapshotSchema = z.object({
  id: z.string(), profileId: z.string(), job: JobPostingSchema,
  assessment: FitAssessmentSchema, createdAt: z.string().datetime(),
  inputIdentity: AssessmentInputIdentitySchema.optional(),
});

export class CareerStore {
  readonly #db: DatabaseSync;
  constructor(path = ":memory:", private readonly now: () => Date = () => new Date()) {
    const previousMask = process.umask(0o077);
    try { this.#db = new DatabaseSync(path); }
    finally { process.umask(previousMask); }
    try { migrate(this.#db); } catch (error) { this.#db.close(); throw error; }
  }
  private read(table: "candidate_profiles" | "jobs" | "assessments" | "applications", id: string): unknown {
    const row = this.#db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  upsertProfile(profile: CandidateProfile): CandidateProfile {
    const value = CandidateProfileSchema.parse(profile);
    this.#db.prepare("INSERT INTO candidate_profiles VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(value.id, JSON.stringify(value));
    return value;
  }
  upsertJob(job: JobPosting): JobPosting {
    const value = JobPostingSchema.parse(job);
    this.#db.prepare("INSERT INTO jobs VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(value.id, JSON.stringify(value));
    return value;
  }
  getProfile(id: string): CandidateProfile | undefined {
    const value = this.read("candidate_profiles", id);
    return value === undefined ? undefined : CandidateProfileSchema.parse(value);
  }
  getJob(id: string): JobPosting | undefined {
    const value = this.read("jobs", id);
    return value === undefined ? undefined : JobPostingSchema.parse(value);
  }
  saveAssessment(profile: CandidateProfile, job: JobPosting, assessment: FitAssessment): string {
    // Use the captured assessment input, not a profile re-read after asynchronous model work.
    const profileId = profile.id;
    const snapshot = SnapshotSchema.parse({ id: `assessment_${randomUUID()}`, profileId, job, assessment,
      inputIdentity: assessmentInputIdentity(profile, job), createdAt: this.now().toISOString() });
    this.#db.prepare("INSERT INTO assessments VALUES (?, ?, ?, ?)")
      .run(snapshot.id, profileId, job.id, JSON.stringify(snapshot));
    return snapshot.id;
  }
  private transaction<T>(work: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.#db.exec("COMMIT"); return result; }
    catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }
  // Only typed outcome facts enter history; no notes, free text, profile or job copies.
  private event(application: Application): void {
    this.#db.prepare("INSERT INTO application_events (application_id, data) VALUES (?, ?)")
      .run(application.id, JSON.stringify(outcomeEvent(application)));
  }
  saveApplication(input: ApplicationSaveInput): Application {
    const { assessmentId, status } = ApplicationSaveInputSchema.parse(input);
    return this.transaction(() => {
      const raw = this.read("assessments", assessmentId);
      if (!raw) throw new Error("Assessment not found. Call job_assess first; use its assessmentId.");
      const snapshot = SnapshotSchema.parse(raw);
      const existing = this.#db.prepare("SELECT data FROM applications WHERE profile_id = ? AND job_id = ?")
        .get(snapshot.profileId, snapshot.job.id);
      // Retries must not revert a later outcome or replace the original decision snapshot.
      if (existing) return ApplicationSchema.parse(JSON.parse(String(existing.data)));
      const timestamp = this.now().toISOString();
      const application = ApplicationSchema.parse({
        id: `application_${randomUUID()}`, jobId: snapshot.job.id, candidateProfileId: snapshot.profileId,
        assessmentId, status, verdictAtDecision: snapshot.assessment.verdict,
        roleFamily: snapshot.job.roleFamily, company: snapshot.job.company, title: snapshot.job.title,
        createdAt: timestamp, updatedAt: timestamp,
        normalizedOutcomeStage: "unknown", outcomeProvenance: "user_report", outcomeRevision: 0,
        ...(status === "applied" ? { appliedAt: timestamp } : {}),
      });
      this.#db.prepare("INSERT INTO applications VALUES (?, ?, ?, ?, ?)")
        .run(application.id, application.candidateProfileId, application.jobId, assessmentId, JSON.stringify(application));
      this.event(application);
      return application;
    });
  }
  updateApplication(input: ApplicationUpdateInput): Application {
    const parsed = ApplicationUpdateInputSchema.parse(input);
    const { applicationId, status } = parsed;
    if (parsed.occurredAt && Date.parse(parsed.occurredAt) > this.now().getTime()) throw new Error("occurredAt cannot be in the future.");
    return this.transaction(() => {
      const raw = this.read("applications", applicationId);
      if (!raw) throw new Error("Application not found. Call pipeline_summary to find the saved application ID.");
      const previous = ApplicationSchema.parse(raw);
      const next = ApplicationSchema.parse(updateOutcome(previous, parsed));
      // Compare against the legacy row read through the same defaults so an identical report on an
      // old record stays a no-op: no event, no updatedAt change, no move inside the last-updated window.
      if (JSON.stringify(withOutcomeDefaults(previous)) === JSON.stringify(next)) return previous;
      next.updatedAt = this.now().toISOString();
      if (status === "applied" && !next.appliedAt) next.appliedAt = next.updatedAt;
      this.#db.prepare("UPDATE applications SET data = ? WHERE id = ?").run(JSON.stringify(next), applicationId);
      this.event(next);
      return next;
    });
  }
  pipelineSummary(input: PipelineInput = {}): PipelineSummary {
    const { from, to } = PipelineInputSchema.parse(input);
    if (from && to && Date.parse(from) > Date.parse(to)) throw new Error("from must be before or equal to to.");
    const all = this.#db.prepare("SELECT data FROM applications ORDER BY id").all()
      .map((row) => ApplicationSchema.parse(JSON.parse(String(row.data))));
    const applications = all
      .filter((app) => (!from || Date.parse(app.updatedAt) >= Date.parse(from)) && (!to || Date.parse(app.updatedAt) <= Date.parse(to)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const byStatus = ApplicationStatusSchema.options.map((status) => ({ status, count: applications.filter((a) => a.status === status).length }));
    const byRoleFamily = [...new Set(applications.map((a) => a.roleFamily))].sort()
      .map((roleFamily) => ({ roleFamily, count: applications.filter((a) => a.roleFamily === roleFamily).length }));
    const verdictOutcomes = VerdictSchema.options.flatMap((verdict) => ApplicationStatusSchema.options.map((status) => ({
      verdict, status, count: applications.filter((a) => a.verdictAtDecision === verdict && a.status === status).length,
    })));
    const events = this.#db.prepare("SELECT data FROM application_events ORDER BY id").all()
      .map((row) => readOutcomeEvent(JSON.parse(String(row.data))));
    return PipelineSummarySchema.parse({ total: applications.length, byStatus, byRoleFamily, verdictOutcomes,
      stageSummary: summarizeStages(applications, events, all.length - applications.length, { from, to }),
      applications: applications.slice(0, 100),
      observations: ["Descriptive counts of current recorded statuses, not hiring probabilities or proof of skill gaps.",
        "Dates filter last update time (inclusive), not application cohorts. Small, self-selected samples cannot establish market trends.",
        "Stage reach counts distinct application IDs in active history, not inferred intermediate stages. Replace supersedes prior history; append retains reported progression.",
        "Stage/date coverage describes current outcomes. Pending includes discovered, saved, applied and interview; withdrawal is separate. Progression may overlap pending/withdrawn. No rates or direct-role/transition classifications are inferred.",
        ...(applications.length > 100 ? ["Only the 100 most recently updated application details are shown; counts include all matching records."] : [])],
    });
  }
  clear(): void {
    this.transaction(() => this.#db.exec("DELETE FROM application_events; DELETE FROM applications; DELETE FROM assessments; DELETE FROM jobs; DELETE FROM candidate_profiles;"));
  }
  // Owner-initiated wipe: clear every table, then rewrite the file so deleted pages and the WAL
  // no longer hold the old content. VACUUM cannot run inside a transaction.
  reset(): void {
    this.clear();
    this.#db.exec("VACUUM");
    this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  close(): void { this.#db.close(); }
}
