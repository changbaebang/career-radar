import type { CandidateProfile, FitAssessment, JobPosting } from "@career-radar/shared";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";

import type { CareerAnalyzer } from "./analyzer.js";
import {
  ASSESSMENT_INSTRUCTIONS, AssessmentDraftSchema, CandidateExtractionSchema, JOB_INSTRUCTIONS, JobExtractionSchema, OUTPUT_NAMES,
  PROFILE_INSTRUCTIONS, assessmentInput, jobInput, profileInput, toAssessment, toJob, toProfile, type JobExtraction, type ProfileExtraction,
} from "./contracts.js";
import { observeCall, projectUsage, type AnalyzerOperation, type AnalyzerResponseEvent, type AnalyzerTransport, type ResponseProjection } from "./telemetry.js";

// Fixed in code, never read from the environment: the approval screen of the live harness names it.
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Static messages only: model output and error bodies are never echoed.
export const OPENROUTER_ERRORS = {
  missingKey: "Set OPENROUTER_API_KEY in .env.local before using the openrouter provider.",
  missingModel: "Set OPENROUTER_MODEL in .env.local; the openrouter provider has no default model.",
  noContent: "OpenRouter returned no message content.",
  refused: "OpenRouter model refused the request.",
  truncated: "OpenRouter response ended before the structured output completed.",
  finishError: "OpenRouter's upstream endpoint reported an error finish (no completed output).",
  invalidJson: "OpenRouter returned content that is not valid JSON.",
  schemaMismatch: "OpenRouter returned JSON that does not match the requested schema; the routed endpoint may not enforce structured outputs.",
} as const;

type ChatResponse = {
  id?: string; model?: string; provider?: string; _request_id?: string | null;
  choices: Array<{ finish_reason: string | null; message: { content: string | null; refusal?: string | null } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number } | null; completion_tokens_details?: { reasoning_tokens?: number } | null } | null;
};

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

// OpenRouter adapter over the OpenAI-compatible Chat Completions endpoint. Same prompts, same draft
// schemas and same result mapping as the OpenAI adapter; only the transport differs. Structured
// output enforcement varies by the endpoint OpenRouter routes to, so the response is parsed and
// schema-checked here and anything else fails closed.
export class OpenRouterCareerAnalyzer implements CareerAnalyzer {
  readonly #client: OpenAI;
  readonly #model: string;
  readonly #onResponse?: (event: AnalyzerResponseEvent) => void;

  constructor(options: { apiKey?: string; model?: string; onResponse?: (event: AnalyzerResponseEvent) => void; transport?: AnalyzerTransport } = {}) {
    const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey?.trim()) throw new Error(OPENROUTER_ERRORS.missingKey);
    const model = options.model ?? process.env.OPENROUTER_MODEL;
    if (!model?.trim()) throw new Error(OPENROUTER_ERRORS.missingModel);
    this.#client = new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL, defaultHeaders: { "X-OpenRouter-Title": "Career Radar" }, ...(options.transport ?? {}) });
    this.#model = model;
    this.#onResponse = options.onResponse;
  }

  async #complete<S extends z.ZodTypeAny>(operation: AnalyzerOperation, schema: S, instructions: string, input: string, signal?: AbortSignal): Promise<{ draft: z.infer<S>; response: ChatResponse }> {
    const response = await observeCall(this.#onResponse, operation, this.#model, "OpenRouter", () => this.#client.chat.completions.create({
      model: this.#model,
      messages: [{ role: "system", content: instructions }, { role: "user", content: input }],
      response_format: zodResponseFormat(schema, OUTPUT_NAMES[operation]),
      // OpenRouter routing preference (not an OpenAI parameter): only endpoints that accept every
      // supplied parameter, including response_format, may serve this request.
      ...({ provider: { require_parameters: true } } as object),
    }, { signal, ...(signal ? { maxRetries: 0 } : {}) }) as Promise<ChatResponse>, projectChat);
    const choice = response.choices[0];
    if (!choice) throw new Error(OPENROUTER_ERRORS.noContent);
    if (choice.message.refusal) throw new Error(OPENROUTER_ERRORS.refused);
    if (choice.finish_reason === "error") throw new Error(OPENROUTER_ERRORS.finishError);
    if (choice.finish_reason !== "stop") throw new Error(OPENROUTER_ERRORS.truncated);
    if (typeof choice.message.content !== "string" || choice.message.content.trim() === "") throw new Error(OPENROUTER_ERRORS.noContent);
    let json: unknown;
    try { json = JSON.parse(choice.message.content); } catch { throw new Error(OPENROUTER_ERRORS.invalidJson); }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(OPENROUTER_ERRORS.schemaMismatch);
    return { draft: parsed.data as z.infer<S>, response };
  }

  // "openrouter/<model>@<upstream provider>": which endpoint actually produced the draft.
  #modelVersion(response: ChatResponse): string {
    return `openrouter/${response.model ?? this.#model}@${response.provider ?? "unknown"}`;
  }

  async extractProfile(resumeText: string, profileId?: string): Promise<ProfileExtraction> {
    const { draft } = await this.#complete("extractProfile", CandidateExtractionSchema, PROFILE_INSTRUCTIONS, profileInput(resumeText));
    return toProfile(draft, resumeText, profileId);
  }

  async extractJob(description: string, signal?: AbortSignal): Promise<JobExtraction> {
    const { draft } = await this.#complete("extractJob", JobExtractionSchema, JOB_INSTRUCTIONS, jobInput(description), signal);
    return toJob(draft, description);
  }

  async assess(profile: CandidateProfile, job: JobPosting, signal?: AbortSignal): Promise<FitAssessment> {
    const { draft, response } = await this.#complete("assess", AssessmentDraftSchema, ASSESSMENT_INSTRUCTIONS, assessmentInput(profile, job), signal);
    return toAssessment(draft, this.#modelVersion(response));
  }
}
