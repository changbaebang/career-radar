// M5-A authored query set. Queries are phrased like job requirement texts (M5-B uses requirement
// texts as retrieval queries). Relevance is authored as sentence-level locators with the expected
// text; the runner checks the text against the chunker output at load time, resolves the locators
// to chunk ids per chunker (a field-level chunk is relevant when its locator is the prefix of a
// relevant sentence locator), and refuses to run when any entry no longer resolves.
//
// Several queries are written to show where lexical retrieval fails (abbreviations, synonyms,
// morphology). Low recall on those is the finding, not a bug in the query set.
export const QUERY_SET_VERSION = "synthetic-queries-v1";

export type RelevantEvidence = { sourceId: string; locator: string; text: string };
export type RetrievalQuery = { id: string; query: string; relevant: RelevantEvidence[]; note?: string };

const P = "profile:synthetic-frontend-lead";

export const retrievalQueries: RetrievalQuery[] = [
  { id: "q01", query: "Experience with React", relevant: [
    { sourceId: P, locator: "skills[0]", text: "React" },
    { sourceId: P, locator: "roles[1].responsibilities[0]", text: "Built the React checkout and payment pages." },
    { sourceId: P, locator: "roles[1].evidence[0]", text: "Migrated the checkout from a jQuery codebase to React with zero downtime." },
    { sourceId: "project:checkout-migration", locator: "section:0/sentence:0", text: "The checkout was rewritten from jQuery to React one step at a time behind feature flags." },
  ], note: "A distractor mentions React Native." },
  { id: "q02", query: "TypeScript strict mode migration", relevant: [
    { sourceId: P, locator: "roles[0].evidence[1]", text: "Introduced TypeScript strict mode across twelve packages without a release freeze." },
    { sourceId: "blog:typescript-strict-migration", locator: "section:0/sentence:0", text: "Turning on TypeScript strict mode across the whole monorepo at once would have blocked every release." },
  ] },
  { id: "q03", query: "Led a team of engineers", relevant: [
    { sourceId: P, locator: "leadership[0]", text: "Led a platform team of six engineers." },
    { sourceId: P, locator: "roles[0].responsibilities[0]", text: "Led a platform team of six engineers building a shared design system." },
  ], note: "A distractor has a team of four engineers." },
  { id: "q04", query: "Design system ownership", relevant: [
    { sourceId: P, locator: "domains[1]", text: "design systems" },
    { sourceId: P, locator: "roles[0].responsibilities[0]", text: "Led a platform team of six engineers building a shared design system." },
    { sourceId: "project:design-system", locator: "section:0/sentence:0", text: "The design system started as a set of color and spacing tokens shared by two product teams." },
  ] },
  { id: "q05", query: "Module federation micro-frontends", relevant: [
    { sourceId: P, locator: "roles[0].responsibilities[1]", text: "Owned the module federation shell used by four product teams." },
    { sourceId: "project:module-federation", locator: "section:0/sentence:0", text: "The shell loads product team bundles at runtime through module federation." },
  ], note: "'micro-frontends' does not occur in the corpus." },
  { id: "q06", query: "Web performance and page load time", relevant: [
    { sourceId: P, locator: "roles[0].evidence[0]", text: "Cut the median page load time on the checkout flow by measuring before and after each change." },
    { sourceId: "blog:measuring-before-optimizing", locator: "section:0/sentence:0", text: "I did not trust my intuition about which page was slow." },
  ] },
  { id: "q07", query: "Core Web Vitals", relevant: [
    { sourceId: "blog:measuring-before-optimizing", locator: "section:0/sentence:2", text: "Core Web Vitals from real users disagreed with the lab numbers on two routes." },
  ] },
  { id: "q08", query: "End-to-end testing with Playwright", relevant: [
    { sourceId: P, locator: "skills[4]", text: "Playwright" },
    { sourceId: P, locator: "roles[1].evidence[1]", text: "Added end-to-end tests with Playwright covering the payment flow." },
  ] },
  { id: "q09", query: "Node.js backend services", relevant: [
    { sourceId: P, locator: "skills[2]", text: "Node.js" },
    { sourceId: P, locator: "roles[1].responsibilities[1]", text: "Maintained the Node.js backend-for-frontend service." },
  ], note: "A distractor describes Node.js services on call." },
  { id: "q10", query: "Accessibility and WCAG compliance", relevant: [
    { sourceId: P, locator: "roles[2].evidence[0]", text: "Delivered an accessible component library audited against WCAG 2.1 AA." },
    { sourceId: "project:design-system", locator: "section:0/sentence:1", text: "Every component ships with keyboard navigation and screen reader labels." },
  ], note: "'accessibility' vs 'accessible': no stemming." },
  { id: "q11", query: "Mentoring and growing engineers", relevant: [
    { sourceId: P, locator: "roles[0].evidence[2]", text: "Mentored three engineers who were promoted to senior." },
  ], note: "'mentoring' misses ('mentored' is a different term); 'engineers' carries the query." },
  { id: "q12", query: "Hiring and interviewing engineers", relevant: [
    { sourceId: P, locator: "leadership[1]", text: "Ran hiring loops for frontend roles." },
    { sourceId: "blog:hiring-loops", locator: "section:0/sentence:0", text: "Every interviewer scores the same rubric before the debrief." },
  ] },
  { id: "q13", query: "Communicating roadmaps to product leadership", relevant: [
    { sourceId: P, locator: "customerFacing[0]", text: "Presented quarterly platform roadmaps to product leads." },
  ] },
  { id: "q14", query: "Experience with LLM tools in the development workflow", relevant: [
    { sourceId: P, locator: "aiEvidence[0]", text: "Prototyped an LLM-based code review assistant for pull requests." },
  ] },
  { id: "q15", query: "Infrastructure as code with Terraform", relevant: [
    { sourceId: P, locator: "cloudEvidence[0]", text: "Deployed static sites through a CDN with infrastructure defined in Terraform." },
  ] },
  { id: "q16", query: "CDN and static site deployment", relevant: [
    { sourceId: P, locator: "cloudEvidence[0]", text: "Deployed static sites through a CDN with infrastructure defined in Terraform." },
    { sourceId: "project:module-federation", locator: "section:1/sentence:1", text: "The manifest is signed and served from the CDN." },
  ] },
  { id: "q17", query: "GraphQL APIs", relevant: [
    { sourceId: P, locator: "skills[3]", text: "GraphQL" },
  ] },
  { id: "q18", query: "JavaScript bundle size reduction", relevant: [
    { sourceId: P, locator: "roles[1].evidence[2]", text: "Reduced the JavaScript bundle by removing duplicate polyfills." },
  ] },
  { id: "q19", query: "Feature flags for gradual rollout", relevant: [
    { sourceId: "project:checkout-migration", locator: "section:0/sentence:0", text: "The checkout was rewritten from jQuery to React one step at a time behind feature flags." },
    { sourceId: "project:checkout-migration", locator: "section:0/sentence:1", text: "Each step was measured on real traffic before the flag was widened." },
  ] },
  { id: "q20", query: "Zero-downtime migration of a legacy jQuery codebase", relevant: [
    { sourceId: P, locator: "roles[1].evidence[0]", text: "Migrated the checkout from a jQuery codebase to React with zero downtime." },
    { sourceId: "project:checkout-migration", locator: "section:0/sentence:0", text: "The checkout was rewritten from jQuery to React one step at a time behind feature flags." },
  ] },
  { id: "q21", query: "Architecture reviews", relevant: [
    { sourceId: P, locator: "roles[0].responsibilities[2]", text: "Ran weekly architecture reviews for frontend changes." },
  ] },
  { id: "q22", query: "E-commerce checkout and payments", relevant: [
    { sourceId: P, locator: "domains[0]", text: "e-commerce" },
    { sourceId: P, locator: "roles[1].responsibilities[0]", text: "Built the React checkout and payment pages." },
  ], note: "Distractors mention checkout discounts and a payment service." },
  { id: "q23", query: "Independent deployments across teams", relevant: [
    { sourceId: "project:module-federation", locator: "section:0/sentence:1", text: "Each team deploys independently and declares the shared dependencies it expects." },
  ], note: "'deployments' vs 'deploys', 'independent' vs 'independently': no stemming." },
  { id: "q24", query: "Contract tests in the CI pipeline", relevant: [
    { sourceId: "project:module-federation", locator: "section:0/sentence:2", text: "Version mismatches are caught by a contract test that runs in every pipeline." },
  ] },
  { id: "q25", query: "Deprecation policy for breaking changes", relevant: [
    { sourceId: "project:design-system", locator: "section:1/sentence:0", text: "Breaking changes go through a deprecation period of two releases." },
    { sourceId: "project:design-system", locator: "section:1/sentence:1", text: "Consumers see a console warning with the migration path before the old component is removed." },
  ] },
  { id: "q26", query: "Rollback procedure for frontend releases", relevant: [
    { sourceId: "project:module-federation", locator: "section:1/sentence:0", text: "Rollbacks are a matter of pointing the shell at the previous bundle manifest." },
  ], note: "'rollback' vs 'rollbacks': no stemming, expected lexical miss; a distractor also describes backend rollbacks." },
  { id: "q27", query: "Monorepo with many packages", relevant: [
    { sourceId: P, locator: "roles[0].evidence[1]", text: "Introduced TypeScript strict mode across twelve packages without a release freeze." },
    { sourceId: "blog:typescript-strict-migration", locator: "section:0/sentence:0", text: "Turning on TypeScript strict mode across the whole monorepo at once would have blocked every release." },
    { sourceId: "blog:typescript-strict-migration", locator: "section:0/sentence:1", text: "We enabled it package by package, starting with the leaves of the dependency graph." },
  ] },
  { id: "q28", query: "Writing TypeScript declaration files for untyped libraries", relevant: [
    { sourceId: "blog:typescript-strict-migration", locator: "section:1/sentence:0", text: "The last package took a month because it wrapped a third-party library without types." },
    { sourceId: "blog:typescript-strict-migration", locator: "section:1/sentence:1", text: "Writing the declaration file was the real work." },
  ] },
  { id: "q29", query: "Lighthouse performance audits", relevant: [
    { sourceId: "blog:measuring-before-optimizing", locator: "section:0/sentence:1", text: "Lighthouse runs on a throttled connection gave a baseline for every route." },
  ] },
  { id: "q30", query: "Frontend platform lead", relevant: [
    { sourceId: P, locator: "headline", text: "Frontend platform lead with twelve years of web application experience" },
    { sourceId: P, locator: "roles[0].title", text: "Frontend Platform Lead" },
  ], note: "A distractor mentions a platform under a sink." },
  { id: "q31", query: "Senior frontend engineer with 5+ years of experience", relevant: [
    { sourceId: P, locator: "roles[1].title", text: "Senior Frontend Engineer" },
    { sourceId: P, locator: "headline", text: "Frontend platform lead with twelve years of web application experience" },
  ], note: "'5+' and 'twelve' never match lexically." },
  { id: "q32", query: "Developer tooling", relevant: [
    { sourceId: P, locator: "domains[2]", text: "developer tooling" },
  ] },
  { id: "q33", query: "Content management system implementation", relevant: [
    { sourceId: P, locator: "roles[2].responsibilities[0]", text: "Implemented marketing sites and an internal CMS." },
  ], note: "'CMS' is an abbreviation and 'implementation' vs 'implemented' does not stem: expected lexical miss." },
  { id: "q34", query: "Next.js", relevant: [
    { sourceId: P, locator: "skills[9]", text: "Next.js" },
  ] },
  { id: "q35", query: "Build tooling with Vite or Webpack", relevant: [
    { sourceId: P, locator: "skills[5]", text: "Webpack" },
    { sourceId: P, locator: "skills[6]", text: "Vite" },
  ] },
  { id: "q36", query: "Screen reader support", relevant: [
    { sourceId: "project:design-system", locator: "section:0/sentence:1", text: "Every component ships with keyboard navigation and screen reader labels." },
  ] },
];
