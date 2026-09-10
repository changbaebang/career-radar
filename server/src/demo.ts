import {
  CareerRadarStatusSchema,
  type CareerRadarStatus,
} from "@career-radar/shared";

export function buildCareerRadarStatus(now = new Date()): CareerRadarStatus {
  return CareerRadarStatusSchema.parse({
    name: "Career Radar",
    milestone: "Milestone 2",
    state: "ready",
    message: "Assess a job, save the decision, and track application outcomes locally. Early private-use prototype.",
    checkedAt: now.toISOString(),
    capabilities: [
      "Resume evidence extraction",
      "Pasted job-description normalization",
      "Grounded REALISTIC / STRETCH / PASS assessment",
      "Allowed public job URL reading",
      "SQLite decision and application storage",
      "Application status updates and pipeline summary",
    ],
  });
}
