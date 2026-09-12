import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_OPENAI_MODEL, type CareerAnalyzer } from "../../src/ai/analyzer.js";
import { createAnalyzerFromEnv, providerDestination, resolveProviderName, type ProviderName } from "../../src/ai/provider.js";
import { loadLocalEnv } from "../../src/config.js";
import { measurementResumeText } from "../measure-live/synthetic-inputs.js";
import { createResultsApp, runUsageCheck, type JobInput, type UsageCheckResults } from "./run.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
// pnpm runs package scripts from the package directory; INIT_CWD is where the user typed the command.
const callerDirectory = process.env.INIT_CWD ?? process.cwd();
const fromCaller = (path: string) => resolve(callerDirectory, path);

// Same SDK pins as the live harness: one HTTP attempt per counted call and no SDK logging, so the
// printed call bound is the real request bound and OPENAI_LOG=debug cannot echo the resume.
export const USAGE_TRANSPORT = { maxRetries: 0, logLevel: "off" } as const;
export const USAGE_ERRORS = {
  baseUrlSet: "Refused: unset OPENAI_BASE_URL (shell or .env.local); the usage check only sends to the destination it printed.",
  invalidOption: "Unknown option or missing value. Use --help.",
  jobCount: "Give between one and five --job values. Use --help.",
  outputExists: "Output directory must be new.",
} as const;

export function usageAnalyzerFactory(provider: ProviderName): () => CareerAnalyzer {
  return () => createAnalyzerFromEnv({ provider, transport: { ...USAGE_TRANSPORT } });
}

const HELP = `pnpm usage-check [--resume FILE] --job URL|FILE [--job ...] [--approve-transmission] [--out DIR] [--port N]
pnpm usage-check --replay DIR/results.json [--port N]

One profile, up to five postings, real MCP tool calls through the configured provider, then a local page
with the widget output per job and a comparison table. Without --approve-transmission it only prints
what would be sent and exits 3 with zero model calls. --resume defaults to the synthetic measurement
resume. --job accepts an https URL on an allowed job board or a path to a text file; relative paths are
resolved from the directory where you ran the command. Results are written to
data/usage-check/<timestamp>/results.json (gitignored); --replay serves a saved file without any call.
SDK retries and SDK logging are off; a live run is refused while OPENAI_BASE_URL is set.`;

type Args = { help: boolean; resume?: string; jobs: string[]; approve: boolean; out?: string; replay?: string; port: number };

export function parseUsageArgs(argv: string[]): Args {
  const args: Args = { help: false, jobs: [], approve: false, port: 8010 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined || v.startsWith("--")) throw new Error(USAGE_ERRORS.invalidOption); return v; };
    switch (arg) {
      case "--": break;
      case "--help": args.help = true; break;
      case "--approve-transmission": args.approve = true; break;
      case "--resume": args.resume = next(); break;
      case "--job": args.jobs.push(next()); break;
      case "--out": args.out = next(); break;
      case "--replay": args.replay = next(); break;
      case "--port": { const p = Number(next()); if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error(USAGE_ERRORS.invalidOption); args.port = p; break; }
      default: throw new Error(USAGE_ERRORS.invalidOption);
    }
  }
  if (!args.help && !args.replay && (args.jobs.length === 0 || args.jobs.length > 5)) throw new Error(USAGE_ERRORS.jobCount);
  return args;
}

function jobInput(value: string, index: number): JobInput {
  if (/^https:\/\//i.test(value)) return { label: `job ${index + 1} (${new URL(value).hostname})`, url: value };
  const path = fromCaller(value);
  return { label: `job ${index + 1} (${path.split("/").pop()})`, text: readFileSync(path, "utf8") };
}

function serve(results: UsageCheckResults, port: number): void {
  const bundle = readFileSync(join(root, "web/dist/widget.js"), "utf8");
  createResultsApp(results, bundle).listen(port, "127.0.0.1", () => console.error(`Usage check page: http://127.0.0.1:${port}/  (loopback only; Ctrl-C to stop)`));
}

async function main(): Promise<number> {
  const args = parseUsageArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return 0; }
  if (args.replay) { serve(JSON.parse(readFileSync(fromCaller(args.replay), "utf8")) as UsageCheckResults, args.port); return 0; }
  const resumePath = args.resume ? fromCaller(args.resume) : undefined;
  const resumeText = resumePath ? readFileSync(resumePath, "utf8") : measurementResumeText;
  const jobs = args.jobs.map(jobInput);
  loadLocalEnv();
  const provider = resolveProviderName();
  if (provider === "openai" && process.env.OPENAI_BASE_URL) throw new Error(USAGE_ERRORS.baseUrlSet);
  const model = provider === "openrouter" ? process.env.OPENROUTER_MODEL ?? "(OPENROUTER_MODEL unset)" : process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  console.error([
    "Usage check plan",
    `  provider: ${provider}   destination: ${providerDestination(provider)}   model: ${model}`,
    `  resume: ${resumePath ? `${resumePath} (${resumeText.length} chars)` : `synthetic measurement resume (${resumeText.length} chars)`}`,
    ...jobs.map((job) => `  ${job.label}: ${job.url ?? `${job.text!.length} chars of pasted text`}`),
    `  model calls: up to ${1 + jobs.length * 2} (1 profile extraction + per job: extraction and assessment); one HTTP attempt each, SDK retries off`,
    "  The resume text and each posting are transmitted to the provider above; a free tier is still an external transmission.",
    provider === "openrouter" ? "  OpenRouter forwards them to the upstream provider serving the model; check that provider's data policy." : "",
  ].filter(Boolean).join("\n"));
  if (!args.approve) { console.error("Add --approve-transmission to run. 0 model calls made."); return 3; }
  const out = args.out ? fromCaller(args.out) : join(root, "data/usage-check", new Date().toISOString().replaceAll(":", "-"));
  if (existsSync(out)) throw new Error(USAGE_ERRORS.outputExists);
  const results = await runUsageCheck({ resumeText, jobs, createAnalyzer: usageAnalyzerFactory(provider), provider, model, log: (line) => console.error(`  ${line}`) });
  mkdirSync(out, { recursive: true, mode: 0o700 });
  writeFileSync(join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.error(`Saved ${join(out, "results.json")} (${results.modelCalls} model calls; ${results.jobs.filter((j) => j.status === "assessed").length}/${results.jobs.length} assessed).`);
  console.error("Deleting that directory removes the local results file only; what the provider retains and anything you printed or copied are separate.");
  serve(results, args.port);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => { if (code !== 0) process.exitCode = code; }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Usage check could not complete.");
    process.exitCode = 2;
  });
}
