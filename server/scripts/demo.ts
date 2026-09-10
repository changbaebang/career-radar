import { readFileSync } from "node:fs";
import type { FitAssessment, JobAssessmentResult } from "@career-radar/shared";
import { createHttpApp } from "../src/httpApp.js";
import { CareerStore } from "../src/domain/store.js";
import { syntheticJob, syntheticProfile } from "../tests/fixtures.js";

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

const app = createHttpApp({ store, createAnalyzer: () => { throw new Error("Offline synthetic demo. AI calls are disabled. Use pnpm dev for real analysis."); } });
const bundle = readFileSync(new URL("../../web/dist/widget.js", import.meta.url), "utf8");
app.get("/", (req, res) => {
  const selected = Number(req.query.example);
  const data = req.query.view === "assessment" ? examples[Number.isInteger(selected) && selected >= 0 && selected < examples.length ? selected : 0] : store.pipelineSummary();
  const serialized = JSON.stringify(data).replace(/</g, "\\u003c");
  res.type("html").send(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Career Radar · 합성 데이터 데모</title>
    <body style="max-width:760px;margin:32px auto;padding:0 18px">
      <div style="font:14px/1.6 system-ui;margin-bottom:18px"><strong>Career Radar · 초기 프로토타입</strong><br>
      합성 데이터 데모입니다. 실제 이력서·공고·AI 판정이 아니며 API 호출과 비용이 없습니다.<br>
      <a href="/">지원 현황</a> · <a href="/?view=assessment&example=0">REALISTIC</a> · <a href="/?view=assessment&example=1">STRETCH</a> · <a href="/?view=assessment&example=2">PASS</a>
      <form method="post" action="/demo/interview"><button style="margin-top:10px;padding:8px 12px">첫 번째 지원을 면접으로 변경</button></form></div>
      <div id="root"></div><script>window.openai={toolOutput:${serialized}};</script><script>${bundle}</script></body></html>`);
});
app.post("/demo/interview", (_req, res) => {
  store.updateApplication({ applicationId: firstApplicationId, status: "interview", stage: "technical" });
  res.redirect(303, "/");
});
const server = app.listen(8001, "127.0.0.1", () => console.log("Synthetic demo (no API calls): http://127.0.0.1:8001"));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close(() => store.close()));
