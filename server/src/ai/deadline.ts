import type { CareerAnalyzer } from "./analyzer.js";

// The SDK's own `timeout` only covers the wait for response headers; a slow body streams on after it.
// An AbortSignal passed to the request is honoured by fetch until the body is fully read, so every
// analyzer call gets its own deadline signal (combined with any caller signal) and the in-flight
// promises are tracked so the caller can wait for them before assembling results. Shared by the
// usage-check runner and the model-mode evaluation (M5-D).
export function withCallDeadline(ms: number) {
  const pending = new Set<Promise<unknown>>();
  let aborted = 0;
  const guard = <T>(caller: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => { aborted += 1; controller.abort(); }, ms);
    const signal = caller ? AbortSignal.any([caller, controller.signal]) : controller.signal;
    const promise = run(signal).finally(() => clearTimeout(timer));
    pending.add(promise);
    promise.catch(() => undefined).finally(() => pending.delete(promise));
    return promise;
  };
  return {
    get aborted() { return aborted; },
    wrap: (inner: CareerAnalyzer): CareerAnalyzer => ({
      extractProfile: (text, id, signal) => guard(signal, (s) => inner.extractProfile(text, id, s)),
      extractJob: (description, signal) => guard(signal, (s) => inner.extractJob(description, s)),
      assess: (profile, job, signal, evidence) => guard(signal, (s) => inner.assess(profile, job, s, evidence)),
    }),
    // Resolves with the number of calls still pending after the grace period.
    settle: async (graceMs: number): Promise<number> => {
      if (pending.size === 0) return 0;
      await Promise.race([Promise.allSettled([...pending]), new Promise<void>((resolve) => { const t = setTimeout(resolve, graceMs); t.unref(); })]);
      return pending.size;
    },
  };
}
export type CallDeadline = ReturnType<typeof withCallDeadline>;
