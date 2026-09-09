# Architectural Decisions

## ADR-0001: Start with the React widget archetype

**Status:** Accepted

Milestone 0 needs one read-only tool and one small React UI. A `react-widget` is therefore the smallest supported archetype. The repository uses split `server/` and `web/` packages so later milestones can introduce decoupled data and render tools without reorganizing the project now.

## ADR-0002: Use current MCP Apps metadata

**Status:** Accepted

The widget is registered with `text/html;profile=mcp-app`, linked from the tool through `_meta.ui.resourceUri`, and given an exact empty CSP allowlist. The ChatGPT-specific `openai/outputTemplate` field is included only as a compatibility alias.

## ADR-0003: Keep Milestone 0 independent of model calls

**Status:** Accepted

The first milestone proves the MCP-to-widget path using deterministic status data. OpenAI Responses API integration begins in Milestone 1, where model output can be validated against product schemas and eval fixtures.

## ADR-0004: Adapt a pinned official example

**Status:** Accepted

The server transport and MCP Apps resource/tool registration patterns are adapted from the official `openai/openai-apps-sdk-examples` repository at commit `18cc38e78a968712c357bacdc3c79fead5bfc6b4`. Only the minimal pattern needed by Career Radar is retained.

## ADR-0005: Keep Milestone 1 state ephemeral

**Status:** Accepted

`profile_upsert` and `job_ingest` keep normalized records in process memory so `job_assess` can refer to stable IDs. Raw resume text is not retained. SQLite, migrations, application history, and cross-process persistence remain Milestone 2 work.

## ADR-0006: Separate model judgment from deterministic safety policy

**Status:** Accepted

The Responses API produces strict Zod-validated structures with `store: false`. Server code adds deterministic IDs, `modelVersion`, and `promptVersion`, removes positive claims that do not map to candidate evidence, promotes missing core language/location/certification/education requirements to hard blockers, and prevents unsupported `REALISTIC` results.
