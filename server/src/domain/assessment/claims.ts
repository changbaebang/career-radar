import { createHash } from "node:crypto";
import type { EvidenceMatch, FitAssessment, Gap } from "@career-radar/shared";
import { normalizeEvidence } from "./normalize.js";

// M5-B claim identity. A citation names the claim it supports by `claimId`, so the id must survive
// what the M1 policy does to claims: a gap promoted to a hard blocker keeps its id (requirement
// claims are keyed by requirement, not by array), and two matches on the same requirement with
// different evidence are different claims (match ids hash a serialized tuple, never a string
// concatenation, so no field can run into its neighbour).
export function matchClaimId(match: Pick<EvidenceMatch, "requirementId" | "requirement" | "evidence">): string {
  const tuple = ["match", match.requirementId ?? null, normalizeEvidence(match.requirement), normalizeEvidence(match.evidence)];
  return createHash("sha256").update(JSON.stringify(tuple)).digest("hex");
}

export function requirementClaimId(gap: Pick<Gap, "requirementId" | "requirement">): string {
  return gap.requirementId !== undefined ? `req:${gap.requirementId}` : `text:${normalizeEvidence(gap.requirement)}`;
}

// Every claim id a fit result currently carries: matches, gaps and hard blockers.
export function claimIds(assessment: Pick<FitAssessment, "strongestMatches" | "gaps" | "hardBlockers">): Set<string> {
  return new Set([
    ...assessment.strongestMatches.map(matchClaimId),
    ...assessment.gaps.map(requirementClaimId),
    ...assessment.hardBlockers.map(requirementClaimId),
  ]);
}
