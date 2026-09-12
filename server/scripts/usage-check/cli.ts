import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { DEFAULT_OPENAI_MODEL } from "../../src/ai/analyzer.js";
import { createAnalyzerFromEnv, providerDestination, resolveProviderName } from "../../src/ai/provider.js";
import { loadLocalEnv } from "../../src/config.js";
import { measurementResumeText } from "../measure-live/synthetic-inputs.js";
import { renderAssessment, renderIndex, runUsageCheck, type JobInput, type UsageCheckResults } from "./run.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const HELP = `pnpm usage-check [--resume FILE] --job URL|FILE [--job ...] [--approve-transmission] [--out DIR] [--port N]
pnpm usage-check --replay DIR/results.json [--port N]

One profile, up to five postings, real MCP tool calls through the configured provider, then a local page
with the widget output per job and a comparison table. Without --approve-transmission it only prints
what would be sent and exits 3 with zero model calls. --resume defaults to the synthetic measurement
resume. --job accepts an https URL on an allowed job board or a path to a text file. Results are written
to data/usage-check/<timestamp>/results.json (gitignored); --replay serves a saved file without any call.`;

type Args = { help: boolean; resume?: string; jobs: string[]; approve: boolean; out?: string; replay?: string; port: number };

export function parseUsageArgs(argv: string[]): Args {
  const args: Args = { help: false, jobs: [], approve: false, port: 8010 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined || v.startsWith("--")) throw new Error("Unknown option or missing value. Use --help."); return v; };
    switch (arg) {
      case "--": break;
      case "--help": args.help = true; break;
      case "--approve-transmission": args.approve = true; break;
      case "--resume": args.resume = next(); break;
      case "--job": args.jobs.push(next()); break;
      case "--out": args.out = next(); break;
      case "--replay": args.replay = next(); break;
      case "--port": { const p = Number(next()); if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error("Unknown option or missing value. Use --help."); args.port = p; break; }
      default: throw new Error("Unknown option or missing value. Use --help.");
    }
  }
  if (!args.help && !args.replay && (args.jobs.length === 0 || args.jobs.length > 5)) throw new Error("Give between one and five --job values. Use --help.");
  return args;
}

function jobInput(value: string, index: number): JobInput {
  if (/^https:\/\//i.test(value)) return { label: `job ${index + 1} (${new URL(value).hostname})`, url: value };
  const path = resolve(value);
  return { label: `job ${index + 1} (${path.split("/").pop()})`, text: readFileSync(path, "utf8") };
}

function serve(results: UsageCheckResults, port: number): void {
  const bundle = readFileSync(join(root, "web/dist/widget.js"), "utf8");
  const app = express();
  app.get("/", (req, res) => {
    if (req.query.view === "json") { res.type("json").send(JSON.stringify(results, null, 2)); return; }
    if (req.query.view === "assessment") {
      const index = Number(req.query.job);
      const job = results.jobs[index];
      if (job?.status === "assessed") { res.type("html").send(renderAssessment(job.assessment, bundle, index, results.jobs.length)); return; }
    }
    res.type("html").send(renderIndex(results));
  });
  app.listen(port, "127.0.0.1", () => console.error(`Usage check page: http://127.0.0.1:${port}/  (Ctrl-C to stop)`));
}

async function main(): Promise<number> {
  const args = parseUsageArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return 0; }
  if (args.replay) { serve(JSON.parse(readFileSync(resolve(args.replay), "utf8")) as UsageCheckResults, args.port); return 0; }
  const resumeText = args.resume ? readFileSync(resolve(args.resume), "utf8") : measurementResumeText;
  const jobs = args.jobs.map(jobInput);
  loadLocalEnv();
  const provider = resolveProviderName();
  const model = provider === "openrouter" ? process.env.OPENROUTER_MODEL ?? "(OPENROUTER_MODEL unset)" : process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  console.error([
    "Usage check plan",
    `  provider: ${provider}   destination: ${providerDestination(provider)}   model: ${model}`,
    `  resume: ${args.resume ? `${resolve(args.resume)} (${resumeText.length} chars)` : `synthetic measurement resume (${resumeText.length} chars)`}`,
    ...jobs.map((job) => `  ${job.label}: ${job.url ?? `${job.text!.length} chars of pasted text`}`),
    `  model calls: up to ${1 + jobs.length * 2} (1 profile extraction + per job: extraction and assessment)`,
    "  The resume text and each posting are transmitted to the provider above; a free tier is still an external transmission.",
    provider === "openrouter" ? "  OpenRouter forwards them to the upstream provider serving the model; check that provider's data policy." : "",
  ].filter(Boolean).join("\n"));
  if (!args.approve) { console.error("Add --approve-transmission to run. 0 model calls made."); return 3; }
  const out = args.out ? resolve(args.out) : join(root, "data/usage-check", new Date().toISOString().replaceAll(":", "-"));
  if (existsSync(out)) throw new Error("Output directory must be new.");
  const results = await runUsageCheck({ resumeText, jobs, createAnalyzer: createAnalyzerFromEnv, provider, model, log: (line) => console.error(`  ${line}`) });
  mkdirSync(out, { recursive: true, mode: 0o700 });
  writeFileSync(join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.error(`Saved ${join(out, "results.json")} (${results.modelCalls} model calls; ${results.jobs.filter((j) => j.status === "assessed").length}/${results.jobs.length} assessed). Delete the directory to remove every trace.`);
  serve(results, args.port);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => { if (code !== 0) process.exitCode = code; }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Usage check could not complete.");
    process.exitCode = 2;
  });
}
