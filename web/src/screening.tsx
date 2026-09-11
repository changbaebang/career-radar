import type { ScreeningContextV1 } from "@career-radar/shared";

const label = (value: string) => value.replaceAll("_", " ");

// Screening context is separate from fit evidence and interview risks: it never changes the verdict,
// and "uncertain" means references were missing or unverified, not that the risk is low.
export function ScreeningContextSection({ context }: { context?: ScreeningContextV1 }) {
  if (!context) {
    return (
      <section className="screening" aria-label="Screening context">
        <h2>Screening context</h2>
        <p className="message">Not evaluated for this assessment. Absence is not a low-risk signal.</p>
      </section>
    );
  }
  const { seniorityFit, careerStoryRisk, screeningRisks, unknowns } = context;
  const references = [...seniorityFit.evidence, ...careerStoryRisk.evidence, ...screeningRisks.flatMap((risk) => risk.evidence)];
  return (
    <section className="screening" aria-label="Screening context">
      <h2>Screening context</h2>
      <div className="meta">
        <span className="pill secondary" data-uncertain={seniorityFit.value === "uncertain"}>Role scope: {label(seniorityFit.value)} · {seniorityFit.confidence}</span>
        <span className="pill secondary" data-uncertain={careerStoryRisk.value === "uncertain"}>Career story: {label(careerStoryRisk.value)} · {careerStoryRisk.confidence}</span>
      </div>
      <p className="message">{seniorityFit.explanation}</p>
      <p className="message">
        {careerStoryRisk.explanation}
        {careerStoryRisk.clarificationQuestion && <> <strong>To clarify:</strong> {careerStoryRisk.clarificationQuestion}</>}
      </p>
      {screeningRisks.length > 0 && (
        <ul>
          {screeningRisks.map((risk, index) => (
            <li key={index}><span><strong>{label(risk.type)} · {risk.severity} · {risk.confidence} confidence</strong><br />{risk.explanation}</span></li>
          ))}
        </ul>
      )}
      <details>
        <summary>{references.length} cited references · {unknowns.length} unknowns</summary>
        {references.map((reference, index) => (
          <p className="message" key={index}><strong>{reference.source} · {reference.path}</strong><br />{reference.quote}</p>
        ))}
        {unknowns.length > 0 && <ul>{unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul>}
      </details>
      <p className="message">Screening context never changes the verdict or ranking. Uncertain means references were missing or unverified, not low risk. Interview risks are listed separately.</p>
    </section>
  );
}
