import { describe, expect, it } from "vitest";
import { HARD_MAX_MODEL_CALLS, REFUSALS, confirmationAccepted, parseArgs, planModelCalls, resolveMode, type GateEnv } from "../scripts/measure-live/gate.js";
import { RECOMMEND_DEADLINE_MS } from "../src/domain/jobs/search.js";

const clean: GateEnv = {};

describe("measure:live gate (argv decides the mode, the environment can only refuse)", () => {
  it("defaults to a saved dry run at the production deadline with no approvals", () => {
    const options = parseArgs([]);
    expect(options).toMatchObject({ approveNetwork: false, approveModelCost: false, deadlineMs: RECOMMEND_DEADLINE_MS, retryMode: "failed-only", save: true, limit: 5, inspect: false });
    expect(resolveMode(options, clean, 5)).toEqual({ mode: "dry-run", cap: 20, upperBound: 20, breakdown: { "A-production-deadline": 10, "B-retry": 10 } });
  });

  it("needs both flags for live and refuses cost approval without network approval", () => {
    expect(resolveMode(parseArgs(["--approve-network"]), clean, 5).mode).toBe("search-only");
    const live = resolveMode(parseArgs(["--approve-network", "--approve-model-cost"]), clean, 5);
    expect(live.mode).toBe("live"); expect(live.refusal).toBeUndefined();
    expect(resolveMode(parseArgs(["--approve-model-cost"]), clean, 5).refusal).toBe(REFUSALS.costWithoutNetwork);
  });

  it.each([["CI", "true"], ["GITHUB_ACTIONS", "true"], ["VITEST", "true"], ["NODE_ENV", "test"], ["CAREER_RADAR_DB_PATH", "/tmp/app.db"]])(
    "refuses approvals when %s is set, while the dry run still works", (key, value) => {
      const env = { [key]: value } as GateEnv;
      expect(resolveMode(parseArgs(["--approve-network", "--approve-model-cost"]), env, 5).refusal).toMatch(/^Refused/);
      expect(resolveMode(parseArgs(["--approve-network"]), env, 5).refusal).toMatch(/^Refused/);
      expect(resolveMode(parseArgs([]), env, 5).refusal).toBeUndefined();
    });

  it("refuses a live run while OPENAI_BASE_URL is set, and only a live run", () => {
    const env: GateEnv = { OPENAI_BASE_URL: "https://synthetic-review.invalid/v1" };
    expect(resolveMode(parseArgs(["--approve-network", "--approve-model-cost"]), env, 5).refusal).toBe(REFUSALS.baseUrlSet);
    expect(resolveMode(parseArgs(["--approve-network"]), env, 5).refusal).toBeUndefined();
    expect(resolveMode(parseArgs([]), env, 5).refusal).toBeUndefined();
  });

  it("selects the provider explicitly and scopes the OPENAI_BASE_URL refusal to the openai provider", () => {
    expect(parseArgs([]).provider).toBe("openai");
    expect(parseArgs(["--provider", "openrouter"]).provider).toBe("openrouter");
    expect(() => parseArgs(["--provider", "bogus"])).toThrow(REFUSALS.unknownOption);
    const env: GateEnv = { OPENAI_BASE_URL: "https://synthetic-review.invalid/v1" };
    expect(resolveMode(parseArgs(["--provider", "openrouter", "--approve-network", "--approve-model-cost"]), env, 5).refusal).toBeUndefined();
    expect(resolveMode(parseArgs(["--provider", "openai", "--approve-network", "--approve-model-cost"]), env, 5).refusal).toBe(REFUSALS.baseUrlSet);
  });

  it("tolerates the bare -- that pnpm forwards from the root script", () => {
    expect(parseArgs(["--"])).toMatchObject({ save: true });
    expect(parseArgs(["--", "--no-save", "--scenario", "fail-at-3"])).toMatchObject({ save: false, scenario: "fail-at-3" });
  });

  it("cannot be promoted to live by the environment", () => {
    const env = { CI: "", NODE_ENV: "production", CAREER_RADAR_DB_PATH: "" } as GateEnv;
    expect(resolveMode(parseArgs([]), env, 5).mode).toBe("dry-run");
    expect(resolveMode(parseArgs(["--approve-network"]), env, 5).mode).toBe("search-only");
  });

  it("plans two calls per candidate per batch plus one for profile extraction", () => {
    expect(planModelCalls(parseArgs([]), 3)).toEqual({ upperBound: 12, breakdown: { "A-production-deadline": 6, "B-retry": 6 } });
    expect(planModelCalls(parseArgs(["--retry-mode", "none", "--include-profile-extraction", "--forced-abort-ms", "1000"]), 2))
      .toEqual({ upperBound: 9, breakdown: { "A-production-deadline": 4, "B-retry": 0, "C-forced-abort": 4, "profile-extraction": 1 } });
  });

  it("enforces the hard ceiling and refuses a plan above the cap", () => {
    expect(resolveMode(parseArgs(["--max-model-calls", String(HARD_MAX_MODEL_CALLS + 1)]), clean, 5).refusal).toBe(REFUSALS.capAboveCeiling);
    expect(resolveMode(parseArgs(["--max-model-calls", "19"]), clean, 5).refusal).toBe(REFUSALS.planAboveCap);
    const exact = resolveMode(parseArgs(["--max-model-calls", "20"]), clean, 5);
    expect(exact.cap).toBe(20); expect(exact.refusal).toBeUndefined();
    // Five candidates, three batches and a profile extraction still fit under the ceiling.
    const full = resolveMode(parseArgs(["--forced-abort-ms", "1000", "--include-profile-extraction"]), clean, 5);
    expect(full).toMatchObject({ upperBound: 31, cap: 31 }); expect(full.refusal).toBeUndefined();
  });

  it("keeps dry-run-only flags away from any approved mode", () => {
    expect(resolveMode(parseArgs(["--approve-network", "--scenario", "ok"]), clean, 5).refusal).toBe(REFUSALS.dryRunOnlyFlags);
    expect(resolveMode(parseArgs(["--approve-network", "--no-save"]), clean, 5).refusal).toBe(REFUSALS.dryRunOnlyFlags);
  });

  it("refuses a plan whose worst-case wall time outlives the search snapshot", () => {
    const options = parseArgs(["--deadline-ms", "600000", "--forced-abort-ms", "599999", "--settle-wait-ms", "600000"]);
    expect(resolveMode(options, clean, 5).refusal).toBe(REFUSALS.wallTime);
  });

  it.each([
    [["--bogus"]], [["--scenario", "nope"]], [["--limit", "11"]], [["--limit", "0"]], [["--deadline-ms", "0"]], [["--deadline-ms", "600001"]],
    [["--candidate-ids", "a,a"]], [["--candidate-ids", "a,b,c,d,e,f"]], [["--candidate-ids", ""]], [["--output"]], [["--board-token", "Bad Token"]],
    [["--retry-mode", "sometimes"]], [["--max-model-calls", "1.5"]],
  ])("rejects %j with the fixed unknown-option message", (argv) => {
    expect(() => parseArgs(argv)).toThrow(REFUSALS.unknownOption);
  });

  it("checks the forced-abort and stall ranges", () => {
    expect(() => parseArgs(["--forced-abort-ms", String(RECOMMEND_DEADLINE_MS)])).toThrow(REFUSALS.forcedAbortRange);
    expect(parseArgs(["--forced-abort-ms", "1000"]).forcedAbortMs).toBe(1000);
    expect(() => parseArgs(["--scenario", "stall"])).toThrow(REFUSALS.stallNeedsShortDeadline);
    expect(parseArgs(["--scenario", "stall", "--deadline-ms", "10000"]).scenario).toBe("stall");
  });

  it("accepts only the exact cap as the typed confirmation", () => {
    expect(confirmationAccepted("20", 20)).toBe(true);
    expect(confirmationAccepted(" 20\n", 20)).toBe(true);
    for (const line of ["", "yes", "y", "200", "2", "20 calls", "2e1", "020"]) expect(confirmationAccepted(line, 20)).toBe(false);
  });

  it("uses only static refusal strings", () => {
    for (const message of Object.values(REFUSALS)) expect(message).not.toMatch(/\$\{|%s/);
  });
});
