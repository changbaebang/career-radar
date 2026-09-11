import { FakeCareerAnalyzer } from "../scripts/measure-live/fake-analyzer.js";
import { parseArgs, resolveMode, type Scenario } from "../scripts/measure-live/gate.js";
import { MeasuredAnalyzer } from "../scripts/measure-live/measured-analyzer.js";
import { buildReport, reportInputs, searchSection, type Approvals, type Provenance } from "../scripts/measure-live/report.js";
import { performSearch, recordingProvider, runMeasurement } from "../scripts/measure-live/run.js";
import { createFixtureProvider, measurementProfile, measurementResumeText } from "../scripts/measure-live/synthetic-inputs.js";
import { JobDiscovery } from "../src/domain/jobs/search.js";
import { CareerStore } from "../src/domain/store.js";

// Runs the whole harness pipeline in-process with the fixture provider and the fake analyzer.
export async function dryRun(args: string[] = [], scenario: Scenario = "ok", delayMs = 1) {
  const options = parseArgs(args);
  const provider = recordingProvider(createFixtureProvider(5));
  const discoveryFactory = (deadlineMs: number) => new JobDiscovery(provider, undefined, { deadlineMs });
  const discovery = discoveryFactory(options.deadlineMs);
  const store = new CareerStore();
  store.upsertProfile(measurementProfile);
  const clock = () => performance.now();
  const context = await performSearch(discovery, provider, options, clock);
  const resolution = resolveMode(options, {}, context.selectedIds.length);
  if (resolution.refusal) throw new Error(resolution.refusal);
  const measured = new MeasuredAnalyzer(new FakeCareerAnalyzer(scenario, delayMs), { cap: resolution.cap, clock, hits: context.hits, allowProfileExtraction: options.includeProfileExtraction });
  const log: string[] = [];
  try {
    const state = await runMeasurement({ provider, measured, store, profile: measurementProfile, clock, now: () => new Date(), discoveryFactory, log: (line) => log.push(line),
      ...(options.includeProfileExtraction ? { resumeText: measurementResumeText } : {}) }, context, options);
    return { options, context, state, measured, log, store, resolution };
  } finally { discovery.close(); }
}

export const NOW = "2026-09-11T00:00:00.000Z";
export const provenance: Provenance = {
  codeSha: "0".repeat(40), dirty: false, hashes: { analyzer: "a".repeat(64), search: "b".repeat(64), policy: "c".repeat(64), schema: "d".repeat(64) },
  openaiSdkVersion: "7.4.0", nodeVersion: process.version, promptVersion: "milestone-1-v1", defaultModel: "gpt-5-mini", requestedModel: "synthetic-no-model",
};

export function dryRunReport(run: Awaited<ReturnType<typeof dryRun>>, over: Partial<Parameters<typeof buildReport>[0]> = {}) {
  const approvals: Approvals = { network: false, modelCost: false, confirmedVia: "none", maxModelCalls: run.resolution.cap, plannedUpperBound: run.resolution.upperBound, planBreakdown: run.resolution.breakdown };
  return buildReport({ mode: "dry-run", state: run.state, startedAt: NOW, finishedAt: NOW, generatedAt: NOW, provenance, approvals,
    inputs: reportInputs(run.options, run.context.selectedIds, "dry-run"), interrupted: false, exitCode: 0, searchCandidates: searchSection(run.context), ...over });
}
