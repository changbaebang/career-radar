import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  CareerRadarStatusSchema,
  JobAssessmentResultSchema,
  PipelineSummarySchema,
  type PipelineSummary,
  type CareerRadarStatus,
  type JobAssessmentResult,
} from "@career-radar/shared";

declare global {
  interface Window {
    openai?: { toolOutput?: unknown };
  }
}

const styles = `
  :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 280px; color: #17211b; background: transparent; }
  .card { position: relative; overflow: hidden; padding: 22px; border: 1px solid rgba(24, 82, 54, .18); border-radius: 20px; background: linear-gradient(145deg, #f7fbf8 0%, #eef7f1 100%); box-shadow: 0 16px 40px rgba(21, 72, 48, .10); }
  .card::after { content: ''; position: absolute; width: 180px; height: 180px; right: -80px; top: -90px; border-radius: 50%; background: rgba(48, 164, 101, .12); }
  .eyebrow { position: relative; z-index: 1; margin: 0 0 7px; color: #317653; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  h1 { position: relative; z-index: 1; margin: 0; max-width: 22ch; font-size: 23px; line-height: 1.2; }
  h2 { margin: 20px 0 9px; font-size: 13px; letter-spacing: .02em; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 15px 0 4px; }
  .pill { display: inline-flex; align-items: center; padding: 7px 11px; border-radius: 999px; background: #dff4e7; color: #175b38; font-size: 12px; font-weight: 800; }
  .pill[data-verdict='PASS'] { background: #f9e1df; color: #8d2d28; }
  .pill[data-verdict='STRETCH'] { background: #fff0c9; color: #7a5610; }
  .secondary { background: rgba(255,255,255,.65); color: #405147; border: 1px solid rgba(24,82,54,.12); }
  .message, .recommendation { margin: 10px 0 0; color: #405147; font-size: 13px; line-height: 1.55; }
  .recommendation { padding: 13px 14px; border-radius: 12px; background: rgba(255,255,255,.66); }
  ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
  li { display: grid; grid-template-columns: 16px 1fr; gap: 7px; align-items: start; color: #31483a; font-size: 12px; line-height: 1.45; }
  li::before { content: '•'; color: #2f8c58; font-weight: 900; }
  .blockers { padding: 12px 14px; border-radius: 12px; background: rgba(174, 53, 47, .09); }
  .blockers h2 { margin-top: 0; color: #8d2d28; }
  .loading { padding: 22px; color: #506258; font-size: 14px; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6f3ea; }
    .card { border-color: rgba(137,217,170,.2); background: linear-gradient(145deg, #17211b 0%, #1d3024 100%); }
    .eyebrow { color: #81d6a5; }
    .message, .recommendation, li { color: #c3d6ca; }
    .secondary, .recommendation { background: rgba(255,255,255,.06); color: #c3d6ca; }
  }
`;

type ToolOutput = CareerRadarStatus | JobAssessmentResult | PipelineSummary;

function parseOutput(value: unknown): ToolOutput | null {
  const pipeline = PipelineSummarySchema.safeParse(value);
  if (pipeline.success) return pipeline.data;
  const assessment = JobAssessmentResultSchema.safeParse(value);
  if (assessment.success) return assessment.data;
  const status = CareerRadarStatusSchema.safeParse(value);
  return status.success ? status.data : null;
}

function StatusCard({ status }: { status: CareerRadarStatus }) {
  return (
    <article className="card" aria-label="Career Radar status">
      <p className="eyebrow">{status.milestone}</p>
      <h1>{status.name}</h1>
      <div className="meta"><span className="pill">Ready</span></div>
      <p className="message">{status.message}</p>
      <h2>Available now</h2>
      <ul>{status.capabilities.map((item) => <li key={item}>{item}</li>)}</ul>
    </article>
  );
}

function AssessmentCard({ result }: { result: JobAssessmentResult }) {
  const { job, assessment } = result;
  return (
    <article className="card" aria-label={`Career Radar assessment for ${job.title}`}>
      <p className="eyebrow">{job.company}</p>
      <h1>{job.title}</h1>
      <div className="meta">
        <span className="pill" data-verdict={assessment.verdict}>{assessment.verdict}</span>
        <span className="pill secondary">{assessment.confidence} confidence</span>
        <span className="pill secondary">{assessment.resumeContortion} contortion</span>
      </div>

      <h2>Strongest evidence</h2>
      {assessment.strongestMatches.length === 0 ? (
        <p className="message">No verified matching evidence was found in this profile.</p>
      ) : (
        <ul>
          {assessment.strongestMatches.slice(0, 3).map((match) => (
            <li key={`${match.requirementId ?? match.requirement}-${match.evidence}`}>
              <span><strong>{match.requirement}</strong><br />{match.evidence}</span>
            </li>
          ))}
        </ul>
      )}

      <h2>Critical gaps</h2>
      {assessment.gaps.length === 0 ? (
        <p className="message">No gaps were identified in this assessment.</p>
      ) : (
        <ul>
          {assessment.gaps.slice(0, 3).map((gap) => (
            <li key={`${gap.requirementId ?? gap.requirement}-${gap.reason}`}>
              <span><strong>{gap.requirement}</strong><br />{gap.reason}</span>
            </li>
          ))}
        </ul>
      )}

      {assessment.hardBlockers.length > 0 && (
        <section className="blockers">
          <h2>Hard blockers</h2>
          <ul>{assessment.hardBlockers.map((gap) => <li key={gap.requirementId ?? gap.requirement}>{gap.requirement}</li>)}</ul>
        </section>
      )}

      <h2>Recommendation</h2>
      <p className="recommendation">{assessment.recommendation}</p>
    </article>
  );
}

function App() {
  const [output, setOutput] = useState<ToolOutput | null>(() => parseOutput(window.openai?.toolOutput));

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0" || message.method !== "ui/notifications/tool-result") return;
      const next = parseOutput(message.params?.structuredContent);
      if (next) setOutput(next);
    };
    window.addEventListener("message", onMessage, { passive: true });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!output) return <div className="loading">Waiting for Career Radar…</div>;
  if ("total" in output) return <PipelineCard summary={output} />;
  return "assessment" in output ? <AssessmentCard result={output} /> : <StatusCard status={output} />;
}

function PipelineCard({ summary }: { summary: PipelineSummary }) {
  return (
    <article className="card" aria-label="Career Radar application pipeline">
      <p className="eyebrow">Career Radar · Early prototype</p>
      <h1>Application pipeline</h1>
      <p className="message">{summary.total} recorded applications</p>
      <div className="meta">{summary.byStatus.filter((item) => item.count > 0).map((item) => (
        <span className="pill secondary" key={item.status}>{item.status} · {item.count}</span>
      ))}</div>
      <h2>Recent applications</h2>
      {summary.total === 0 ? <p className="message">No saved applications yet. Assess a job, then ask to save it.</p> : (
        <ul>{summary.applications.slice(0, 10).map((application) => (
          <li key={application.id}><span><strong>{application.company} — {application.title}</strong><br />
            {application.verdictAtDecision} · {application.status}
            {application.outcomeStage ? ` · ${application.outcomeStage}` : ""}
          </span></li>
        ))}</ul>
      )}
      <h2>By role family</h2>
      <ul>{summary.byRoleFamily.map((item) => <li key={item.roleFamily}>{item.roleFamily} · {item.count}</li>)}</ul>
      <p className="recommendation">Recorded outcomes are observations, not hiring probabilities or proof of a skill gap. Small samples need caution.</p>
    </article>
  );
}

const styleElement = document.createElement("style");
styleElement.textContent = styles;
document.head.append(styleElement);
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Career Radar widget root was not found.");
createRoot(rootElement).render(<App />);
