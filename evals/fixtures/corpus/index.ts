import type { CandidateProfile } from "@career-radar/shared";
import type { EvidenceDocument } from "../../../server/src/domain/evidence/chunk.js";

// M5-A synthetic evidence corpus. Every name, employer, project and sentence is invented for the
// retrieval eval; nothing here is a real person's resume or writing. The structured profile is
// chunked with the profile chunker, the documents with the document chunker. The `synthetic`
// documents are distractors: plausible text that shares words with the profile but is not the
// candidate's evidence, so Recall@K is measured against competition, not against an empty index.
export const CORPUS_VERSION = "synthetic-corpus-v1";

export const corpusProfile: CandidateProfile = {
  id: "synthetic-frontend-lead",
  headline: "Frontend platform lead with twelve years of web application experience",
  yearsExperience: 12,
  roles: [
    {
      company: "Example Platform Co.", title: "Frontend Platform Lead", start: "2022", end: "2026",
      responsibilities: [
        "Led a platform team of six engineers building a shared design system.",
        "Owned the module federation shell used by four product teams.",
        "Ran weekly architecture reviews for frontend changes.",
      ],
      evidence: [
        "Cut the median page load time on the checkout flow by measuring before and after each change.",
        "Introduced TypeScript strict mode across twelve packages without a release freeze.",
        "Mentored three engineers who were promoted to senior.",
      ],
    },
    {
      company: "Sample Commerce Inc.", title: "Senior Frontend Engineer", start: "2018", end: "2022",
      responsibilities: [
        "Built the React checkout and payment pages.",
        "Maintained the Node.js backend-for-frontend service.",
      ],
      evidence: [
        "Migrated the checkout from a jQuery codebase to React with zero downtime.",
        "Added end-to-end tests with Playwright covering the payment flow.",
        "Reduced the JavaScript bundle by removing duplicate polyfills.",
      ],
    },
    {
      company: "Demo Studio", title: "Frontend Engineer", start: "2014", end: "2018",
      responsibilities: ["Implemented marketing sites and an internal CMS."],
      evidence: ["Delivered an accessible component library audited against WCAG 2.1 AA."],
    },
  ],
  skills: ["React", "TypeScript", "Node.js", "GraphQL", "Playwright", "Webpack", "Vite", "CSS", "HTML", "Next.js"],
  domains: ["e-commerce", "design systems", "developer tooling"],
  leadership: ["Led a platform team of six engineers.", "Ran hiring loops for frontend roles."],
  customerFacing: ["Presented quarterly platform roadmaps to product leads."],
  aiEvidence: ["Prototyped an LLM-based code review assistant for pull requests."],
  cloudEvidence: ["Deployed static sites through a CDN with infrastructure defined in Terraform."],
  constraints: { locations: ["Seoul"], remotePreference: "hybrid", languages: ["Korean", "English"] },
  sourceHash: "1f0c7e3b9a5d2c8e6f4a1b0d9c8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e",
};

export const corpusDocuments: EvidenceDocument[] = [
  {
    sourceType: "project", sourceId: "project:design-system", metadata: { title: "Shared design system" },
    text: `# Shared design system

The design system started as a set of color and spacing tokens shared by two product teams. Every component ships with keyboard navigation and screen reader labels. Adoption was tracked per team with a weekly report of which pages used the shared components.

Breaking changes go through a deprecation period of two releases. Consumers see a console warning with the migration path before the old component is removed.`,
  },
  {
    sourceType: "project", sourceId: "project:module-federation", metadata: { title: "Module federation shell" },
    text: `# Module federation shell

The shell loads product team bundles at runtime through module federation. Each team deploys independently and declares the shared dependencies it expects. Version mismatches are caught by a contract test that runs in every pipeline.

Rollbacks are a matter of pointing the shell at the previous bundle manifest. The manifest is signed and served from the CDN.`,
  },
  {
    sourceType: "project", sourceId: "project:checkout-migration", metadata: { title: "Checkout migration" },
    text: `# Checkout migration

The checkout was rewritten from jQuery to React one step at a time behind feature flags. Each step was measured on real traffic before the flag was widened. Payment error rates were compared against the previous week before every rollout.

The old code was deleted only after two full release cycles without a flag reversal.`,
  },
  {
    sourceType: "blog", sourceId: "blog:measuring-before-optimizing", metadata: { title: "Measure before optimizing" },
    text: `# Measure before optimizing

I did not trust my intuition about which page was slow. Lighthouse runs on a throttled connection gave a baseline for every route. Core Web Vitals from real users disagreed with the lab numbers on two routes.

The slowest route turned out to be waiting on a synchronous font load. Removing that wait was a one-line change that no amount of bundle splitting would have found.`,
  },
  {
    sourceType: "blog", sourceId: "blog:typescript-strict-migration", metadata: { title: "Strict mode, one package at a time" },
    text: `# Strict mode, one package at a time

Turning on TypeScript strict mode across the whole monorepo at once would have blocked every release. We enabled it package by package, starting with the leaves of the dependency graph. Each package fixed its own errors in a pull request that touched nothing else.

The last package took a month because it wrapped a third-party library without types. Writing the declaration file was the real work.`,
  },
  {
    sourceType: "blog", sourceId: "blog:hiring-loops", metadata: { title: "Running a hiring loop" },
    text: `# Running a hiring loop

Every interviewer scores the same rubric before the debrief. The rubric lists observable behaviors, not impressions. A candidate who explains a trade-off they regret scores higher than one who never made a mistake.

We publish the take-home exercise with a time box and pay for the time.`,
  },
  {
    sourceType: "synthetic", sourceId: "synthetic:ml-engineer-notes", metadata: { title: "Distractor: ML engineer notes" },
    text: `# Training pipeline notes

The training pipeline retrains the ranking model every night on the previous day of click logs. Feature drift is measured against a frozen validation set. The team of four engineers reviews the offline metrics before promoting a model.

A React Native app shows the model's predictions to field testers. Kubernetes runs the batch jobs on spot instances.`,
  },
  {
    sourceType: "synthetic", sourceId: "synthetic:marketing-plan", metadata: { title: "Distractor: marketing plan" },
    text: `# Quarterly marketing plan

The campaign targets returning customers with a checkout discount in the second week. Landing pages are built by the agency and reviewed by the brand team. Performance is measured by conversion rate and average order value.

The design team owns the visual system and approves every asset.`,
  },
  {
    sourceType: "synthetic", sourceId: "synthetic:backend-oncall", metadata: { title: "Distractor: backend on-call" },
    text: `# On-call handbook

The payment service pages the on-call engineer when the error rate exceeds the threshold for five minutes. Rollbacks use the previous container image and take about three minutes. Every incident gets a written review within two days.

Node.js services expose a health endpoint that the load balancer polls.`,
  },
  {
    sourceType: "synthetic", sourceId: "synthetic:kitchen-remodel", metadata: { title: "Distractor: kitchen remodel" },
    text: `# Kitchen remodel log

The contractor measured the cabinets twice before ordering. Delivery took six weeks and the countertop arrived with a chip. The platform under the sink needed a second coat of sealant.`,
  },
];
