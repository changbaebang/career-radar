import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { stableId } from "../src/domain/store.js";
import { renderAssessment, renderIndex, runUsageCheck } from "../scripts/usage-check/run.js";
import { parseUsageArgs } from "../scripts/usage-check/cli.js";
import { groundedAssessment } from "./discovery-fixtures.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";

const serverDirectory = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("../scripts/usage-check/cli.ts", import.meta.url));

function fakeAnalyzer(failOn?: string) {
  return {
    extractProfile: vi.fn(async () => ({ profile: syntheticProfile, warnings: ["synthetic"] })),
    extractJob: vi.fn(async (description: string) => ({ job: { ...syntheticJob, id: stableId("job", description), title: description.slice(0, 20) }, warnings: [] })),
    assess: vi.fn(async (_profile: unknown, job: { title: string }) => {
      if (failOn && job.title.startsWith(failOn)) throw new Error("SYNTHETIC_PROVIDER_FAILURE");
      return { ...groundedAssessment, screeningContext: { version: "1" as const,
        seniorityFit: { value: "uncertain" as const, confidence: "low" as const, explanation: "Synthetic.", evidence: [] },
        careerStoryRisk: { value: "uncertain" as const, confidence: "low" as const, explanation: "Synthetic.", clarificationQuestion: "Synthetic clarification?", evidence: [] },
        screeningRisks: [], unknowns: [] } };
    }),
  };
}
const jobs = [
  { label: "job 1 (pasted)", text: "Alpha role: lead a React platform team for a commerce product." },
  { label: "job 2 (pasted)", text: "Beta role: build accessible frontend tooling and mentor engineers." },
  { label: "job 3 (jobs.lever.co)", url: "https://jobs.lever.co/example/gamma" },
];

describe("usage check (real MCP tools over HTTP, fake analyzer, no network)", () => {
  it("runs profile_upsert, then job_ingest and job_assess per posting, and reports the call count", async () => {
    const analyzer = fakeAnalyzer();
    const fetchJob = vi.fn(async (url: string) => ({ text: "Gamma role fetched: own frontend delivery for customers.", sourceUrl: url, warnings: ["Synthetic fetched page"] }));
    const results = await runUsageCheck({ resumeText: "Synthetic resume text that is long enough to pass the minimum length check.", jobs,
      createAnalyzer: () => analyzer, fetchJob, provider: "openrouter", model: "synthetic/free-model", now: () => new Date("2026-09-12T00:00:00.000Z") });
    expect(results).toMatchObject({ kind: "usage-check", provider: "openrouter", model: "synthetic/free-model", modelCalls: 7, promptVersion: groundedAssessment.promptVersion });
    expect(results.jobs.map((j) => j.status)).toEqual(["assessed", "assessed", "assessed"]);
    expect(analyzer.extractProfile).toHaveBeenCalledTimes(1);
    expect(fetchJob).toHaveBeenCalledWith("https://jobs.lever.co/example/gamma");
    const third = results.jobs[2]!;
    expect(third.status === "assessed" && third.ingest.job.sourceUrl).toBe("https://jobs.lever.co/example/gamma");
    expect(third.status === "assessed" && third.assessment.assessment.screeningContext?.seniorityFit.value).toBe("uncertain");
    const index = renderIndex(results);
    expect(index).toContain("REALISTIC");
    expect(index).toContain("uncertain / uncertain");
    // The pipeline replaced the unsupported synthetic question with the neutral clarification copy.
    expect(index).toContain("What career context should be clarified for this role?");
    expect(index).not.toContain("Synthetic clarification?");
    expect(index).toContain("model calls 7");
    const page = renderAssessment(third.status === "assessed" ? third.assessment : (() => { throw new Error("unreachable"); })(), "/* bundle */", 2, 3);
    expect(page).toContain("window.openai={toolOutput:");
    expect(page).toContain("job 3 of 3");
  });

  it("keeps going after one posting fails and records the fixed failure message", async () => {
    const results = await runUsageCheck({ resumeText: "Synthetic resume text that is long enough to pass the minimum length check.", jobs: jobs.slice(0, 2),
      createAnalyzer: () => fakeAnalyzer("Beta"), provider: "openai", model: "gpt-synthetic" });
    expect(results.jobs.map((j) => j.status)).toEqual(["assessed", "failed"]);
    const failed = results.jobs[1]!;
    expect(failed.status === "failed" && failed.step).toBe("job_assess");
    expect(results.modelCalls).toBe(5);
    expect(renderIndex(results)).toContain("failed at job_assess");
  });

  it("parses arguments and requires one to five postings unless replaying", () => {
    expect(parseUsageArgs(["--job", "a.txt", "--job", "https://jobs.lever.co/x/y", "--approve-transmission", "--port", "8020"])).toMatchObject({ jobs: ["a.txt", "https://jobs.lever.co/x/y"], approve: true, port: 8020 });
    expect(parseUsageArgs(["--replay", "r.json"])).toMatchObject({ replay: "r.json", jobs: [] });
    expect(() => parseUsageArgs([])).toThrow("between one and five");
    expect(() => parseUsageArgs(["--job", "a", "--job", "b", "--job", "c", "--job", "d", "--job", "e", "--job", "f"])).toThrow("between one and five");
    expect(() => parseUsageArgs(["--bogus"])).toThrow("Unknown option");
    expect(() => parseUsageArgs(["--job", "a", "--port", "80"])).toThrow("Unknown option");
  });

  it("prints the plan and exits 3 with zero calls when transmission is not approved", () => {
    const tsx = createRequire(import.meta.url).resolve("tsx");
    const run = spawnSync(process.execPath, ["--import", tsx, script, "--job", "https://jobs.lever.co/example/one"], { cwd: serverDirectory, encoding: "utf8", timeout: 60_000,
      env: { ...process.env, CAREER_RADAR_PROVIDER: "openrouter", OPENROUTER_MODEL: "synthetic/free-model" } });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain("destination: https://openrouter.ai/api/v1");
    expect(run.stderr).toContain("model: synthetic/free-model");
    expect(run.stderr).toContain("0 model calls made");
    expect(run.stdout).toBe("");
  });
});
