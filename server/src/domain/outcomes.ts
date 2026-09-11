import { z } from "zod";
import {
  ApplicationStatusSchema, OutcomeStageSchema, VerdictSchema,
  type Application, type ApplicationUpdateInput, type OutcomeStage, type PipelineInput, type PipelineSummary,
} from "@career-radar/shared";

// Only explicit vocabulary, not fuzzy matching or model inference. Historical v1 text stays unknown.
const aliases: Record<string, OutcomeStage> = {
  "resume screen": "resume_screen", "recruiter screen": "recruiter_screen",
  "coding test": "coding_test", technical: "technical_interview", "technical interview": "technical_interview",
  "hiring manager interview": "hiring_manager_interview", "final interview": "final_interview", offer: "offer",
};
function normalizeStage(text: string): OutcomeStage {
  const token = text.trim().toLowerCase();
  const parsed = OutcomeStageSchema.safeParse(token);
  return parsed.success ? parsed.data : Object.hasOwn(aliases, token) ? aliases[token]! : "unknown";
}

// Legacy rows lack the M4-C fields. Reading them through these defaults lets callers compare a
// stored record with an updated one without the backfilled keys counting as a change.
export function withOutcomeDefaults(app: Application): Application {
  return { ...app, normalizedOutcomeStage: app.normalizedOutcomeStage ?? "unknown",
    outcomeProvenance: app.outcomeProvenance ?? "legacy_mapping", outcomeRevision: app.outcomeRevision ?? 0 };
}

export function updateOutcome(previous: Application, input: ApplicationUpdateInput): Application {
  const clearing = input.normalizedOutcomeStage === null || input.stage?.trim() === "";
  const inferred = input.stage === undefined ? undefined : normalizeStage(input.stage);
  if (clearing && input.normalizedOutcomeStage && input.normalizedOutcomeStage !== "unknown") {
    throw new Error("A cleared stage cannot have a known normalized stage.");
  }
  if (input.normalizedOutcomeStage === null && input.stage?.trim()) throw new Error("Clear both stage fields together.");
  if (inferred && inferred !== "unknown" && input.normalizedOutcomeStage && input.normalizedOutcomeStage !== inferred) {
    throw new Error("Stage text and normalized stage conflict. Ask the user to clarify.");
  }
  const stage = clearing ? "unknown" : input.normalizedOutcomeStage ?? inferred ?? previous.normalizedOutcomeStage ?? "unknown";
  if ((["saved", "discovered"].includes(input.status) && stage !== "unknown") ||
      (input.status === "offer" && stage !== "unknown" && stage !== "offer") ||
      (input.status === "interview" && ["resume_screen", "offer"].includes(stage))) {
    throw new Error("Status and stage conflict. Explicitly correct or clear the stage.");
  }
  const changedFact = previous.status !== input.status || stage !== (previous.normalizedOutcomeStage ?? "unknown");
  const date = input.occurredAt === null ? undefined : input.occurredAt ?? (changedFact ? undefined : previous.occurredAt);
  const changedDate = date !== previous.occurredAt;
  const nextText = input.stage ?? (input.normalizedOutcomeStage !== undefined ? "" : previous.outcomeStage);
  const suppliedOutcome = changedFact || changedDate || nextText !== previous.outcomeStage ||
    (input.historyMode === "replace" && previous.outcomeHistoryMode === "append") ||
    (previous.outcomeProvenance !== "user_report" && (input.stage !== undefined || input.normalizedOutcomeStage !== undefined));
  // Omitted historyMode means a new progression. Replacement is destructive for aggregation and
  // must be requested explicitly; clearing a stage is an explicit retraction and always replaces.
  const replace = input.historyMode === "replace" || clearing;
  return {
    ...previous, status: input.status,
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.stage !== undefined ? { outcomeStage: input.stage } : {}),
    // Replacing the normalized stage alone must not leave contradictory old free text.
    ...(input.normalizedOutcomeStage !== undefined && input.stage === undefined ? { outcomeStage: "" } : {}),
    normalizedOutcomeStage: stage, occurredAt: date,
    outcomeProvenance: suppliedOutcome ? "user_report" : previous.outcomeProvenance ?? "legacy_mapping",
    outcomeRevision: (previous.outcomeRevision ?? 0) + (replace && suppliedOutcome ? 1 : 0),
    outcomeHistoryMode: suppliedOutcome ? (replace ? "replace" : "append") : previous.outcomeHistoryMode,
  };
}

const EventV2Schema = z.object({
  eventVersion: z.literal(2), applicationId: z.string(), revision: z.number().int().nonnegative(),
  status: ApplicationStatusSchema, normalizedOutcomeStage: OutcomeStageSchema,
  provenance: z.enum(["user_report", "legacy_mapping"]),
  recordedAt: z.string().datetime(), occurredAt: z.string().datetime().optional(),
}).strict();
export type OutcomeEvent = z.infer<typeof EventV2Schema>;
export function outcomeEvent(app: Application): OutcomeEvent {
  return EventV2Schema.parse({ eventVersion: 2, applicationId: app.id, revision: app.outcomeRevision ?? 0,
    status: app.status, normalizedOutcomeStage: app.normalizedOutcomeStage ?? "unknown",
    provenance: app.outcomeProvenance ?? "legacy_mapping", recordedAt: app.updatedAt, occurredAt: app.occurredAt });
}
export function readOutcomeEvent(value: unknown): OutcomeEvent {
  const version = z.object({ eventVersion: z.number().optional() }).parse(value).eventVersion;
  if (version !== undefined) return EventV2Schema.parse(value); // Unknown versions fail closed.
  const legacy = z.object({ id: z.string(), status: ApplicationStatusSchema, updatedAt: z.string().datetime() }).parse(value);
  return { eventVersion: 2, applicationId: legacy.id, revision: 0, status: legacy.status,
    normalizedOutcomeStage: "unknown", provenance: "legacy_mapping", recordedAt: legacy.updatedAt };
}

export function summarizeStages(apps: Application[], events: OutcomeEvent[], excluded: number, window: PipelineInput): NonNullable<PipelineSummary["stageSummary"]> {
  const active = new Map(apps.map((app) => [app.id, { app, facts: [] as OutcomeEvent[] }]));
  for (const event of events) {
    const record = active.get(event.applicationId);
    if (record && event.revision === (record.app.outcomeRevision ?? 0)) record.facts.push(event);
  }
  const progressed = new Set<string>();
  const reach = new Map(OutcomeStageSchema.options.filter((s) => s !== "unknown").map((s) => [s, new Set<string>()]));
  for (const { app, facts } of active.values()) {
    // v1 snapshots did not distinguish corrections from progression. Never rebuild a timeline
    // from them; only the latest legacy snapshot survives until explicit user reports exist.
    const reported = facts.filter((fact) => fact.provenance === "user_report");
    const usable = reported.length ? reported : facts.slice(-1);
    for (const fact of usable) {
      if (fact.normalizedOutcomeStage !== "unknown") reach.get(fact.normalizedOutcomeStage)?.add(app.id);
      if (fact.status === "interview" || fact.status === "offer" ||
          !["unknown", "resume_screen"].includes(fact.normalizedOutcomeStage)) progressed.add(app.id);
    }
  }
  const stageOf = (app: Application) => app.normalizedOutcomeStage ?? "unknown";
  const known = apps.filter((a) => stageOf(a) !== "unknown").length;
  const dated = apps.filter((a) => a.occurredAt !== undefined).length;
  return { version: 1, windowBasis: "last_updated", ...window, total: apps.length, excludedByWindow: excluded,
    pending: apps.filter((a) => ["discovered", "saved", "applied", "interview"].includes(a.status)).length,
    withdrawn: apps.filter((a) => a.status === "withdrawn").length,
    knownStage: known, unknownStage: apps.length - known,
    knownOccurrenceDate: dated, unknownOccurrenceDate: apps.length - dated,
    resumeScreenRejected: apps.filter((a) => a.status === "rejected" && stageOf(a) === "resume_screen").length,
    unknownStageRejected: apps.filter((a) => a.status === "rejected" && stageOf(a) === "unknown").length,
    recordedProgression: progressed.size,
    stageReach: [...reach].map(([stage, ids]) => ({ stage, count: ids.size })),
    verdictStages: VerdictSchema.options.flatMap((verdict) => OutcomeStageSchema.options.map((stage) => ({
      verdict, stage, count: apps.filter((a) => a.verdictAtDecision === verdict && stageOf(a) === stage).length,
    }))),
    roleProgression: [...new Set(apps.map((a) => a.roleFamily))].sort().map((roleFamily) => {
      const group = apps.filter((a) => a.roleFamily === roleFamily);
      return { roleFamily, total: group.length, progressed: group.filter((a) => progressed.has(a.id)).length,
        unknownStage: group.filter((a) => stageOf(a) === "unknown").length };
    }),
  };
}
