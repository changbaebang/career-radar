# Usage check — one profile, three postings

The verification tooling is in place (policy evals, live-measurement harness, located screening
context, a second provider). None of it shows that a person reading the app's output picks
postings better. This check does. It is not a milestone and adds no product behaviour: the
deliverable is the owner's written answers, and the next post is about them.

## The question

Put one profile and three postings through the app and read the result. Then answer:

1. Can you follow why each posting is worth applying to, or not?
2. Did you learn a difference between the postings, or a question you need to check, that you
   did not have before reading?
3. Compared with pasting the same resume and postings into a plain chat, is this more convenient?

Three postings cannot establish recommendation accuracy. They can show whether the output helps
with the job the app was built for.

## Two rounds, different claims

- **Round 1: synthetic profile.** The invented measurement resume (`--resume` omitted) and three
  public postings. Answers to questions 1 and 2 are about the output's readability and whether it
  surfaces differences; nothing here says the app helps *your* search.
- **Round 2: your own resume.** Only after checking what leaves the machine (below). Running the
  app locally does not keep the input local: the resume and each posting are transmitted to the
  configured provider, and deleting local files does not delete anything the provider retains.
  Decide this round separately.

## Before any call

- Pick the provider in `.env.local`: `CAREER_RADAR_PROVIDER=openai` (`OPENAI_API_KEY`) or
  `openrouter` (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` — a model whose supported parameters list
  `structured_outputs`). See [PROVIDERS.md](PROVIDERS.md); a free tier is still an external
  transmission, and a result from one provider says nothing about another.
- Pick three public postings on `boards.greenhouse.io`, `job-boards.greenhouse.io`,
  `jobs.lever.co` or `jobs.ashbyhq.com`, or save their text to files. Choose roles you would
  actually weigh against each other; the point is prioritizing, not covering the market.
- Each run makes at most 1 + 2 × postings model calls (profile extraction, then extraction and
  assessment per posting), one HTTP attempt each: the script pins SDK retries and SDK logging off,
  like the live harness, and refuses to run while `OPENAI_BASE_URL` is set so requests can only go
  to the destination it printed.

## Path A — inside ChatGPT (the real product surface)

Follow [Connect from ChatGPT](../README.md#connect-from-chatgpt): `pnpm dev`, a Secure MCP Tunnel,
Developer Mode, refresh the app after the widget URI change (v5). Then ask ChatGPT to create the
profile from the resume text, ingest each posting, and assess each one. Question 3 is best answered
here, because "plain chat" is one tab away. This also exercises issue #5 (host flow), which has
not been verified yet, so expect to hit host problems that are not about the assessments.

## Path B — local page, no ChatGPT

```bash
pnpm usage-check --job https://jobs.lever.co/example/one --job ./posting-two.txt --job ./posting-three.txt
```

Without `--approve-transmission` this prints the provider, destination, model, input sizes and the
call count, then exits with code 3 and zero calls. Add the flag to run. The script drives the real
MCP tools (`profile_upsert`, `job_ingest`, `job_assess`) over the real HTTP transport, so the
output is what the app produces, then serves `http://127.0.0.1:8010/`: a comparison table (a
reading aid, not the widget) and one real widget card per posting. A posting that fails is
reported with the fixed error message and does not stop the others. Each tool call is bounded at
5 minutes (the MCP client default of 60 seconds is too short for some free models). The model request
behind it carries a cancel signal for the same 5 minutes, which fetch honours until the response body is
fully read (the SDK's own `timeout` only covers the wait for headers), and results are assembled only
after cancelled or late calls have settled; `results.json` records how long every call took and the per-call
telemetry (finish status, token counters, upstream provider), never the content.

Results are written to `data/usage-check/<timestamp>/results.json` (gitignored, `0o600`). It
contains the structured profile, the postings and the assessments; deleting the directory removes
that local file, not what the provider retains or anything you printed elsewhere. Relative `--job`,
`--resume`, `--out` and `--replay` paths are resolved from the directory where you ran the command.
The page is served on loopback only and rejects requests whose Host or Origin is not a loopback
address, the same gate the MCP server uses. `pnpm usage-check --replay data/usage-check/<timestamp>/results.json` serves a saved
run without any call. The app database is not touched: the check uses an in-memory store.

## Record

Keep it short. For each posting: the verdict, whether you agree, one sentence on why. Then the
three answers, and one line on what you would remove from the output. Provider, model and prompt
version are in `results.json` and on the page header; copy them into the notes so the answers
stay tied to what produced them.
