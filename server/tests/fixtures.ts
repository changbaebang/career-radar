import type { CandidateProfile, JobPosting } from "@career-radar/shared";

// Synthetic records for server tests. Kept here so server tests do not depend on the eval fixtures.
export const syntheticProfile: CandidateProfile = {
  id: "profile_synthetic", headline: "Frontend Lead",
  roles: [{ company: "Example Company", title: "Frontend Lead", responsibilities: ["Led a React platform team"], evidence: ["Led a React platform team"] }],
  skills: ["React"], domains: [], leadership: [], customerFacing: [], aiEvidence: [], cloudEvidence: [],
  sourceHash: "a".repeat(64),
};

export const syntheticJob: JobPosting = {
  id: "job_synthetic", company: "Example Employer", title: "Frontend Engineering Lead",
  description: "Lead a React team.", required: [{ id: "req_1", text: "Lead a React team", type: "leadership", importance: "core" }],
  preferred: [], responsibilities: [], roleFamily: "Frontend Engineering Lead", domains: [], technologies: [],
};
