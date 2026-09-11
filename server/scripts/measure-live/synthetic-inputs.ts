import type { CandidateProfile } from "@career-radar/shared";
import type { JobSearchProvider, ProviderSearchResult, SearchHit } from "../../src/infra/search/greenhouse.js";
import { hashSource, stableId } from "../../src/domain/store.js";

// Fully invented inputs. Nothing here describes a real person or a real vacancy.
export const SYNTHETIC_JD_SENTINEL = "SYNTHETIC_JD_SENTINEL";
export const SYNTHETIC_EVIDENCE_SENTINEL = "SYNTHETIC_EVIDENCE_SENTINEL";

// Sized like a real resume so assess() input tokens and latency resemble production use.
export const measurementResumeText = [
  "Synthetic Candidate — Staff Frontend Engineer (invented profile for measurement only)",
  "Example Platform Co., Frontend Platform Lead, 2022–2026.",
  "Led a React platform team of six engineers building a shared design system and a module federation shell.",
  "Owned the frontend performance program: cut median checkout render time from 2.4 s to 1.1 s.",
  "Introduced a TypeScript migration plan adopted by four product teams.",
  "Mentored two engineers into senior roles and ran the frontend hiring loop.",
  "Example Commerce Inc., Senior Frontend Engineer, 2019–2022.",
  "Built the order and payment flows in Next.js with server-side rendering and edge caching.",
  "Designed the client-side feature flag SDK used by twelve teams.",
  "Advised enterprise customers on Azure application incidents during an on-call rotation.",
  "Example Studio, Frontend Engineer, 2016–2019.",
  "Shipped accessible React components audited against WCAG 2.1 AA.",
  "Automated visual regression testing with Playwright in CI.",
  "Example Agency, Web Developer, 2014–2016.",
  "Delivered marketing sites and internal dashboards with JavaScript and Node.js services.",
  "Skills: TypeScript, React, Next.js, Node.js, GraphQL, REST, Playwright, Vite, Webpack, Tailwind CSS,",
  "accessibility, performance profiling, design systems, module federation, CI/CD, Azure App Service,",
  "feature flags, SQL basics, observability, technical writing, mentoring.",
  "Built a local LLM evaluation prototype that compares structured outputs across prompt versions.",
].join("\n");

export const measurementProfile: CandidateProfile = {
  id: "profile_measurement_synthetic",
  headline: "Staff Frontend Engineer (synthetic measurement profile)",
  yearsExperience: 12,
  roles: [
    { company: "Example Platform Co.", title: "Frontend Platform Lead", start: "2022", end: "2026",
      responsibilities: ["Led a React platform team of six engineers building a shared design system and a module federation shell",
        "Owned the frontend performance program"],
      evidence: ["Led a React platform team of six engineers building a shared design system and a module federation shell",
        "Cut median checkout render time from 2.4 s to 1.1 s", "Introduced a TypeScript migration plan adopted by four product teams",
        "Mentored two engineers into senior roles and ran the frontend hiring loop"] },
    { company: "Example Commerce Inc.", title: "Senior Frontend Engineer", start: "2019", end: "2022",
      responsibilities: ["Built the order and payment flows in Next.js with server-side rendering and edge caching"],
      evidence: ["Built the order and payment flows in Next.js with server-side rendering and edge caching",
        "Designed the client-side feature flag SDK used by twelve teams",
        "Advised enterprise customers on Azure application incidents during an on-call rotation"] },
    { company: "Example Studio", title: "Frontend Engineer", start: "2016", end: "2019",
      responsibilities: ["Shipped accessible React components audited against WCAG 2.1 AA"],
      evidence: ["Shipped accessible React components audited against WCAG 2.1 AA", "Automated visual regression testing with Playwright in CI"] },
    { company: "Example Agency", title: "Web Developer", start: "2014", end: "2016",
      responsibilities: ["Delivered marketing sites and internal dashboards with JavaScript and Node.js services"],
      evidence: ["Delivered marketing sites and internal dashboards with JavaScript and Node.js services"] },
  ],
  skills: ["TypeScript", "React", "Next.js", "Node.js", "GraphQL", "REST", "Playwright", "Vite", "Webpack", "Tailwind CSS",
    "accessibility", "performance profiling", "design systems", "module federation", "CI/CD", "Azure App Service",
    "feature flags", "SQL basics", "observability", "technical writing", "mentoring"],
  domains: ["e-commerce", "developer platforms"],
  leadership: ["Led a React platform team of six engineers building a shared design system and a module federation shell",
    "Mentored two engineers into senior roles and ran the frontend hiring loop"],
  customerFacing: ["Advised enterprise customers on Azure application incidents during an on-call rotation"],
  aiEvidence: ["Built a local LLM evaluation prototype that compares structured outputs across prompt versions"],
  cloudEvidence: ["Azure App Service"],
  sourceHash: hashSource(measurementResumeText),
};

// Mirrors the exact strings JobDiscovery.recommend() builds, so a wrapper can map extractJob() and
// assess() calls back to a candidate by equality instead of guessing. Pinned by hashes.search.
export function expectedDescription(hit: SearchHit): string {
  return `Greenhouse board token: ${hit.candidate.boardToken}\nTitle: ${hit.candidate.title}\nLocation: ${hit.candidate.location}\n\n${hit.description}`;
}
export function expectedJobId(hit: SearchHit): string {
  return stableId("job", `${hit.candidate.sourceUrl}\n${expectedDescription(hit)}`);
}

// Dry-run provider: no network, descriptions carry a sentinel so leak tests can prove they never reach a report.
export function createFixtureProvider(count = 5): JobSearchProvider {
  return {
    async search(input): Promise<ProviderSearchResult> {
      const retrievedAt = new Date().toISOString();
      const hits: SearchHit[] = Array.from({ length: count }, (_, i) => ({
        candidate: {
          candidateId: `synthetic_${i + 1}`, title: `Synthetic role ${i + 1}`, boardToken: input.boardToken,
          location: "Synthetic location", sourceUrl: `https://job-boards.greenhouse.io/${input.boardToken}/jobs/${i + 1}`,
          retrievedAt,
        },
        description: `${SYNTHETIC_JD_SENTINEL} ${i + 1}. Lead a React team building accessible frontend platform tools. Mentor engineers and own delivery quality across the roadmap.`,
      }));
      return { provider: "Synthetic fixture provider — no network", sourceUrl: `https://boards-api.greenhouse.io/v1/boards/${input.boardToken}/jobs?content=true`,
        retrievedAt, matchedCount: hits.length, hits: hits.slice(0, input.limit), warnings: ["Synthetic fixture search; no network request was made."] };
    },
  };
}
