# Agent skills: design

Status: approved by the owner, 2026-09-24. Decisions: `docs/planning/agent-skills-grill.md`, Round 1 (all recommendations accepted).

## 1. Purpose

Developers increasingly set up libraries by asking a coding agent (Claude Code, Cursor, Codex, Copilot) to do it. Without guidance, an agent reaching for GridCue guesses. It puts the Jev key in a `VITE_` variable, skips the Mock, invents schema options, or wires the provider straight to the browser. An installable skill gives the agent GridCue's setup path and its hard rules, and points it at the live docs for everything else.

Success: in a fresh Vite + TanStack Table app, an agent with only this skill installed adds GridCue, and a request previews on the Mock Provider, with no key in the browser bundle.

## 2. What ships

```text
skills/
  gridcue/
    SKILL.md                    # when to use it, the setup path, the hard rules, where facts come from
    LICENSE                     # MIT, as the repo
    references/
      setup.md                  # detect the stack; install; Mock first; choose the UI
      domain.md                 # describe the domain from the app's real columns
      jev.md                    # turn on Jev behind a Server Handler; protect the endpoint; strategies
      evals.md                  # write eval cases on the app's own schema and run them
      troubleshooting.md        # symptoms → causes, from the docs' known failure paths
.claude-plugin/
  marketplace.json              # "gridcue" marketplace, one plugin, source "./"
  plugin.json                   # name "gridcue", version = packages/gridcue version
```

Install, as the docs and READMEs will show:

```bash
npx skills add JH3lou/GridCue --skill gridcue      # Claude Code, Cursor, Codex, Copilot, and more
claude plugin marketplace add JH3lou/GridCue && claude plugin install gridcue@gridcue   # Claude Code plugin
```

Maintainer skills in `.agents/skills/` (`gridcue-planning` and the three vendored design skills) get `metadata: { internal: true }` in their frontmatter, so the skills CLI no longer offers them to users. The Claude plugin loads only the `skills/` folder at its root, so it never includes them.

## 3. The skill

### `SKILL.md`

- **Frontmatter.** `name: gridcue`. The `description` is written for triggering: adding a natural-language command bar or "ask your data" to a data grid or table, configuring GridCue, turning on Jev for GridCue, or writing GridCue evals.
- **Where facts come from.** The live docs are the source of truth. The agent reads `https://gridcue.dev/llms.txt` for the page list, then fetches the pages it needs as Markdown at `https://gridcue.dev/llms.mdx/docs/<path>/content.md`. It checks the installed `gridcue` version (`package.json` or the lockfile) and says so if the docs describe a newer API. Without network access, it falls back to the installed package's types and README and says so.
- **The setup path**, one step at a time, each ending in a check the agent runs or asks the User to run:
  1. Detect the stack: Vite or Next.js; TanStack Table v9 or plain rows; React 19; Tailwind + shadcn or not.
  2. Install `gridcue` (and `@tanstack/react-table` if needed). Check: it builds.
  3. Wire the Mock Provider and a command bar. Check: a request such as "sort by <a real column>, largest first" shows a Preview.
  4. Pick the UI: `GridCueBar` (plain CSS) or the shadcn command bar from the Component Registry. Check: it renders in both themes.
  5. Describe the domain from the app's real columns (reference `domain.md`). Check: three requests in the User's own words preview correctly.
  6. Turn on Jev behind a Server Handler (reference `jev.md`), only if the User wants it. Check: the canary-key bundle check passes.
  7. Offer to write evals on the app's schema (reference `evals.md`).
- **Hard rules**, stated plainly and never traded away:
  - The Jev key lives only on the server: never in `VITE_` or `NEXT_PUBLIC_` variables, client code, logs, or commits.
  - Rows never go to a provider; mark sensitive columns `restricted`.
  - Never bypass preview, apply, or undo; never have a model write filter state directly.
  - Put the endpoint behind the app's own auth and rate limits.
  - GridCue changes views only: never wire it to edit, trade, or export.
  - Use only options the docs or types show; don't invent schema fields.

### References

Each is short, task-shaped, and links to the docs pages it summarises rather than restating them. They carry what an agent tends to get wrong: the decision points, the order of steps, and the checks. API details stay in the docs.

## 4. Keeping it current

- `plugin.json`'s version is the package version. A check fails when they differ.
- AGENTS.md's "Hit every surface" gains **Agent skill**: a public API or setup change updates `skills/gridcue` in the same PR.
- A new `pnpm check:skills` step in `pnpm check`:
  - `SKILL.md` frontmatter parses, with `name` and a `description` under 1024 characters.
  - Every maintainer skill in `.agents/skills/` is marked internal.
  - Every `https://gridcue.dev/...` docs link in `skills/` names a page that exists in `apps/site/content/docs`, so a renamed page fails CI instead of breaking the skill.
  - `plugin.json` and `marketplace.json` parse, and the versions match.

## 5. Docs

- A Site page, "Set up with an AI assistant", under Get started: the two install commands, what the skill does and won't do, and a prompt to start with ("Add GridCue to this app's accounts table").
- One line in each README pointing to it.

## 6. Verification before release

- `pnpm check`, with `check:skills`.
- A real trial: a fresh Vite + TanStack Table app with a small synthetic table, Claude Code with only the skill installed, and the prompt above. Pass when a request previews on the Mock and `check:bundles`-style grep finds no key in the build. Recorded in the PR.
- `npx skills add ./ --list` from the repo shows `gridcue` and none of the maintainer skills.

## 7. Out of scope

- Cursor, Codex, and other agent-specific plugin manifests (the skills CLI already covers those agents).
- An MCP server.
- Skills for maintaining GridCue itself; those stay internal.

## 8. Risks

- **Discovery shadowing.** The skills CLI also scans `.claude/skills/` (a link to `.agents/skills/`). The internal flag covers both paths; the `--list` check proves it.
- **Docs drift.** Covered by the link check and the "Hit every surface" rule. The skill's own text holds rules and steps, not API details.
- **Network-less agents.** The fallback to the installed package's types and README is explicit.
