// Exact-match grounding must survive the model adding a trailing period or wrapping quotes.
// Shared by the M1 policy, the B1/M5-B validators, claim ids and the evaluation harness so every
// comparison of evidence text uses exactly one rule. Kept in its own module to avoid import cycles.
export const normalizeEvidence = (value: string) =>
  value.trim().toLocaleLowerCase().replaceAll(/\s+/g, " ").replace(/^["'“‘]+|["'”’.,;:!?]+$/g, "");
