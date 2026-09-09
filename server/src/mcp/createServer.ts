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

import { type CareerAnalyzer, OpenAICareerAnalyzer } from "../ai/analyzer.js";
import { buildCareerRadarStatus } from "../demo.js";
import { applyAssessmentPolicy } from "../domain/assessment/policy.js";
import { CareerStore } from "../domain/store.js";

export const CAREER_RADAR_WIDGET_URI = "ui://career-radar/widget-v1.html";
export const careerStore = new CareerStore();

export type McpDependencies = {
  analyzer?: CareerAnalyzer;
  store?: CareerStore;
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

export function createMcpServer(dependencies: McpDependencies = {}): McpServer {
  const store = dependencies.store ?? careerStore;
  let analyzer = dependencies.analyzer;
  const getAnalyzer = () => (analyzer ??= new OpenAICareerAnalyzer());
  const server = new McpServer({ name: "career-radar", version: "0.1.0" });

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
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
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
      title: "Ingest pasted job description",
      description:
        "Use this when the user provides pasted job-description text that must be normalized before an assessment. Milestone 1 does not fetch URLs.",
      inputSchema: { text: z.string().min(50).max(80_000) },
      outputSchema: JobIngestResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        securitySchemes: [{ type: "noauth" }],
        "openai/toolInvocation/invoking": "Reading job requirements…",
        "openai/toolInvocation/invoked": "Job description normalized",
      },
    },
    async ({ text }) => {
      const result = await getAnalyzer().extractJob(text);
      store.upsertJob(result.job);
      return {
        structuredContent: result,
        content: [{
          type: "text" as const,
          text: `Normalized ${result.job.company} — ${result.job.title} as ${result.job.id}.`,
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
        "Use this when profile_upsert and job_ingest have returned IDs and the user wants an evidence-based REALISTIC, STRETCH, or PASS decision.",
      inputSchema: {
        candidateProfileId: z.string().min(1),
        jobId: z.string().min(1),
      },
      outputSchema: JobAssessmentResultSchema.shape,
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
        "openai/toolInvocation/invoking": "Assessing evidence and gaps…",
        "openai/toolInvocation/invoked": "Career fit assessment ready",
      },
    },
    async ({ candidateProfileId, jobId }) => {
      const profile = store.getProfile(candidateProfileId);
      if (!profile) throw new Error(`Candidate profile ${candidateProfileId} was not found. Call profile_upsert first.`);
      const job = store.getJob(jobId);
      if (!job) throw new Error(`Job ${jobId} was not found. Call job_ingest first.`);
      const assessment = applyAssessmentPolicy(profile, job, await getAnalyzer().assess(profile, job));
      const result = JobAssessmentResultSchema.parse({ job, assessment });
      return {
        structuredContent: result,
        content: [{
          type: "text" as const,
          text: `${job.company} — ${job.title}: ${assessment.verdict}. ${assessment.recommendation}`,
        }],
      };
    },
  );

  registerAppResource(
    server,
    "Career Radar widget",
    CAREER_RADAR_WIDGET_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Career Radar connection status and job assessment card.",
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
            "A compact evidence-based Career Radar job assessment card.",
          "openai/widgetPrefersBorder": true,
        },
      }],
    }),
  );

  return server;
}
