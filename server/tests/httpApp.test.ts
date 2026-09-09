import type { AddressInfo } from "node:net";

import type {
  CandidateProfile,
  FitAssessment,
  JobPosting,
} from "@career-radar/shared";
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

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

async function startTestServer(dependencies: McpDependencies = {}) {
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

describe("Career Radar HTTP and MCP server", () => {
  it("serves deterministic readiness data", async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "Career Radar", milestone: "Milestone 1", state: "ready",
    });
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
      assessment: { verdict: "REALISTIC", modelVersion: "fake-model" },
    });
    expect(store.getProfile(profile.id)).toEqual(profile);
    expect(store.getJob(job.id)).toEqual(job);
    expect(createAnalyzer).toHaveBeenCalledTimes(1);
    store.clear();
  });

  it("does not share default storage between independent HTTP apps", async () => {
    const { profile } = (await import("../../evals/fixtures/cases.js")).evalCases[0];
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
});
