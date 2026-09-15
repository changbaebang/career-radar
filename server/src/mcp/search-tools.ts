import { JobSearchInputSchema, JobSearchResultSchema, JobRecommendInputSchema, JobRecommendationsSchema } from "@career-radar/shared";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CareerAnalyzer } from "../ai/analyzer.js";
import type { JobDiscovery } from "../domain/jobs/search.js";
import type { CareerStore } from "../domain/store.js";
import { RunTracer, runWithTrace } from "../domain/trace/run-trace.js";
import type { TraceStore } from "../domain/trace/store.js";

export function registerSearchTools(server: McpServer, discovery: JobDiscovery, store: CareerStore, createAnalyzer: () => CareerAnalyzer, resourceUri: string, traces?: TraceStore): void {
  registerAppTool(server, "job_search", {
    title: "Search a Greenhouse job board",
    description: "Use this when the user wants to discover jobs on one explicitly named Greenhouse board. Ask for its board token if unknown; do not guess an employer or use resume/contact data as a token. Optional title keywords (all words) and location substring are filtered locally and never sent to Greenhouse. Returns up to 10 unassessed candidates, not fit recommendations. Creates a 30-minute process-local search snapshot; restart or eviction requires a new search. No API key or model call.",
    inputSchema: JobSearchInputSchema.shape, outputSchema: JobSearchResultSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    _meta: { securitySchemes: [{ type: "noauth" }] },
  }, async (input) => {
    const result = await discovery.search(input);
    return { structuredContent: result, content: [{ type: "text", text: `Found ${result.matchedCount} matching posts on this board; showing ${result.candidates.length}. These are not assessed. Use job_recommend only when the user asks to analyze selected candidates.` }] };
  });

  registerAppTool(server, "job_recommend", {
    title: "Recommend selected jobs from evidence",
    description: "Use this when the user asks to assess selected job_search candidates against an existing profile. Pass only candidate IDs from that search, at most 5; this may make up to 10 paid model operations and saves local assessment snapshots. Stops after the first analysis failure. Every assessed role is returned; requested REALISTIC/STRETCH counts only report shortfalls and are never filled by inventing fit. Returns explicit shortages/failures and optional PASS explanations; each assessment carries screening context or an explicit not-evaluated absence. Does not search again, save applications, rewrite resumes, or contact employers. Retrying runs new analysis; do not automatically retry failures or shortages.",
    inputSchema: JobRecommendInputSchema.shape, outputSchema: JobRecommendationsSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    _meta: { securitySchemes: [{ type: "noauth" }], ui: { resourceUri }, "openai/outputTemplate": resourceUri },
  }, async (input) => {
    // M5-E: one run trace for the batch; per-candidate stages carry the candidate index.
    const tracer = new RunTracer("job_recommend");
    let result;
    try { result = await runWithTrace(tracer, () => discovery.recommend(input, store, createAnalyzer, tracer)); }
    catch (error) { traces?.trySave(tracer.finish("failed", error)); throw error; }
    traces?.trySave(tracer.finish(result.failures.length ? "partial" : "ok"));
    return { structuredContent: result, content: [{ type: "text", text: `${result.realistic.length} REALISTIC, ${result.stretch.length} STRETCH, ${result.pass.length} PASS explanations. Shortfall: ${result.shortfall.realistic} REALISTIC, ${result.shortfall.stretch} STRETCH. ${result.failures.length} failed or unattempted jobs; those are not PASS verdicts. No employer was contacted. (run ${tracer.runId})` }] };
  });
}
