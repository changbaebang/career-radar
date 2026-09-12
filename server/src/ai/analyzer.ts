import type { CandidateProfile, FitAssessment, JobPosting } from "@career-radar/shared";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  ASSESSMENT_INSTRUCTIONS, AssessmentDraftSchema, CandidateExtractionSchema, JOB_INSTRUCTIONS, JobExtractionSchema, OUTPUT_NAMES,
  PROFILE_INSTRUCTIONS, assessmentInput, jobInput, profileInput, toAssessment, toJob, toProfile, type JobExtraction, type ProfileExtraction,
} from "./contracts.js";
import { observeCall, projectUsage, type AnalyzerOperation, type AnalyzerResponseEvent, type AnalyzerTransport, type ResponseProjection } from "./telemetry.js";

export { PROMPT_VERSION } from "./contracts.js";
export type { JobExtraction, ProfileExtraction } from "./contracts.js";
export type { AnalyzerOperation, AnalyzerResponseEvent, AnalyzerTransport } from "./telemetry.js";

export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

export interface CareerAnalyzer {
  extractProfile(resumeText: string, profileId?: string, signal?: AbortSignal): Promise<ProfileExtraction>;
  extractJob(description: string, signal?: AbortSignal): Promise<JobExtraction>;
  assess(profile: CandidateProfile, job: JobPosting, signal?: AbortSignal): Promise<FitAssessment>;
}

type ObservedResponse = {
  id?: string; model?: string; status?: string; _request_id?: string | null;
  incomplete_details?: { reason?: string } | null;
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number;
    input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
};

function projectResponse(response: ObservedResponse): ResponseProjection {
  const projection: ResponseProjection = {};
  if (response.id) projection.responseId = response.id;
  if (response.model) projection.responseModel = response.model;
  if (typeof response._request_id === "string") projection.requestId = response._request_id;
  if (response.status) projection.responseStatus = response.status;
  if (response.incomplete_details?.reason) projection.incompleteReason = response.incomplete_details.reason;
  if (response.usage) {
    projection.usage = projectUsage({ input: response.usage.input_tokens, output: response.usage.output_tokens, total: response.usage.total_tokens,
      cached: response.usage.input_tokens_details?.cached_tokens, reasoning: response.usage.output_tokens_details?.reasoning_tokens });
  }
  return projection;
}

function requireParsed<T>(value: T | null, operation: string): T {
  if (value === null) throw new Error(`OpenAI returned no parsed ${operation} result.`);
  return value;
}

// OpenAI Responses API adapter. Prompts, draft schemas and result mapping live in contracts.ts and
// are shared with every other provider adapter.
export class OpenAICareerAnalyzer implements CareerAnalyzer {
  readonly #client: OpenAI;
  readonly #model: string;
  readonly #onResponse?: (event: AnalyzerResponseEvent) => void;

  // transport: SDK client options the measurement harness pins (retries off, logging off). The server never sets them.
  constructor(options: { apiKey?: string; model?: string; onResponse?: (event: AnalyzerResponseEvent) => void; transport?: AnalyzerTransport } = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error("Set OPENAI_API_KEY in .env.local or the server environment before analyzing a resume or job.");
    }
    this.#client = new OpenAI({ apiKey, ...(options.transport ?? {}) });
    this.#model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
    this.#onResponse = options.onResponse;
  }

  #observe<T extends ObservedResponse>(operation: AnalyzerOperation, call: () => Promise<T>): Promise<T> {
    return observeCall(this.#onResponse, operation, this.#model, "OpenAI", call, projectResponse);
  }

  async extractProfile(resumeText: string, profileId?: string, signal?: AbortSignal): Promise<ProfileExtraction> {
    const response = await this.#observe("extractProfile", () => this.#client.responses.parse({
      model: this.#model, store: false, instructions: PROFILE_INSTRUCTIONS, input: profileInput(resumeText),
      text: { format: zodTextFormat(CandidateExtractionSchema, OUTPUT_NAMES.extractProfile) },
    }, { signal, ...(signal ? { maxRetries: 0 } : {}) }));
    return toProfile(requireParsed(response.output_parsed, "candidate profile"), resumeText, profileId);
  }

  async extractJob(description: string, signal?: AbortSignal): Promise<JobExtraction> {
    const response = await this.#observe("extractJob", () => this.#client.responses.parse({
      model: this.#model, store: false, instructions: JOB_INSTRUCTIONS, input: jobInput(description),
      text: { format: zodTextFormat(JobExtractionSchema, OUTPUT_NAMES.extractJob) },
    }, { signal, ...(signal ? { maxRetries: 0 } : {}) }));
    return toJob(requireParsed(response.output_parsed, "job posting"), description);
  }

  async assess(profile: CandidateProfile, job: JobPosting, signal?: AbortSignal): Promise<FitAssessment> {
    const response = await this.#observe("assess", () => this.#client.responses.parse({
      model: this.#model, store: false, instructions: ASSESSMENT_INSTRUCTIONS, input: assessmentInput(profile, job),
      text: { format: zodTextFormat(AssessmentDraftSchema, OUTPUT_NAMES.assess) },
    }, { signal, ...(signal ? { maxRetries: 0 } : {}) }));
    return toAssessment(requireParsed(response.output_parsed, "fit assessment"), response.model ?? this.#model);
  }
}
