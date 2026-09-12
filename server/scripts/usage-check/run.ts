import type { AddressInfo } from "node:net";
import { JobAssessmentResultSchema, JobIngestResultSchema, ProfileUpsertResultSchema,
  type JobAssessmentResult, type JobIngestResult, type ProfileUpsertResult } from "@career-radar/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express, { type Express } from "express";
import type { CareerAnalyzer } from "../../src/ai/analyzer.js";
import { CareerStore } from "../../src/domain/store.js";
import { createHttpApp, isLoopbackHost, isLoopbackOrigin } from "../../src/httpApp.js";
import type { fetchJobUrl } from "../../src/infra/fetch/job-url.js";

// The usage check: one profile, a few postings, read the result. It drives the real MCP tools
// through the real HTTP transport (the same contracts ChatGPT would call), so what the owner reads
// is what the app produces, not a domain-function shortcut. Nothing here judges quality.

export type JobInput = { label: string; text?: string; url?: string };
export type JobOutcome =
  | { label: string; status: "assessed"; ingest: JobIngestResult; assessment: JobAssessmentResult }
  | { label: string; status: "failed"; step: "job_ingest" | "job_assess"; message: string; ingest?: JobIngestResult };
export type UsageCheckResults = {
  kind: "usage-check"; generatedAt: string; provider: string; model: string; promptVersion?: string;
  profile: ProfileUpsertResult; jobs: JobOutcome[]; modelCalls: number;
};

export type UsageCheckDeps = {
  resumeText: string; jobs: JobInput[]; createAnalyzer: () => CareerAnalyzer; fetchJob?: typeof fetchJobUrl;
  provider: string; model: string; now?: () => Date; log?: (line: string) => void;
};

export async function runUsageCheck(deps: UsageCheckDeps): Promise<UsageCheckResults> {
  const log = deps.log ?? (() => undefined);
  const store = new CareerStore(); // in-memory: the check leaves only the results file behind
  let calls = 0;
  const createAnalyzer = () => { const inner = deps.createAnalyzer(); return countCalls(inner, () => { calls += 1; }); };
  const app = createHttpApp({ store, createAnalyzer, ...(deps.fetchJob ? { fetchJob: deps.fetchJob } : {}) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const client = new Client({ name: "career-radar-usage-check", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  try {
    log("profile_upsert");
    const upsert = await client.callTool({ name: "profile_upsert", arguments: { resumeText: deps.resumeText } });
    if (upsert.isError) throw new Error(toolText(upsert.content));
    const profile = ProfileUpsertResultSchema.parse(upsert.structuredContent);
    const jobs: JobOutcome[] = [];
    let promptVersion: string | undefined;
    for (const job of deps.jobs) {
      log(`job_ingest ${job.label}`);
      const ingested = await client.callTool({ name: "job_ingest", arguments: job.url ? { url: job.url } : { text: job.text } });
      if (ingested.isError) { jobs.push({ label: job.label, status: "failed", step: "job_ingest", message: toolText(ingested.content) }); continue; }
      const ingest = JobIngestResultSchema.parse(ingested.structuredContent);
      log(`job_assess ${job.label}`);
      const assessed = await client.callTool({ name: "job_assess", arguments: { candidateProfileId: profile.profile.id, jobId: ingest.job.id } });
      if (assessed.isError) { jobs.push({ label: job.label, status: "failed", step: "job_assess", message: toolText(assessed.content), ingest }); continue; }
      const assessment = JobAssessmentResultSchema.parse(assessed.structuredContent);
      promptVersion ??= assessment.assessment.promptVersion;
      jobs.push({ label: job.label, status: "assessed", ingest, assessment });
    }
    return { kind: "usage-check", generatedAt: (deps.now ?? (() => new Date()))().toISOString(), provider: deps.provider, model: deps.model,
      ...(promptVersion ? { promptVersion } : {}), profile, jobs, modelCalls: calls };
  } finally {
    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
}

function countCalls(inner: CareerAnalyzer, tick: () => void): CareerAnalyzer {
  return {
    extractProfile: (text, id) => { tick(); return inner.extractProfile(text, id); },
    extractJob: (description, signal) => { tick(); return inner.extractJob(description, signal); },
    assess: (profile, job, signal) => { tick(); return inner.assess(profile, job, signal); },
  };
}

function toolText(content: unknown): string {
  const first = Array.isArray(content) ? (content[0] as { text?: unknown } | undefined) : undefined;
  return typeof first?.text === "string" ? first.text : "Tool call failed.";
}

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Index: a plain comparison table (a reading aid, not the widget) plus one real widget card per job.
export function renderIndex(results: UsageCheckResults): string {
  const rows = results.jobs.map((job, index) => {
    if (job.status === "failed") return `<tr><td>${index + 1}</td><td>${escape(job.label)}</td><td colspan="6">failed at ${job.step}: ${escape(job.message)}</td></tr>`;
    const a = job.assessment.assessment; const c = a.screeningContext;
    return `<tr><td>${index + 1}</td><td><a href="/?view=assessment&job=${index}">${escape(job.assessment.job.company)} — ${escape(job.assessment.job.title)}</a></td>
      <td><strong>${a.verdict}</strong></td><td>${a.confidence}</td><td>${a.hardBlockers.length}</td>
      <td>${c ? `${escape(c.seniorityFit.value)} / ${escape(c.careerStoryRisk.value)}` : "not evaluated"}</td>
      <td>${c?.careerStoryRisk.clarificationQuestion ? escape(c.careerStoryRisk.clarificationQuestion) : ""}</td>
      <td>${escape(a.modelVersion)}</td></tr>`;
  }).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Career Radar · usage check</title>
  <body style="max-width:960px;margin:32px auto;padding:0 18px;font:14px/1.6 system-ui">
  <h1 style="font-size:20px">Career Radar · usage check</h1>
  <p>${escape(results.generatedAt)} · provider <strong>${escape(results.provider)}</strong> · model <strong>${escape(results.model)}</strong> · prompt ${escape(results.promptVersion ?? "n/a")} · model calls ${results.modelCalls}</p>
  <p>Profile <code>${escape(results.profile.profile.id)}</code> — ${escape(results.profile.profile.headline)} (${results.profile.profile.roles.length} roles, ${results.profile.profile.skills.length} skills${results.profile.warnings.length ? `, ${results.profile.warnings.length} extraction warnings` : ""})</p>
  <p style="color:#555">This table is a reading aid for prioritizing; the cards behind each link are the actual widget output. Verdicts are not hiring probabilities.</p>
  <table style="border-collapse:collapse;width:100%"><thead><tr style="text-align:left;border-bottom:2px solid #333"><th>#</th><th>Job</th><th>Verdict</th><th>Confidence</th><th>Blockers</th><th>Scope / story</th><th>Clarify</th><th>Model</th></tr></thead><tbody>${rows}</tbody></table>
  <p style="margin-top:18px"><a href="/?view=json">raw results.json</a></p>
  <h2 style="font-size:16px;margin-top:28px">Answer after reading</h2>
  <ol><li>Can you follow why each job is worth applying to, or not?</li><li>Did you learn a difference, or a question to check, that you did not have before reading?</li><li>Compared with pasting the same resume and postings into a plain chat, is this more convenient?</li></ol>
  </body></html>`;
}

export function renderAssessment(result: JobAssessmentResult, bundle: string, index: number, total: number): string {
  const serialized = JSON.stringify(result).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Career Radar · assessment ${index + 1}</title>
  <body style="max-width:760px;margin:32px auto;padding:0 18px"><p style="font:14px/1.6 system-ui"><a href="/">← summary</a> · job ${index + 1} of ${total}</p>
  <div id="root"></div><script>window.openai={toolOutput:${serialized}};</script><script>${bundle}</script></body></html>`;
}

// The results page serves the structured profile and the assessments, so it gets the same
// loopback Host/Origin gate as the MCP server: binding to 127.0.0.1 alone does not stop a
// DNS-rebinding page from reaching it with its own Host.
export function createResultsApp(results: UsageCheckResults, bundle: string): Express {
  const app = express();
  app.use((request, response, next) => {
    if (!isLoopbackHost(request.get("host")) || !isLoopbackOrigin(request.get("origin"))) {
      response.status(403).type("text").send("Only loopback hosts may read usage-check results.");
      return;
    }
    next();
  });
  app.get("/", (req, res) => {
    if (req.query.view === "json") { res.type("json").send(JSON.stringify(results, null, 2)); return; }
    if (req.query.view === "assessment") {
      const index = Number(req.query.job);
      const job = results.jobs[index];
      if (job?.status === "assessed") { res.type("html").send(renderAssessment(job.assessment, bundle, index, results.jobs.length)); return; }
    }
    res.type("html").send(renderIndex(results));
  });
  return app;
}
