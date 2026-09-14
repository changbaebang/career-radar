# ChatGPT host check — issue #5, widget v6

Status: **not run yet**. This page is the runbook and the record for verifying the real product
surface (ChatGPT + Secure MCP Tunnel) before M5 changes it. Issue #5 was written against the M3
tools and the v5 widget; the tool set and the widget URI have moved since, so this page re-bases
the checklist on the current tree and narrows the first round to what M5-0 needs.

## Why before M5-0

- M5-B raises the widget URI to v7 and changes tool outputs. Without a v6 baseline in the host, a
  host problem found after M5 cannot be attributed to M5 or to the pre-M5 state.
- The only host verification so far is the M0 connection. Every widget bump since (v5 for M4-B2,
  v6 for #19) is reasoned from the parser, not observed in ChatGPT.
- Path A of [USAGE_CHECK.md](USAGE_CHECK.md) is this check. Question 3 there ("easier than plain
  chat?") can only be answered where plain chat is one tab away.
- The M5-0 baseline page records this run as the host's verification label (`live-verified` for
  the items that passed, with SHA, widget URI, provider and date) or keeps `not verified`.

## Scope of the first round

In scope, in this order: `career_radar_status` → `profile_upsert` → `job_ingest` (three postings)
→ `job_assess` (three) → `application_save` → `pipeline_summary` → `application_update`, plus the
host behaviours around them: widget render and loading state, re-entry, error display, small
screen, keyboard, links.

Out of scope for this round:

- `job_search` → `job_recommend`. The five-candidate batch is issue #4's latency question. On the
  free OpenRouter endpoint one assessment already exceeds a minute (usage check round 1), so the
  batch would most likely exceed whatever per-call limit the host applies (unknown; the MCP client
  default is 60 s) and fail for a reason that is not about the host. Run it after #4 has a
  measured batch.
- Authentication, isolation, public release (#6).
- Any real resume. The profile is the synthetic measurement resume; the postings are the same three
  public postings as round 1 (local text files, gitignored).

## Before you start

- **Transmission.** The same facts as the usage check: the resume text and the postings are sent to
  the configured provider (OpenRouter free model, as in round 1) and to ChatGPT itself, which also
  sees every tool input and output. The provider's and OpenAI's retention apply; deleting local
  files does not delete those copies. Approve per round.
- **Database.** Unlike `pnpm usage-check`, `pnpm dev` uses the app database. Point the run at a
  throwaway file so the check never mixes with the owner's data, and delete it afterwards:

  ```bash
  CAREER_RADAR_DB_PATH=data/host-check.db pnpm dev
  # afterwards
  rm -f data/host-check.db
  ```

  Shell variables win over `.env.local` (`process.loadEnvFile` does not override existing
  variables), so the override works without editing the file.
- **Record the identifiers first**, so the answers stay tied to what produced them: `git rev-parse
  --short HEAD`, the widget URI (`CAREER_RADAR_WIDGET_URI` in `server/src/mcp/createServer.ts`,
  `widget-v6.html` today), `PROMPT_VERSION` in `server/src/ai/contracts.ts`, and provider and model
  from `.env.local`. Never the key.

## Setup

1. `pnpm build`, then `CAREER_RADAR_DB_PATH=data/host-check.db pnpm dev`. The server reads the widget
   bundle from `web/dist/`; the root `dev` script builds it.
2. Connect ChatGPT as in [Connect from ChatGPT](../README.md#connect-from-chatgpt): Secure MCP Tunnel
   to `http://localhost:8000/mcp`, Developer Mode, a developer-mode app using the tunnel.
3. **Refresh the app connection.** Tool and resource metadata changed since the last host session
   (v5 → v6, new tools). After the refresh, confirm the app's resource list shows
   `ui://career-radar/widget-v6.html` and the tool list shows nine tools.
4. Print the synthetic resume to paste:

   ```bash
   cd server && node --import tsx --input-type=module -e \
     'import { measurementResumeText } from "./scripts/measure-live/synthetic-inputs.ts"; console.log(measurementResumeText)'
   ```

5. Have the three posting text files from round 1 open. Paste text, not URLs: only allowed job
   boards are fetched by URL, and the round-1 postings were pasted text.

## Steps

Type the prompt in a new conversation with the app enabled. ChatGPT chooses the tool; if it picks a
different one, note that as a finding (tool descriptions are part of what #5 verifies).

| # | Prompt (or action) | Expected tool | What to check |
| --- | --- | --- | --- |
| 1 | "Show Career Radar status." | `career_radar_status` | Status card renders (eyebrow "Milestone 4", capabilities list). "Waiting for Career Radar…" is replaced, not stuck. |
| 2 | "Create my candidate profile from this resume text:" + pasted synthetic resume | `profile_upsert` | One model call. Text reply names the profile id and says raw text was not retained. No provider error body in the reply. |
| 3 | "Ingest this job posting:" + posting text (three times, one per posting) | `job_ingest` | Text reply names the job id; a posting without an employer shows "(employer not stated)", never an invented company. |
| 4 | "Assess the <title> posting against my profile." (three times) | `job_assess` | Assessment card: verdict, integer score on the 0-100 scale, evidence with requirement ids, blockers, screening context with explicit `uncertain`. Compare with the round-1 results file for the same posting; differences from #19 are expected (employer absent instead of invented, integer score). |
| 5 | Re-entry: open another conversation, come back, scroll to each card; then reload the ChatGPT tab | (none) | Cards re-render from the host's tool output; none falls back to "Waiting for Career Radar…". |
| 6 | "Save the <title> assessment as an application I plan to apply to." | `application_save` | Text-only reply with the application id (this tool has no widget). No verdict is invented. |
| 7 | "Show my application pipeline." | `pipeline_summary` | Pipeline card renders with the saved application counted. |
| 8 | "I applied to <title>; record the application as applied, stage screening." | `application_update` | Text reply records status `applied` and the stage; repeating step 7 shows it on the pipeline card. |
| 9 | Small screen: narrow the browser to phone width or open the conversation in the ChatGPT mobile app | (none) | Cards remain readable; long evidence wraps; no horizontal scroll inside the card. |
| 10 | Keyboard: Tab through a card | (none) | Focus order is sensible; any link is reachable and points only at an intended public destination (posting URL if one was given). |
| 11 | Error display (optional, needs a restart): stop the server, start it with `OPENROUTER_API_KEY="" CAREER_RADAR_DB_PATH=data/host-check.db pnpm dev`, repeat step 2 | `profile_upsert` | The reply shows the fixed configuration message (`Set OPENROUTER_API_KEY in .env.local…`), no stack trace, no request body. Restart with the key afterwards. |

Per posting, note the verdict, whether you agree, and one sentence why, as in the usage-check
record. Then the three usage-check questions, with question 3 answered by actually pasting the same
inputs into a plain chat in another tab.

## What to capture

- The identifiers above, the date, and per step: pass / fail / not tried, one line of observation.
- Screenshots only of synthetic content (status card, one assessment card, the pipeline card); crop
  out account details. No screenshot of the resume text or a posting.
- Timings are **not** part of this round: the host path has no per-call telemetry, and latency is
  #4's measurement. Note only if a step visibly exceeded the host's limit or was cancelled.
- Anything ChatGPT did that the tool descriptions did not intend (wrong tool, invented ids, a
  verdict phrased as advice).

## Run log

| Date (KST) | SHA | Widget URI | Provider / model | Prompt version | Steps passed / failed / not tried | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | not run yet |

Results also go to issue #5 as a comment (what passed at this SHA, what remains) and to the M5-0
baseline page. Checklist items that remain untried stay `not verified`; a passed item is
`live-verified` for this provider, model and widget URI only.
