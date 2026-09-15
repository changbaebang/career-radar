import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stableId } from "../src/domain/store.js";
import { renderAssessment, renderIndex, runUsageCheck, withCallDeadline } from "../scripts/usage-check/run.js";
import { OpenAICareerAnalyzer } from "../src/ai/analyzer.js";
import { createServer } from "node:http";
import { parseUsageArgs } from "../scripts/usage-check/cli.js";
import { groundedAssessment } from "./discovery-fixtures.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";

const traceDirectories: string[] = [];
const temporary = () => { const d = mkdtempSync(join(tmpdir(), "career-radar-usage-traces-")); traceDirectories.push(d); return d; };
afterEach(() => { for (const d of traceDirectories.splice(0)) rmSync(d, { recursive: true, force: true }); });

const serverDirectory = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("../scripts/usage-check/cli.ts", import.meta.url));

function fakeAnalyzer(failOn?: string) {
  return {
    extractProfile: vi.fn(async () => ({ profile: syntheticProfile, warnings: ["synthetic"] })),
    extractJob: vi.fn(async (description: string) => ({ job: { ...syntheticJob, id: stableId("job", description), title: description.slice(0, 20) }, warnings: [] })),
    assess: vi.fn(async (_profile: unknown, job: { title: string }) => {
      if (failOn && job.title.startsWith(failOn)) throw new Error("SYNTHETIC_PROVIDER_FAILURE");
      return { ...groundedAssessment, screeningContext: { version: "1" as const,
        seniorityFit: { value: "uncertain" as const, confidence: "low" as const, explanation: "Synthetic.", evidence: [] },
        careerStoryRisk: { value: "uncertain" as const, confidence: "low" as const, explanation: "Synthetic.", clarificationQuestion: "Synthetic clarification?", evidence: [] },
        screeningRisks: [], unknowns: [] } };
    }),
  };
}
const jobs = [
  { label: "job 1 (pasted)", text: "Alpha role: lead a React platform team for a commerce product." },
  { label: "job 2 (pasted)", text: "Beta role: build accessible frontend tooling and mentor engineers." },
  { label: "job 3 (jobs.lever.co)", url: "https://jobs.lever.co/example/gamma" },
];

describe("usage check (real MCP tools over HTTP, fake analyzer, no network)", () => {
  it("runs profile_upsert, then job_ingest and job_assess per posting, and reports the call count", async () => {
    const analyzer = fakeAnalyzer();
    const fetchJob = vi.fn(async (url: string) => ({ text: "Gamma role fetched: own frontend delivery for customers.", sourceUrl: url, warnings: ["Synthetic fetched page"] }));
    const results = await runUsageCheck({ traceDirectory: temporary(), resumeText: "Synthetic resume text that is long enough to pass the minimum length check.", jobs,
      createAnalyzer: () => analyzer, fetchJob, provider: "openrouter", model: "synthetic/free-model", now: () => new Date("2026-09-12T00:00:00.000Z") });
    expect(results).toMatchObject({ kind: "usage-check", provider: "openrouter", model: "synthetic/free-model", modelCalls: 7, promptVersion: groundedAssessment.promptVersion, toolTimeoutMs: 300_000 });
    expect(results.profileMs).toBeGreaterThanOrEqual(0);
    expect(results.telemetry).toEqual([]); // the fake analyzer emits no hook events
    expect(results).toMatchObject({ abortedCalls: 0, unsettledCalls: 0 });
    expect(results.jobs.every((j) => j.status === "assessed" && j.ingestMs >= 0 && j.assessMs >= 0)).toBe(true);
    expect(results.jobs.map((j) => j.status)).toEqual(["assessed", "assessed", "assessed"]);
    expect(analyzer.extractProfile).toHaveBeenCalledTimes(1);
    expect(fetchJob).toHaveBeenCalledWith("https://jobs.lever.co/example/gamma");
    const third = results.jobs[2]!;
    expect(third.status === "assessed" && third.ingest.job.sourceUrl).toBe("https://jobs.lever.co/example/gamma");
    expect(third.status === "assessed" && third.assessment.assessment.screeningContext?.seniorityFit.value).toBe("uncertain");
    const index = renderIndex(results);
    expect(index).toContain("REALISTIC");
    expect(index).toContain("uncertain / uncertain");
    // The pipeline replaced the unsupported synthetic question with the neutral clarification copy.
    expect(index).toContain("What career context should be clarified for this role?");
    expect(index).not.toContain("Synthetic clarification?");
    expect(index).toContain("model calls 7");
    const page = renderAssessment(third.status === "assessed" ? third.assessment : (() => { throw new Error("unreachable"); })(), "/* bundle */", 2, 3);
    expect(page).toContain("window.openai={toolOutput:");
    expect(page).toContain("job 3 of 3");
  });

  it("keeps going after one posting fails and records the fixed failure message", async () => {
    const results = await runUsageCheck({ traceDirectory: temporary(), resumeText: "Synthetic resume text that is long enough to pass the minimum length check.", jobs: jobs.slice(0, 2),
      createAnalyzer: () => fakeAnalyzer("Beta"), provider: "openai", model: "gpt-synthetic" });
    expect(results.jobs.map((j) => j.status)).toEqual(["assessed", "failed"]);
    const failed = results.jobs[1]!;
    expect(failed.status === "failed" && failed.step).toBe("job_assess");
    expect(results.modelCalls).toBe(5);
    expect(renderIndex(results)).toContain("failed at job_assess");
  });

  it("cancels a model call that outlives the per-call bound, records it, and keeps going", async () => {
    const analyzer = fakeAnalyzer();
    let seen: AbortSignal | undefined;
    // First assessment hangs until the deadline signal fires, like a request whose body never finishes.
    analyzer.assess.mockImplementationOnce((_profile: unknown, _job: unknown, signal?: AbortSignal) => new Promise((_, reject) => {
      seen = signal; signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    const results = await runUsageCheck({ traceDirectory: temporary(), resumeText: "Synthetic resume text that is long enough to pass the minimum length check.", jobs: jobs.slice(0, 2),
      createAnalyzer: () => analyzer, provider: "openai", model: "gpt-synthetic", toolTimeoutMs: 300 });
    expect(results.jobs.map((j) => j.status)).toEqual(["failed", "assessed"]);
    const failed = results.jobs[0]!;
    expect(failed.status === "failed" && failed.step).toBe("job_assess");
    expect(failed.status === "failed" && failed.assessMs).toBeGreaterThanOrEqual(250);
    expect(seen?.aborted).toBe(true);
    expect(results).toMatchObject({ abortedCalls: 1, unsettledCalls: 0 });
    expect(renderIndex(results)).toContain("1 cancelled by the 300 ms per-call bound");
  });

  it("bounds a slow response body with the deadline signal where the SDK timeout alone does not (real SDK, local server)", async () => {
    // Headers immediately, body completed only after 400 ms.
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"id":"resp_x","object":"response","model":"m","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}');
      setTimeout(() => res.end("}"), 400);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    try {
      vi.stubEnv("OPENAI_BASE_URL", baseURL);
      const adapter = new OpenAICareerAnalyzer({ apiKey: "synthetic-not-a-real-key", transport: { maxRetries: 0, logLevel: "off", timeout: 100 } });
      let started = performance.now();
      await expect(adapter.extractProfile("SYNTHETIC-RESUME")).rejects.toThrow(); // completes after ~400 ms, then fails parsing: timeout did not bound the body
      expect(performance.now() - started).toBeGreaterThanOrEqual(350);
      const deadline = withCallDeadline(100);
      started = performance.now();
      await expect(deadline.wrap(adapter).extractProfile("SYNTHETIC-RESUME")).rejects.toMatchObject({ name: "AbortError" });
      expect(performance.now() - started).toBeLessThan(350);
      expect(deadline.aborted).toBe(1);
      expect(await deadline.settle(1_000)).toBe(0);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it("parses arguments and requires one to five postings unless replaying", () => {
    expect(parseUsageArgs(["--job", "a.txt", "--job", "https://jobs.lever.co/x/y", "--approve-transmission", "--port", "8020"])).toMatchObject({ jobs: ["a.txt", "https://jobs.lever.co/x/y"], approve: true, port: 8020 });
    expect(parseUsageArgs(["--replay", "r.json"])).toMatchObject({ replay: "r.json", jobs: [] });
    expect(() => parseUsageArgs([])).toThrow("between one and five");
    expect(() => parseUsageArgs(["--job", "a", "--job", "b", "--job", "c", "--job", "d", "--job", "e", "--job", "f"])).toThrow("between one and five");
    expect(() => parseUsageArgs(["--bogus"])).toThrow("Unknown option");
    expect(() => parseUsageArgs(["--job", "a", "--port", "80"])).toThrow("Unknown option");
  });

  it("prints the plan and exits 3 with zero calls when transmission is not approved", () => {
    const tsx = createRequire(import.meta.url).resolve("tsx");
    const run = spawnSync(process.execPath, ["--import", tsx, script, "--job", "https://jobs.lever.co/example/one"], { cwd: serverDirectory, encoding: "utf8", timeout: 60_000,
      env: { ...process.env, CAREER_RADAR_PROVIDER: "openrouter", OPENROUTER_MODEL: "synthetic/free-model" } });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain("destination: https://openrouter.ai/api/v1");
    expect(run.stderr).toContain("model: synthetic/free-model");
    expect(run.stderr).toContain("0 model calls made");
    expect(run.stdout).toBe("");
  });
});

// --- review follow-ups: access gate, pinned transport, caller-relative paths ---
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createResultsApp, type UsageCheckResults } from "../scripts/usage-check/run.js";
import { USAGE_ERRORS, usageAnalyzerFactory } from "../scripts/usage-check/cli.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function syntheticResults(): Promise<UsageCheckResults> {
  return runUsageCheck({ traceDirectory: temporary(), resumeText: "Synthetic resume text that is long enough to pass the minimum length check.", jobs: jobs.slice(0, 1),
    createAnalyzer: () => fakeAnalyzer(), provider: "synthetic", model: "synthetic-no-model", now: () => new Date("2026-09-12T00:00:00.000Z") });
}
function rawGet(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path, method: "GET", headers }, (response) => {
      let body = ""; response.setEncoding("utf8"); response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    req.on("error", reject); req.end();
  });
}

describe("usage check results page access gate", () => {
  it("serves loopback requests and rejects foreign Host or Origin before any result is returned", async () => {
    const results = await syntheticResults();
    const server = createResultsApp(results, "/* bundle */").listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const port = (server.address() as AddressInfo).port;
    const ok = await rawGet(port, "/?view=json", { Host: `127.0.0.1:${port}` });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain(results.profile.profile.id);
    const foreign: Array<Record<string, string>> = [{ Host: `rebind.example:${port}` }, { Host: `127.0.0.1:${port}`, Origin: `http://rebind.example:${port}` }, { Host: `rebind.example:${port}`, Origin: `http://rebind.example:${port}` }];
    for (const headers of foreign) {
      const denied = await rawGet(port, "/?view=json", headers);
      expect(denied.status).toBe(403);
      expect(denied.body).not.toContain(results.profile.profile.id);
      expect(denied.body).not.toContain("REALISTIC");
    }
    expect((await rawGet(port, "/", { Host: `localhost:${port}`, Origin: `http://localhost:${port}` })).status).toBe(200);
    expect((await rawGet(port, "/?view=assessment&job=0", { Host: `[::1]:${port}` })).status).toBe(200);
  });
});

describe("usage check analyzer transport (real SDK, stubbed fetch)", () => {
  it("makes exactly one HTTP attempt per call and never prints request bodies under OPENAI_LOG=debug", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-not-a-real-key"); vi.stubEnv("OPENAI_LOG", "debug"); vi.stubEnv("OPENAI_BASE_URL", "");
    const attempts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      attempts.push(String(init?.body ?? ""));
      return new Response('{"error":{"message":"synthetic 500"}}', { status: 500, headers: { "content-type": "application/json", "retry-after-ms": "1" } });
    }));
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(usageAnalyzerFactory("openai")().extractProfile("SYNTHETIC-RESUME-MARKER")).rejects.toThrow();
    expect(attempts).toHaveLength(1); // signal-less profile extraction: no SDK retries
    expect(attempts[0]).toContain("SYNTHETIC-RESUME-MARKER"); // the request itself is unchanged
    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
});

describe("usage check through the root pnpm command", () => {
  const rootScript = (args: string[], env: Record<string, string> = {}) => {
    const execPath = process.env.npm_execpath;
    const [command, prefix] = execPath && /\.c?js$/.test(execPath) ? [process.execPath, [execPath]] : ["pnpm", [] as string[]];
    return { command, argv: [...prefix, "usage-check", ...args], env: { ...process.env, ...env } };
  };
  const scratch = () => {
    const directory = mkdtempSync(join(repositoryRoot, "data", "usage-check-test-")); // under gitignored data/*
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
  };

  it("resolves a relative --job file from the caller's directory and refuses OPENAI_BASE_URL", () => {
    const directory = scratch();
    writeFileSync(join(directory, "posting.txt"), "Synthetic pasted posting: lead a React platform team for a commerce product.");
    const relative = join("data", directory.split("/").pop()!, "posting.txt");
    const { command, argv, env } = rootScript(["--job", relative], { CAREER_RADAR_PROVIDER: "openrouter", OPENROUTER_MODEL: "synthetic/free-model", OPENAI_BASE_URL: "" });
    const plan = spawnSync(command, argv, { cwd: repositoryRoot, encoding: "utf8", env, timeout: 180_000 });
    expect(plan.status, plan.stderr).toBe(3);
    expect(plan.stderr).toContain("posting.txt");
    expect(plan.stderr).not.toContain("ENOENT");
    expect(plan.stderr).toContain("SDK retries off");
    const refused = spawnSync(command, [...argv, "--approve-transmission"], { cwd: repositoryRoot, encoding: "utf8", timeout: 180_000,
      env: { ...env, CAREER_RADAR_PROVIDER: "openai", OPENAI_API_KEY: "synthetic-not-a-real-key", OPENAI_BASE_URL: "https://review-destination.invalid/v1" } });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain(USAGE_ERRORS.baseUrlSet);
  });

  it("replays a saved results file given as a caller-relative path", async () => {
    const directory = scratch();
    mkdirSync(join(directory, "run"));
    writeFileSync(join(directory, "run", "results.json"), JSON.stringify(await syntheticResults()));
    const relative = join("data", directory.split("/").pop()!, "run", "results.json");
    const port = 8100 + Math.floor(Math.random() * 400);
    const { command, argv, env } = rootScript(["--replay", relative, "--port", String(port)]);
    const child = spawn(command, argv, { cwd: repositoryRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    cleanup.push(() => { child.kill("SIGINT"); });
    let stderr = "";
    await new Promise<void>((resolve, reject) => {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { stderr += chunk; if (stderr.includes("Usage check page")) resolve(); });
      child.once("exit", (code) => reject(new Error(`exited ${code} before serving: ${stderr}`)));
      setTimeout(() => reject(new Error(`timed out before serving: ${stderr}`)), 170_000).unref();
    });
    const page = await rawGet(port, "/", { Host: `127.0.0.1:${port}` });
    expect(page.status).toBe(200);
    expect(page.body).toContain("Career Radar · usage check");
    const json = await rawGet(port, "/?view=json", { Host: `127.0.0.1:${port}` });
    expect(json.status).toBe(200);
    expect(JSON.parse(json.body)).toMatchObject({ kind: "usage-check", modelCalls: 3 });
    expect((await rawGet(port, "/?view=json", { Host: `rebind.example:${port}` })).status).toBe(403);
  }, 200_000);
});
