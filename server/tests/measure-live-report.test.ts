import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LiveMeasurementReportSchema, assertRedacted, createReportDirectory, renderIssueComment, renderMarkdown, reportInputs, writeReport } from "../scripts/measure-live/report.js";
import { OPENROUTER_BASE_URL } from "../src/ai/openrouter.js";
import { SYNTHETIC_EVIDENCE_SENTINEL, SYNTHETIC_JD_SENTINEL, measurementResumeText } from "../scripts/measure-live/synthetic-inputs.js";
import { dryRun, dryRunReport } from "./measure-live-helpers.js";

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("measure:live report", () => {
  it("builds a strictly validated report that carries counters and hashes, never text or money", async () => {
    const run = await dryRun([], "fail-at-3");
    const report = dryRunReport(run);
    expect(LiveMeasurementReportSchema.strict().parse(report)).toEqual(report);
    expect(report).toMatchObject({ reportKind: "live-batch-measurement", reportVersion: 1, mode: "dry-run", status: "complete",
      provider: { api: "synthetic-no-model", store: false, maxRetries: 0, logLevel: "off", baseUrl: "https://api.openai.com/v1" }, billing: { monetaryCostConfirmed: false, billedAmount: null },
      decision: { recommendedDeadlineMs: null }, budgetObservation: { defaultDeadlineMs: 90_000, finishedWithinDeadline: true, sampleSize: 5, runsRequiredBeforeDecision: 3 } });
    expect(report.search.candidates).toHaveLength(5);
    expect(report.search.candidates[0]).toMatchObject({ descriptionSha256: expect.stringMatching(/^[0-9a-f]{64}$/), descriptionLength: expect.any(Number) });
    const serialized = JSON.stringify(report) + renderMarkdown(report) + renderIssueComment(report);
    for (const fragment of [SYNTHETIC_JD_SENTINEL, SYNTHETIC_EVIDENCE_SENTINEL, "Lead a React team", "SYNTHETIC_PROVIDER_FAILURE", measurementResumeText.slice(0, 40), "<job-description>", "<resume>"]) {
      expect(serialized).not.toContain(fragment);
    }
    expect(() => assertRedacted(serialized, [measurementResumeText, ...run.context.hits.map((h) => h.description)])).not.toThrow();
  });

  it("renders Markdown and an issue comment without cost, percentage or savings claims", async () => {
    const report = dryRunReport(await dryRun(["--forced-abort-ms", "20", "--retry-mode", "all"], "ok", 5));
    const markdown = renderMarkdown(report);
    const comment = renderIssueComment(report);
    for (const text of [markdown, comment]) {
      expect(text).not.toMatch(/\$\s?\d/);
      expect(text).not.toMatch(/\d\s?%/);
      expect(text).not.toMatch(/saving|절감|cheaper|cost estimate/i);
    }
    expect(markdown).toContain("Billing");
    expect(markdown).toContain("not a budget decision");
    expect(markdown).toContain("## C-forced-abort");
    expect(comment.split("\n").length).toBeLessThanOrEqual(40);
    expect(comment).toContain("Billing unverified");
    expect(comment).toContain("three approved runs");
  });

  it("records the provider and its fixed destination, per provider", async () => {
    const run = await dryRun();
    expect(dryRunReport(run)).toMatchObject({ inputs: { provider: "openai" }, provider: { api: "synthetic-no-model", baseUrl: "https://api.openai.com/v1" } });
    const routed = dryRunReport(run, { mode: "live", inputs: { ...reportInputs(run.options, run.context.selectedIds, "live"), provider: "openrouter" } });
    expect(routed).toMatchObject({ inputs: { provider: "openrouter" }, provider: { api: "openrouter-chat-completions", baseUrl: OPENROUTER_BASE_URL } });
    expect(renderMarkdown(routed)).toContain("Provider: openrouter (openrouter-chat-completions)");
    expect(renderIssueComment(routed)).toContain("provider openrouter");
  });

  it("marks an interrupted run incomplete and keeps the in-flight billing caveat", async () => {
    const report = dryRunReport(await dryRun(), { interrupted: true, exitCode: 130 });
    expect(report).toMatchObject({ status: "incomplete", interrupted: true, exitCode: 130 });
    expect(report.interruptionNote).toMatch(/still be billed/);
    expect(dryRunReport(await dryRun(), { state: undefined }).status).toBe("incomplete");
  });

  it("assertRedacted rejects keys, prompt tags and forbidden fragments with a message that never echoes them", () => {
    const fail = (text: string, forbidden: string[] = []) => {
      let message = "";
      try { assertRedacted(text, forbidden); } catch (error) { message = (error as Error).message; }
      expect(message).toBe("Report redaction failed.");
    };
    fail("token sk-abcdefghijklmnopqrstuvwxyz0123 leaked");
    fail("<job-description>");
    fail("…<resume>…");
    fail("line: SECRET-JD-LINE-THAT-MUST-NOT-APPEAR-IN-REPORTS", ["SECRET-JD-LINE-THAT-MUST-NOT-APPEAR-IN-REPORTS"]);
    expect(() => assertRedacted("clean report", ["SECRET-JD-LINE"])).not.toThrow();
    expect(() => assertRedacted("has a short word", ["short"])).not.toThrow(); // fragments under 8 chars are not matched
  });

  it("writes report files 0o600 inside a fresh 0o700 directory and refuses to reuse either", async () => {
    const base = mkdtempSync(join(tmpdir(), "career-radar-measure-")); directories.push(base);
    const directory = join(base, "run");
    const report = dryRunReport(await dryRun());
    createReportDirectory(directory);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    writeReport(directory, report, renderMarkdown(report), renderIssueComment(report));
    for (const name of ["report.json", "report.md", "issue-comment.md"]) expect(statSync(join(directory, name)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(directory, "report.json"), "utf8")).reportKind).toBe("live-batch-measurement");
    expect(() => createReportDirectory(directory)).toThrow();
    expect(() => writeReport(directory, report, "", "")).toThrow();
    expect(readFileSync(join(directory, "report.md"), "utf8")).toContain("# Career Radar live batch measurement");
  });
});
