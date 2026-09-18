import type { RetrievedEvidence } from "../domain/evidence/retrieve.js";
import type { CandidateProfile, FitAssessment, JobPosting } from "@career-radar/shared";
import { APIError, APIUserAbortError } from "openai/error";
import { HTTPClient } from "@openrouter/sdk/lib/http";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import type { JSONSchema } from "@tanstack/ai";
import { resolveDebugOption } from "@tanstack/ai/adapter-internals";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { ProviderRequestError } from "./errors.js";

import type { CareerAnalyzer } from "./analyzer.js";
import {
  ASSESSMENT_INSTRUCTIONS, AssessmentDraftSchema, CandidateExtractionSchema, JOB_INSTRUCTIONS, JobExtractionSchema, OUTPUT_NAMES,
  PROFILE_INSTRUCTIONS, assessmentInput, jobInput, profileInput, toAssessment, toJob, toProfile, type JobExtraction, type ProfileExtraction,
} from "./contracts.js";
import { observeCall, projectUsage, type AnalyzerOperation, type AnalyzerResponseEvent, type AnalyzerTransport, type ResponseProjection } from "./telemetry.js";

// Fixed in code, never read from the environment: the approval screen of the live harness names it.
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Static messages only: model output and error bodies are never echoed.
export const OPENROUTER_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type OpenRouterReasoningEffort = (typeof OPENROUTER_REASONING_EFFORTS)[number];

export const OPENROUTER_ERRORS = {
  missingKey: "Set OPENROUTER_API_KEY in .env.local before using the openrouter provider.",
  missingModel: "Set OPENROUTER_MODEL in .env.local; the openrouter provider has no default model.",
  invalidReasoning: "OPENROUTER_REASONING_EFFORT must be one of none, minimal, low, medium, high, xhigh, max.",
  noContent: "OpenRouter returned no message content.",
  refused: "OpenRouter model refused the request.",
  truncated: "OpenRouter response ended before the structured output completed.",
  finishError: "OpenRouter's upstream endpoint reported an error finish (no completed output).",
  invalidJson: "OpenRouter returned content that is not valid JSON.",
  schemaMismatch: "OpenRouter returned JSON that does not match the requested schema; the routed endpoint may not enforce structured outputs.",
} as const;

const ChatResponseSchema = z.object({
  id: z.string().optional(), model: z.string().optional(), provider: z.string().optional(), _request_id: z.string().nullable().optional(),
  choices: z.array(z.object({ finish_reason: z.string().nullable(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }).passthrough() }).passthrough()),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number(), total_tokens: z.number(),
    prompt_tokens_details: z.object({ cached_tokens: z.number().optional() }).passthrough().nullable().optional(),
    completion_tokens_details: z.object({ reasoning_tokens: z.number().optional() }).passthrough().nullable().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();
type ChatResponse = z.infer<typeof ChatResponseSchema>;

function projectChat(response: ChatResponse): ResponseProjection {
  const projection: ResponseProjection = {};
  if (response.id) projection.responseId = response.id;
  if (response.model) projection.responseModel = response.model;
  if (typeof response._request_id === "string") projection.requestId = response._request_id;
  projection.upstreamProvider = typeof response.provider === "string" && response.provider ? response.provider : "unknown";
  const finish = response.choices[0]?.finish_reason;
  if (finish) projection.responseStatus = finish;
  if (response.usage) {
    projection.usage = projectUsage({ input: response.usage.prompt_tokens, output: response.usage.completion_tokens, total: response.usage.total_tokens,
      cached: response.usage.prompt_tokens_details?.cached_tokens, reasoning: response.usage.completion_tokens_details?.reasoning_tokens });
  }
  return projection;
}

// TanStack OpenRouter adapter over the Chat Completions endpoint. Same prompts, same draft
// schemas and same result mapping as the OpenAI adapter. Structured
// output enforcement varies by the endpoint OpenRouter routes to, so the response is parsed and
// schema-checked here and anything else fails closed.
export class OpenRouterCareerAnalyzer implements CareerAnalyzer {
  readonly #apiKey: string;
  readonly #timeout: number;
  readonly #model: string;
  readonly #reasoningEffort?: OpenRouterReasoningEffort;
  readonly #onResponse?: (event: AnalyzerResponseEvent) => void;

  // reasoningEffort: optional OpenRouter `reasoning.effort`, an intensity hint rather than a token cap.
  // Reasoning tokens are billed as output and, on the free endpoints tried so far, dwarfed the answer;
  // whether this lowers them is unverified. It is sent as a request parameter, so with require_parameters
  // routing it also restricts routing to endpoints that accept it.
  constructor(options: { apiKey?: string; model?: string; reasoningEffort?: string; onResponse?: (event: AnalyzerResponseEvent) => void; transport?: AnalyzerTransport } = {}) {
    const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey?.trim()) throw new Error(OPENROUTER_ERRORS.missingKey);
    const model = options.model ?? process.env.OPENROUTER_MODEL;
    if (!model?.trim()) throw new Error(OPENROUTER_ERRORS.missingModel);
    const effort = (options.reasoningEffort ?? process.env.OPENROUTER_REASONING_EFFORT)?.trim();
    if (effort) {
      if (!(OPENROUTER_REASONING_EFFORTS as readonly string[]).includes(effort)) throw new Error(OPENROUTER_ERRORS.invalidReasoning);
      this.#reasoningEffort = effort as OpenRouterReasoningEffort;
    }
    this.#apiKey = apiKey;
    this.#timeout = options.transport?.timeout ?? 600_000;
    this.#model = model;
    this.#onResponse = options.onResponse;
  }

  async #complete<S extends z.ZodTypeAny>(operation: AnalyzerOperation, schema: S, instructions: string, input: string, signal?: AbortSignal): Promise<{ draft: z.infer<S>; response: ChatResponse }> {
    // One adapter per call: metadata and boundary errors must not leak across concurrent requests.
    // TanStack's non-streaming structuredOutput currently omits finish/model/provider metadata.
    // Keep a request-local HTTP boundary until upstream exposes those fields and validates finishes.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let response: ChatResponse | undefined;
    let boundaryError: unknown;
    const httpClient = new HTTPClient({ fetcher: async (request, init) => {
      try {
        response = await observeCall(this.#onResponse, operation, this.#model, "OpenRouter", async () => {
          if (combined.aborted) throw new APIUserAbortError();
          let wire: Response;
          let text: string;
          try {
            wire = await fetch(request, { ...init, signal: combined });
            text = await wire.text(); // signal remains active until the body is consumed
          } catch {
            if (combined.aborted) throw new APIUserAbortError();
            throw new ProviderRequestError("OpenRouter", "APIConnectionError", {});
          }
          let json: unknown;
          try { json = JSON.parse(text); } catch {
            if (wire.ok) throw new Error(OPENROUTER_ERRORS.invalidJson);
          }
          if (!wire.ok) throw APIError.generate(wire.status, json && typeof json === "object" ? json : undefined, "", wire.headers);
          const envelope = ChatResponseSchema.safeParse(json);
          if (!envelope.success) throw new Error(OPENROUTER_ERRORS.noContent);
          const raw = envelope.data;
          raw._request_id = wire.headers.get("x-request-id");
          return raw;
        }, projectChat);
        validateCompletion(response);
        return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
      } catch (error) {
        boundaryError = combined.aborted ? new APIUserAbortError() : error;
        throw boundaryError;
      }
    } });
    // OPENROUTER_MODEL intentionally accepts newly published / :free IDs outside the SDK catalog.
    // The cast only crosses the SDK's catalog type; it does not claim runtime capabilities.
    const adapter = createOpenRouterText(this.#model as Parameters<typeof createOpenRouterText>[0], this.#apiKey, {
      serverURL: OPENROUTER_BASE_URL, appTitle: "Career Radar", httpClient,
      retryConfig: { strategy: "none" }, debugLogger: { group() {}, groupEnd() {}, log() {} },
    });
    let data: unknown;
    try {
      const result = await adapter.structuredOutput({
        outputSchema: zodResponseFormat(schema, OUTPUT_NAMES[operation]).json_schema.schema as JSONSchema,
        chatOptions: {
          model: this.#model, systemPrompts: [instructions], messages: [{ role: "user", content: input }],
          modelOptions: { provider: { requireParameters: true }, ...(this.#reasoningEffort ? { reasoning: { effort: this.#reasoningEffort } } : {}) },
          request: { signal: combined }, logger: resolveDebugOption(false),
        },
      });
      data = result.data;
    } catch {
      if (combined.aborted) throw new APIUserAbortError();
      // SDK parser errors may embed output text. Never let their messages/causes escape.
      if (boundaryError) throw boundaryError;
      throw new ProviderRequestError("OpenRouter", "APIResponseValidationError", {});
    } finally { clearTimeout(timer); }
    if (!response) throw new Error(OPENROUTER_ERRORS.noContent);
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new Error(OPENROUTER_ERRORS.schemaMismatch);
    return { draft: parsed.data as z.infer<S>, response };
  }

  // "openrouter/<model>@<upstream provider>": which endpoint actually produced the draft.
  #modelVersion(response: ChatResponse): string {
    return `openrouter/${response.model ?? this.#model}@${response.provider ?? "unknown"}`;
  }

  async extractProfile(resumeText: string, profileId?: string, signal?: AbortSignal): Promise<ProfileExtraction> {
    const { draft } = await this.#complete("extractProfile", CandidateExtractionSchema, PROFILE_INSTRUCTIONS, profileInput(resumeText), signal);
    return toProfile(draft, resumeText, profileId);
  }

  async extractJob(description: string, signal?: AbortSignal): Promise<JobExtraction> {
    const { draft } = await this.#complete("extractJob", JobExtractionSchema, JOB_INSTRUCTIONS, jobInput(description), signal);
    return toJob(draft, description);
  }

  async assess(profile: CandidateProfile, job: JobPosting, signal?: AbortSignal, evidence?: RetrievedEvidence): Promise<FitAssessment> {
    const { draft, response } = await this.#complete("assess", AssessmentDraftSchema, ASSESSMENT_INSTRUCTIONS, assessmentInput(profile, job, evidence), signal);
    return toAssessment(draft, this.#modelVersion(response));
  }
}

function validateCompletion(response: ChatResponse): void {
  const choice = response.choices[0];
  if (!choice) throw new Error(OPENROUTER_ERRORS.noContent);
  if (choice.message.refusal) throw new Error(OPENROUTER_ERRORS.refused);
  if (choice.finish_reason === "error") throw new Error(OPENROUTER_ERRORS.finishError);
  if (choice.finish_reason !== "stop") throw new Error(OPENROUTER_ERRORS.truncated);
  if (typeof choice.message.content !== "string" || choice.message.content.trim() === "") throw new Error(OPENROUTER_ERRORS.noContent);
  try { JSON.parse(choice.message.content); } catch { throw new Error(OPENROUTER_ERRORS.invalidJson); }
}
