import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICareerAnalyzer } from "../src/ai/analyzer.js";
import { OPENROUTER_BASE_URL, OpenRouterCareerAnalyzer } from "../src/ai/openrouter.js";
import { OPENAI_BASE_URL_DEFAULT, PROVIDER_ERRORS, createAnalyzerFromEnv, providerDestination, resolveProviderName } from "../src/ai/provider.js";

afterEach(() => vi.unstubAllEnvs());

describe("provider selection (explicit, no fallback)", () => {
  it("defaults to openai and accepts openrouter case-insensitively", () => {
    vi.stubEnv("CAREER_RADAR_PROVIDER", "");
    expect(resolveProviderName()).toBe("openai");
    expect(resolveProviderName(undefined)).toBe("openai");
    expect(resolveProviderName(" OpenRouter ")).toBe("openrouter");
    expect(() => resolveProviderName("bogus")).toThrow(PROVIDER_ERRORS.unknown);
  });

  it("instantiates the adapter named by the environment and surfaces its own configuration errors", () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-not-a-real-key"); vi.stubEnv("CAREER_RADAR_PROVIDER", "openai");
    expect(createAnalyzerFromEnv()).toBeInstanceOf(OpenAICareerAnalyzer);
    vi.stubEnv("CAREER_RADAR_PROVIDER", "openrouter"); vi.stubEnv("OPENROUTER_API_KEY", ""); vi.stubEnv("OPENROUTER_MODEL", "");
    expect(() => createAnalyzerFromEnv()).toThrow("OPENROUTER_API_KEY");
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-not-a-real-key"); vi.stubEnv("OPENROUTER_MODEL", "synthetic/free-model");
    expect(createAnalyzerFromEnv()).toBeInstanceOf(OpenRouterCareerAnalyzer);
    expect(createAnalyzerFromEnv({ provider: "openai" })).toBeInstanceOf(OpenAICareerAnalyzer);
    vi.stubEnv("CAREER_RADAR_PROVIDER", "bogus");
    expect(() => createAnalyzerFromEnv()).toThrow(PROVIDER_ERRORS.unknown);
  });

  it("names a fixed destination per provider", () => {
    expect(providerDestination("openai")).toBe(OPENAI_BASE_URL_DEFAULT);
    expect(providerDestination("openrouter")).toBe(OPENROUTER_BASE_URL);
  });
});
