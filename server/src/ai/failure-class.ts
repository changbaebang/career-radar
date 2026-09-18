import { OPENROUTER_ERRORS } from "./openrouter.js";
import type { AnalyzerResponseEvent } from "./telemetry.js";

// Fixed failure classes for a model call, shared by the run trace (M5-E) and the model-mode
// evaluation (M5-D). Decided from fixed adapter messages, error names and telemetry only; never
// from message prose, which can carry a provider's response body.
export type FailureClass = "schema_failure" | "refusal" | "truncation" | "timeout" | "tool_failure" | "provider_error" | "other";

export function classifyFailure(error: unknown, lastEvent?: Partial<AnalyzerResponseEvent>): FailureClass {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (message === OPENROUTER_ERRORS.envelopeMismatch) return "provider_error";
  if (name === "AbortError" || name === "APIUserAbortError" || /timed? ?out/i.test(name)) return "timeout";
  if (message === OPENROUTER_ERRORS.truncated || lastEvent?.incompleteReason === "max_output_tokens") return "truncation";
  if (message === OPENROUTER_ERRORS.refused || /refus/i.test(name)) return "refusal";
  if ([OPENROUTER_ERRORS.schemaMismatch, OPENROUTER_ERRORS.invalidJson, OPENROUTER_ERRORS.noContent, OPENROUTER_ERRORS.finishError].includes(message as never)
    || /returned no parsed/.test(message) || name === "ZodError") return "schema_failure";
  if (/Error$/.test(name) && (error as { status?: number }).status !== undefined) return "provider_error";
  if (/request failed/.test(message)) return "provider_error";
  return "other";
}
