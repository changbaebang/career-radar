import { RECOMMEND_DEADLINE_MS } from "../../src/domain/jobs/search.js";

// Pure gating rules for the live measurement harness. No I/O here: everything is decided from
// argv and an environment snapshot so each rule can be unit-tested without a network or a key.

export const HARD_MAX_MODEL_CALLS = 40;
export const DEFAULT_SETTLE_WAIT_MS = 30_000;
export const MAX_DEADLINE_MS = 600_000;
export const SEARCH_TTL_MS = 30 * 60_000;
// Runs must finish before the search snapshot expires, with margin.
export const MAX_PLANNED_WALL_MS = SEARCH_TTL_MS - 5 * 60_000;

export type Scenario = "ok" | "fail-at-3" | "stall";
export type RetryMode = "failed-only" | "all" | "none";
export type Mode = "dry-run" | "search-only" | "live";

export type Options = {
  help: boolean;
  approveNetwork: boolean;
  approveModelCost: boolean;
  scenario?: Scenario;
  boardToken: string;
  titleKeywords?: string;
  location?: string;
  limit: number;
  candidateIds?: string[];
  deadlineMs: number;
  retryMode: RetryMode;
  forcedAbortMs?: number;
  includeProfileExtraction: boolean;
  maxModelCalls?: number;
  settleWaitMs: number;
  output?: string;
  save: boolean;
  inspect: boolean;
};

export type GateEnv = {
  CI?: string; GITHUB_ACTIONS?: string; VITEST?: string; NODE_ENV?: string; CAREER_RADAR_DB_PATH?: string; OPENAI_BASE_URL?: string;
};

// Every refusal is a fixed string so the CLI never echoes argv, env values or file contents.
export const REFUSALS = {
  unknownOption: "Unknown option or invalid value. Use --help.",
  costWithoutNetwork: "--approve-model-cost requires --approve-network.",
  dryRunOnlyFlags: "--scenario/--no-save are dry-run only.",
  ciEnvironment: "Refused: approval flags are not accepted under CI/test environments.",
  databasePathSet: "Refused: unset CAREER_RADAR_DB_PATH; the harness never opens the application database.",
  baseUrlSet: "Refused: unset OPENAI_BASE_URL (shell or .env.local); the harness only sends to https://api.openai.com/v1.",
  capAboveCeiling: `--max-model-calls exceeds the hard ceiling of ${HARD_MAX_MODEL_CALLS}.`,
  planAboveCap: "Planned model calls exceed --max-model-calls.",
  wallTime: "Planned run exceeds the 30-minute search snapshot TTL; lower --deadline-ms/--settle-wait-ms.",
  stallNeedsShortDeadline: "--scenario stall requires --deadline-ms of at most 10000.",
  forcedAbortRange: "--forced-abort-ms must be at least 1 and below --deadline-ms.",
  outputExists: "Output directory must be new.",
} as const;

export const HELP = `pnpm measure:live [flags]

Modes (decided by argv only; environment variables can refuse, never grant):
  (no approval flag)                       dry-run: fixture provider + fake analyzer, full flow, zero network
  --approve-network                        search-only: one Greenhouse public GET (board token only), prints the plan
  --approve-network --approve-model-cost   live: paid Responses API calls after a typed confirmation

Flags:
  --scenario ok|fail-at-3|stall   dry-run only (default ok); stall needs --deadline-ms <= 10000
  --board-token TOKEN             default greenhouse
  --title-keywords S  --location S  --limit 1..10 (default 5)
  --candidate-ids a,b,c           default: first min(5, limit) search results; max 5
  --deadline-ms N                 Run A/B deadline; default ${RECOMMEND_DEADLINE_MS}; 1..${MAX_DEADLINE_MS}
  --retry-mode failed-only|all|none   default failed-only
  --forced-abort-ms N             enables Run C (forced abort); 1 <= N < deadline-ms
  --include-profile-extraction    one extra extractProfile call outside any batch
  --max-model-calls N             default = planned upper bound; ceiling ${HARD_MAX_MODEL_CALLS}
  --settle-wait-ms N              default ${DEFAULT_SETTLE_WAIT_MS}
  --output DIR                    must not exist (relative to the current directory, like pnpm eval)
  --no-save                       dry-run only
  --inspect                       also write inspection/ (drafts + harness.db, 0o700)
  --help

Exit: 0 runs executed; 1 harness failure (partial report written); 2 argument/gate refusal; 3 declined; 130 interrupted.
Reports never contain the API key, resume text, job descriptions or model prose.`;

function integer(value: string | undefined, min: number, max: number): number {
  const n = Number(value);
  if (value === undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(REFUSALS.unknownOption);
  return n;
}

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    help: false, approveNetwork: false, approveModelCost: false, boardToken: "greenhouse", limit: 5,
    deadlineMs: RECOMMEND_DEADLINE_MS, retryMode: "failed-only", includeProfileExtraction: false,
    settleWaitMs: DEFAULT_SETTLE_WAIT_MS, save: true, inspect: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined || v.startsWith("--")) throw new Error(REFUSALS.unknownOption); return v; };
    switch (arg) {
      case "--": break; // pnpm forwards a user-typed "--" verbatim; there are no positional arguments to separate
      case "--help": options.help = true; break;
      case "--approve-network": options.approveNetwork = true; break;
      case "--approve-model-cost": options.approveModelCost = true; break;
      case "--include-profile-extraction": options.includeProfileExtraction = true; break;
      case "--no-save": options.save = false; break;
      case "--inspect": options.inspect = true; break;
      case "--scenario": {
        const v = next();
        if (v !== "ok" && v !== "fail-at-3" && v !== "stall") throw new Error(REFUSALS.unknownOption);
        options.scenario = v; break;
      }
      case "--board-token": {
        const v = next();
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v)) throw new Error(REFUSALS.unknownOption);
        options.boardToken = v; break;
      }
      case "--title-keywords": options.titleKeywords = next().slice(0, 80); break;
      case "--location": options.location = next().slice(0, 80); break;
      case "--limit": options.limit = integer(next(), 1, 10); break;
      case "--candidate-ids": {
        const ids = next().split(",").map((s) => s.trim()).filter(Boolean);
        if (ids.length === 0 || ids.length > 5 || new Set(ids).size !== ids.length || ids.some((id) => id.length > 100)) throw new Error(REFUSALS.unknownOption);
        options.candidateIds = ids; break;
      }
      case "--deadline-ms": options.deadlineMs = integer(next(), 1, MAX_DEADLINE_MS); break;
      case "--retry-mode": {
        const v = next();
        if (v !== "failed-only" && v !== "all" && v !== "none") throw new Error(REFUSALS.unknownOption);
        options.retryMode = v; break;
      }
      case "--forced-abort-ms": options.forcedAbortMs = integer(next(), 1, MAX_DEADLINE_MS); break;
      case "--max-model-calls": options.maxModelCalls = integer(next(), 1, 10_000); break;
      case "--settle-wait-ms": options.settleWaitMs = integer(next(), 0, MAX_DEADLINE_MS); break;
      case "--output": options.output = next(); break;
      default: throw new Error(REFUSALS.unknownOption);
    }
  }
  if (options.forcedAbortMs !== undefined && options.forcedAbortMs >= options.deadlineMs) throw new Error(REFUSALS.forcedAbortRange);
  if (options.scenario === "stall" && options.deadlineMs > 10_000) throw new Error(REFUSALS.stallNeedsShortDeadline);
  return options;
}

export function planModelCalls(options: Options, candidateCount: number): { upperBound: number; breakdown: Record<string, number> } {
  const perBatch = 2 * candidateCount;
  const breakdown: Record<string, number> = { "A-production-deadline": perBatch };
  breakdown["B-retry"] = options.retryMode === "none" ? 0 : perBatch;
  if (options.forcedAbortMs !== undefined) breakdown["C-forced-abort"] = perBatch;
  if (options.includeProfileExtraction) breakdown["profile-extraction"] = 1;
  return { upperBound: Object.values(breakdown).reduce((n, v) => n + v, 0), breakdown };
}

export function plannedMaxWallMs(options: Options): number {
  const runs = options.retryMode === "none" ? 1 : 2;
  return runs * options.deadlineMs + (options.forcedAbortMs ?? 0) + (runs + (options.forcedAbortMs === undefined ? 0 : 1)) * options.settleWaitMs + 60_000;
}

export type Resolution = { mode: Mode; refusal?: string; cap: number; upperBound: number; breakdown: Record<string, number> };

// Mode comes from argv alone. The environment can only turn an approval into a refusal.
export function resolveMode(options: Options, env: GateEnv, candidateCount: number): Resolution {
  const approval = options.approveNetwork || options.approveModelCost;
  const mode: Mode = options.approveNetwork && options.approveModelCost ? "live" : options.approveNetwork ? "search-only" : "dry-run";
  const plan = planModelCalls(options, candidateCount);
  const cap = options.maxModelCalls ?? plan.upperBound;
  const result: Resolution = { mode, cap, ...plan };
  const refuse = (message: string) => ({ ...result, refusal: message });
  if (options.approveModelCost && !options.approveNetwork) return refuse(REFUSALS.costWithoutNetwork);
  if (approval && (options.scenario !== undefined || !options.save)) return refuse(REFUSALS.dryRunOnlyFlags);
  if (approval && (env.CI || env.GITHUB_ACTIONS || env.VITEST || env.NODE_ENV === "test")) return refuse(REFUSALS.ciEnvironment);
  if (approval && env.CAREER_RADAR_DB_PATH) return refuse(REFUSALS.databasePathSet);
  if (mode === "live" && env.OPENAI_BASE_URL) return refuse(REFUSALS.baseUrlSet);
  if (cap > HARD_MAX_MODEL_CALLS) return refuse(REFUSALS.capAboveCeiling);
  if (plan.upperBound > cap) return refuse(REFUSALS.planAboveCap);
  if (plannedMaxWallMs(options) > MAX_PLANNED_WALL_MS) return refuse(REFUSALS.wallTime);
  return result;
}

// The typed line must equal the printed cap, nothing else: "yes", a different number or an empty
// line all decline. The line itself is never recorded.
export function confirmationAccepted(line: string, cap: number): boolean {
  return line.trim() === String(cap);
}
