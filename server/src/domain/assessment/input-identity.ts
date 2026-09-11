import { createHash } from "node:crypto";
import { CandidateProfileSchema, JobPostingSchema, type CandidateProfile, type JobPosting,
  type AssessmentInputIdentity } from "@career-radar/shared";

// Versioned, sorted object keys; array order and exact string content remain significant.
// Shared with the evaluation harness so both hash families normalize identically.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown): string {
  return createHash("sha256").update(`structured-input-v1\n${canonical(value)}`).digest("hex");
}
// Identify actual structured inputs, not extraction provenance or recoverable profile content.
// The profile id is a storage key, not input content: identical structured content stored under
// another id is the same input. sourceHash stays in because it is content-derived.
export function assessmentInputIdentity(profile: CandidateProfile, job: JobPosting): AssessmentInputIdentity {
  const { id: _id, ...content } = CandidateProfileSchema.parse(profile);
  void _id;
  return { version: "structured-input-v1", profileHash: digest(content),
    jobHash: digest(JobPostingSchema.parse(job)) };
}
