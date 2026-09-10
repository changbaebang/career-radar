import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("node:https", () => ({ request: requestMock }));
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "8.8.8.8", family: 4 }] }));
import { GreenhouseJobSearchProvider } from "../src/infra/search/greenhouse.js";

function transport(statusCode = 200, headers: Record<string, string | undefined> = { "content-type": "application/json" }, chunks = ['{"jobs":[]}']) {
  const response = Object.assign(new EventEmitter(), { statusCode, headers, destroy: vi.fn() });
  const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn((error: Error) => { req.emit("error", error); }) });
  requestMock.mockImplementation((_url: URL, _options: unknown, callback: (value: typeof response) => void) => {
    queueMicrotask(() => {
      callback(response);
      if (!response.destroy.mock.calls.length) {
        for (const chunk of chunks) response.emit("data", Buffer.from(chunk));
        response.emit("end");
      }
    });
    return req;
  });
  return { response, req };
}

describe("Greenhouse HTTPS reader boundary", () => {
  it("pins the checked IP and sends no auth or caller metadata", async () => {
    transport();
    const result = await new GreenhouseJobSearchProvider().search({ boardToken: "synthetic", limit: 5 });
    expect(result.hits).toEqual([]);
    const options = requestMock.mock.calls.at(-1)![1];
    expect(options).toMatchObject({ method: "GET", agent: false, family: 4,
      headers: { Accept: "application/json", "Accept-Encoding": "identity" } });
    expect(Object.keys(options.headers).sort()).toEqual(["Accept", "Accept-Encoding", "User-Agent"]);
    const callback = vi.fn();
    options.lookup("boards-api.greenhouse.io", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });

  it.each([
    { status: 302, headers: { "content-type": "application/json", location: "http://127.0.0.1/private" } },
    { status: 429, headers: { "content-type": "application/json" } },
    { status: 404, headers: { "content-type": "application/json" } },
    { status: 200, headers: { "content-type": "text/html" } },
    { status: 200, headers: { "content-type": "application/json", "content-encoding": "gzip" } },
  ])("rejects $status / $headers without redirect or body processing", async ({ status, headers }) => {
    const { response } = transport(status, headers);
    const before = requestMock.mock.calls.length;
    await expect(new GreenhouseJobSearchProvider().search({ boardToken: "synthetic", limit: 5 })).rejects.toThrow("could not be read");
    expect(response.destroy).toHaveBeenCalledOnce();
    expect(requestMock.mock.calls.length - before).toBe(1);
  });

  it("aborts the stream once the byte limit is exceeded", async () => {
    const { req } = transport(200, { "content-type": "application/json" }, ["x".repeat(3_000_000), "x".repeat(2_000_001)]);
    await expect(new GreenhouseJobSearchProvider().search({ boardToken: "synthetic", limit: 5 })).rejects.toThrow("could not be read");
    expect(req.destroy).toHaveBeenCalledOnce();
  });
});
