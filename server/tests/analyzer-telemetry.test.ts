import { describe, expect, it, vi } from "vitest";
const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { parse }; } }));
import { OpenAICareerAnalyzer, type AnalyzerResponseEvent } from "../src/ai/analyzer.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";

const response = {
  id: "resp_synthetic", model: "gpt-5-mini-2026", status: "completed", _request_id: "req_synthetic", output_parsed: null, output_text: "SECRET-BODY",
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 2 } },
};

describe("analyzer response telemetry hook", () => {
  it("is a pass-through without a hook: same request arguments, same failure", async () => {
    parse.mockResolvedValueOnce(response);
    const analyzer = new OpenAICareerAnalyzer({ apiKey: "synthetic-not-a-real-key" });
    await expect(analyzer.extractJob("SECRET-JD")).rejects.toThrow();
    expect(parse).toHaveBeenLastCalledWith(expect.objectContaining({ store: false, input: expect.stringContaining("SECRET-JD") }), { signal: undefined });
  });

  it("reports identifiers, usage and timing for a response, never the request or the body", async () => {
    parse.mockResolvedValueOnce(response);
    const events: AnalyzerResponseEvent[] = [];
    const analyzer = new OpenAICareerAnalyzer({ apiKey: "synthetic-not-a-real-key", model: "gpt-5-mini", onResponse: (event) => events.push(event) });
    await expect(analyzer.extractJob("SECRET-JD")).rejects.toThrow(); // output_parsed is null: the hook fires before parsing fails
    expect(events).toEqual([{ operation: "extractJob", requestedModel: "gpt-5-mini", durationMs: expect.any(Number), outcome: "ok", responseId: "resp_synthetic",
      responseModel: "gpt-5-mini-2026", requestId: "req_synthetic", responseStatus: "completed",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 4, reasoningTokens: 2 } }]);
    expect(events[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(events)).not.toContain("SECRET");
  });

  it("reports only the error class and transport identifiers for a failed call, and survives a throwing hook", async () => {
    const failure = Object.assign(new Error("SECRET-RESPONSE-BODY"), { name: "APIConnectionError", status: 502, code: "bad_gateway", requestID: "req_failed" });
    parse.mockRejectedValueOnce(failure);
    const events: AnalyzerResponseEvent[] = [];
    const analyzer = new OpenAICareerAnalyzer({ apiKey: "synthetic-not-a-real-key", model: "gpt-5-mini", onResponse: (event) => { events.push(event); throw new Error("hook bug"); } });
    const signal = new AbortController().signal;
    await expect(analyzer.assess(syntheticProfile, syntheticJob, signal)).rejects.toBe(failure);
    expect(parse).toHaveBeenLastCalledWith(expect.objectContaining({ store: false }), { signal, maxRetries: 0 });
    expect(events).toEqual([{ operation: "assess", requestedModel: "gpt-5-mini", durationMs: expect.any(Number), outcome: "error",
      error: { name: "APIConnectionError", status: 502, code: "bad_gateway", requestId: "req_failed" } }]);
    expect(JSON.stringify(events)).not.toContain("SECRET");
  });
});
