import { ApplicationResultSchema, ApplicationSaveInputSchema, ApplicationUpdateInputSchema, PipelineInputSchema, PipelineSummarySchema } from "@career-radar/shared";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CareerStore } from "../domain/store.js";

export function registerPipelineTools(server: McpServer, store: CareerStore, resourceUri: string): void {
  registerAppTool(server, "application_save", {
    title: "Save an application",
    description: "Use this when the user explicitly wants to save an assessed job or record that they applied. Use assessmentId returned by job_assess or job_recommend; do not invent a verdict. Existing records are returned unchanged; use application_update to change status.",
    inputSchema: ApplicationSaveInputSchema.shape, outputSchema: ApplicationResultSchema.shape,
    _meta: { securitySchemes: [{ type: "noauth" }] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  }, async (input) => {
    const application = store.saveApplication(input);
    return { structuredContent: { application }, content: [{ type: "text", text: `${application.company} — ${application.title}: ${application.status}. Application ID: ${application.id}. This records a local status; no application was sent to the employer.` }] };
  });

  registerAppTool(server, "application_update", {
    title: "Update an application outcome",
    description: "Use this when the user explicitly reports or corrects an application status, interview stage, rejection, withdrawal, or offer. Find IDs via pipeline_summary. Omitted stage/notes are preserved; an empty string clears them. Never infer an outcome.",
    inputSchema: ApplicationUpdateInputSchema.shape, outputSchema: ApplicationResultSchema.shape,
    _meta: { securitySchemes: [{ type: "noauth" }] },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
  }, async (input) => {
    const application = store.updateApplication(input);
    return { structuredContent: { application }, content: [{ type: "text", text: `${application.company} — ${application.title}: recorded as ${application.status}. No employer was contacted.` }] };
  });

  registerAppTool(server, "pipeline_summary", {
    title: "Review the application pipeline",
    description: "Use this when the user wants saved application IDs, current status counts, or a descriptive verdict/outcome summary. Optional UTC dates filter last updated time inclusively, not an applied-date cohort. Results show at most 100 recent records; counts include all matching applications. Do not infer hiring probabilities or causal skill gaps.",
    inputSchema: PipelineInputSchema.shape, outputSchema: PipelineSummarySchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    _meta: { ui: { resourceUri }, "openai/outputTemplate": resourceUri },
  }, async (input) => {
    const summary = store.pipelineSummary(input);
    return { structuredContent: summary, content: [{ type: "text", text: `${summary.total} applications recorded. ${summary.observations[0]}` }] };
  });
}
