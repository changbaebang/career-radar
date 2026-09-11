import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { FitAssessment } from "@career-radar/shared";
import { CareerStore } from "../src/domain/store.js";
import { syntheticJob as job, syntheticProfile as profile } from "./fixtures.js";

const assessment: FitAssessment = {
  verdict: "STRETCH", confidence: "low", resumeContortion: "medium", strongestMatches: [],
  gaps: [], hardBlockers: [], interviewRisks: [], recommendation: "Synthetic test only.",
  missingInformation: [], modelVersion: "synthetic", promptVersion: "test-v1",
};
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function storeAt(path = ":memory:", now?: () => Date) {
  const store = new CareerStore(path, now);
  cleanup.push(() => store.close());
  store.upsertProfile(profile); store.upsertJob(job);
  return store;
}
function filePath() {
  const directory = mkdtempSync(join(tmpdir(), "career-radar-test-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "test.db");
}

describe("SQLite CareerStore", () => {
  it("migrates once and survives a full close/reopen with snapshots and outcomes", () => {
    const path = filePath();
    const first = new CareerStore(path);
    first.upsertProfile(profile); first.upsertJob(job);
    const id = first.saveAssessment(profile.id, job, assessment);
    const saved = first.saveApplication({ assessmentId: id });
    const updated = first.updateApplication({ applicationId: saved.id, status: "rejected", stage: "resume screen" });
    first.close();
    const reopened = new CareerStore(path); cleanup.push(() => reopened.close());
    expect(reopened.getProfile(profile.id)).toEqual(profile);
    expect(reopened.getJob(job.id)).toEqual(job);
    expect(reopened.pipelineSummary().applications).toEqual([updated]);
    const db = new DatabaseSync(path); cleanup.push(() => db.close());
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM application_events").get()?.n).toBe(2);
    expect(JSON.parse(String(db.prepare("SELECT data FROM assessments").get()?.data)).assessment).toEqual(assessment);
  });

  it("keeps the original verdict/job snapshot and does not revert an outcome on save retry", () => {
    const store = storeAt();
    const id = store.saveAssessment(profile.id, job, assessment);
    const saved = store.saveApplication({ assessmentId: id });
    const updated = store.updateApplication({ applicationId: saved.id, status: "interview" });
    store.upsertJob({ ...job, roleFamily: "Changed family" });
    const later = store.saveAssessment(profile.id, { ...job, roleFamily: "Changed family" }, { ...assessment, verdict: "REALISTIC" });
    expect(store.saveApplication({ assessmentId: later, status: "applied" })).toEqual(updated);
    expect(store.pipelineSummary().total).toBe(1);
    expect(updated.verdictAtDecision).toBe("STRETCH");
    expect(updated.roleFamily).toBe(job.roleFamily);
  });

  it("preserves applied time, records corrections, and makes identical updates no-ops", () => {
    let time = new Date("2026-09-10T00:00:00Z");
    const path = filePath();
    const store = storeAt(path, () => time);
    const saved = store.saveApplication({ assessmentId: store.saveAssessment(profile.id, job, assessment) });
    expect(saved.appliedAt).toBeUndefined();
    const applied = store.updateApplication({ applicationId: saved.id, status: "applied", notes: "It's synthetic; DROP TABLE jobs;" });
    time = new Date("2026-09-11T00:00:00Z");
    expect(store.updateApplication({ applicationId: saved.id, status: "applied" })).toEqual(applied);
    const interview = store.updateApplication({ applicationId: saved.id, status: "interview", stage: "technical" });
    expect(interview.appliedAt).toBe(applied.appliedAt);
    expect(interview.notes).toBe(applied.notes);
    expect(store.updateApplication({ applicationId: saved.id, status: "interview", notes: "", stage: "" }).notes).toBe("");
    expect(store.getJob(job.id)).toEqual(job);
    const db = new DatabaseSync(path); cleanup.push(() => db.close());
    expect(db.prepare("SELECT COUNT(*) AS n FROM application_events").get()?.n).toBe(4);
  });

  it("rejects missing references and invalid input without leaving partial data", () => {
    const store = storeAt();
    expect(() => store.saveApplication({ assessmentId: "invented" })).toThrow("Assessment not found");
    expect(() => store.updateApplication({ applicationId: "invented", status: "offer" })).toThrow("Application not found");
    expect(() => store.saveAssessment("missing-profile", job, assessment)).toThrow();
    expect(() => store.upsertJob({ ...job, title: "" })).toThrow();
    expect(store.pipelineSummary().total).toBe(0);
    const id = store.saveAssessment(profile.id, job, assessment);
    expect(store.saveApplication({ assessmentId: id }).status).toBe("saved");
  });

  it("reports zero states and inclusive last-update filtering without invented probabilities", () => {
    const store = storeAt(":memory:", () => new Date("2026-09-10T00:00:00Z"));
    expect(store.pipelineSummary().byStatus).toHaveLength(7);
    store.saveApplication({ assessmentId: store.saveAssessment(profile.id, job, assessment), status: "applied" });
    const summary = store.pipelineSummary({ from: "2026-09-10T00:00:00Z", to: "2026-09-10T00:00:00.000Z" });
    expect(summary.total).toBe(1);
    expect(summary.byStatus.find((item) => item.status === "applied")?.count).toBe(1);
    expect(summary.verdictOutcomes.find((item) => item.verdict === "STRETCH" && item.status === "applied")?.count).toBe(1);
    expect(summary.observations.join(" ")).toContain("not hiring probabilities");
    expect(store.pipelineSummary({ from: "2026-09-11T00:00:00Z" }).total).toBe(0);
    expect(() => store.pipelineSummary({ from: "bad date" })).toThrow();
    expect(() => store.pipelineSummary({ from: "2026-09-11T00:00:00Z", to: "2026-09-10T00:00:00Z" })).toThrow("from must");
  });

  it("rolls back the application write if its audit event fails", () => {
    const path = filePath(); const store = storeAt(path);
    const db = new DatabaseSync(path); cleanup.push(() => db.close());
    db.exec("CREATE TRIGGER reject_event BEFORE INSERT ON application_events BEGIN SELECT RAISE(ABORT, 'event failed'); END;");
    const id = store.saveAssessment(profile.id, job, assessment);
    expect(() => store.saveApplication({ assessmentId: id })).toThrow("event failed");
    expect(store.pipelineSummary().total).toBe(0);
  });

  it("refuses future database versions without downgrading", () => {
    const path = filePath(); const db = new DatabaseSync(path);
    db.exec("PRAGMA user_version = 99"); db.close();
    expect(() => new CareerStore(path)).toThrow("newer than this app");
  });

  it("keeps notes out of the event history and wipes the file on reset", () => {
    const path = filePath(); const store = storeAt(path);
    const saved = store.saveApplication({ assessmentId: store.saveAssessment(profile.id, job, assessment) });
    store.updateApplication({ applicationId: saved.id, status: "interview", notes: "Interviewer: SECRET-NAME" });
    store.updateApplication({ applicationId: saved.id, status: "interview", notes: "" });
    const db = new DatabaseSync(path); cleanup.push(() => db.close());
    const events = db.prepare("SELECT data FROM application_events").all().map((row) => String(row.data));
    expect(events).toHaveLength(3);
    expect(events.join(" ")).not.toContain("SECRET-NAME");
    expect(events.join(" ")).not.toContain('"notes"');
    db.close(); cleanup.pop();
    store.reset();
    expect(store.pipelineSummary().total).toBe(0);
    expect(store.getProfile(profile.id)).toBeUndefined();
    const reopened = new CareerStore(path); cleanup.push(() => reopened.close());
    expect(reopened.pipelineSummary().total).toBe(0);
  });

  it("clears records in foreign-key-safe order", () => {
    const store = storeAt();
    store.saveApplication({ assessmentId: store.saveAssessment(profile.id, job, assessment) });
    store.clear();
    expect(store.pipelineSummary().total).toBe(0);
    expect(store.getProfile(profile.id)).toBeUndefined();
    expect(store.getJob(job.id)).toBeUndefined();
  });
});
