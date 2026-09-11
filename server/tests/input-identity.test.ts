import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { assessmentInputIdentity } from "../src/domain/assessment/input-identity.js";
import { CareerStore } from "../src/domain/store.js";
import { syntheticProfile as profile, syntheticJob as job } from "./fixtures.js";
import { groundedAssessment as assessment } from "./discovery-fixtures.js";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "career-radar-b1-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "synthetic.db");
  const store = new CareerStore(path); cleanup.push(() => store.close());
  const db = new DatabaseSync(path); cleanup.push(() => db.close());
  store.upsertProfile(profile); store.upsertJob(job);
  return { store, db, path };
}
function snapshot(db: DatabaseSync, id: string) {
  return JSON.parse(String(db.prepare("SELECT data FROM assessments WHERE id = ?").get(id)?.data));
}
describe("structured-input-v1 identity, not retained input or extraction provenance", () => {
  it("is stable across object key order/omitted undefined but preserves string and array differences", () => {
    const initial = assessmentInputIdentity(profile, job);
    const reordered = Object.fromEntries(Object.entries(profile).reverse());
    expect(assessmentInputIdentity({ ...profile, ...reordered, yearsExperience: undefined }, job)).toEqual(initial);
    expect(assessmentInputIdentity({ ...profile, skills: ["React", "TypeScript"] }, job).profileHash)
      .not.toBe(assessmentInputIdentity({ ...profile, skills: ["TypeScript", "React"] }, job).profileHash);
    expect(assessmentInputIdentity({ ...profile, headline: `${profile.headline}.` }, job).profileHash).not.toBe(initial.profileHash);
    expect(assessmentInputIdentity(profile, { ...job, description: `${job.description} Different scope.` }).jobHash).not.toBe(initial.jobHash);
  });
  it("distinguishes different structured profiles extracted from the same raw source", () => {
    const changed = { ...profile, leadership: ["Owned a synthetic platform roadmap"] };
    expect(changed.sourceHash).toBe(profile.sourceHash);
    expect(assessmentInputIdentity(changed, job).profileHash).not.toBe(assessmentInputIdentity(profile, job).profileHash);
  });
  it("saves the captured input identity even if the same profile ID is overwritten during assessment", () => {
    const { store, db } = setup();
    const captured = store.getProfile(profile.id)!;
    const changed = { ...profile, headline: "New synthetic profile version" };
    store.upsertProfile(changed);
    const first = store.saveAssessment(captured, job, assessment);
    const before = snapshot(db, first);
    expect(before.inputIdentity).toEqual(assessmentInputIdentity(captured, job));
    expect(Object.keys(before).sort()).toEqual(["assessment", "createdAt", "id", "inputIdentity", "job", "profileId"]);
    expect(before).not.toHaveProperty("profile");
    const second = store.saveAssessment(changed, job, assessment);
    expect(snapshot(db, second).inputIdentity.profileHash).not.toBe(before.inputIdentity.profileHash);
    store.saveApplication({ assessmentId: first });
    expect(snapshot(db, first)).toEqual(before);
    expect(store.pipelineSummary().applications[0]).not.toHaveProperty("inputIdentity");
    expect(String(db.prepare("SELECT data FROM application_events").get()?.data)).not.toContain("profileHash");
  });
  it("loads old snapshots without backfilling a hash from the current profile, then resets all identities", () => {
    const { store, db, path } = setup();
    const id = store.saveAssessment(profile, job, assessment);
    const old = snapshot(db, id); delete old.inputIdentity;
    const raw = JSON.stringify(old);
    db.prepare("UPDATE assessments SET data = ? WHERE id = ?").run(raw, id);
    store.upsertProfile({ ...profile, headline: "Changed after the legacy decision" });
    const reopened = new CareerStore(path); cleanup.push(() => reopened.close());
    const saved = reopened.saveApplication({ assessmentId: id });
    expect(saved.verdictAtDecision).toBe(assessment.verdict);
    expect(db.prepare("SELECT data FROM assessments WHERE id = ?").get(id)?.data).toBe(raw);
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
    const current = reopened.saveAssessment(profile, job, assessment);
    expect(snapshot(db, current).inputIdentity.version).toBe("structured-input-v1");
    reopened.reset();
    expect(db.prepare("SELECT count(*) AS n FROM assessments").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM application_events").get()?.n).toBe(0);
  });
  it("rejects malformed versioned identities instead of treating them as legacy", () => {
    const { store, db } = setup();
    const id = store.saveAssessment(profile, job, assessment);
    const bad = snapshot(db, id); bad.inputIdentity.version = "future-version";
    db.prepare("UPDATE assessments SET data = ? WHERE id = ?").run(JSON.stringify(bad), id);
    expect(() => store.saveApplication({ assessmentId: id })).toThrow();
    expect(store.pipelineSummary().total).toBe(0);
  });
});
