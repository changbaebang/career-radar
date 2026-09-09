# Career Radar

[한국어](README.ko.md) | English

Career Radar is an evidence-based career decision tool. It is designed to help a candidate decide whether a role is `REALISTIC`, `STRETCH`, or `PASS` without inventing experience or turning a fit label into a hiring probability.

This repository currently contains **Milestone 1**: resume-text profile extraction, pasted job-description normalization, and an evidence-grounded single-job assessment rendered in a React widget.

## Architecture

The initial archetype is a **React widget** with a split `server/` and `web/` layout. That is the smallest current shape that satisfies the React UI requirement. The structure leaves room for the decoupled data/render pattern in later milestones without adding those tools now.

```text
career-radar/
  server/           # MCP server and /health endpoint
  web/              # React widget bundled by Vite
  packages/shared/  # Shared Zod schema and TypeScript types
  docs/             # Product specification and decisions
  data/             # Local-only data location for later milestones
```

The MCP implementation follows the official OpenAI examples at commit `18cc38e78a968712c357bacdc3c79fead5bfc6b4`, trimmed to one Career Radar status tool and one widget.

## Requirements

- Node.js 22 or newer
- pnpm 10

## Local development

```bash
pnpm install
pnpm dev
```

The server starts on `http://localhost:8000` by default:

- MCP endpoint: `http://localhost:8000/mcp`
- HTTP readiness endpoint: `http://localhost:8000/health`

Copy `.env.example` to the gitignored `.env.local` and set `OPENAI_API_KEY`. `OPENAI_MODEL` is optional and defaults to `gpt-5-mini`. The server loads this file locally; credentials never enter the widget.

## Checks

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm eval
```

## Single-job assessment

In a ChatGPT conversation with the app enabled:

1. Provide resume text so ChatGPT can call `profile_upsert`.
2. Paste one job description so it can call `job_ingest`.
3. Ask whether the role is realistic so it can call `job_assess` with the returned profile and job IDs.

The process stores only the structured candidate profile and normalized job in memory. It does not retain raw resume text, fetch job URLs, write SQLite data, or rewrite a resume in Milestone 1.

## Connect from ChatGPT

1. Start the local server with `pnpm dev`.
2. Create an [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) targeting `http://localhost:8000/mcp`. This is recommended for development because it does not expose the local server to the public internet.
3. In ChatGPT, enable Developer Mode under **Settings → Security and login**.
4. Open **ChatGPT Plugins**, create a developer-mode app, and select the Secure MCP Tunnel. A public development endpoint such as `https://example.ngrok.app/mcp` can be used instead.
5. Ask ChatGPT to show the Career Radar status.
6. Refresh the app connection after changing MCP tool or resource metadata.

Secure MCP Tunnel is for development and private connectivity, not public Plugin submission. Public submission requires a stable public HTTPS MCP endpoint.

Keep the OpenAI API key used by the tunnel in a server-process environment variable, never in the React widget or committed files. A gitignored `.env.local` is suitable for local development. Use a GitHub Actions Secret only if a workflow actually runs the tunnel or deployment. When moving to another OpenAI account, create a new key and tunnel there, then refresh the ChatGPT app connection; the repository remains portable.

## Current scope

Implemented:

- pnpm workspace
- shared Zod status schema
- stateless Streamable HTTP MCP endpoint
- `career_radar_status` read-only tool
- `profile_upsert`, pasted-text `job_ingest`, and `job_assess` tools
- OpenAI Responses API structured outputs validated with Zod
- deterministic evidence-grounding and hard-blocker post-processing
- MCP Apps UI resource with a Job Assessment Card
- twelve synthetic policy eval fixtures, including regression cases for the deterministic safety policy
- lint, typecheck, build, and unit-test scripts

Not implemented yet:

- SQLite persistence
- application tracking
- job URL fetching
- job search

See [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) for the milestone plan.

## Documentation references

- [Plugin quickstart](https://developers.openai.com/plugins/build/app-quickstart)
- [Define tools](https://developers.openai.com/plugins/plan/tools)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Add UI to an MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Connect and test a Plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Plugin reference](https://developers.openai.com/plugins/reference)
