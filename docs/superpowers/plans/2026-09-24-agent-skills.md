# Agent skills: implementation plan

Spec: `docs/superpowers/specs/2026-09-24-agent-skills-design.md` (approved 2026-09-24). Status: approved by the owner, 2026-09-24.

**Goal:** an installable `gridcue` agent skill, available through the skills CLI and as a Claude Code plugin, that sets GridCue up safely in someone's app and reads the live docs for facts.

**Base:** the Site's docs page and the link check need `apps/site`, so the work is based on `main` once PR #7 has merged. Until then it's based on `claude/site`, and gets rebased onto `main` before its PR. One PR: `feat: an installable agent skill for setting up GridCue`.

Each task ends with its own check. No task starts until the one before it passes.

---

### Task 1. Hide the maintainer skills

**Files:** `.agents/skills/{better-ui,emil-design-eng,gridcue-planning,principle-experience-first}/SKILL.md`

- Add to each frontmatter:
  ```yaml
  metadata:
    internal: true
  ```
  For the three vendored skills, this is the only change; their upstream text and licenses stay as they are.

**Check:** `npx -y skills@<pinned> add ./ --list` from the repo root lists none of the four. (It will list `gridcue` after Task 2.) The version is pinned to one at least a day old, as the repo's supply-chain rule requires.

### Task 2. `skills/gridcue/SKILL.md`

**Files:** `skills/gridcue/SKILL.md`, `skills/gridcue/LICENSE` (the repo's MIT text)

Content, in this order, as the spec lays out (§3):
1. Frontmatter: `name: gridcue`, and a trigger-focused `description` of under 1024 characters.
2. What GridCue is, in three sentences, and what it will never do (view-only).
3. **Where facts come from:** `https://gridcue.dev/llms.txt`, then each page as `https://gridcue.dev/llms.mdx/docs/<path>/content.md`. Check the installed `gridcue` version first. Offline fallback: the installed package's types and README, said out loud.
4. **The setup path:** seven steps, each with its check (spec §3), each pointing to its reference file.
5. **Hard rules** (spec §3), as a short list.
6. When to stop and ask the User: an existing server they'd have to change, a table the adapter can't read, or a request to change data.

**Check:** `--list` now shows `gridcue` and only `gridcue`. The body stays under about 300 lines, with detail pushed into references.

### Task 3. References

**Files:** `skills/gridcue/references/{setup,domain,jev,evals,troubleshooting}.md`

Each is task-shaped. It holds the decision points, the order, the checks, and links to the docs pages it summarises. It carries no API tables; those stay in the docs.

- `setup.md`: detecting the stack from `package.json`; TanStack Table v9 (`gridcueFilterFn`, `schemaFromTanStack`, `createTanStackAdapter`) vs the Rows Adapter; creating the controller once; `GridCueBar` + `gridcue/styles.css` vs `npx shadcn add https://gridcue.dev/r/command-bar.json`; the Mock-first check.
- `domain.md`: reading the app's real columns and enum values; aliases; `rowNoun`, `entity`, `valueGroups`; `restricted`; three test requests in the User's words.
- `jev.md`: `@typesafe-ai/sdk` on the server only; Next.js route and Vite/Express recipes; `createRemoteProvider` in the browser; `JEV_API_KEY` naming; auth and rate limits; `strategy` (fan-out default, and when focused fits); the canary-key bundle check.
- `evals.md`: copying `evals/run.ts` and `cli.ts`, writing JSONL cases from the User's requests (ambiguous, unsupported, and hidden-column cases included), reading `exact`, `mismatch` and `unsafe`.
- `troubleshooting.md`: symptom → cause → fix, taken from the docs' failure paths ("nothing previews", "asks too many questions", "`gridcue/server` in a client bundle", "Jev without the SDK" `INPUT_CONFIG`, and so on).

**Check:** every docs URL in `skills/` resolves (Task 5's check, run early by hand).

### Task 4. Claude Code plugin

**Files:** `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`

- `marketplace.json`: name `gridcue`, owner JH3lou, one plugin `gridcue` with `source: "./"`.
- `plugin.json`: name `gridcue`, `version` equal to `packages/gridcue/package.json`'s version, description, homepage `https://gridcue.dev`, repository, license MIT.

**Check:**
- `claude plugin validate .`, if that command exists. Otherwise the JSON parses and matches the documented schema.
- A local install, `claude plugin marketplace add ./` and `claude plugin install gridcue@gridcue`, loads the skill. I remove it afterwards.

### Task 5. `pnpm check:skills`

**Files:** `scripts/check-skills.mjs`, root `package.json` (the script, and a step in `check`)

It fails when:
- a `SKILL.md` under `skills/` has no `name` or `description`, the `name` doesn't match its folder, or the `description` is 1024 characters or more;
- a `SKILL.md` under `.agents/skills/` is not `metadata.internal: true`;
- a `https://gridcue.dev/docs/...` or `https://gridcue.dev/llms.mdx/docs/.../content.md` link in `skills/` names a page with no file in `apps/site/content/docs`;
- `.claude-plugin/*.json` doesn't parse, or `plugin.json`'s version differs from the package's.

**Check:** passes on the tree. Then each failure is shown once by breaking it on purpose and restoring: a bad link, a missing `internal`, and a version mismatch.

### Task 6. Rules and docs

**Files:**
- `AGENTS.md`: "Hit every surface" gains **Agent skill**. "Where code lives" gains `skills/` and `.claude-plugin/`.
- `apps/site/content/docs/get-started/ai-assistant.mdx`, plus `get-started/meta.json`: the "Set up with an AI assistant" page, with both install commands, what the skill does and won't do, and a first prompt.
- `README.md` and `packages/gridcue/README.md`: one line each, linking the page.
- `.github/pull_request_template.md`: the docs checkbox mentions `skills/gridcue` too.

**Check:** the Site build passes, including the link check, and the new page appears in `llms.txt`.

### Task 7. Verify end to end

1. Run `pnpm check`.
2. Run `npx skills add ./ --list`. It shows `gridcue` only.
3. **Real trial:**
   - In the scratchpad, scaffold a fresh Vite + React + TanStack Table v9 app with a small synthetic table.
   - Install only this skill with `npx skills add <repo path> --skill gridcue -a claude-code`.
   - Run Claude Code headless on "Add GridCue to this app's accounts table", with GridCue from the packed tarball (0.1.0 may not be on npm yet).
   - Pass when:
     - the app builds;
     - a request previews on the Mock in a real browser;
     - a canary-key build has no key.
   - Record the transcript summary and the result in the PR.
4. Check the new docs page in light and dark.

### Task 8. PR

- Rebase onto `main` once #7 has merged.
- One PR. The body gives the problem, the approach, the trial result, and the install commands.
- Nothing is published: the skill is installable from GitHub the moment the PR merges.
