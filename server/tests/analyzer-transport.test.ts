import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICareerAnalyzer } from "../src/ai/analyzer.js";

// Real OpenAI SDK 7.x with only the global fetch replaced: every request gets a synthetic 500 with a
// 1 ms retry-after, so the SDK's own retry loop runs without any network or delay.
const attempts: Array<{ url: string; body: string }> = [];
function stubFetch() {
  attempts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    attempts.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response('{"error":{"message":"synthetic 500"}}', { status: 500, headers: { "content-type": "application/json", "retry-after-ms": "1" } });
  }));
}
const key = "synthetic-not-a-real-key";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("harness transport options on the real SDK (fetch stubbed, no network)", () => {
  it("leaves the server's SDK retries alone but turns them off for the harness, including signal-less profile extraction", async () => {
    stubFetch();
    const server = new OpenAICareerAnalyzer({ apiKey: key });
    await expect(server.extractProfile("SYNTHETIC-RESUME")).rejects.toThrow();
    expect(attempts).toHaveLength(3); // SDK default: 2 retries after the first attempt
    stubFetch();
    const harness = new OpenAICareerAnalyzer({ apiKey: key, transport: { maxRetries: 0, logLevel: "off" } });
    await expect(harness.extractProfile("SYNTHETIC-RESUME")).rejects.toThrow();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.url).toBe("https://api.openai.com/v1/responses");
    stubFetch();
    await expect(harness.extractJob("SYNTHETIC-JD")).rejects.toThrow();
    expect(attempts).toHaveLength(1);
  });

  it("keeps OPENAI_LOG=debug from printing request bodies once the harness pins the SDK log level off", async () => {
    vi.stubEnv("OPENAI_LOG", "debug");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const printed = () => [...debug.mock.calls, ...info.mock.calls].map((args) => inspect(args, { depth: 8 })).join("\n");
    stubFetch();
    const unpinned = new OpenAICareerAnalyzer({ apiKey: key, transport: { maxRetries: 0 } });
    await expect(unpinned.extractProfile("SYNTHETIC-RESUME-MARKER")).rejects.toThrow();
    expect(printed()).toContain("SYNTHETIC-RESUME-MARKER"); // the hazard: SDK debug logging echoes the request
    debug.mockClear(); info.mockClear(); stubFetch();
    const harness = new OpenAICareerAnalyzer({ apiKey: key, transport: { maxRetries: 0, logLevel: "off" } });
    await expect(harness.extractProfile("SYNTHETIC-RESUME-MARKER")).rejects.toThrow();
    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("follows OPENAI_BASE_URL when it is set, which is why the harness refuses a live run under it", async () => {
    vi.stubEnv("OPENAI_BASE_URL", "https://synthetic-review.invalid/v1");
    stubFetch();
    const analyzer = new OpenAICareerAnalyzer({ apiKey: key, transport: { maxRetries: 0, logLevel: "off" } });
    await expect(analyzer.extractProfile("SYNTHETIC-RESUME")).rejects.toThrow();
    expect(attempts.map((a) => a.url)).toEqual(["https://synthetic-review.invalid/v1/responses"]);
  });
});
