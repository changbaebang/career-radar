import { afterEach, describe, expect, it, vi } from "vitest";
import { PROMPT_VERSION, type AnalyzerResponseEvent } from "../src/ai/analyzer.js";
import { OPENROUTER_BASE_URL, OPENROUTER_ERRORS, OpenRouterCareerAnalyzer } from "../src/ai/openrouter.js";
import { syntheticJob, syntheticProfile } from "./fixtures.js";

// Real OpenAI SDK against a stubbed global fetch: request shape, headers and every fail-closed path
// are exercised without any network. No OpenRouter call is made.
type Captured = { url: string; headers: Headers; body: Record<string, unknown> };
const requests: Captured[] = [];
function stubFetch(reply: (request: Captured) => Response) {
  requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const captured: Captured = { url: String(input), headers: new Headers(init?.headers as HeadersInit), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
    requests.push(captured);
    return reply(captured);
  }));
}
function completion(content: unknown, overrides: Record<string, unknown> = {}, choice: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    id: "gen-synthetic", object: "chat.completion", model: "synthetic/free-model", provider: "SyntheticUpstream",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) }, ...choice }],
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19, prompt_tokens_details: { cached_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 2 } },
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_synthetic" } });
}
const key = "synthetic-not-a-real-key";
const analyzer = (extra: ConstructorParameters<typeof OpenRouterCareerAnalyzer>[0] = {}) => new OpenRouterCareerAnalyzer({ apiKey: key, model: "synthetic/free-model", ...extra });
const candidate = { source: "candidate", path: "roles[0].evidence[0]", quote: "Led a React platform team" };
const role = { source: "job", path: "required[0].text", quote: "Lead a React team" };
const assessmentDraft = {
  verdict: "REALISTIC", confidence: "high", resumeContortion: "low", score: null,
  strongestMatches: [{ requirementId: "req_1", requirement: "Lead a React team", evidence: "Led a React platform team", source: { company: null, role: null, project: null }, strength: "direct", citations: [] }],
  gaps: [], hardBlockers: [], interviewRisks: [], recommendation: "Synthetic recommendation.", missingInformation: [],
  screeningContext: {
    seniorityFit: { value: "aligned", explanation: "Synthetic scope.", evidence: [candidate, role], confidence: "medium" },
    careerStoryRisk: { value: "low", explanation: "Synthetic story.", evidence: [candidate, role], clarificationQuestion: null, confidence: "medium" },
    screeningRisks: [], unknowns: [],
  },
};
const profileDraft = {
  headline: "Frontend Lead", yearsExperience: null,
  roles: [{ company: "Example Company", title: "Frontend Lead", start: null, end: null, responsibilities: ["Led a React platform team"], evidence: ["Led a React platform team"] }],
  skills: ["React"], domains: [], leadership: [], customerFacing: [], aiEvidence: [], cloudEvidence: [],
  constraints: { locations: [], remotePreference: null, languages: [] }, warnings: ["synthetic"],
};
const jobDraft = {
  company: "Example Employer", title: "Frontend Engineering Lead", location: null,
  required: [{ text: "Lead a React team", type: "leadership", importance: "core" }], preferred: [], responsibilities: [],
  roleFamily: "Frontend Engineering Lead", domains: [], technologies: [], seniority: null, warnings: [],
};
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("OpenRouterCareerAnalyzer (real SDK, stubbed fetch, no network)", () => {
  it("sends a strict json_schema chat completion to openrouter.ai with require_parameters routing", async () => {
    stubFetch(() => completion(assessmentDraft));
    await analyzer().assess(syntheticProfile, syntheticJob);
    expect(requests).toHaveLength(1);
    const { url, headers, body } = requests[0]!;
    expect(url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    expect(headers.get("authorization")).toBe(`Bearer ${key}`);
    expect(headers.get("x-openrouter-title")).toBe("Career Radar");
    expect(body.model).toBe("synthetic/free-model");
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body).not.toHaveProperty("store");
    const format = body.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: unknown } };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema).toMatchObject({ name: "fit_assessment", strict: true });
    expect(JSON.stringify(format.json_schema.schema)).toContain("screeningContext");
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("otherwise answer uncertain");
    expect(messages[1]!).toEqual({ role: "user", content: JSON.stringify({ candidateProfile: syntheticProfile, jobPosting: syntheticJob }) });
  });

  it("maps a valid draft through the shared contracts and records provider and model", async () => {
    stubFetch(() => completion(assessmentDraft));
    const result = await analyzer().assess(syntheticProfile, syntheticJob);
    expect(result).toMatchObject({ verdict: "REALISTIC", promptVersion: PROMPT_VERSION, modelVersion: "openrouter/synthetic/free-model@SyntheticUpstream" });
    expect(result.screeningContext).toMatchObject({ version: "1", seniorityFit: { value: "aligned" } });
    expect(result.screeningContext?.careerStoryRisk).not.toHaveProperty("clarificationQuestion");
    stubFetch(() => completion(assessmentDraft, { provider: undefined }));
    expect((await analyzer().assess(syntheticProfile, syntheticJob)).modelVersion).toBe("openrouter/synthetic/free-model@unknown");
  });

  it("extracts profile and job with the same instructions and mapping as the OpenAI adapter", async () => {
    stubFetch(() => completion(profileDraft));
    const { profile, warnings } = await analyzer().extractProfile("Synthetic resume text for the OpenRouter adapter test.", "profile_synthetic");
    expect(profile).toMatchObject({ id: "profile_synthetic", headline: "Frontend Lead", roles: [{ company: "Example Company" }] });
    expect(profile.roles[0]).not.toHaveProperty("start");
    expect(warnings).toEqual(["synthetic"]);
    expect((requests[0]!.body.messages as Array<{ content: string }>)[0]!.content).toContain("Extract only facts explicitly present in the resume.");
    expect((requests[0]!.body.response_format as { json_schema: { name: string } }).json_schema.name).toBe("candidate_profile");
    stubFetch(() => completion(jobDraft));
    const { job } = await analyzer().extractJob("Synthetic job description.");
    expect(job.required[0]!.id).toBe(`${job.id}_required_1`);
    expect(job).not.toHaveProperty("location");
  });

  it.each([
    ["refusal", () => completion("", {}, { message: { role: "assistant", content: null, refusal: "SECRET-REFUSAL" } }), OPENROUTER_ERRORS.refused],
    ["truncation", () => completion(JSON.stringify(assessmentDraft).slice(0, 40), {}, { finish_reason: "length" }), OPENROUTER_ERRORS.truncated],
    ["upstream error finish", () => completion("", {}, { finish_reason: "error", message: { role: "assistant", content: null } }), OPENROUTER_ERRORS.finishError],
    ["non-JSON content", () => completion("SECRET-PROSE not json"), OPENROUTER_ERRORS.invalidJson],
    ["schema mismatch", () => completion({ verdict: "MAYBE", SECRET: "SECRET-FIELD" }), OPENROUTER_ERRORS.schemaMismatch],
    ["empty content", () => completion(""), OPENROUTER_ERRORS.noContent],
    ["no choices", () => completion("", { choices: [] }), OPENROUTER_ERRORS.noContent],
  ])("fails closed on %s with a fixed message that never echoes the content", async (_name, reply, message) => {
    stubFetch(reply);
    let caught = "";
    try { await analyzer().assess(syntheticProfile, syntheticJob); } catch (error) { caught = (error as Error).message; }
    expect(caught).toBe(message);
    expect(caught).not.toContain("SECRET");
  });

  it("reports chat usage counters through the telemetry hook and disables SDK retries for batch calls", async () => {
    const events: AnalyzerResponseEvent[] = [];
    stubFetch(() => completion(assessmentDraft));
    await analyzer({ onResponse: (event) => events.push(event) }).assess(syntheticProfile, syntheticJob);
    expect(events).toEqual([{ operation: "assess", requestedModel: "synthetic/free-model", durationMs: expect.any(Number), outcome: "ok",
      responseId: "gen-synthetic", responseModel: "synthetic/free-model", requestId: "req_synthetic", upstreamProvider: "SyntheticUpstream", responseStatus: "stop",
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19, cachedInputTokens: 3, reasoningTokens: 2 } }]);
    stubFetch(() => new Response('{"error":{"message":"synthetic 500"}}', { status: 500, headers: { "content-type": "application/json", "retry-after-ms": "1" } }));
    await expect(analyzer().assess(syntheticProfile, syntheticJob, new AbortController().signal)).rejects.toThrow();
    expect(requests).toHaveLength(1); // signal present: maxRetries 0 per call
    stubFetch(() => new Response('{"error":{"message":"synthetic 500"}}', { status: 500, headers: { "content-type": "application/json", "retry-after-ms": "1" } }));
    await expect(analyzer({ transport: { maxRetries: 0, logLevel: "off" } }).extractProfile("Synthetic resume text.")).rejects.toThrow();
    expect(requests).toHaveLength(1); // harness transport: no retries even without a signal
  });

  it("replaces SDK HTTP errors with a fixed message that keeps class, status, code and request id, and lets cancellation through", async () => {
    stubFetch(() => new Response('{"error":{"message":"SECRET-ERROR-BODY echoing the resume","code":"bad_request"}}', { status: 400, headers: { "content-type": "application/json", "x-request-id": "req_failed" } }));
    const events: AnalyzerResponseEvent[] = [];
    let caught: unknown;
    try { await analyzer({ onResponse: (event) => events.push(event) }).extractProfile("SECRET resume text"); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ name: "BadRequestError", status: 400, code: "bad_request", requestID: "req_failed", message: "OpenRouter request failed (HTTP 400). Check the key, model and network; the provider's message is not shown." });
    expect(String((caught as Error).message)).not.toContain("SECRET");
    expect(events[0]).toMatchObject({ outcome: "error", error: { name: "BadRequestError", status: 400, code: "bad_request", requestId: "req_failed" } });
    const controller = new AbortController(); controller.abort();
    stubFetch(() => completion(assessmentDraft));
    let aborted: unknown;
    try { await analyzer().assess(syntheticProfile, syntheticJob, controller.signal); } catch (error) { aborted = error; }
    expect((aborted as Error).constructor.name).toBe("APIUserAbortError");
    expect(requests).toHaveLength(0);
  });

  it("records the upstream provider as unknown when the response omits it", async () => {
    const events: AnalyzerResponseEvent[] = [];
    stubFetch(() => completion(assessmentDraft, { provider: undefined }));
    await analyzer({ onResponse: (event) => events.push(event) }).assess(syntheticProfile, syntheticJob);
    expect(events[0]!.upstreamProvider).toBe("unknown");
  });

  it("sends reasoning.effort only when the opt-in knob is set, and validates its value", async () => {
    stubFetch(() => completion(assessmentDraft));
    await analyzer().assess(syntheticProfile, syntheticJob);
    expect(requests[0]!.body).not.toHaveProperty("reasoning");
    stubFetch(() => completion(assessmentDraft));
    await analyzer({ reasoningEffort: "low" }).assess(syntheticProfile, syntheticJob);
    expect(requests[0]!.body.reasoning).toEqual({ effort: "low" });
    expect(requests[0]!.body.provider).toEqual({ require_parameters: true });
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "lots");
    expect(() => analyzer()).toThrow(OPENROUTER_ERRORS.invalidReasoning);
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "minimal");
    stubFetch(() => completion(assessmentDraft));
    await analyzer().assess(syntheticProfile, syntheticJob);
    expect(requests[0]!.body.reasoning).toEqual({ effort: "minimal" });
  });

  it("refuses to start without a key or a model and never reads OPENAI variables", () => {
    vi.stubEnv("OPENROUTER_API_KEY", ""); vi.stubEnv("OPENROUTER_MODEL", "");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai"); vi.stubEnv("OPENAI_MODEL", "gpt-synthetic");
    expect(() => new OpenRouterCareerAnalyzer()).toThrow(OPENROUTER_ERRORS.missingKey);
    expect(() => new OpenRouterCareerAnalyzer({ apiKey: key })).toThrow(OPENROUTER_ERRORS.missingModel);
    vi.stubEnv("OPENROUTER_API_KEY", key); vi.stubEnv("OPENROUTER_MODEL", "synthetic/free-model");
    expect(() => new OpenRouterCareerAnalyzer()).not.toThrow();
  });
});
