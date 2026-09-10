import { describe, expect, it } from "vitest";

import { CareerRadarStatusSchema } from "../src/index.js";

describe("CareerRadarStatusSchema", () => {
  it("accepts the Milestone 3 status payload", () => {
    const parsed = CareerRadarStatusSchema.parse({
      name: "Career Radar",
      milestone: "Milestone 3",
      state: "ready",
      message: "MCP and widget scaffold are connected.",
      checkedAt: "2026-09-09T00:00:00.000Z",
      capabilities: ["MCP tool", "React widget"],
    });

    expect(parsed.state).toBe("ready");
  });

  it("rejects stale milestone states", () => {
    expect(() =>
      CareerRadarStatusSchema.parse({
        name: "Career Radar",
        milestone: "Milestone 0",
        state: "ready",
        message: "Too early.",
        checkedAt: "2026-09-09T00:00:00.000Z",
        capabilities: ["Job assessment"],
      }),
    ).toThrow();
  });
});
