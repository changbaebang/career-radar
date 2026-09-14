import { createHash } from "node:crypto";
import { MAX_CLAIM_ID_CHARS, type EvidenceMatch, type FitAssessment, type Gap } from "@career-radar/shared";
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

// Requirement text has no length bound, claim ids do (CitationSchema): a text key that would not
// fit falls back to a hash of the same normalized text, so a long requirement still gets one stable id.
export const TEXT_CLAIM_PREFIX = "text:";
export const TEXT_HASH_CLAIM_PREFIX = "text-sha256:";
export function requirementClaimId(gap: Pick<Gap, "requirementId" | "requirement">): string {
  if (gap.requirementId !== undefined) return `req:${gap.requirementId}`;
  const text = normalizeEvidence(gap.requirement);
  if (TEXT_CLAIM_PREFIX.length + text.length <= MAX_CLAIM_ID_CHARS) return `${TEXT_CLAIM_PREFIX}${text}`;
  return `${TEXT_HASH_CLAIM_PREFIX}${createHash("sha256").update(text).digest("hex")}`;
}

// Every claim id a fit result currently carries: matches, gaps and hard blockers.
export function claimIds(assessment: Pick<FitAssessment, "strongestMatches" | "gaps" | "hardBlockers">): Set<string> {
  return new Set([
    ...assessment.strongestMatches.map(matchClaimId),
    ...assessment.gaps.map(requirementClaimId),
    ...assessment.hardBlockers.map(requirementClaimId),
  ]);
}
