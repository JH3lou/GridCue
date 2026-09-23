# GridCue

GridCue lets a user say what they want to see in a dense data grid, in plain language, and turns that into a checked, previewable, undoable change to the grid's view. It is an open-source TypeScript toolkit: a framework-free core, React bindings, grid adapters, pluggable intent providers, and shadcn/ui components that developers copy into their own apps.

The first provider is TypeSafe AI's Jev. Jev picks among closed, typed choices. Deterministic code owns parsing, validation, policy, preview, apply, and undo.

## Planning status

The build plan is still being settled. Nothing is scaffolded yet.

- Open decisions and their history: `docs/planning/build-plan-grill.md`.
- Decisions already made: `docs/adr/`.
- The bootstrap agent's original work order is `docs/planning/bootstrap-work-order.md`. It is a proposal, not an approved plan.
- Do not scaffold or write product code until the owner approves a spec in `docs/superpowers/specs/` and a plan in `docs/superpowers/plans/`.

## What we never compromise on

### 1. View state only

GridCue filters, sorts, groups, aggregates, shows, hides, reorders, and pins columns, changes density, and resets views. It never edits cells, places trades, submits orders, exports data, navigates to privileged screens, or triggers business workflows. Record editing would be a separate product with its own risk model, not a flag.

### 2. The model proposes, code decides

Provider output is a proposal, never authority. Every plan is validated against the Host's View Schema and the adapter's capabilities before preview and again before apply. Unknown columns, operators, values, and actions fail closed. Ambiguous or low-confidence requests ask a Clarification or abstain. Never invent a plausible interpretation.

### 3. Preview, apply atomically, undo

Nothing applies without a preview. A multi-operation plan applies completely or not at all. Every applied plan is undoable and emits a structured audit event. A stale Revision is rejected rather than overwriting the user's manual changes.

### 4. The Host owns data and secrets

Raw row data is not sent to an Intent Provider by default. Provider input is limited to the Utterance, approved schema metadata, current View State, and Host-approved candidate values. API keys never enter browser bundles, logs, examples, fixtures, or source control. Provider calls go through a Server Handler the Host controls.

### 5. Works where developers already are

GridCue is one npm package, `gridcue` (ADR 0007). Its root entry has no framework, bundler, grid, or provider imports. The first release must work in both Vite and Next.js apps. A feature that only works in the Site demo is not done.

## A small glossary

Project vocabulary lives in `CONTEXT.md`. Use its terms and avoid the words it lists under _Avoid_. When talking about this repo:

- **you** means the agent reading this file.
- **the owner** means the repository owner, who makes the product decisions.
- **Host**, **User**, **Utterance**, **View Plan**, and the rest mean exactly what `CONTEXT.md` says.

## Hit every surface

The most likely defect is a change that works where you tested it and nowhere else. Before calling work done, say which of these applied:

- **Entry points.** The package's root, React, server, mock, and TanStack Table entries. A protocol change reaches all of them.
- **Component Registry.** Styled components are copied into apps by the shadcn CLI, so behaviour belongs in hooks and look belongs in components. See ADR 0001.
- **Frameworks and tables.** The Vite and Next.js examples, and both Grid Adapters: the Rows Adapter and TanStack Table. Server-only code must never be reachable from a client bundle.
- **The Site.** The marketing page, live demo, and developer docs. Update the docs page for any public API you change.
- **Failure paths.** Every new way in needs its way out: cancel, undo, clarification, and the unsupported result.

## Verifying

- Prove the smallest thing first: the tests you touched, then lint and typecheck for the package you changed.
- The merge gate is `pnpm check` once the workspace exists: format, lint, typecheck, unit and contract tests, and build. CI runs it on every PR.
- Every grid adapter passes the shared adapter contract suite.
- Provider tests use a mocked transport. Live Jev tests need an explicit command and `JEV_API_KEY`, and skip cleanly without it.
- Evals use synthetic data only and cover ambiguity, unsupported actions, hidden fields, aliases, compound requests, and adversarial text.
- A regression that could apply the wrong view blocks a release.

## Pull requests

- Never open a PR unless the owner asks for one.
- Conventional commit titles in plain language, such as `fix(core): stale revisions no longer apply`.
- Body: the problem in a sentence or two, then how you fixed it.
- UI changes need before and after screenshots. Motion needs a short video.
- One concern per PR. If the description says "also", split it.

## Documentation

- **Developer docs** live in the Site and teach adopters how to use GridCue. Update the relevant page when a public API or setup step changes.
- **`docs/internals/`** holds the product definition, architecture, and intent protocol, plus constraints a maintainer would get wrong without them. If reading the code answers the question, leave it out.
- **`docs/adr/`** records hard-to-reverse decisions, one short file each. Changing the intent protocol, the view-only boundary, the provider or adapter interfaces, confirmation or confidence defaults, telemetry defaults, licensing, or package names needs an ADR first.
- **`docs/operations/`** will hold maintainer runbooks such as local development, release, and deploy. Create pages only when there is a procedure to write down.
- **`CONTEXT.md`** is a glossary and nothing else.
- When a documented decision changes, rewrite or remove the old text. Do not append a second account.

## Plans and work artifacts

- Approved specs and plans are committed to `docs/superpowers/` as the owner's approval record.
- Keep scratch notes, research dumps, and temporary files outside the repository.

## Where code will live

This is the planned layout. It becomes true as the approved plan is built.

- `packages/gridcue`: the one published package. Its root entry holds the protocol, schemas, compiler, validation, policy, diff, preview text, audit redaction, and the provider and adapter interfaces. Subpath entries: `gridcue/react` for hooks, `gridcue/server` for the Server Handler and Jev provider, `gridcue/mock` for the Mock Provider, and `gridcue/tanstack-table` for the TanStack Table adapter.
- `registry/`: source for the shadcn Component Registry.
- `apps/site`: the Vite Site with marketing, demo, and docs. See ADR 0002.
- `examples/`: minimal Vite and Next.js integrations.
- `evals/`: synthetic eval cases.

## Code standards

- Strict TypeScript and ESM. No untyped `any` at public boundaries.
- Runtime-validate public inputs and provider responses.
- Explicit package exports. No deep-import contracts.
- Operations use stable IDs, never display labels.
- Preview text is rendered deterministically from validated operations. Never ask a model to explain its own plan.
- Accessibility: keyboard operation, visible focus, screen-reader labels, and status cues that don't rely on colour alone.
- Structured errors with stable codes grouped by stage: `INPUT_`, `RESOLUTION_`, `PLAN_`, `POLICY_`, `ADAPTER_`, `PROVIDER_`.
- Treat Utterances, schema descriptions, aliases, and enum labels as untrusted input.
- Telemetry is off by default. Never record raw Utterances or schema details without explicit Host configuration.
- Minimize runtime dependencies, especially in core. Pin exact versions in the lockfile. No `.env` files in git; keep `.env.example` current.
- React Bits and other effect libraries stay in the Site and never enter a package. See ADR 0003.

## Taste

Build the smallest thing that makes the correct behaviour unsurprising. No speculative abstractions, placeholder services, or roadmap features nobody asked for. If a rule here fights the task in front of you, say so plainly and get the owner's sign-off before breaking it.

## Skills

Project skills live in `.agents/skills/`, and `.claude/skills` links to the same folder. Planning uses the superpowers and Matt Pocock skill plugins, which `.claude/settings.json` enables for Claude Code. See `.agents/skills/gridcue-planning/SKILL.md` for how they fit together here.
