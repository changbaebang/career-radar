# Career Radar

[한국어](README.ko.md) | English

Career Radar is an evidence-based career decision tool. It is designed to help a candidate decide whether a role is `REALISTIC`, `STRETCH`, or `PASS` without inventing experience or turning a fit label into a hiring probability.

This repository currently contains **Milestone 0 only**: a TypeScript workspace with a Node MCP server, a read-only demo tool, and a minimal React widget for ChatGPT.

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

Milestone 0 does not call the OpenAI API. `.env.local` is ignored and reserved for server-side credentials used by later milestones.

## Checks

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

## Connect from ChatGPT

1. Start the local server with `pnpm dev`.
2. Expose port 8000 through a public HTTPS tunnel, for example `ngrok http 8000`.
3. In ChatGPT, enable Developer Mode under **Settings → Security and login**.
4. Open **ChatGPT Plugins**, create a developer-mode app, and enter the tunnel URL with `/mcp`, such as `https://example.ngrok.app/mcp`.
5. Ask ChatGPT to show the Career Radar status.
6. Refresh the app connection after changing MCP tool or resource metadata.

Do not use a development tunnel as a production endpoint.

## Current scope

Implemented:

- pnpm workspace
- shared Zod status schema
- stateless Streamable HTTP MCP endpoint
- `career_radar_status` read-only tool
- MCP Apps UI resource with a React widget
- lint, typecheck, build, and unit-test scripts

Not implemented yet:

- resume parsing
- job ingestion or assessment
- OpenAI Responses API calls
- SQLite persistence
- application tracking
- job search

See [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) for the milestone plan.

## Documentation references

- [Plugin quickstart](https://developers.openai.com/plugins/build/app-quickstart)
- [Define tools](https://developers.openai.com/plugins/plan/tools)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Add UI to an MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Plugin reference](https://developers.openai.com/plugins/reference)
