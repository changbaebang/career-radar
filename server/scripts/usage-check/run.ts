import type { AddressInfo } from "node:net";
import { JobAssessmentResultSchema, JobIngestResultSchema, ProfileUpsertResultSchema,
  type JobAssessmentResult, type JobIngestResult, type ProfileUpsertResult } from "@career-radar/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express, { type Express } from "express";
import type { AnalyzerResponseEvent, CareerAnalyzer } from "../../src/ai/analyzer.js";
import { CareerStore } from "../../src/domain/store.js";
import { createHttpApp, isLoopbackHost, isLoopbackOrigin } from "../../src/httpApp.js";
import type { fetchJobUrl } from "../../src/infra/fetch/job-url.js";

// The usage check: one profile, a few postings, read the result. It drives the real MCP tools
// through the real HTTP transport (the same contracts ChatGPT would call), so what the owner reads
// is what the app produces, not a domain-function shortcut. Nothing here judges quality.

export type JobInput = { label: string; text?: string; url?: string };
// Wall-clock time of each tool call as the client saw it (model latency plus transport), in ms.
export type JobOutcome =
  | { label: string; status: "assessed"; ingest: JobIngestResult; assessment: JobAssessmentResult; ingestMs: number; assessMs: number }
  | { label: string; status: "failed"; step: "job_ingest" | "job_assess"; message: string; ingest?: JobIngestResult; ingestMs?: number; assessMs?: number };
export type UsageCheckResults = {
  kind: "usage-check"; generatedAt: string; provider: string; model: string; promptVersion?: string;
  profile: ProfileUpsertResult; profileMs: number; jobs: JobOutcome[]; modelCalls: number; toolTimeoutMs: number;
  // Model calls cancelled by the per-call deadline, and calls that still had not settled when the
  // results were assembled (the settle wait is bounded, so this should be 0).
  abortedCalls: number; unsettledCalls: number;
  // Per-call telemetry from the analyzer hook: identifiers, finish status and token counters only (no content).
  telemetry: AnalyzerResponseEvent[];
};

// The MCP SDK client gives up on a tool call after 60 s by default; a free model can take longer for
// one extraction, so the runner uses a wider bound and records how long each call actually took.
export const DEFAULT_TOOL_TIMEOUT_MS = 300_000;

export type UsageCheckDeps = {
  resumeText: string; jobs: JobInput[]; createAnalyzer: () => CareerAnalyzer; fetchJob?: typeof fetchJobUrl;
  provider: string; model: string; now?: () => Date; log?: (line: string) => void; toolTimeoutMs?: number;
  // Adapters emit one event per model call; the runner collects them so a failure can be read from
  // finish_reason and token usage rather than guessed.
  onResponse?: (register: (event: AnalyzerResponseEvent) => void) => void;
};

export async function runUsageCheck(deps: UsageCheckDeps): Promise<UsageCheckResults> {
  const log = deps.log ?? (() => undefined);
  const store = new CareerStore(); // in-memory: the check leaves only the results file behind
  const toolTimeoutMs = deps.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  let calls = 0;
  const deadline = withCallDeadline(toolTimeoutMs);
  const telemetry: AnalyzerResponseEvent[] = [];
  deps.onResponse?.((event) => {
    telemetry.push(event);
    log(`    model ${event.operation} ${event.outcome} in ${Math.round(event.durationMs)} ms · status ${event.responseStatus ?? "n/a"} · tokens in ${event.usage?.inputTokens ?? "?"} out ${event.usage?.outputTokens ?? "?"} reasoning ${event.usage?.reasoningTokens ?? "?"} · upstream ${event.upstreamProvider ?? "n/a"}${event.error ? ` · error ${event.error.name}` : ""}`);
  });
  const createAnalyzer = () => { const inner = deps.createAnalyzer(); return deadline.wrap(countCalls(inner, () => { calls += 1; })); };
  const app = createHttpApp({ store, createAnalyzer, ...(deps.fetchJob ? { fetchJob: deps.fetchJob } : {}) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const client = new Client({ name: "career-radar-usage-check", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  // A timed-out or thrown call becomes a failed step with the SDK's own message (never provider text).
  const call = async (name: string, args: Record<string, unknown>): Promise<{ ok: boolean; content: unknown; structured: unknown; ms: number }> => {
    const started = performance.now();
    try {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: toolTimeoutMs });
      const ms = Math.round(performance.now() - started);
      log(`  ${name} ${result.isError ? "failed" : "ok"} in ${ms} ms`);
      return { ok: !result.isError, content: result.content, structured: result.structuredContent, ms };
    } catch (error) {
      const ms = Math.round(performance.now() - started);
      log(`  ${name} threw after ${ms} ms`);
      return { ok: false, content: [{ type: "text", text: error instanceof Error ? error.message : "Tool call failed." }], structured: undefined, ms };
    }
  };
  try {
    log("profile_upsert");
    const upsert = await call("profile_upsert", { resumeText: deps.resumeText });
    if (!upsert.ok) throw new Error(toolText(upsert.content));
    const profile = ProfileUpsertResultSchema.parse(upsert.structured);
    const jobs: JobOutcome[] = [];
    let promptVersion: string | undefined;
    for (const job of deps.jobs) {
      log(`job_ingest ${job.label}`);
      const ingested = await call("job_ingest", job.url ? { url: job.url } : { text: job.text });
      if (!ingested.ok) { jobs.push({ label: job.label, status: "failed", step: "job_ingest", message: toolText(ingested.content), ingestMs: ingested.ms }); continue; }
      const ingest = JobIngestResultSchema.parse(ingested.structured);
      log(`job_assess ${job.label}`);
      const assessed = await call("job_assess", { candidateProfileId: profile.profile.id, jobId: ingest.job.id });
      if (!assessed.ok) { jobs.push({ label: job.label, status: "failed", step: "job_assess", message: toolText(assessed.content), ingest, ingestMs: ingested.ms, assessMs: assessed.ms }); continue; }
      const assessment = JobAssessmentResultSchema.parse(assessed.structured);
      promptVersion ??= assessment.assessment.promptVersion;
      jobs.push({ label: job.label, status: "assessed", ingest, assessment, ingestMs: ingested.ms, assessMs: assessed.ms });
    }
    // Wait (bounded) for cancelled or late model calls so their telemetry lands in the saved file; anything
    // still pending after the grace period is counted, not awaited further.
    const unsettledCalls = await deadline.settle(SETTLE_GRACE_MS);
    if (unsettledCalls) log(`  ${unsettledCalls} model call(s) still unsettled after ${SETTLE_GRACE_MS} ms`);
    return { kind: "usage-check", generatedAt: (deps.now ?? (() => new Date()))().toISOString(), provider: deps.provider, model: deps.model,
      ...(promptVersion ? { promptVersion } : {}), profile, profileMs: upsert.ms, jobs, modelCalls: calls, toolTimeoutMs,
      abortedCalls: deadline.aborted, unsettledCalls, telemetry };
  } finally {
    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
}

export const SETTLE_GRACE_MS = 10_000;

// The SDK's own `timeout` only covers the wait for response headers; a slow body streams on after it.
// An AbortSignal passed to the request is honoured by fetch until the body is fully read, so every
// analyzer call gets its own deadline signal (combined with any caller signal) and the in-flight
// promises are tracked so the caller can wait for them before assembling results.
export function withCallDeadline(ms: number) {
  const pending = new Set<Promise<unknown>>();
  let aborted = 0;
  const guard = <T>(caller: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => { aborted += 1; controller.abort(); }, ms);
    const signal = caller ? AbortSignal.any([caller, controller.signal]) : controller.signal;
    const promise = run(signal).finally(() => clearTimeout(timer));
    pending.add(promise);
    promise.catch(() => undefined).finally(() => pending.delete(promise));
    return promise;
  };
  return {
    get aborted() { return aborted; },
    wrap: (inner: CareerAnalyzer): CareerAnalyzer => ({
      extractProfile: (text, id, signal) => guard(signal, (s) => inner.extractProfile(text, id, s)),
      extractJob: (description, signal) => guard(signal, (s) => inner.extractJob(description, s)),
      assess: (profile, job, signal, evidence) => guard(signal, (s) => inner.assess(profile, job, s, evidence)),
    }),
    // Resolves with the number of calls still pending after the grace period.
    settle: async (graceMs: number): Promise<number> => {
      if (pending.size === 0) return 0;
      await Promise.race([Promise.allSettled([...pending]), new Promise<void>((resolve) => { const t = setTimeout(resolve, graceMs); t.unref(); })]);
      return pending.size;
    },
  };
}

function countCalls(inner: CareerAnalyzer, tick: () => void): CareerAnalyzer {
  return {
    extractProfile: (text, id, signal) => { tick(); return inner.extractProfile(text, id, signal); },
    extractJob: (description, signal) => { tick(); return inner.extractJob(description, signal); },
    assess: (profile, job, signal, evidence) => { tick(); return inner.assess(profile, job, signal, evidence); },
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
    if (job.status === "failed") return `<tr><td>${index + 1}</td><td>${escape(job.label)}</td><td colspan="7">failed at ${job.step} (${job.ingestMs ?? 0}${job.assessMs !== undefined ? ` + ${job.assessMs}` : ""} ms): ${escape(job.message)}</td></tr>`;
    const a = job.assessment.assessment; const c = a.screeningContext;
    return `<tr><td>${index + 1}</td><td><a href="/?view=assessment&job=${index}">${escape(job.assessment.job.company ?? "(employer not stated)")} — ${escape(job.assessment.job.title)}</a></td>
      <td><strong>${a.verdict}</strong></td><td>${a.confidence}</td><td>${a.hardBlockers.length}</td>
      <td>${c ? `${escape(c.seniorityFit.value)} / ${escape(c.careerStoryRisk.value)}` : "not evaluated"}</td>
      <td>${c?.careerStoryRisk.clarificationQuestion ? escape(c.careerStoryRisk.clarificationQuestion) : ""}</td>
      <td>${job.ingestMs} + ${job.assessMs}</td><td>${escape(a.modelVersion)}</td></tr>`;
  }).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Career Radar · usage check</title>
  <body style="max-width:960px;margin:32px auto;padding:0 18px;font:14px/1.6 system-ui">
  <h1 style="font-size:20px">Career Radar · usage check</h1>
  <p>${escape(results.generatedAt)} · provider <strong>${escape(results.provider)}</strong> · model <strong>${escape(results.model)}</strong> · prompt ${escape(results.promptVersion ?? "n/a")} · model calls ${results.modelCalls} (${results.abortedCalls} cancelled by the ${results.toolTimeoutMs} ms per-call bound${results.unsettledCalls ? `, ${results.unsettledCalls} unsettled` : ""}) · profile extraction ${results.profileMs} ms</p>
  <p>Profile <code>${escape(results.profile.profile.id)}</code> — ${escape(results.profile.profile.headline)} (${results.profile.profile.roles.length} roles, ${results.profile.profile.skills.length} skills${results.profile.warnings.length ? `, ${results.profile.warnings.length} extraction warnings` : ""})</p>
  <p style="color:#555">This table is a reading aid for prioritizing; the cards behind each link are the actual widget output. Verdicts are not hiring probabilities. Times are what the MCP client waited per call on this provider; they say nothing about other providers.</p>
  <table style="border-collapse:collapse;width:100%"><thead><tr style="text-align:left;border-bottom:2px solid #333"><th>#</th><th>Job</th><th>Verdict</th><th>Confidence</th><th>Blockers</th><th>Scope / story</th><th>Clarify</th><th>extract + assess ms</th><th>Model</th></tr></thead><tbody>${rows}</tbody></table>
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
