# Human review of a synthetic evaluation case

Copy this template for a deliberate review; do not mark a case accepted merely
because its policy test passes. Keep real resumes, application history and private
identifiers out of public annotations. No outcome import or automatic label update.

- Case ID and contract/input hash:
- Dataset version and code SHA:
- Reviewer attribution (public-safe, supplied by the reviewer):
- Review date/version:
- Status: pending / accepted / needs revision
- Scope: deterministic policy contract / human fit judgment / exploratory
- Provenance: independently authored synthetic case / reviewed synthetic counterpart

## Initial assessment (before looking at outcomes)

- Expected verdict (or explicitly unresolved/allowed set):
- Candidate evidence and relevant JD requirement IDs:
- Mandatory versus preferred distinction:
- Expected blockers and rationale for each ID:
- Required valid evidence and forbidden claims:
- Rationale for the verdict; why plausible alternatives are weaker:
- Normal control / paired variant:
- Unknown facts and limits:

An unresolved/allowed-set fit example is not ready for this exact-label policy runner.
Keep it outside the executable set until the contract is reviewed; do not select a
single label just to make the test runnable.

## Optional later observation

- Separately reported outcome and known stage (or unknown):
- Source/provenance and known/unknown occurrence date:
- Hypothesis, counterexamples and review question:

An outcome can motivate review; rejection/offer never supplies the expected label.

## Decision and next action

- Accept unchanged / revise synthetic contract / remain pending:
- What evidence changed the judgment (not just a different model answer):
- Annotation revision and superseded decision, if any:
- Failing regression and passing normal control to add before any policy change:

Only a recorded human decision can change `humanReview` to `accepted`. This is
an explicit repository review workflow, not an automated learning mechanism.
