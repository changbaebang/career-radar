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
import { createHttpApp } from "../src/httpApp.js";
import {
  CAREER_RADAR_WIDGET_URI,
  type McpDependencies,
} from "../src/mcp/createServer.js";
import { CareerStore } from "../src/domain/store.js";
import { syntheticProfile } from "./fixtures.js";
import { syntheticJob } from "./fixtures.js";
import { JobDiscovery } from "../src/domain/jobs/search.js";
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
    const client = await connectClient(await startTestServer({ store, discovery, createAnalyzer }));
    closeCallbacks.push(async () => { discovery.close(); store.close(); });
    const tools = (await client.listTools()).tools;
    // B2 advertises the optional screening context on assessment outputs (widget URI v5); identity stays internal.
    for (const name of ["job_assess", "job_recommend"]) expect(JSON.stringify(tools.find((tool) => tool.name === name)?.outputSchema)).toContain("screeningContext");
    expect(JSON.stringify(tools)).not.toContain("inputIdentity");
    expect(CAREER_RADAR_WIDGET_URI).toBe("ui://career-radar/widget-v5.html");
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
    const analyzer: CareerAnalyzer = {
      extractProfile: async () => ({ profile, warnings: [] }),
      extractJob: async () => ({ job, warnings: [] }),
      assess: async () => assessment,
    };
    const store = new CareerStore();
    const createAnalyzer = vi.fn(() => analyzer);
    const client = await connectClient(await startTestServer({ createAnalyzer, store }));
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
    expect(store.getProfile(profile.id)).toEqual(profile);
    expect(store.getJob(job.id)).toEqual(job);
    expect(createAnalyzer).toHaveBeenCalledTimes(1);
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
