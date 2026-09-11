import type { JobRecommendations, RecommendedJob } from "@career-radar/shared";
import { ScreeningContextSection } from "./screening";

function SourceLink({ href, children }: { href: string; children: string }) {
  // Source URLs are untrusted even when the host supplied a schema-valid tool result.
  let safe = false;
  try {
    const url = new URL(href);
    safe = url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["job-boards.greenhouse.io", "boards-api.greenhouse.io"].includes(url.hostname);
  } catch { /* Display text only for malformed URLs. */ }
  return safe ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
}

function JobRow({ item }: { item: RecommendedJob }) {
  const { candidate, assessment } = item;
  return <section className="recommended-job" aria-label={candidate.title}>
    <h3>{candidate.title}</h3>
    <p className="message">Board: {candidate.boardToken}{candidate.location ? ` · ${candidate.location}` : ""}</p>
    <div className="meta">
      <span className="pill" data-verdict={assessment.verdict}>{assessment.verdict}</span>
      <span className="pill secondary">{assessment.confidence} confidence</span>
      <span className="pill secondary">{assessment.resumeContortion} contortion</span>
    </div>
    <dl className="comparison">
      <div><dt>Best evidence</dt><dd>{assessment.strongestMatches[0]?.evidence ?? "No verified matching evidence."}</dd></div>
      <div><dt>Biggest gap</dt><dd>{assessment.hardBlockers[0]?.reason ?? assessment.gaps[0]?.reason ?? "No gap identified; not a guarantee of fit."}</dd></div>
    </dl>
    <p className="message">{assessment.recommendation}</p>
    {assessment.hardBlockers.length > 0 && <p className="message"><strong>Hard blockers:</strong> {assessment.hardBlockers.map((gap) => gap.requirement).join("; ")}</p>}
    <ScreeningContextSection context={assessment.screeningContext} />
    <details>
      <summary>Evidence and decision details</summary>
      {assessment.strongestMatches.map((match, index) => <p className="message" key={index}><strong>{match.requirement}</strong><br />{match.evidence}</p>)}
      {assessment.gaps.map((gap, index) => <p className="message" key={index}><strong>{gap.requirement}</strong><br />{gap.reason}</p>)}
      {assessment.missingInformation.length > 0 && <p className="message">Missing information: {assessment.missingInformation.join("; ")}</p>}
      <p className="message">Model: {assessment.modelVersion} · Prompt: {assessment.promptVersion}</p>
      <p className="message">To save this decision, ask ChatGPT to save assessment <code>{item.assessmentId}</code>. Nothing has been sent to the employer.</p>
    </details>
    <p className="source-line"><SourceLink href={candidate.sourceUrl}>View source posting</SourceLink><br />
      Provider updated: {candidate.updatedAt ?? "unknown"}<br />Retrieved: {candidate.retrievedAt}</p>
  </section>;
}

export function RecommendationsCard({ result }: { result: JobRecommendations }) {
  const assessed = result.available.realistic + result.available.stretch + result.available.pass;
  return <article className="card recommendations" aria-label="Career Radar job recommendations">
    <p className="eyebrow">Career Radar · Selected jobs</p>
    <h1>Worth applying to?</h1>
    <p className="message">{assessed} assessed · {result.failures.length} failed or not attempted</p>
    <p className="source-line">{result.provider}<br />Retrieved: {result.retrievedAt}<br />Assessed: {result.assessedAt}</p>
    <p className="recommendation">Fit labels are not hiring probabilities. These are a small selection from one board, not a market-wide ranking. Recheck availability before applying.</p>

    {([
      ["REALISTIC", result.realistic, result.requested.realistic, result.shortfall.realistic],
      ["STRETCH", result.stretch, result.requested.stretch, result.shortfall.stretch],
    ] as const).map(([label, items, requested, shortfall]) => <section key={label} aria-label={`${label} recommendations`}>
      <h2 className="group-heading">{label} <span>{items.length} assessed · target {requested}</span></h2>
      {shortfall > 0 && <p className="message">{shortfall} below target. No verdict was changed to fill this group.</p>}
      {items.length === 0 && <p className="message">No assessed roles in this group. Check other groups and analysis failures.</p>}
      {items.map((item) => <JobRow key={item.candidate.candidateId} item={item} />)}
    </section>)}

    {result.pass.length > 0 && <section aria-label="PASS explanations"><h2 className="group-heading">PASS <span>Why to skip</span></h2>
      {result.pass.map((item) => <JobRow key={item.candidate.candidateId} item={item} />)}</section>}
    {result.available.pass > result.pass.length && <p className="message">{result.available.pass} PASS results; explanations were not requested.</p>}
    {result.failures.length > 0 && <section className="blockers" aria-label="Analysis failures">
      <h2>Analysis incomplete — not a PASS verdict</h2>
      <ul>{result.failures.map((failure) => <li key={failure.candidateId}><span><strong>{failure.candidateId}</strong><br />{failure.message}</span></li>)}</ul>
    </section>}
    <details><summary>Search scope and limitations</summary><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>
  </article>;
}
