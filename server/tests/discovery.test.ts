import { afterEach, describe, expect, it, vi } from "vitest";
import { JobDiscovery, groupRecommendations } from "../src/domain/jobs/search.js";
import { CareerStore } from "../src/domain/store.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";
import { discoveryResult, groundedAssessment, recommendedItem } from "./discovery-fixtures.js";

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach((close) => close()); vi.useRealTimers(); });
async function setup() {
  const provider = { search: vi.fn(async () => structuredClone(discoveryResult)) };
  const discovery = new JobDiscovery(provider);
  const store = new CareerStore();
  store.upsertProfile(syntheticProfile);
  const analyzer = {
    extractProfile: vi.fn(), extractJob: vi.fn(async () => ({ job: syntheticJob, warnings: [] })),
    assess: vi.fn(async () => structuredClone(groundedAssessment)),
  };
  const createAnalyzer = vi.fn(() => analyzer);
  cleanup.push(() => { discovery.close(); store.close(); });
  const search = await discovery.search({ boardToken: "synthetic" });
  const input = { searchId: search.searchId, candidateProfileId: syntheticProfile.id, candidateIds: ["synthetic_1", "synthetic_2", "synthetic_3"], realisticCount: 2, stretchCount: 1 };
  return { discovery, store, provider, analyzer, createAnalyzer, search, input };
}

describe("bounded search snapshots and recommendations", () => {
  it("search returns summaries, not resume/JD text, and invokes no analyzer", async () => {
    const { provider, search, createAnalyzer } = await setup();
    expect(provider.search).toHaveBeenCalledWith({ boardToken: "synthetic", limit: 5 });
    expect(JSON.stringify(search)).not.toContain("Lead a React team");
    expect(JSON.stringify(search)).not.toContain("sourceHash");
    expect(createAnalyzer).not.toHaveBeenCalled();
  });

  it("runs policy before grouping, preserves sources, and saves IDs usable by application_save", async () => {
    const { discovery, store, analyzer, createAnalyzer, input } = await setup();
    analyzer.assess.mockResolvedValueOnce(groundedAssessment)
      .mockResolvedValueOnce({ ...groundedAssessment, strongestMatches: [{ ...groundedAssessment.strongestMatches[0]!, evidence: "Invented Kubernetes achievement" }] })
      .mockResolvedValueOnce({ ...groundedAssessment, hardBlockers: [{ requirementId: "req_1", requirement: "Mandatory leadership", reason: "Synthetic central gap", severity: "hard_blocker" }] });
    const result = await discovery.recommend(input, store, createAnalyzer);
    expect(result.available).toEqual({ realistic: 1, stretch: 1, pass: 1 });
    expect(result.shortfall).toEqual({ realistic: 1, stretch: 0 });
    expect(result.stretch[0]?.assessment.strongestMatches).toEqual([]);
    expect(result.pass[0]?.assessment.hardBlockers).toHaveLength(1);
    const selected = result.realistic[0]!;
    expect(store.getJob(selected.jobId)?.sourceUrl).toBe(discoveryResult.hits[0]?.candidate.sourceUrl);
    expect(store.pipelineSummary().total).toBe(0);
    const application = store.saveApplication({ assessmentId: selected.assessmentId });
    expect(application.verdictAtDecision).toBe("REALISTIC");
    const changed = store.updateApplication({ applicationId: application.id, status: "interview" });
    expect(store.saveApplication({ assessmentId: selected.assessmentId })).toEqual(changed);
    expect(analyzer.assess).toHaveBeenCalledTimes(3);
  });

  it("ranks only within fixed verdicts, does not use score, and supports hidden PASS explanations", () => {
    const items = [recommendedItem(1, { confidence: "low", score: 100 }), recommendedItem(2, { confidence: "high", score: 1 }), recommendedItem(3, { verdict: "PASS" })];
    const result = groupRecommendations(items, 1, 2, false);
    expect(result.realistic[0]?.candidate.candidateId).toBe("synthetic_2");
    expect(result.shortfall).toEqual({ realistic: 0, stretch: 2 });
    expect(result.pass).toEqual([]);
    expect(result.available.pass).toBe(1);
    expect(items[0]?.candidate.candidateId).toBe("synthetic_1");
  });

  it.each([
    { candidateIds: ["synthetic_1", "foreign_id"] }, { candidateIds: ["synthetic_1", "synthetic_1"] },
    { candidateIds: [] }, { candidateIds: Array.from({ length: 6 }, (_, i) => `synthetic_${i}`) },
    { candidateProfileId: "missing" }, { realisticCount: 5, stretchCount: 5 }, { searchId: "made_up" },
    { realisticCount: 0, stretchCount: 0, includePass: false },
  ])("rejects the complete invalid selection before model work %j", async (override) => {
    const { discovery, store, createAnalyzer, input } = await setup();
    await expect(discovery.recommend({ ...input, ...override }, store, createAnalyzer)).rejects.toThrow();
    expect(createAnalyzer).not.toHaveBeenCalled();
    expect(store.getJob(syntheticJob.id)).toBeUndefined();
  });

  it("expires idle snapshots and evicts the oldest at the fixed cap", async () => {
    vi.useFakeTimers();
    const { discovery, store, createAnalyzer, input } = await setup();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await expect(discovery.recommend(input, store, createAnalyzer)).rejects.toThrow("expired");
    const first = await discovery.search({ boardToken: "synthetic" });
    for (let i = 0; i < 10; i++) await discovery.search({ boardToken: "synthetic" });
    await expect(discovery.recommend({ ...input, searchId: first.searchId }, store, createAnalyzer)).rejects.toThrow("evicted");
    expect(createAnalyzer).not.toHaveBeenCalled();
  });

  it("keeps successful items but stops additional paid operations after an error", async () => {
    const { discovery, store, analyzer, createAnalyzer, input } = await setup();
    analyzer.assess.mockResolvedValueOnce(groundedAssessment).mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_DIAGNOSTIC"));
    const result = await discovery.recommend(input, store, createAnalyzer);
    expect(result.realistic).toHaveLength(1);
    expect(result.pass).toEqual([]);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[1]?.message).toContain("Not attempted");
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_DIAGNOSTIC");
    expect(analyzer.assess).toHaveBeenCalledTimes(2);
    expect(analyzer.extractJob).toHaveBeenCalledTimes(2);
  });

  it("reports missing-key failure without treating it as an empty successful recommendation", async () => {
    const { discovery, store, input } = await setup();
    const result = await discovery.recommend(input, store, () => { throw new Error("No key"); });
    expect(result.available).toEqual({ realistic: 0, stretch: 0, pass: 0 });
    expect(result.failures).toHaveLength(3);
    expect(result.shortfall).toEqual({ realistic: 2, stretch: 1 });
  });

  it("aborts a stalled batch and rejects overlapping batches before more work", async () => {
    vi.useFakeTimers();
    const { discovery, store, analyzer, createAnalyzer, input } = await setup();
    analyzer.extractJob.mockImplementation(() => new Promise(() => {}));
    const pending = discovery.recommend(input, store, createAnalyzer);
    await expect(discovery.recommend(input, store, createAnalyzer)).rejects.toThrow("already running");
    await vi.advanceTimersByTimeAsync(90_000);
    const result = await pending;
    expect(result.failures).toHaveLength(3);
    expect(result.available.realistic).toBe(0);
    expect(analyzer.assess).not.toHaveBeenCalled();
  });

  it("does not share search IDs across app instances", async () => {
    const { store, createAnalyzer, input } = await setup();
    const other = new JobDiscovery({ search: async () => discoveryResult });
    cleanup.push(() => other.close());
    await expect(other.recommend(input, store, createAnalyzer)).rejects.toThrow("expired");
    expect(createAnalyzer).not.toHaveBeenCalled();
  });
});
