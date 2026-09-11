// "openai/error" is imported on purpose: tests that mock the "openai" entry point still get the real
// error classes here, and the check below must never throw on a non-callable right-hand side.
import { APIError, APIUserAbortError } from "openai/error";

// Replacement for an SDK HTTP/transport error. Keeps only what a consumer may log or show: the SDK
// error class, the HTTP status, the provider's error code and the request ID. The provider's message
// can echo request input or internal diagnostics, so it is dropped.
export class ProviderRequestError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly requestID?: string;
  constructor(provider: string, kind: string, detail: { status?: number; code?: string; requestID?: string }) {
    super(`${provider} request failed${detail.status !== undefined ? ` (HTTP ${detail.status})` : ""}. Check the key, model and network; the provider's message is not shown.`);
    this.name = kind;
    if (detail.status !== undefined) this.status = detail.status;
    if (detail.code !== undefined) this.code = detail.code;
    if (detail.requestID !== undefined) this.requestID = detail.requestID;
  }
}

// Cancellation keeps its identity so batch abort handling can tell it apart. Everything that is not
// an SDK error (fixed adapter messages, schema errors) passes through unchanged.
export function sanitizeProviderError(error: unknown, provider: string): unknown {
  if (error instanceof APIUserAbortError || !(error instanceof APIError)) return error;
  return new ProviderRequestError(provider, error.constructor.name, {
    ...(typeof error.status === "number" ? { status: error.status } : {}),
    ...(typeof error.code === "string" ? { code: error.code } : {}),
    ...(typeof error.requestID === "string" ? { requestID: error.requestID } : {}),
  });
}
