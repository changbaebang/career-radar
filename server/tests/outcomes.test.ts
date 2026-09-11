import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { PipelineSummarySchema, type FitAssessment } from "@career-radar/shared";
import { CareerStore } from "../src/domain/store.js";
import { readOutcomeEvent } from "../src/domain/outcomes.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";

const assessment: FitAssessment = { verdict: "REALISTIC", confidence: "medium", resumeContortion: "low",
  strongestMatches: [], gaps: [], hardBlockers: [], interviewRisks: [], missingInformation: [],
  recommendation: "Synthetic fixture", modelVersion: "synthetic", promptVersion: "test" };
const cleanups: Array<() => void> = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "career-radar-outcomes-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "synthetic.db");
  const store = new CareerStore(path, () => new Date("2026-09-11T00:00:00Z"));
  cleanups.push(() => store.close());
  const db = new DatabaseSync(path); cleanups.push(() => db.close());
  store.upsertProfile(syntheticProfile);
  function save(id: string) {
    const job = { ...syntheticJob, id };
    store.upsertJob(job);
    return store.saveApplication({ assessmentId: store.saveAssessment(syntheticProfile.id, job, assessment) });
  }
  return { store, db, path, save };
}
function count(db: DatabaseSync) { return db.prepare("SELECT count(*) AS n FROM application_events").get()?.n; }

describe("M4-C synthetic outcome analytics, not fit/model evals", () => {
  it("G: separates resume/final rejection with identical fit and leaves snapshots unchanged", () => {
    const { store, save, db } = setup();
    const a = save("a"); const b = save("b");
    const snapshots = db.prepare("SELECT data FROM assessments ORDER BY id").all();
    store.updateApplication({ applicationId: a.id, status: "rejected", normalizedOutcomeStage: "resume_screen" });
    store.updateApplication({ applicationId: b.id, status: "rejected", normalizedOutcomeStage: "final_interview" });
    const result = store.pipelineSummary();
    expect(result.stageSummary).toMatchObject({ total: 2, resumeScreenRejected: 1, recordedProgression: 1, unknownOccurrenceDate: 2 });
    expect(result.stageSummary?.stageReach.find((s) => s.stage === "technical_interview")?.count).toBe(0);
    expect(result.applications.every((a) => a.verdictAtDecision === "REALISTIC")).toBe(true);
    expect(db.prepare("SELECT data FROM assessments ORDER BY id").all()).toEqual(snapshots);
  });

  it("H: append preserves reported history, duplicates do not add events or inflate counts", () => {
    const { store, save, db } = setup(); const a = save("a");
    const first = { applicationId: a.id, status: "interview" as const, stage: "recruiter screen", historyMode: "append" as const };
    const result = store.updateApplication(first);
    const n = count(db);
    expect(store.updateApplication(first)).toEqual(result);
    expect(count(db)).toBe(n);
    store.updateApplication({ ...first, stage: "final interview" });
    store.updateApplication({ applicationId: a.id, status: "withdrawn", historyMode: "append" });
    const summary = store.pipelineSummary().stageSummary!;
    expect(summary).toMatchObject({ total: 1, recordedProgression: 1, withdrawn: 1, pending: 0 });
    expect(summary.stageReach.find((s) => s.stage === "recruiter_screen")?.count).toBe(1);
    expect(summary.stageReach.find((s) => s.stage === "final_interview")?.count).toBe(1);
    expect(summary.roleProgression[0]).toMatchObject({ total: 1, progressed: 1 });
  });

  it("H: replace supersedes all earlier facts without erasing audit rows; retries remain no-ops", () => {
    const { store, save, db } = setup(); const a = save("a");
    store.updateApplication({ applicationId: a.id, status: "interview", stage: "technical", historyMode: "append" });
    const correction = { applicationId: a.id, status: "rejected" as const, stage: "resume screen", historyMode: "replace" as const };
    const corrected = store.updateApplication(correction);
    const n = count(db);
    expect(store.updateApplication(correction)).toEqual(corrected);
    expect(count(db)).toBe(n);
    const summary = store.pipelineSummary().stageSummary!;
    expect(summary.recordedProgression).toBe(0);
    expect(summary.resumeScreenRejected).toBe(1);
    expect(summary.stageReach.find((s) => s.stage === "technical_interview")?.count).toBe(0);
    expect(count(db)).toBe(3);
  });

  it("clears both stage projections and retracts reach even with append; keeps unknown dates unknown", () => {
    const { store, save } = setup(); const a = save("a");
    store.updateApplication({ applicationId: a.id, status: "rejected", stage: "technical", occurredAt: "2026-09-01T00:00:00Z" });
    const cleared = store.updateApplication({ applicationId: a.id, status: "rejected", normalizedOutcomeStage: null, historyMode: "append" });
    expect(cleared).toMatchObject({ outcomeStage: "", normalizedOutcomeStage: "unknown" });
    expect(cleared.occurredAt).toBeUndefined();
    expect(store.pipelineSummary().stageSummary).toMatchObject({ recordedProgression: 0, unknownStageRejected: 1, unknownOccurrenceDate: 1 });
  });

  it("date-only corrections do not fabricate dates; omitted stage/notes stay unchanged", () => {
    const { store, save } = setup(); const a = save("a");
    const update = { applicationId: a.id, status: "rejected" as const };
    store.updateApplication({ ...update, stage: "resume screen", notes: "Synthetic note", occurredAt: "2026-09-01T00:00:00Z" });
    expect(store.updateApplication(update).occurredAt).toBe("2026-09-01T00:00:00Z");
    const changed = store.updateApplication({ ...update, occurredAt: null });
    expect(changed).toMatchObject({ outcomeStage: "resume screen", notes: "Synthetic note" });
    expect(changed.occurredAt).toBeUndefined();
  });

  it("notes-only edits preserve progression and never enter event payloads", () => {
    const { store, save, db } = setup(); const a = save("a");
    store.updateApplication({ applicationId: a.id, status: "interview", stage: "technical", historyMode: "append" });
    store.updateApplication({ applicationId: a.id, status: "rejected", normalizedOutcomeStage: "unknown", historyMode: "append" });
    const before = store.pipelineSummary().stageSummary;
    store.updateApplication({ applicationId: a.id, status: "rejected", notes: "SECRET-NOTE" });
    expect(store.pipelineSummary().stageSummary).toEqual(before);
    const rows = db.prepare("SELECT data FROM application_events").all().map((r) => String(r.data)).join(" ");
    for (const forbidden of ["SECRET-NOTE", "notes", "company", "title", "outcomeStage", "sourceHash"]) expect(rows).not.toContain(forbidden);
  });

  it("reports pending, withdrawal, unknown rejection and inclusive window exclusions separately", () => {
    const { store, save, db } = setup(); save("pending");
    const a = save("withdrawn"); const b = save("rejected"); const c = save("old");
    store.updateApplication({ applicationId: a.id, status: "withdrawn" });
    store.updateApplication({ applicationId: b.id, status: "rejected", stage: "unclear step" });
    db.prepare("UPDATE applications SET data = ? WHERE id = ?").run(JSON.stringify({ ...c, updatedAt: "2026-08-01T00:00:00Z" }), c.id);
    expect(store.pipelineSummary({ from: "2026-09-11T00:00:00Z", to: "2026-09-11T00:00:00Z" }).stageSummary)
      .toMatchObject({ total: 3, excludedByWindow: 1, pending: 1, withdrawn: 1, unknownStage: 3, unknownStageRejected: 1, resumeScreenRejected: 0 });
    expect(store.pipelineSummary({ from: "2026-10-01T00:00:00Z" }).stageSummary).toMatchObject({ total: 0, excludedByWindow: 4, recordedProgression: 0 });
  });

  it("rejects conflicting/invalid reports atomically", () => {
    const { store, save, db } = setup(); const a = save("a");
    for (const fields of [
      { status: "saved" as const, normalizedOutcomeStage: "final_interview" as const },
      { status: "offer" as const, stage: "technical" },
      { status: "rejected" as const, stage: "resume screen", normalizedOutcomeStage: "final_interview" as const },
      { status: "rejected" as const, stage: "", normalizedOutcomeStage: "final_interview" as const },
      { status: "rejected" as const, occurredAt: "2099-01-01T00:00:00Z" },
    ]) expect(() => store.updateApplication({ applicationId: a.id, ...fields })).toThrow();
    expect(count(db)).toBe(1);
    expect(store.pipelineSummary().applications[0]).toEqual(a);
  });

  it("upgrades a v1 DB without rewriting old JSON or inventing legacy stages/dates", () => {
    const { save, db, path } = setup(); const a = save("a");
    const { normalizedOutcomeStage: _stage, outcomeProvenance: _provenance, outcomeRevision: _revision, ...legacy } = a;
    void _stage; void _provenance; void _revision;
    const raw = JSON.stringify({ ...legacy, status: "rejected", outcomeStage: "resume screen" });
    db.prepare("UPDATE applications SET data = ? WHERE id = ?").run(raw, a.id);
    db.exec("DELETE FROM application_events; DROP INDEX application_events_application_id; PRAGMA user_version = 1");
    db.prepare("INSERT INTO application_events(application_id,data) VALUES (?,?)").run(a.id, JSON.stringify({ ...legacy, status: "interview", outcomeStage: "technical" }));
    db.prepare("INSERT INTO application_events(application_id,data) VALUES (?,?)").run(a.id, raw);
    const reopened = new CareerStore(path); cleanups.push(() => reopened.close());
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(db.prepare("SELECT data FROM applications").get()?.data).toBe(raw);
    expect(reopened.pipelineSummary().stageSummary).toMatchObject({ unknownStage: 1, unknownOccurrenceDate: 1, recordedProgression: 0 });
    expect(reopened.pipelineSummary().applications[0]?.outcomeStage).toBe("resume screen");
    expect(readOutcomeEvent(JSON.parse(raw))).toMatchObject({ provenance: "legacy_mapping", normalizedOutcomeStage: "unknown" });
  });

  it("keeps append-only migration atomic on failure", () => {
    const { db, path } = setup();
    // Existing index makes migration 2 fail. Migration version must not advance.
    db.exec("PRAGMA user_version = 1");
    expect(() => new CareerStore(path)).toThrow();
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
  });

  it("resets every history revision and can restart with an empty summary", () => {
    const { store, save, db, path } = setup(); const a = save("a");
    store.updateApplication({ applicationId: a.id, status: "interview", stage: "technical" });
    store.updateApplication({ applicationId: a.id, status: "rejected", stage: "" });
    store.reset();
    expect(count(db)).toBe(0);
    const reopened = new CareerStore(path); cleanups.push(() => reopened.close());
    expect(reopened.pipelineSummary().stageSummary).toMatchObject({ total: 0, knownStage: 0, unknownStage: 0, recordedProgression: 0 });
  });

  it("accepts legacy widget payloads but rejects unknown event versions", () => {
    const { store } = setup();
    const { stageSummary: _stages, ...oldPayload } = store.pipelineSummary(); void _stages;
    expect(PipelineSummarySchema.safeParse(oldPayload).success).toBe(true);
    expect(() => readOutcomeEvent({ eventVersion: 99 })).toThrow();
  });

  it("explicitly replacing unchanged current facts can retract previous appended progression once", () => {
    const { store, save, db } = setup(); const a = save("a");
    store.updateApplication({ applicationId: a.id, status: "interview", stage: "technical", historyMode: "append" });
    store.updateApplication({ applicationId: a.id, status: "rejected", stage: "unknown", historyMode: "append" });
    expect(store.pipelineSummary().stageSummary?.recordedProgression).toBe(1);
    const correction = { applicationId: a.id, status: "rejected" as const, historyMode: "replace" as const };
    store.updateApplication(correction);
    expect(store.pipelineSummary().stageSummary?.recordedProgression).toBe(0);
    const n = count(db); store.updateApplication(correction); expect(count(db)).toBe(n);
  });

  it("normalizes only own aliases and counts all records beyond the detail cap", () => {
    const { store, save } = setup();
    for (let i = 0; i < 101; i++) {
      const a = save(`job_${i}`);
      store.updateApplication({ applicationId: a.id, status: "rejected", stage: "constructor" });
    }
    const summary = store.pipelineSummary();
    expect(summary.applications).toHaveLength(100);
    expect(summary.stageSummary).toMatchObject({ total: 101, unknownStageRejected: 101, recordedProgression: 0 });
  });
});
