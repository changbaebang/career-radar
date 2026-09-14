import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CareerRadarStatusSchema,
  JobAssessmentResultSchema,
  JobIngestResultSchema,
  ProfileUpsertResultSchema,
} from "@career-radar/shared";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CareerAnalyzer } from "../ai/analyzer.js";
import { buildCareerRadarStatus } from "../demo.js";
import { finalizeAssessment } from "../domain/assessment/pipeline.js";
import { retrieveEvidence } from "../domain/evidence/retrieve.js";
import type { CareerStore } from "../domain/store.js";
import { fetchJobUrl } from "../infra/fetch/job-url.js";
import { registerPipelineTools } from "./pipeline-tools.js";
import { registerSearchTools } from "./search-tools.js";
import type { JobDiscovery } from "../domain/jobs/search.js";

// v6: job.company may be absent (usage-check follow-up); the v5 widget parses strictly and would show
// "Waiting for Career Radar…" for such results, so hosts must refresh descriptors. v5 added screeningContext.
// v7: EvidenceRef.source gains "evidence" and fit results gain citations (M5-B); the v6 widget parses
// strictly and would reject the new enum value.
export const CAREER_RADAR_WIDGET_URI = "ui://career-radar/widget-v7.html";

// Both are required on purpose: an MCP server is created per request, so a per-call default store
// would forget every profile between profile_upsert and job_assess. createHttpApp owns the shared
// instances; any other transport must supply its own.
export type McpDependencies = {
  store: CareerStore;
  createAnalyzer: () => CareerAnalyzer;
  fetchJob?: typeof fetchJobUrl;
  discovery: JobDiscovery;
};

function readWidgetBundle(): string {
  const bundlePath = fileURLToPath(
    new URL("../../../web/dist/widget.js", import.meta.url),
  );
  try {
    return readFileSync(bundlePath, "utf8");
  } catch (error) {
    throw new Error(
      `Career Radar widget bundle not found at ${bundlePath}. Run pnpm build first.`,
      { cause: error },
    );
  }
}

export function createMcpServer(dependencies: McpDependencies): McpServer {
  const { store, createAnalyzer: getAnalyzer } = dependencies;
  const server = new McpServer({ name: "career-radar", version: "0.4.0" });

  registerAppTool(
    server,
    "career_radar_status",
    {
      title: "Show Career Radar status",
      description:
        "Use this when the user wants to verify the Career Radar MCP connection and see the currently implemented capabilities.",
      inputSchema: {},
      outputSchema: CareerRadarStatusSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        securitySchemes: [{ type: "noauth" }],
        ui: { resourceUri: CAREER_RADAR_WIDGET_URI },
        "openai/outputTemplate": CAREER_RADAR_WIDGET_URI,
        "openai/toolInvocation/invoking": "Checking Career Radar…",
        "openai/toolInvocation/invoked": "Career Radar is ready",
      },
    },
    async () => {
      const status = buildCareerRadarStatus();
      return {
        structuredContent: status,
        content: [{ type: "text" as const, text: status.message }],
      };
    },
  );

  registerAppTool(
    server,
    "profile_upsert",
    {
      title: "Create a candidate profile",
      description:
        "Use this when the user provides resume text and Career Radar needs a truthful structured candidate profile before assessing a job.",
      inputSchema: {
        resumeText: z.string().min(50).max(50_000),
        profileId: z.string().min(1).max(100).optional(),
      },
      outputSchema: ProfileUpsertResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
        idempotentHint: false,
      },
      _meta: {
        securitySchemes: [{ type: "noauth" }],
        "openai/toolInvocation/invoking": "Structuring resume evidence…",
        "openai/toolInvocation/invoked": "Candidate profile created",
      },
    },
    async ({ resumeText, profileId }) => {
      const result = await getAnalyzer().extractProfile(resumeText, profileId);
      store.upsertProfile(result.profile);
      return {
        structuredContent: result,
        content: [{
          type: "text" as const,
          text: `Candidate profile ${result.profile.id} was created from explicit resume evidence. Raw resume text was not retained.`,
        }],
      };
    },
  );

  registerAppTool(
    server,
    "job_ingest",
    {
      title: "Ingest a job URL or description",
      description:
        "Use this when the user provides exactly one pasted job description or public HTTPS job URL on boards.greenhouse.io, job-boards.greenhouse.io, jobs.lever.co, or jobs.ashbyhq.com. JavaScript-only or unsupported pages require pasted text. This does not search for jobs.",
      inputSchema: { text: z.string().min(50).max(80_000).optional(), url: z.string().url().max(2048).optional() },
      outputSchema: JobIngestResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: false,
      },
      _meta: {
        securitySchemes: [{ type: "noauth" }],
        "openai/toolInvocation/invoking": "Reading job requirements…",
        "openai/toolInvocation/invoked": "Job description normalized",
      },
    },
    async ({ text, url }) => {
      if ((text === undefined) === (url === undefined)) throw new Error("Provide exactly one of text or url.");
      const fetched = url ? await (dependencies.fetchJob ?? fetchJobUrl)(url) : undefined;
      const extracted = await getAnalyzer().extractJob(fetched?.text ?? text!);
      const result = JobIngestResultSchema.parse({
        job: { ...extracted.job, sourceUrl: fetched?.sourceUrl },
        warnings: [...extracted.warnings, ...(fetched?.warnings ?? [])],
      });
      store.upsertJob(result.job);
      return {
        structuredContent: result,
        content: [{
          type: "text" as const,
          text: `Normalized ${result.job.company ?? "(employer not stated)"} — ${result.job.title} as ${result.job.id}.`,
        }],
      };
    },
  );

  registerAppTool(
    server,
    "job_assess",
    {
      title: "Assess candidate-job fit",
      description:
        "Use this when profile_upsert and job_ingest have returned IDs and the user wants an evidence-based REALISTIC, STRETCH, or PASS decision. The result also carries screening context (role scope and career-story clarification with cited references) that never changes the verdict; uncertain entries mean references were missing or unverified, not low risk.",
      inputSchema: {
        candidateProfileId: z.string().min(1),
        jobId: z.string().min(1),
      },
      outputSchema: JobAssessmentResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false,
      },
      _meta: {
        securitySchemes: [{ type: "noauth" }],
        ui: { resourceUri: CAREER_RADAR_WIDGET_URI },
        "openai/outputTemplate": CAREER_RADAR_WIDGET_URI,
        "openai/toolInvocation/invoking": "Assessing evidence and gaps…",
        "openai/toolInvocation/invoked": "Career fit assessment ready",
      },
    },
    async ({ candidateProfileId, jobId }) => {
      const profile = store.getProfile(candidateProfileId);
      if (!profile) throw new Error("Candidate profile was not found or has expired. Call profile_upsert again.");
      const job = store.getJob(jobId);
      if (!job) throw new Error("Job was not found or has expired. Call job_ingest again.");
      // M5-B: deterministic pre-retrieval over the profile's evidence; its trace is what citations resolve against.
      const evidence = retrieveEvidence(profile, job);
      const assessment = finalizeAssessment(profile, job, await getAnalyzer().assess(profile, job, undefined, evidence), evidence);
      const assessmentId = store.saveAssessment(profile, job, assessment);
      const result = JobAssessmentResultSchema.parse({ job, assessment, assessmentId });
      return {
        structuredContent: result,
        content: [{
          type: "text" as const,
          text: `${job.company ?? "(employer not stated)"} — ${job.title}: ${assessment.verdict}. ${assessment.recommendation}`,
        }],
      };
    },
  );

  registerPipelineTools(server, store, CAREER_RADAR_WIDGET_URI);
  registerSearchTools(server, dependencies.discovery, store, getAnalyzer, CAREER_RADAR_WIDGET_URI);

  registerAppResource(
    server,
    "Career Radar widget",
    CAREER_RADAR_WIDGET_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Career Radar status, assessment, recommendation, and pipeline views.",
    },
    async () => ({
      contents: [{
        uri: CAREER_RADAR_WIDGET_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: `<div id="root"></div><script>${readWidgetBundle()}</script>`,
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { connectDomains: [], resourceDomains: [] },
          },
          "openai/widgetDescription":
            "Career Radar evidence-based assessments with screening context and explicit uncertainty, recommendation groups with shortages and freshness, and the stage-aware application pipeline.",
          "openai/widgetPrefersBorder": true,
        },
      }],
    }),
  );

  return server;
}
