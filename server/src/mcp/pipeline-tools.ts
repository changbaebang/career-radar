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
    return { structuredContent: { application }, content: [{ type: "text", text: `${application.company ?? "(employer not stated)"} — ${application.title}: ${application.status}. Application ID: ${application.id}. This records a local status; no application was sent to the employer.` }] };
  });

  registerAppTool(server, "application_update", {
    title: "Update an application outcome",
    description: "Use this when the user explicitly reports or corrects an application outcome. Find IDs via pipeline_summary. historyMode defaults to append (a new progression). Pass replace only for an explicit correction/retraction: it supersedes ALL earlier outcome history for this application on a changed outcome, so clarify that whole-history scope with the user first. Notes-only edits do not replace history. Omitted stage/notes are preserved; empty stage or null normalizedOutcomeStage clears both stage projections and supersedes earlier history even in append mode. Normalize only the user's stated stage; never infer one from rejection. occurredAt is the reported occurrence time, not recording time: null clears, omission preserves for the same status/stage but resets to unknown when either changes. Never infer an outcome or date.",
    inputSchema: ApplicationUpdateInputSchema.shape, outputSchema: ApplicationResultSchema.shape,
    _meta: { securitySchemes: [{ type: "noauth" }] },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
  }, async (input) => {
    const application = store.updateApplication(input);
    return { structuredContent: { application }, content: [{ type: "text", text: `${application.company ?? "(employer not stated)"} — ${application.title}: recorded as ${application.status}. No employer was contacted.` }] };
  });

  registerAppTool(server, "pipeline_summary", {
    title: "Review the application pipeline",
    description: "Use this when the user wants saved application IDs, current outcomes, or correction-safe stage progression. Optional UTC dates filter last updated time inclusively, not occurrence time or an applied-date cohort. Stage reach counts distinct application IDs in active history; verdict/stage and date coverage use current outcomes. Results show at most 100 recent records; counts include all matching applications and report window exclusions, pending, withdrawn and unknowns. Do not infer intermediate stages, probabilities, transition intent or causal skill gaps.",
    inputSchema: PipelineInputSchema.shape, outputSchema: PipelineSummarySchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    _meta: { ui: { resourceUri }, "openai/outputTemplate": resourceUri },
  }, async (input) => {
    const summary = store.pipelineSummary(input);
    return { structuredContent: summary, content: [{ type: "text", text: `${summary.total} applications recorded. ${summary.observations[0]}` }] };
  });
}
