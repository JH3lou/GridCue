# Agent skills grill

Owner request (2026-09-24): "we should add installable agent skills for people who want to use agentic coding assistants to help configure the stuff."

## Facts gathered

- `npx skills add <owner>/<repo>` (vercel-labs/skills) installs `SKILL.md` folders into Claude Code, Cursor, Codex, Copilot, Gemini CLI and about 75 other agents, per project or globally. It discovers skills under `skills/`, and also under `.agents/skills/` and `.claude/skills/`.
- A skill with `metadata: { internal: true }` in its frontmatter is hidden from that discovery unless `INSTALL_INTERNAL_SKILLS=1`.
- A Claude Code plugin marketplace is `.claude-plugin/marketplace.json` plus `.claude-plugin/plugin.json` at the repo root; `claude plugin marketplace add <owner>/<repo>` then `claude plugin install <plugin>@<marketplace>`. A plugin loads the `skills/` folder at its root.
- typesafe-ai/skills and cloudflare/skills both use `skills/<name>/SKILL.md` plus the Claude plugin manifests. Cloudflare also ships Cursor and Codex plugin manifests.
- This repo's maintainer skills live in `.agents/skills/` (`.claude/skills` links to it), so the CLI would list them to users today.
- The Site already serves `llms.txt`, `llms-full.txt`, and each docs page as Markdown at `/llms.mdx/docs/<path>/content.md`.

## Round 1

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Where the skills live | In this repo, `skills/gridcue/`, so they version and review with the package. Install: `npx skills add JH3lou/GridCue --skill gridcue`. |
| 2 | Keeping maintainer skills out of users' installs | Mark every skill in `.agents/skills/` `metadata.internal: true`. |
| 3 | Shape | One skill, `gridcue`, with reference files the agent reads when it needs them: set up, describe your domain, turn on Jev, evals, troubleshooting. One install, one trigger. |
| 4 | Source of truth | The skill carries the workflow and the hard rules; facts come from the live docs (`gridcue.dev/llms.txt` and per-page Markdown), so it can't drift from the API. It checks the installed `gridcue` version first. |
| 5 | What it does | A guided setup, each step ending in a check: detect the stack (Vite or Next, TanStack Table or plain rows); install; wire the Mock and confirm a request previews; pick the UI (`GridCueBar` or the shadcn command bar); describe the domain from the app's real columns; turn on Jev behind a Server Handler; write evals on the app's own schema. |
| 6 | Hard rules in the skill | Key only on the server (never `VITE_`/`NEXT_PUBLIC_`); rows never sent; restricted columns stay restricted; never bypass preview, apply, or undo; put the endpoint behind auth and rate limits. |
| 7 | Channels | The skills CLI, and a Claude Code plugin marketplace. Cursor and Codex manifests later, if asked for. |
| 8 | Keeping it current | Plugin version tracks the package version. A public API change updates the skill in the same PR: add "Agent skill" to AGENTS.md's "Hit every surface". |
| 9 | Verification | CI: valid frontmatter, and every docs link in the skill exists in the built Site. Before release: in a fresh Vite + TanStack app, an agent with only the skill installed sets up GridCue, and a request previews on the Mock. |
| 10 | Docs | A Site page, "Set up with an AI assistant", under Get started; one line in both READMEs. |

## Owner answers (Round 1)

| # | Answer |
| --- | --- |
| 1–10 | "yes this looks great": every recommendation, as written. |

Related direction in the same message: outside contributors may change only the Site's docs pages, enforced by a required check (PR #8).
