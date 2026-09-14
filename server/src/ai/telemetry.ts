import { sanitizeProviderError } from "./errors.js";

export type AnalyzerOperation = "extractProfile" | "extractJob" | "assess";
// SDK client options the measurement harness pins (retries off, logging off). The server never sets them.
// timeout: per-request wall-clock bound in ms (SDK default is 10 minutes); the usage check sets it so an
// unresponsive free endpoint cannot keep the process alive after the tool call has already given up.
export type AnalyzerTransport = { maxRetries?: number; logLevel?: "off" | "error" | "warn" | "info" | "debug"; timeout?: number };

// Telemetry projection of one model call. Deliberately excludes the request input, the instructions
// and the parsed/raw output so a consumer can log it without handling personal data.
export type AnalyzerResponseEvent = {
  operation: AnalyzerOperation; requestedModel: string; durationMs: number; outcome: "ok" | "error";
  responseId?: string; responseModel?: string; requestId?: string;
  // Routed providers (OpenRouter) name the endpoint that actually served the model; "unknown" when omitted.
  upstreamProvider?: string;
  responseStatus?: string; incompleteReason?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens?: number; reasoningTokens?: number };
  error?: { name: string; status?: number; code?: string; requestId?: string };
  // M5-E: set by the run trace hook when the call happened inside a traced tool call.
  runId?: string;
};
export type ResponseProjection = Pick<AnalyzerResponseEvent, "responseId" | "responseModel" | "requestId" | "upstreamProvider" | "responseStatus" | "incompleteReason" | "usage">;
export type ResponseHook = (event: AnalyzerResponseEvent) => void;

// Request arguments and results are untouched. SDK errors are replaced by ProviderRequestError so a
// provider's error body never reaches an MCP response; cancellation and adapter errors pass through.
export async function observeCall<T>(hook: ResponseHook | undefined, operation: AnalyzerOperation, requestedModel: string, provider: string,
  call: () => Promise<T>, project: (response: T) => ResponseProjection): Promise<T> {
  const startedAt = performance.now();
  try {
    const response = await call();
    if (hook) emit(hook, { operation, requestedModel, durationMs: performance.now() - startedAt, outcome: "ok", ...project(response) });
    return response;
  } catch (raw) {
    const error = sanitizeProviderError(raw, provider);
    if (hook) emit(hook, { operation, requestedModel, durationMs: performance.now() - startedAt, outcome: "error", error: projectError(error) });
    throw error;
  }
}

// Only the error class and transport identifiers: an SDK error message can carry a response body.
function projectError(error: unknown): NonNullable<AnalyzerResponseEvent["error"]> {
  const detail = error as { name?: string; status?: number; code?: string | null; requestID?: string | null } | null;
  const projected: NonNullable<AnalyzerResponseEvent["error"]> = { name: typeof detail?.name === "string" ? detail.name : "Error" };
  if (typeof detail?.status === "number") projected.status = detail.status;
  if (typeof detail?.code === "string") projected.code = detail.code;
  if (typeof detail?.requestID === "string") projected.requestId = detail.requestID;
  return projected;
}

function emit(hook: ResponseHook, event: AnalyzerResponseEvent): void {
  try { hook(event); } catch { /* a telemetry consumer must never break analysis */ }
}

export type UsageCounters = { input: number; output: number; total: number; cached?: number | null; reasoning?: number | null };
export function projectUsage(counters: UsageCounters): NonNullable<AnalyzerResponseEvent["usage"]> {
  const usage: NonNullable<AnalyzerResponseEvent["usage"]> = { inputTokens: counters.input, outputTokens: counters.output, totalTokens: counters.total };
  if (typeof counters.cached === "number") usage.cachedInputTokens = counters.cached;
  if (typeof counters.reasoning === "number") usage.reasoningTokens = counters.reasoning;
  return usage;
}
