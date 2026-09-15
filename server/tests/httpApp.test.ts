import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

import type {
  CandidateProfile,
  FitAssessment,
  JobPosting,
} from "@career-radar/shared";
import { ApplicationResultSchema, JobAssessmentResultSchema, JobRecommendationsSchema, JobSearchResultSchema } from "@career-radar/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CareerAnalyzer } from "../src/ai/analyzer.js";
import { OPENROUTER_BASE_URL, OpenRouterCareerAnalyzer } from "../src/ai/openrouter.js";
import { createHttpApp } from "../src/httpApp.js";
import {
  CAREER_RADAR_WIDGET_URI,
  type McpDependencies,
} from "../src/mcp/createServer.js";
import { CareerStore } from "../src/domain/store.js";
import { TRACE_WRITE_FAILED, TraceStore } from "../src/domain/trace/store.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syntheticProfile } from "./fixtures.js";
import { syntheticJob } from "./fixtures.js";
import { JobDiscovery } from "../src/domain/jobs/search.js";
import { CITATION_INVALID_DROPPED } from "../src/domain/assessment/citations.js";
import { matchClaimId } from "../src/domain/assessment/claims.js";
import type { RetrievedEvidence } from "../src/domain/evidence/retrieve.js";
import { discoveryResult, groundedAssessment } from "./discovery-fixtures.js";

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

async function startTestServer(dependencies: Partial<McpDependencies> = {}) {
  const httpServer = createHttpApp(dependencies).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address() as AddressInfo;
  closeCallbacks.push(
    () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return `http://127.0.0.1:${address.port}`;
}

async function connectClient(baseUrl: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  const client = new Client({ name: "career-radar-integration-test", version: "0.0.0" });
  await client.connect(transport);
  closeCallbacks.push(async () => client.close());
  return client;
}

// fetch() refuses to set Host, so raw http is used to imitate DNS-rebinding requests.
function rawStatus(baseUrl: string, headers: Record<string, string>): Promise<number> {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path: "/health", method: "GET", headers }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("Career Radar HTTP and MCP server", () => {
  it("chains search IDs across MCP requests into grounded recommendations and explicit saves", async () => {
    const store = new CareerStore();
    store.upsertProfile(syntheticProfile);
    const provider = { search: vi.fn(async () => discoveryResult) };
    const discovery = new JobDiscovery(provider);
    const createAnalyzer = vi.fn(() => ({ extractProfile: vi.fn(),
      extractJob: async () => ({ job: syntheticJob, warnings: [] }), assess: async () => groundedAssessment,
    }));
    const traces = new TraceStore();
    const client = await connectClient(await startTestServer({ store, discovery, createAnalyzer, traces }));
    closeCallbacks.push(async () => { discovery.close(); store.close(); });
    const tools = (await client.listTools()).tools;
    // B2 advertises the optional screening context on assessment outputs; identity stays internal. URI is v7 since
    // M5-B added citations and the "evidence" reference source (v6 once company became optional).
    for (const name of ["job_assess", "job_recommend"]) expect(JSON.stringify(tools.find((tool) => tool.name === name)?.outputSchema)).toContain("screeningContext");
    for (const name of ["job_assess", "job_recommend"]) expect(JSON.stringify(tools.find((tool) => tool.name === name)?.outputSchema)).toContain("citations");
    expect(JSON.stringify(tools)).not.toContain("inputIdentity");
    expect(CAREER_RADAR_WIDGET_URI).toBe("ui://career-radar/widget-v7.html");
    expect(tools.find((tool) => tool.name === "job_search")).toMatchObject({ annotations: { readOnlyHint: false, openWorldHint: true } });
    expect(tools.find((tool) => tool.name === "job_search")?._meta).not.toHaveProperty("ui");
    expect(tools.find((tool) => tool.name === "job_recommend")).toMatchObject({
      annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: false },
      _meta: { ui: { resourceUri: CAREER_RADAR_WIDGET_URI } },
    });
    const search = JobSearchResultSchema.parse((await client.callTool({ name: "job_search", arguments: { boardToken: "synthetic" } })).structuredContent);
    expect(createAnalyzer).not.toHaveBeenCalled();
    const bad = await client.callTool({ name: "job_recommend", arguments: {
      searchId: search.searchId, candidateProfileId: syntheticProfile.id, candidateIds: ["foreign-id"],
    } });
    expect(bad.isError).toBe(true);
    expect(createAnalyzer).not.toHaveBeenCalled();
    const result = JobRecommendationsSchema.parse((await client.callTool({ name: "job_recommend", arguments: {
      searchId: search.searchId, candidateProfileId: syntheticProfile.id, candidateIds: [search.candidates[0]!.candidateId],
    } })).structuredContent);
    expect(result.realistic).toHaveLength(1);
    // The synthetic analyzer produced no context: absence is "not evaluated", never synthesized.
    expect(result.realistic[0]!.assessment).not.toHaveProperty("screeningContext");
    expect(result.realistic[0]).not.toHaveProperty("inputIdentity");
    expect(result.shortfall.stretch).toBe(1);
    expect(store.pipelineSummary().total).toBe(0);
    // M5-E: the batch left one run trace whose stages carry the candidate index and no input text.
    // The rejected foreign-id call above was traced too: failed, zero model calls.
    const batchTrace = traces.list();
    expect(batchTrace.map((t) => [t.tool, t.outcome, t.modelCalls])).toEqual([["job_recommend", "ok", 2], ["job_recommend", "failed", 0]]);
    const full = traces.get(batchTrace[0]!.runId)!;
    expect(full.stages.map((s) => [s.stage, s.item])).toEqual([["extract", 0], ["retrieve", 0], ["model", 0], ["validate", 0], ["persist", 0]]);
    expect(JSON.stringify(full)).not.toContain(syntheticJob.description);
    const saved = await client.callTool({ name: "application_save", arguments: { assessmentId: result.realistic[0]!.assessmentId } });
    expect(saved.structuredContent).toMatchObject({ application: { status: "saved", verdictAtDecision: "REALISTIC" } });
    expect(provider.search).toHaveBeenCalledTimes(1);
  });

  it("rejects unrelated browser origins before exposing the local database", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/mcp`, { method: "OPTIONS", headers: { Origin: "https://unrelated.example", "Access-Control-Request-Method": "POST" } });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects DNS-rebinding requests whose Host is not a loopback address", async () => {
    const baseUrl = await startTestServer();
    const port = new URL(baseUrl).port;
    // A rebinding page sends its own domain as both Host and Origin; they match each other but not loopback.
    await expect(rawStatus(baseUrl, { Host: `attacker.example:${port}`, Origin: `http://attacker.example:${port}` })).resolves.toBe(403);
    await expect(rawStatus(baseUrl, { Host: `attacker.example:${port}` })).resolves.toBe(403);
    await expect(rawStatus(baseUrl, { Host: `localhost:${port}`, Origin: `http://localhost:${port}` })).resolves.toBe(200);
    await expect(rawStatus(baseUrl, { Host: `127.0.0.1:${port}` })).resolves.toBe(200);
    await expect(rawStatus(baseUrl, { Host: `[::1]:${port}`, Origin: `http://[::1]:${port}` })).resolves.toBe(200);
  });
  it("serves deterministic readiness data", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "Career Radar", milestone: "Milestone 4", state: "ready",
    });
  });

  it("surfaces a fixed provider configuration message instead of a stack when the environment names an unknown provider", async () => {
    vi.stubEnv("CAREER_RADAR_PROVIDER", "bogus");
    try {
      const client = await connectClient(await startTestServer({ store: new CareerStore() }));
      const result = await client.callTool({ name: "profile_upsert", arguments: { resumeText: "Synthetic resume text that is long enough to pass the minimum length check." } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("Set CAREER_RADAR_PROVIDER to openai or openrouter.");
    } finally { vi.unstubAllEnvs(); }
  });

  it("never forwards a provider's HTTP error body through the OpenRouter adapter into an MCP result", async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => String(input).startsWith(OPENROUTER_BASE_URL)
      ? new Response('{"error":{"message":"SECRET-PROVIDER-BODY","code":"bad_request"}}', { status: 400, headers: { "content-type": "application/json" } })
      : realFetch(input, init)));
    try {
      const createAnalyzer = () => new OpenRouterCareerAnalyzer({ apiKey: "synthetic-not-a-real-key", model: "synthetic/free-model", transport: { maxRetries: 0, logLevel: "off" } });
      const client = await connectClient(await startTestServer({ store: new CareerStore(), createAnalyzer }));
      const result = await client.callTool({ name: "profile_upsert", arguments: { resumeText: "Synthetic resume text that is long enough to pass the minimum length check." } });
      expect(result.isError).toBe(true);
      const text = JSON.stringify(result.content);
      expect(text).toContain("OpenRouter request failed (HTTP 400)");
      expect(text).not.toContain("SECRET-PROVIDER-BODY");
    } finally { vi.unstubAllGlobals(); }
  });

  it("lists and calls the status tool and serves its widget resource", async () => {
    const client = await connectClient(await startTestServer());
    const tools = await client.listTools();
    const statusTool = tools.tools.find((tool) => tool.name === "career_radar_status");
    expect(statusTool).toMatchObject({
      annotations: {
        readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true,
      },
      _meta: { ui: { resourceUri: CAREER_RADAR_WIDGET_URI } },
    });
    const result = await client.callTool({ name: "career_radar_status", arguments: {} });
    expect(result.structuredContent).toMatchObject({ name: "Career Radar", state: "ready" });
    const resource = await client.readResource({ uri: CAREER_RADAR_WIDGET_URI });
    expect(resource.contents[0]).toMatchObject({
      uri: CAREER_RADAR_WIDGET_URI, mimeType: "text/html;profile=mcp-app",
    });
    const content = resource.contents[0];
    expect(content && "text" in content ? content.text : undefined).toContain('<div id="root"></div>');
  });

  it("runs the profile, pasted job, and grounded assessment tool sequence", async () => {
    const profile: CandidateProfile = {
      id: "profile_test", headline: "Frontend engineer", roles: [], skills: ["React"],
      domains: [], leadership: [], customerFacing: [], aiEvidence: [], cloudEvidence: [],
      sourceHash: "a".repeat(64),
    };
    const job: JobPosting = {
      id: "job_test", company: "Example", title: "Frontend Engineer",
      description: "Build reliable React applications for commerce customers.",
      required: [{ id: "req_react", text: "Production React experience", type: "technology", importance: "core" }],
      preferred: [], responsibilities: ["Build React applications"], roleFamily: "frontend",
      domains: ["commerce"], technologies: ["React"],
    };
    const assessment: FitAssessment = {
      verdict: "REALISTIC", confidence: "high", resumeContortion: "low",
      strongestMatches: [{ requirementId: "req_react", requirement: "Production React experience", evidence: "React", source: {}, strength: "direct" }],
      gaps: [], hardBlockers: [], interviewRisks: [], recommendation: "Apply with direct React evidence.",
      missingInformation: [], modelVersion: "fake-model", promptVersion: "fake-prompt",
      // No role/leadership evidence exists for a scope comparison, so the validator must downgrade it;
      // the career-story judgment cites a skill and a requirement and stays as produced.
      screeningContext: { version: "1",
        seniorityFit: { value: "overleveled", confidence: "high", explanation: "Synthetic unsupported scope claim.", evidence: [
          { source: "candidate", path: "skills[0]", quote: "React" }, { source: "job", path: "required[0].text", quote: "Production React experience" }] },
        careerStoryRisk: { value: "low", confidence: "medium", explanation: "Synthetic continuous frontend path.", evidence: [
          { source: "candidate", path: "skills[0]", quote: "React" }, { source: "job", path: "required[0].text", quote: "Production React experience" }] },
        screeningRisks: [], unknowns: [] },
    };
    // M5-B: the server retrieves evidence before the call and hands it to the analyzer; the fake cites the
    // retrieved "React" chunk for its match, plus one chunk id that was never retrieved.
    const assess = vi.fn(async (_profile: CandidateProfile, _job: JobPosting, _signal?: AbortSignal, evidence?: RetrievedEvidence): Promise<FitAssessment> => {
      const react = evidence?.chunks.find((chunk) => chunk.text === "React");
      if (!react) throw new Error("expected the React skill chunk to be retrieved for the React requirement");
      const claimId = matchClaimId(assessment.strongestMatches[0]!);
      return { ...assessment, citations: [
        { claimId, ref: { source: "evidence", path: `chunk:${react.id}`, quote: "React" } },
        { claimId, ref: { source: "evidence", path: `chunk:${"f".repeat(64)}`, quote: "React" } },
      ] };
    });
    const analyzer: CareerAnalyzer = {
      extractProfile: async () => ({ profile, warnings: [] }),
      extractJob: async () => ({ job, warnings: [] }),
      assess,
    };
    const store = new CareerStore();
    const createAnalyzer = vi.fn(() => analyzer);
    const traces = new TraceStore();
    const client = await connectClient(await startTestServer({ createAnalyzer, store, traces }));
    expect(createAnalyzer).not.toHaveBeenCalled();

    await client.callTool({ name: "profile_upsert", arguments: { resumeText: "Frontend engineer with direct production React delivery experience." } });
    await client.callTool({ name: "job_ingest", arguments: { text: "Example seeks a Frontend Engineer to build reliable React applications for commerce customers." } });
    const result = await client.callTool({
      name: "job_assess",
      arguments: { candidateProfileId: profile.id, jobId: job.id },
    });

    expect(result.structuredContent).toMatchObject({
      job: { id: "job_test" },
      assessment: { verdict: "REALISTIC", modelVersion: "fake-model", screeningContext: {
        seniorityFit: { value: "uncertain", confidence: "low" }, careerStoryRisk: { value: "low", confidence: "medium" },
        unknowns: ["seniorityFit: missing scope references or invalid source/path/quote; marked uncertain."] } },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("Synthetic unsupported scope claim.");
    // M5-B: the valid chunk citation is on the tool output; the never-retrieved id was dropped, diagnosed and lowered confidence.
    const output = JobAssessmentResultSchema.parse(result.structuredContent);
    expect(assess).toHaveBeenCalledTimes(1);
    expect(assess.mock.calls[0]![3]).toMatchObject({ version: "retrieval-v1" });
    expect(output.assessment.citations).toHaveLength(1);
    expect(output.assessment.citations?.[0]?.ref).toMatchObject({ source: "evidence", quote: "React" });
    expect(output.assessment.confidence).toBe("low");
    expect(output.assessment.missingInformation).toContain(CITATION_INVALID_DROPPED);
    expect(store.getProfile(profile.id)).toEqual(profile);
    expect(store.getJob(job.id)).toEqual(job);
    expect(createAnalyzer).toHaveBeenCalledTimes(1);
    // M5-E: the call left a run trace; its id is echoed in the tool text and the trace holds no resume, posting or evidence text.
    const [traced] = traces.list();
    expect(traced).toMatchObject({ tool: "job_assess", outcome: "ok", modelCalls: 1 });
    expect((result.content as { text: string }[])[0]!.text).toContain(`(run ${traced!.runId})`);
    const trace = traces.get(traced!.runId)!;
    expect(trace.stages.map((s) => s.stage)).toEqual(["retrieve", "model", "validate", "persist"]);
    expect(trace.stages[2]!.validation).toMatchObject({ finalVerdict: "REALISTIC", finalConfidence: "low", diagnostics: { citationsInvalid: 1 } });
    expect(trace.counters.invalidCitations).toBe(1);
    for (const text of ["Frontend engineer with direct production React delivery experience.", "Synthetic unsupported scope claim.", job.description, ...profile.roles.flatMap((r) => r.evidence)]) expect(JSON.stringify(trace)).not.toContain(text);
    const assessmentId = JobAssessmentResultSchema.parse(result.structuredContent).assessmentId;
    expect(typeof assessmentId).toBe("string");
    const saved = await client.callTool({ name: "application_save", arguments: { assessmentId, status: "saved" } });
    const savedData = ApplicationResultSchema.parse(saved.structuredContent);
    const changed = await client.callTool({ name: "application_update", arguments: { applicationId: savedData.application.id, status: "interview", stage: "technical" } });
    expect(changed.structuredContent).toMatchObject({ application: { status: "interview", verdictAtDecision: "REALISTIC" } });
    const retried = await client.callTool({ name: "application_save", arguments: { assessmentId, status: "saved" } });
    expect(retried.structuredContent).toEqual(changed.structuredContent);
    const summary = await client.callTool({ name: "pipeline_summary", arguments: {} });
    expect(summary.structuredContent).toMatchObject({ total: 1, applications: [{ status: "interview" }] });
    const correction = await client.callTool({ name: "application_update", arguments: {
      applicationId: savedData.application.id, status: "rejected", normalizedOutcomeStage: "resume_screen",
      historyMode: "replace", occurredAt: null,
    } });
    expect(correction.structuredContent).toMatchObject({ application: {
      status: "rejected", normalizedOutcomeStage: "resume_screen", outcomeStage: "", verdictAtDecision: "REALISTIC",
    } });
    const correctedSummary = await client.callTool({ name: "pipeline_summary", arguments: {} });
    expect(correctedSummary.structuredContent).toMatchObject({ stageSummary: { total: 1, resumeScreenRejected: 1, recordedProgression: 0 } });
    const conflict = await client.callTool({ name: "application_update", arguments: {
      applicationId: savedData.application.id, status: "interview", normalizedOutcomeStage: "offer",
    } });
    expect(conflict.isError).toBe(true);
    store.clear();
    store.close();
  });

  it("does not share default storage between independent HTTP apps", async () => {
    const profile = syntheticProfile;
    const createAnalyzer = vi.fn(() => ({
      extractProfile: async () => ({ profile, warnings: [] }),
      extractJob: vi.fn(),
      assess: vi.fn(),
    }));
    const first = await connectClient(await startTestServer({ createAnalyzer }));
    await first.callTool({
      name: "profile_upsert",
      arguments: { resumeText: "Synthetic frontend engineer with explicit React leadership experience." },
    });
    const second = await connectClient(await startTestServer({ createAnalyzer }));
    const result = await second.callTool({
      name: "job_assess", arguments: { candidateProfileId: profile.id, jobId: "unavailable" },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: expect.stringContaining("Call profile_upsert again") }),
    ]));
    expect(createAnalyzer).toHaveBeenCalledTimes(1);
  });

  it("normalizes fetched text, preserves its source, and validates ambiguous input before the model", async () => {
    const { syntheticJob } = await import("./fixtures.js");
    const extractJob = vi.fn(async () => ({ job: syntheticJob, warnings: [] }));
    const createAnalyzer = vi.fn(() => ({ extractProfile: vi.fn(), extractJob, assess: vi.fn() }));
    const fetchJob = vi.fn(async () => ({ text: "Synthetic public frontend job description with sufficient text.", sourceUrl: "https://jobs.lever.co/example/final", warnings: ["Synthetic fetched page"] }));
    const client = await connectClient(await startTestServer({ createAnalyzer, fetchJob }));
    const tools = await client.listTools();
    expect(tools.tools.find((tool) => tool.name === "job_ingest")?.annotations?.openWorldHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "job_assess")?.annotations?.readOnlyHint).toBe(false);
    expect(tools.tools.find((tool) => tool.name === "pipeline_summary")?.annotations?.readOnlyHint).toBe(true);
    const invalid = await client.callTool({ name: "job_ingest", arguments: {} });
    expect(invalid.isError).toBe(true);
    const ambiguous = await client.callTool({ name: "job_ingest", arguments: { url: "https://jobs.lever.co/example/job", text: "Synthetic job with more than fifty characters in the job description." } });
    expect(ambiguous.isError).toBe(true);
    expect(createAnalyzer).not.toHaveBeenCalled();
    const result = await client.callTool({ name: "job_ingest", arguments: { url: "https://jobs.lever.co/example/job" } });
    expect(result.structuredContent).toMatchObject({ job: { sourceUrl: "https://jobs.lever.co/example/final" }, warnings: ["Synthetic fetched page"] });
    expect(extractJob).toHaveBeenCalledWith("Synthetic public frontend job description with sufficient text.");
  });
});

describe("M5-E run trace on a failed tool call", () => {
  it("records the failure class and stage outcome, echoes nothing about the inputs, and still reports the tool error", async () => {
    const store = new CareerStore();
    store.upsertProfile(syntheticProfile); store.upsertJob(syntheticJob);
    const boom = new Error("synthetic provider request failed (HTTP 500)"); boom.name = "InternalServerError"; (boom as { status?: number }).status = 500;
    const traces = new TraceStore();
    const client = await connectClient(await startTestServer({ store, traces, createAnalyzer: () => ({ extractProfile: vi.fn(), extractJob: vi.fn(), assess: async () => { throw boom; } }) }));
    const result = await client.callTool({ name: "job_assess", arguments: { candidateProfileId: syntheticProfile.id, jobId: syntheticJob.id } });
    expect(result.isError).toBe(true);
    const [summary] = traces.list();
    expect(summary).toMatchObject({ tool: "job_assess", outcome: "failed", modelCalls: 1 });
    const trace = traces.get(summary!.runId)!;
    expect(trace).toMatchObject({ failureClass: "provider_error", counters: { providerErrors: 1 } });
    expect(trace.stages.map((s) => [s.stage, s.outcome])).toEqual([["retrieve", "ok"], ["model", "error"]]);
    expect(JSON.stringify(trace)).not.toContain(syntheticJob.description);
  });
});

describe("M5-E review: trace persistence and batch deadlines never change tool results", () => {
  it("returns the saved assessment when the trace cannot be written, and keeps the original error when the model fails", async () => {
    const warnings: string[] = [];
    const warn = vi.spyOn(console, "error").mockImplementation((line: unknown) => { warnings.push(String(line)); });
    try {
      const store = new CareerStore();
      store.upsertProfile(syntheticProfile); store.upsertJob(syntheticJob);
      // A regular file where the trace directory should be: mkdir fails with EEXIST/ENOTDIR on every save.
      const blocked = join(mkdtempSync(join(tmpdir(), "career-radar-blocked-")), "not-a-directory");
      writeFileSync(blocked, "x");
      const traces = new TraceStore(blocked);
      const analyzer: CareerAnalyzer = { extractProfile: vi.fn(), extractJob: vi.fn(), assess: async () => groundedAssessment };
      const client = await connectClient(await startTestServer({ store, traces, createAnalyzer: () => analyzer }));
      const ok = await client.callTool({ name: "job_assess", arguments: { candidateProfileId: syntheticProfile.id, jobId: syntheticJob.id } });
      expect(ok.isError).toBeFalsy();
      expect(typeof JobAssessmentResultSchema.parse(ok.structuredContent).assessmentId).toBe("string");
      expect(store.pipelineSummary().total).toBe(0);
      expect(traces.list()).toHaveLength(1); // memory copy survives the failed write
      expect(warnings).toEqual([TRACE_WRITE_FAILED]);
      expect(JSON.stringify(warnings)).not.toContain(blocked);
      const boom = new Error("synthetic provider request failed (HTTP 500)"); boom.name = "InternalServerError";
      const failing = await connectClient(await startTestServer({ store, traces: new TraceStore(blocked), createAnalyzer: () => ({ ...analyzer, assess: async () => { throw boom; } }) }));
      const failed = await failing.callTool({ name: "job_assess", arguments: { candidateProfileId: syntheticProfile.id, jobId: syntheticJob.id } });
      expect(failed.isError).toBe(true);
      const text = (failed.content as { text: string }[])[0]!.text;
      expect(text).not.toMatch(/EEXIST|ENOTDIR|not-a-directory/);
      expect(warnings).toHaveLength(2);
    } finally { warn.mockRestore(); }
  });

  it("records a batch deadline as an aborted stage and a timeout in the trace that is saved when the tool returns", async () => {
    const store = new CareerStore();
    store.upsertProfile(syntheticProfile);
    const discovery = new JobDiscovery({ search: vi.fn(async () => discoveryResult) }, undefined, { deadlineMs: 20 });
    // Settles 30 ms after the batch deadline aborted it: the tool has already returned by then.
    const lateAnalyzer: CareerAnalyzer = {
      extractProfile: vi.fn(),
      extractJob: (_description, signal) => new Promise((_resolve, reject) => { signal?.addEventListener("abort", () => setTimeout(() => reject(new Error("late")), 30), { once: true }); }),
      assess: vi.fn(),
    };
    const traces = new TraceStore();
    const client = await connectClient(await startTestServer({ store, discovery, traces, createAnalyzer: () => lateAnalyzer }));
    const search = JobSearchResultSchema.parse((await client.callTool({ name: "job_search", arguments: { boardToken: "synthetic" } })).structuredContent);
    const result = JobRecommendationsSchema.parse((await client.callTool({ name: "job_recommend", arguments: {
      searchId: search.searchId, candidateProfileId: syntheticProfile.id, candidateIds: [search.candidates[0]!.candidateId],
    } })).structuredContent);
    expect(result.failures).toHaveLength(1);
    const [summary] = traces.list();
    expect(summary).toMatchObject({ tool: "job_recommend", outcome: "partial", modelCalls: 1 });
    const saved = JSON.parse(JSON.stringify(traces.get(summary!.runId)));
    expect(saved.stages.map((s: { stage: string; outcome: string; failureClass?: string }) => [s.stage, s.outcome, s.failureClass])).toEqual([["extract", "aborted", "timeout"]]);
    expect(saved.stages[0].durationMs).toBeGreaterThan(0);
    expect(saved.counters.timeouts).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 60)); // the late rejection must not rewrite the finished trace
    expect(traces.get(summary!.runId)!.stages[0]!.errorName).toBe("UnsettledAtFinish");
  });
});
