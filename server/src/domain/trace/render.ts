import type { RunTrace, StageRecord } from "./run-trace.js";
import type { TraceSummary } from "./store.js";

// Text views of a run trace for `pnpm diagnose` and the usage-check page. Nothing here reads
// inputs: every column is a timing, count, id, hash or fixed class that the trace already holds.
const pad = (value: string | number, width: number) => String(value).padEnd(width);

function stageLine(record: StageRecord): string {
  const what = record.operation ?? record.stage;
  const detail = record.retrieval ? `queries ${record.retrieval.queries}, chunks ${record.retrieval.chunks}, missing terms ${record.retrieval.missingTerms}`
    : record.validation ? `${record.validation.draftVerdict}/${record.validation.draftConfidence} → ${record.validation.finalVerdict}/${record.validation.finalConfidence}; citations ${record.validation.citationsValid}/${record.validation.citationsSupplied}; ungrounded removed ${record.validation.diagnostics.ungroundedMatchesRemoved}, invalid ${record.validation.diagnostics.citationsInvalid}, orphan ${record.validation.diagnostics.citationsOrphaned}, rekeyed ${record.validation.diagnostics.citationsRekeyed}${record.validation.diagnostics.screeningContextDiscarded ? ", context discarded" : ""}`
    : record.operation ? [record.responseModel, record.upstreamProvider, record.usage ? `tokens in ${record.usage.inputTokens} out ${record.usage.outputTokens}${record.usage.reasoningTokens !== undefined ? ` reasoning ${record.usage.reasoningTokens}` : ""}` : undefined, record.incompleteReason ? `incomplete ${record.incompleteReason}` : undefined].filter(Boolean).join(", ")
    : "";
  const outcome = record.outcome === "ok" ? "ok" : `${record.outcome}${record.failureClass ? ` (${record.failureClass}${record.errorName ? `: ${record.errorName}` : ""})` : ""}`;
  return `${pad(record.item === undefined ? "" : `#${record.item}`, 4)}${pad(record.stage, 9)}${pad(what, 15)}${pad(`+${record.startedMs} ms`, 12)}${pad(`${record.durationMs} ms`, 11)}${pad(outcome, 34)}${detail}`;
}

export function renderTrace(trace: RunTrace): string {
  const c = trace.counters;
  return [
    `run ${trace.runId}  tool ${trace.tool}  started ${trace.startedAt}  total ${trace.durationMs} ms  outcome ${trace.outcome}${trace.failureClass ? ` (${trace.failureClass})` : ""}`,
    `model calls ${c.modelCalls}; failures: schema ${c.schemaFailures}, refusal ${c.refusals}, truncation ${c.truncations}, timeout ${c.timeouts}, provider ${c.providerErrors}, other ${c.otherFailures}; citations invalid ${c.invalidCitations}, orphan ${c.orphanCitations}, rekeyed ${c.rekeyedCitations}; ungrounded matches removed ${c.ungroundedMatchesRemoved}; context discarded ${c.screeningContextDiscarded}`,
    "",
    `${pad("item", 4)}${pad("stage", 9)}${pad("operation", 15)}${pad("start", 12)}${pad("duration", 11)}${pad("outcome", 34)}detail`,
    ...trace.stages.map(stageLine),
  ].join("\n");
}

export function renderTraceList(items: TraceSummary[], directory: string): string {
  if (items.length === 0) return `No run traces under ${directory}.`;
  return [`${items.length} run trace(s) under ${directory} (newest first)`, ...items.map((item) => `${item.startedAt}  ${pad(item.tool, 14)}${pad(item.outcome, 9)}${pad(`${item.durationMs} ms`, 11)}calls ${pad(item.modelCalls, 4)}${item.runId}`)].join("\n");
}
