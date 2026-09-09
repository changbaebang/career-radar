import { afterEach, describe, expect, it, vi } from "vitest";

import { evalCases } from "../../evals/fixtures/cases.js";
import { CareerStore } from "../src/domain/store.js";

const { profile, job } = evalCases[0];

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("CareerStore retention", () => {
  it("removes both record types at TTL even without another request", () => {
    vi.useFakeTimers();
    const store = new CareerStore({ ttlMs: 100 });
    store.upsertProfile(profile);
    store.upsertJob(job);
    expect(vi.getTimerCount()).toBe(2);
    vi.advanceTimersByTime(99);
    expect(store.getProfile(profile.id)).toEqual(profile);
    expect(store.getJob(job.id)).toEqual(job);
    vi.advanceTimersByTime(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.getProfile(profile.id)).toBeUndefined();
    expect(store.getJob(job.id)).toBeUndefined();
  });

  it("caps profiles and jobs separately, evicting oldest writes", () => {
    vi.useFakeTimers();
    const store = new CareerStore({ maxEntries: 2 });
    for (let index = 0; index < 3; index++) {
      store.upsertProfile({ ...profile, id: `profile_${index}` });
      store.upsertJob({ ...job, id: `job_${index}` });
    }
    expect(store.getProfile("profile_0")).toBeUndefined();
    expect(store.getJob("job_0")).toBeUndefined();
    expect(store.getProfile("profile_1")).toBeDefined();
    expect(store.getJob("job_1")).toBeDefined();
    expect(store.getProfile("profile_2")).toBeDefined();
    expect(store.getJob("job_2")).toBeDefined();
    expect(vi.getTimerCount()).toBe(4);
  });

  it("replaces the old expiry when updating a record and clears timers", () => {
    vi.useFakeTimers();
    const store = new CareerStore({ ttlMs: 100 });
    store.upsertProfile(profile);
    vi.advanceTimersByTime(50);
    store.upsertProfile({ ...profile, headline: "Updated synthetic profile" });
    vi.advanceTimersByTime(50);
    expect(store.getProfile(profile.id)?.headline).toBe("Updated synthetic profile");
    expect(vi.getTimerCount()).toBe(1);
    store.clear();
    expect(store.getProfile(profile.id)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
