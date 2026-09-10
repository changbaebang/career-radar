import type { DatabaseSync } from "node:sqlite";

// Append migrations; never change an already released migration.
const migrations = [String.raw`
  CREATE TABLE candidate_profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE assessments (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES candidate_profiles(id),
    job_id TEXT NOT NULL REFERENCES jobs(id),
    data TEXT NOT NULL
  );
  CREATE TABLE applications (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES candidate_profiles(id),
    job_id TEXT NOT NULL REFERENCES jobs(id),
    assessment_id TEXT NOT NULL REFERENCES assessments(id),
    data TEXT NOT NULL,
    UNIQUE (profile_id, job_id)
  );
  CREATE TABLE application_events (
    id INTEGER PRIMARY KEY,
    application_id TEXT NOT NULL REFERENCES applications(id),
    data TEXT NOT NULL
  );
`];

export function migrate(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
    if (version > migrations.length) throw new Error("Database is newer than this app. Upgrade Career Radar.");
    for (let index = version; index < migrations.length; index++) {
      db.exec(migrations[index]!);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
