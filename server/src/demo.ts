import {
  CareerRadarStatusSchema,
  type CareerRadarStatus,
} from "@career-radar/shared";

export function buildCareerRadarStatus(now = new Date()): CareerRadarStatus {
  return CareerRadarStatusSchema.parse({
    name: "Career Radar",
    milestone: "Milestone 3",
    state: "ready",
    message: "Search one Greenhouse board, assess selected roles, and track decisions locally. Early private-use prototype; live model/host validation remains separate.",
    checkedAt: now.toISOString(),
    capabilities: [
      "Resume evidence extraction",
      "Pasted job-description normalization",
      "Grounded REALISTIC / STRETCH / PASS assessment",
      "Allowed public job URL reading",
      "SQLite decision and application storage",
      "Application status updates and pipeline summary",
      "Bounded Greenhouse board search without model calls",
      "Small-set evidence recommendations with explicit shortages and source times",
    ],
  });
}
