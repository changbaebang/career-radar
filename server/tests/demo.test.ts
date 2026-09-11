import { describe, expect, it } from "vitest";

import { buildCareerRadarStatus } from "../src/demo.js";

describe("buildCareerRadarStatus", () => {
  it("returns deterministic Milestone 4 metadata for a supplied time", () => {
    const status = buildCareerRadarStatus(
      new Date("2026-09-09T01:02:03.000Z"),
    );

    expect(status).toMatchObject({
      name: "Career Radar",
      milestone: "Milestone 4",
      state: "ready",
      checkedAt: "2026-09-09T01:02:03.000Z",
    });
    expect(status.capabilities).toContain("Resume evidence extraction");
    expect(status.capabilities.some((item) => item.includes("uncertain without verified references"))).toBe(true);
  });
});
