import { OpenAICareerAnalyzer, type AnalyzerResponseEvent, type AnalyzerTransport, type CareerAnalyzer } from "./analyzer.js";
import { OPENROUTER_BASE_URL, OpenRouterCareerAnalyzer } from "./openrouter.js";

export type ProviderName = "openai" | "openrouter";
export const PROVIDER_NAMES: readonly ProviderName[] = ["openai", "openrouter"];
export const OPENAI_BASE_URL_DEFAULT = "https://api.openai.com/v1";
export const PROVIDER_ERRORS = { unknown: "Set CAREER_RADAR_PROVIDER to openai or openrouter." } as const;

export function isProviderName(value: unknown): value is ProviderName {
  return typeof value === "string" && (PROVIDER_NAMES as readonly string[]).includes(value);
}

// Explicit selection only: no silent fallback from one provider to another. Unset or blank
// (as in .env.example) means the default OpenAI adapter.
export function resolveProviderName(value: string | undefined = process.env.CAREER_RADAR_PROVIDER): ProviderName {
  const name = (value?.trim() || "openai").toLowerCase();
  if (!isProviderName(name)) throw new Error(PROVIDER_ERRORS.unknown);
  return name;
}

export function providerDestination(name: ProviderName): string {
  return name === "openrouter" ? OPENROUTER_BASE_URL : OPENAI_BASE_URL_DEFAULT;
}

export function createAnalyzerFromEnv(options: { provider?: ProviderName; onResponse?: (event: AnalyzerResponseEvent) => void; transport?: AnalyzerTransport } = {}): CareerAnalyzer {
  const name = options.provider ?? resolveProviderName();
  const shared = { ...(options.onResponse ? { onResponse: options.onResponse } : {}), ...(options.transport ? { transport: options.transport } : {}) };
  return name === "openrouter" ? new OpenRouterCareerAnalyzer(shared) : new OpenAICareerAnalyzer(shared);
}
