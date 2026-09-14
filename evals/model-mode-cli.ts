import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_OPENAI_MODEL, type AnalyzerResponseEvent } from "../server/src/ai/analyzer.js";
import { PROMPT_VERSION } from "../server/src/ai/contracts.js";
import { createAnalyzerFromEnv, isProviderName, providerDestination, type ProviderName } from "../server/src/ai/provider.js";
import { loadLocalEnv } from "../server/src/config.js";
import { digest } from "./evaluate.js";
import { GoldenFakeAnalyzer } from "./fixtures/golden/fake-analyzer.js";
import { GOLDEN_SET_VERSION, goldenCases, type GoldenCase } from "./fixtures/golden/index.js";
import {
  CALLS_PER_CASE, assertModelReportRedacted, compareModelReports, renderModelMarkdown, runModelEvaluation, type ModelComparison, type ModelEvalReport,
} from "./model-mode.js";

// `pnpm eval --mode model` (M5-D). Without an approval flag this is a dry run: the golden fake
// analyzer, the full runner, zero network, a report labelled dry-run. With --approve-transmission
// the golden texts are sent to the configured provider. The project verifies on the free tier
// (owner decision, 2026-09-14): the default provider is openrouter and the openai path additionally
// requires --approve-model-cost. Environment variables can refuse a run, never grant one.
const root = fileURLToPath(new URL("../", import.meta.url));
export const HARD_MAX_MODEL_EVAL_CALLS = 150;
export const MODEL_EVAL_TIMEOUT_MS = 300_000;
export const MODEL_TRANSPORT = { maxRetries: 0, logLevel: "off", timeout: MODEL_EVAL_TIMEOUT_MS } as const;

export const MODEL_REFUSALS = {
  unknownOption: "Unknown option or invalid value. Use --help.",
  ciEnvironment: "Refused: approval flags are not accepted under CI/test environments.",
  baseUrlSet: "Refused: unset OPENAI_BASE_URL (shell or .env.local); the model eval only sends to the destination it printed.",
  openaiNeedsCostFlag: "--provider openai requires --approve-model-cost; this project verifies on the free tier by default.",
  capAboveCeiling: `--max-model-calls exceeds the hard ceiling of ${HARD_MAX_MODEL_EVAL_CALLS}.`,
  planAboveCap: "Planned model calls exceed --max-model-calls; select fewer cases with --cases or --limit.",
  outputExists: "Output directory must be new.",
  outputWithNoSave: "--output cannot be combined with --no-save",
  noCases: "No golden case matches the selection. Use --help.",
  baselineTooLarge: "Baseline exceeds 5 MB",
} as const;

export const MODEL_HELP = `pnpm eval --mode model [--cases a,b] [--limit N] [--provider openrouter|openai] [--approve-transmission] [--approve-model-cost] [--max-model-calls N] [--output DIR] [--baseline REPORT_JSON] [--no-save]

Golden-set evaluation of the real model path: extraction (profile, posting) and assessment through the
provider, then the deterministic pipeline. Without --approve-transmission it is a dry run with the golden
fake analyzer (zero network). With it, the synthetic golden texts are transmitted to the provider; the
default provider is openrouter (free tier, OPENROUTER_API_KEY/OPENROUTER_MODEL from .env.local) and
--provider openai also needs --approve-model-cost. Up to ${CALLS_PER_CASE} model calls per case, one HTTP
attempt each, SDK logging off, ${MODEL_EVAL_TIMEOUT_MS / 1000}s per call; the hard ceiling is ${HARD_MAX_MODEL_EVAL_CALLS} calls.
Reports never contain resume text, evidence sentences or posting prose. Exit 0: every selected case attempted;
1: golden-set problems or cases not attempted (report still written); 2: argument or gate refusal.`;

export type ModelOptions = {
  help: boolean; cases?: string[]; limit?: number; provider: ProviderName;
  approveTransmission: boolean; approveModelCost: boolean; maxModelCalls?: number;
  output?: string; save: boolean; baseline?: string;
};

function integer(value: string | undefined, min: number, max: number): number {
  const n = Number(value);
  if (value === undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(MODEL_REFUSALS.unknownOption);
  return n;
}

export function parseModelArgs(argv: string[]): ModelOptions {
  const options: ModelOptions = { help: false, provider: "openrouter", approveTransmission: false, approveModelCost: false, save: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined || v.startsWith("--")) throw new Error(MODEL_REFUSALS.unknownOption); return v; };
    switch (arg) {
      case "--": break;
      case "--help": options.help = true; break;
      case "--approve-transmission": options.approveTransmission = true; break;
      case "--approve-model-cost": options.approveModelCost = true; break;
      case "--no-save": options.save = false; break;
      case "--cases": {
        const ids = next().split(",").map((s) => s.trim()).filter(Boolean);
        if (ids.length === 0 || ids.some((id) => id.length > 100)) throw new Error(MODEL_REFUSALS.unknownOption);
        options.cases = ids; break;
      }
      case "--limit": options.limit = integer(next(), 1, 1000); break;
      case "--provider": { const v = next(); if (!isProviderName(v)) throw new Error(MODEL_REFUSALS.unknownOption); options.provider = v; break; }
      case "--max-model-calls": options.maxModelCalls = integer(next(), 1, 10_000); break;
      case "--output": options.output = next(); break;
      case "--baseline": options.baseline = next(); break;
      default: throw new Error(MODEL_REFUSALS.unknownOption);
    }
  }
  if (!options.save && options.output) throw new Error(MODEL_REFUSALS.outputWithNoSave);
  return options;
}

export type ModelGateEnv = { CI?: string; GITHUB_ACTIONS?: string; VITEST?: string; NODE_ENV?: string; OPENAI_BASE_URL?: string };
export type ModelGate = { execution: "dry-run" | "live"; cap: number; upperBound: number; refusal?: string };

// Execution comes from argv alone; the environment can only refuse.
export function resolveModelGate(options: ModelOptions, env: ModelGateEnv, caseCount: number): ModelGate {
  const upperBound = caseCount * CALLS_PER_CASE;
  const cap = options.maxModelCalls ?? upperBound;
  const execution: ModelGate["execution"] = options.approveTransmission ? "live" : "dry-run";
  const result: ModelGate = { execution, cap, upperBound };
  const refuse = (refusal: string) => ({ ...result, refusal });
  if (caseCount === 0) return refuse(MODEL_REFUSALS.noCases);
  if (execution === "live" && (env.CI || env.GITHUB_ACTIONS || env.VITEST || env.NODE_ENV === "test")) return refuse(MODEL_REFUSALS.ciEnvironment);
  if (execution === "live" && options.provider === "openai" && !options.approveModelCost) return refuse(MODEL_REFUSALS.openaiNeedsCostFlag);
  if (execution === "live" && options.provider === "openai" && env.OPENAI_BASE_URL) return refuse(MODEL_REFUSALS.baseUrlSet);
  if (cap > HARD_MAX_MODEL_EVAL_CALLS) return refuse(MODEL_REFUSALS.capAboveCeiling);
  if (upperBound > cap) return refuse(MODEL_REFUSALS.planAboveCap);
  return result;
}

export function selectCases(options: ModelOptions, all: GoldenCase[] = goldenCases): GoldenCase[] {
  const wanted = options.cases ? new Set(options.cases) : undefined;
  const selected = all.filter((item) => !wanted || wanted.has(item.caseId));
  if (wanted && selected.length !== wanted.size) return [];
  return options.limit !== undefined ? selected.slice(0, options.limit) : selected;
}

function provenance() {
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  let codeSha = "unknown", dirty = true;
  try { codeSha = git(["rev-parse", "HEAD"]); dirty = git(["status", "--porcelain"]) !== ""; } catch { /* not a git checkout */ }
  return {
    codeSha, dirty, promptVersion: PROMPT_VERSION,
    policyHash: digest(readFileSync(resolve(root, "server/src/domain/assessment/policy.ts"), "utf8")),
    schemaHash: digest(readFileSync(resolve(root, "packages/shared/src/index.ts"), "utf8")),
  };
}

export async function runModelEvalCli(argv: string[], io: { log: (line: string) => void; out: (line: string) => void; env?: ModelGateEnv } = { log: console.error, out: console.log }): Promise<number> {
  let options: ModelOptions;
  try { options = parseModelArgs(argv); } catch (error) { io.log(error instanceof Error ? error.message : MODEL_REFUSALS.unknownOption); return 2; }
  if (options.help) { io.out(MODEL_HELP); return 0; }
  const selected = selectCases(options);
  const gate = resolveModelGate(options, io.env ?? process.env, selected.length);
  if (gate.refusal) { io.log(gate.refusal); return 2; }
  const output = options.output ? resolve(root, options.output) : undefined;
  if (output && existsSync(output)) { io.log(MODEL_REFUSALS.outputExists); return 2; }
  let baseline: unknown;
  if (options.baseline) {
    const path = resolve(root, options.baseline);
    if (statSync(path).size > 5_000_000) { io.log(MODEL_REFUSALS.baselineTooLarge); return 2; }
    baseline = JSON.parse(readFileSync(path, "utf8"));
  }
  let model = "golden-fake", store: false | "n/a" = "n/a";
  if (gate.execution === "live") {
    loadLocalEnv();
    if (options.provider === "openai" && process.env.OPENAI_BASE_URL) { io.log(MODEL_REFUSALS.baseUrlSet); return 2; }
    model = options.provider === "openrouter" ? process.env.OPENROUTER_MODEL ?? "(OPENROUTER_MODEL unset)" : process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
    store = options.provider === "openrouter" ? "n/a" : false;
  }
  io.log([
    `Model-mode evaluation plan (${gate.execution})`,
    `  golden set: ${GOLDEN_SET_VERSION}, ${selected.length} of ${goldenCases.length} cases`,
    gate.execution === "live"
      ? `  provider: ${options.provider}   destination: ${providerDestination(options.provider)}   model: ${model}`
      : "  analyzer: golden fake (no network); add --approve-transmission for a live run",
    `  model calls: up to ${gate.upperBound} (${CALLS_PER_CASE} per case), cap ${gate.cap}; one HTTP attempt each, SDK retries off, ${MODEL_EVAL_TIMEOUT_MS / 1000}s per call`,
    gate.execution === "live" ? "  The synthetic resume and posting texts are transmitted to the provider above; a free tier is still an external transmission." : "",
  ].filter(Boolean).join("\n"));
  const createAnalyzer = (onResponse: (event: AnalyzerResponseEvent) => void) => gate.execution === "live"
    ? createAnalyzerFromEnv({ provider: options.provider, transport: { ...MODEL_TRANSPORT }, onResponse })
    : new GoldenFakeAnalyzer({ onResponse });
  const report: ModelEvalReport = await runModelEvaluation(selected, {
    execution: gate.execution, provider: gate.execution === "live" ? options.provider : "fake", requestedModel: model, store,
    transport: { maxRetries: 0, logLevel: "off", timeoutMs: MODEL_EVAL_TIMEOUT_MS }, approvals: { transmission: options.approveTransmission },
    callCap: gate.cap, metadata: provenance(), goldenSetVersion: GOLDEN_SET_VERSION, createAnalyzer, log: (line) => io.log(`  ${line}`),
  });
  let comparison: ModelComparison | undefined;
  if (baseline !== undefined) comparison = compareModelReports(report, baseline);
  const serialized = `${JSON.stringify({ ...report, comparison }, null, 2)}\n`;
  const markdown = renderModelMarkdown(report, comparison);
  assertModelReportRedacted(serialized + markdown, selected);
  let reportDirectory: string | undefined;
  if (options.save) {
    reportDirectory = output ?? resolve(root, "evals/reports", `model-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`);
    mkdirSync(dirname(reportDirectory), { recursive: true });
    mkdirSync(reportDirectory, { mode: 0o700 });
    writeFileSync(resolve(reportDirectory, "report.json"), serialized, { flag: "wx", mode: 0o600 });
    writeFileSync(resolve(reportDirectory, "report.md"), markdown, { flag: "wx", mode: 0o600 });
  }
  io.out(JSON.stringify({ ...report, cases: undefined, reportDirectory, comparison }, null, 2));
  if (comparison && !comparison.compatible) return 2;
  return report.success ? 0 : 1;
}
