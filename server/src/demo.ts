import {
  CareerRadarStatusSchema,
  type CareerRadarStatus,
} from "@career-radar/shared";

export function buildCareerRadarStatus(now = new Date()): CareerRadarStatus {
  return CareerRadarStatusSchema.parse({
    name: "Career Radar",
    milestone: "Milestone 1",
    state: "ready",
    message: "Single-job assessment is ready for resume and pasted JD text.",
    checkedAt: now.toISOString(),
    capabilities: [
      "Resume evidence extraction",
      "Pasted job-description normalization",
      "Grounded REALISTIC / STRETCH / PASS assessment",
    ],
  });
}
