import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedJobUrl, extractJobText, fetchJobUrl, isPublicAddress, type JobFetchDependencies } from "../src/infra/fetch/job-url.js";

const url = "https://jobs.lever.co/example/synthetic-job";
const html = "<main><h1>Synthetic frontend role</h1><p>Build reliable React applications for commerce customers.</p></main>";
function dependencies(): JobFetchDependencies {
  return {
    resolve: vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]),
    read: vi.fn(async () => ({ status: 200, contentType: "text/html; charset=utf-8", body: html })),
  };
}
afterEach(() => vi.useRealTimers());

describe("public job URL ingestion", () => {
  it.each(["http://jobs.lever.co/example", "https://localhost/job", "https://127.0.0.1/job", "https://jobs.lever.co.evil.example/job", "https://jobs.lever.co:444/job", "https://name:secret@jobs.lever.co/job", "file:///etc/passwd"])("rejects unsupported URL %s before resolving", async (input) => {
    const deps = dependencies();
    await expect(fetchJobUrl(input, deps)).rejects.toThrow("Paste the job-description");
    expect(deps.resolve).not.toHaveBeenCalled();
  });
  it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "224.0.0.1", "0.0.0.0"])("blocks nonpublic address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it("normalizes HTML text and discards scripts/forms without executing JavaScript", () => {
    expect(extractJobText(`<script>secret()</script><nav>Navigation</nav>${html}<form>Phone number</form>`))
      .toBe("Synthetic frontend role\nBuild reliable React applications for commerce customers.");
    expect(allowedJobUrl(`${url}#fragment`).hash).toBe("");
  });
  it("passes the validated IP to the transport and returns the final public source", async () => {
    const deps = dependencies();
    const result = await fetchJobUrl(url, deps);
    expect(result.sourceUrl).toBe(url);
    expect(result.text).toContain("Synthetic frontend role");
    expect(deps.read).toHaveBeenCalledWith(new URL(url), { address: "8.8.8.8", family: 4 }, expect.any(AbortSignal));
  });
  it("rejects mixed public/private DNS results", async () => {
    const deps = dependencies();
    deps.resolve = async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }];
    await expect(fetchJobUrl(url, deps)).rejects.toThrow("public IP");
    expect(deps.read).not.toHaveBeenCalled();
  });
  it("validates redirected hosts before another network call", async () => {
    const deps = dependencies();
    deps.read = vi.fn(async () => ({ status: 302, location: "https://localhost/private", contentType: "", body: "" }));
    await expect(fetchJobUrl(url, deps)).rejects.toThrow("Paste the job-description");
    expect(deps.read).toHaveBeenCalledTimes(1);
  });
  it("rechecks DNS on same-host redirects and bounds redirect loops", async () => {
    const deps = dependencies();
    deps.read = vi.fn(async () => ({ status: 302, location: "/next", contentType: "", body: "" }));
    await expect(fetchJobUrl(url, deps)).rejects.toThrow("Too many");
    expect(deps.resolve).toHaveBeenCalledTimes(4);
  });
  it.each([
    { status: 404, contentType: "text/html", body: html },
    { status: 200, contentType: "application/pdf", body: html },
    { status: 200, contentType: "text/html", body: "<script>renderApp()</script>" },
    { status: 200, contentType: "text/plain", body: "a".repeat(1_000_001) },
  ])("fails with pasted-text fallback for unreadable pages", async (page) => {
    const deps = dependencies(); deps.read = async () => page;
    await expect(fetchJobUrl(url, deps)).rejects.toThrow("Paste the job-description");
  });
  it("times out a stalled DNS lookup", async () => {
    vi.useFakeTimers();
    const deps = dependencies(); deps.resolve = () => new Promise(() => {});
    const pending = expect(fetchJobUrl(url, deps)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
  });
});
