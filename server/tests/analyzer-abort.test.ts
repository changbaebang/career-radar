import { describe, expect, it, vi } from "vitest";
const { parse } = vi.hoisted(() => ({ parse: vi.fn(async () => { throw new Error("synthetic interruption"); }) }));
vi.mock("openai", () => ({ default: class { responses = { parse }; } }));
import { OpenAICareerAnalyzer } from "../src/ai/analyzer.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";

describe("recommendation model request budget", () => {
  it("forwards a batch abort signal and disables automatic SDK retries", async () => {
    const analyzer = new OpenAICareerAnalyzer({ apiKey: "synthetic-not-a-real-key" });
    const signal = new AbortController().signal;
    await expect(analyzer.extractJob("Synthetic job", signal)).rejects.toThrow("synthetic interruption");
    expect(parse).toHaveBeenLastCalledWith(expect.objectContaining({ store: false }), { signal, maxRetries: 0 });
    await expect(analyzer.assess(syntheticProfile, syntheticJob, signal)).rejects.toThrow("synthetic interruption");
    expect(parse).toHaveBeenLastCalledWith(expect.objectContaining({ store: false }), { signal, maxRetries: 0 });
  });
  it("retains the single-job request defaults when no batch signal is supplied", async () => {
    const analyzer = new OpenAICareerAnalyzer({ apiKey: "synthetic-not-a-real-key" });
    await expect(analyzer.extractJob("Synthetic job")).rejects.toThrow("synthetic interruption");
    expect(parse).toHaveBeenLastCalledWith(expect.any(Object), { signal: undefined });
  });
});
