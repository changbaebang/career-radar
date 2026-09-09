import {
  CareerRadarStatusSchema,
  type CareerRadarStatus,
} from "@career-radar/shared";

export function buildCareerRadarStatus(now = new Date()): CareerRadarStatus {
  return CareerRadarStatusSchema.parse({
    name: "Career Radar",
    milestone: "Milestone 0",
    state: "ready",
    message: "The MCP server and React widget scaffold are connected.",
    checkedAt: now.toISOString(),
    capabilities: [
      "Read-only MCP status tool",
      "React widget resource",
      "Shared Zod schema",
    ],
  });
}
