import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAICareerAnalyzer } from "../src/ai/analyzer.js";

afterEach(() => vi.unstubAllEnvs());

describe("OpenAICareerAnalyzer configuration", () => {
  it("explains where to configure a missing key before making a request", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => new OpenAICareerAnalyzer()).toThrow("Set OPENAI_API_KEY in .env.local");
  });
});
