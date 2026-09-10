import { readFileSync } from "node:fs";
import { JobRecommendationsSchema, type FitAssessment, type JobAssessmentResult } from "@career-radar/shared";
import { createHttpApp } from "../src/httpApp.js";
import { CareerStore } from "../src/domain/store.js";
import { syntheticJob, syntheticProfile } from "../tests/fixtures.js";
import { JobDiscovery, groupRecommendations } from "../src/domain/jobs/search.js";

// Explicit synthetic demo. No env file, API client, raw resume, or persistent user DB is loaded.
const store = new CareerStore();
store.upsertProfile(syntheticProfile);
const assessment: FitAssessment = {
  verdict: "REALISTIC", confidence: "medium", resumeContortion: "low",
  strongestMatches: [{ requirementId: "req_1", requirement: "Lead a React team", evidence: "Led a React platform team", source: { company: "Example Company", role: "Frontend Lead" }, strength: "direct" }],
  gaps: [], hardBlockers: [], interviewRisks: [], missingInformation: [],
  recommendation: "Synthetic illustration: the stated React team leadership evidence supports this role. REALISTIC is not a hiring probability.",
  modelVersion: "synthetic-demo-no-model", promptVersion: "synthetic-demo-v1",
};
const examples: JobAssessmentResult[] = [];
let firstApplicationId = "";
for (const [index, verdict] of (["REALISTIC", "STRETCH", "PASS"] as const).entries()) {
  const job = { ...syntheticJob, id: `demo_job_${index}`, company: `Example Employer ${index + 1}`, title: `Synthetic role ${index + 1}` };
  const gap = { requirementId: "req_1", requirement: "Synthetic additional role requirement", reason: "No supporting evidence in this synthetic profile.", severity: "material" as const };
  const result: FitAssessment = verdict === "REALISTIC" ? assessment : {
    ...assessment, verdict, strongestMatches: [], gaps: [gap],
    resumeContortion: verdict === "PASS" ? "high" : "medium",
    recommendation: `Synthetic ${verdict} illustration only; not a model-generated assessment of a real person or job.`,
  };
  store.upsertJob(job);
  const assessmentId = store.saveAssessment(syntheticProfile.id, job, result);
  examples.push({ job, assessment: result, assessmentId });
  const saved = store.saveApplication({ assessmentId, status: index === 0 ? "applied" : "saved" });
  if (index === 0) firstApplicationId = saved.id;
}

const retrievedAt = new Date().toISOString();
const hits = examples.map((example, index) => ({ description: example.job.description, candidate: {
  candidateId: `greenhouse_synthetic_${index + 1}`, title: example.job.title, boardToken: "synthetic",
  location: "Synthetic location", sourceUrl: `https://job-boards.greenhouse.io/synthetic/jobs/${index + 1}`,
  retrievedAt, ...(index === 0 ? { updatedAt: "2026-09-01T00:00:00.000Z" } : {}),
} }));
const discovery = new JobDiscovery({ search: async () => ({
  provider: "Synthetic provider — no network", sourceUrl: "https://boards-api.greenhouse.io/v1/boards/synthetic/jobs",
  retrievedAt, matchedCount: hits.length, hits, warnings: ["Synthetic public-demo illustrations only; source links are placeholders, not real vacancies."],
}) });
const search = await discovery.search({ boardToken: "synthetic", limit: 5 });
const recommendations = JobRecommendationsSchema.parse({
  kind: "job_recommendations", searchId: search.searchId, provider: search.provider, sourceUrl: search.sourceUrl,
  retrievedAt, assessedAt: retrievedAt, requested: { realistic: 2, stretch: 1 },
  ...groupRecommendations(examples.map((example, index) => ({ candidate: hits[index]!.candidate,
    jobId: example.job.id, assessmentId: example.assessmentId!, assessment: example.assessment,
  })), 2, 1, true), failures: [], warnings: search.warnings,
});
const failedRecommendations = JobRecommendationsSchema.parse({ ...recommendations,
  ...groupRecommendations([], 2, 1, true),
  failures: [{ candidateId: hits[0]!.candidate.candidateId, message: "Synthetic API-credit failure illustration. This is not a PASS verdict; no model was called." }],
});
const app = createHttpApp({ store, discovery, createAnalyzer: () => { throw new Error("Offline synthetic demo. AI calls are disabled. Use pnpm dev for real analysis."); } });
const bundle = readFileSync(new URL("../../web/dist/widget.js", import.meta.url), "utf8");
app.get("/", (req, res) => {
  const selected = Number(req.query.example);
  const data = req.query.view === "recommendations" ? recommendations
    : req.query.view === "failure" ? failedRecommendations
    : req.query.view === "assessment" ? examples[Number.isInteger(selected) && selected >= 0 && selected < examples.length ? selected : 0] : store.pipelineSummary();
  const serialized = JSON.stringify(data).replace(/</g, "\\u003c");
  res.type("html").send(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Career Radar · 합성 데이터 데모</title>
    <body style="max-width:760px;margin:32px auto;padding:0 18px">
      <div style="font:14px/1.6 system-ui;margin-bottom:18px"><strong>Career Radar · 초기 프로토타입</strong><br>
      합성 데이터 데모입니다. 실제 이력서·공고·AI 판정이 아니며 API 호출과 비용이 없습니다.<br>
      <a href="/">지원 현황</a> · <a href="/?view=assessment&example=0">REALISTIC</a> · <a href="/?view=assessment&example=1">STRETCH</a> · <a href="/?view=assessment&example=2">PASS</a>
      · <a href="/?view=recommendations">추천과 부족한 개수</a> · <a href="/?view=failure">분석 실패 예시</a>
      <form method="post" action="/demo/interview"><button style="margin-top:10px;padding:8px 12px">첫 번째 지원을 면접으로 변경</button></form></div>
      <div id="root"></div><script>window.openai={toolOutput:${serialized}};</script><script>${bundle}</script></body></html>`);
});
app.post("/demo/interview", (_req, res) => {
  store.updateApplication({ applicationId: firstApplicationId, status: "interview", stage: "technical" });
  res.redirect(303, "/");
});
const port = Number(process.env.DEMO_PORT ?? 8001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DEMO_PORT must be between 1 and 65535.");
const server = app.listen(port, "127.0.0.1", () => console.log(`Synthetic demo (no API calls): http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close(() => { discovery.close(); store.close(); }));
