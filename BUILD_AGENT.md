# Initial build work order

## Mission

Scaffold **GridCue**, an open-source TypeScript toolkit that converts a natural-language request into a safe, inspectable change to a complex table or data-grid view.

Deliver one thin end-to-end slice: text in, bounded intent resolution, validated plan, human-readable preview, apply, and undo. Use a deterministic mock provider in the demo and include a production-shaped Jev provider behind a server-safe interface.

Read `AGENTS.md` first, then `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, and `docs/INTENT_PROTOCOL.md`. Those four documents are the requirements for this work order.

## Product sentence

> Say what you need to see; GridCue safely configures the view.

Example:

> “Show taxable accounts with a single position over 10%, group by advisor, sort largest concentration first, and keep only account, household, value, and concentration.”

GridCue must propose a structured view patch, show the resolved changes, and apply them only through the host grid adapter.

## Fixed decisions for the scaffold

- Working name: `GridCue`.
- Runtime: Node.js 22 or newer.
- Language/module system: strict TypeScript and ESM.
- Workspace: pnpm monorepo without an additional task orchestrator unless measurements justify one.
- Optional UI: React 19.
- Demo: Vite + React using synthetic wealth-management data.
- Tests: Vitest plus adapter/provider contract tests.
- Initial table integration: TanStack Table.
- Initial decision provider: Jev, isolated behind the generic provider interface.
- Default behavior: preview before apply; never auto-apply from model output.
- Data boundary: no row data leaves the host by default.
- Proposed license: Apache-2.0. Mark it as an owner decision if the repository owner has not confirmed it; do not publish packages before confirmation.

Use current stable dependency versions and commit the lockfile. Do not publish, deploy, create external accounts, or require a live Jev credential.

## Required workspace shape

```text
.
├── AGENTS.md
├── BUILD_AGENT.md
├── README.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── .github/
│   └── workflows/ci.yml
├── apps/
│   └── demo/
├── packages/
│   ├── core/
│   ├── provider-jev/
│   ├── react/
│   └── tanstack-table/
├── evals/
│   └── cases.jsonl
└── docs/
    ├── PRODUCT.md
    ├── ARCHITECTURE.md
    ├── INTENT_PROTOCOL.md
    └── adr/
```

Do not create empty packages for future frameworks or providers.

## Package responsibilities

### `@gridcue/core`

- Canonical types and runtime schemas.
- Schema/capability registry.
- Deterministic literal parsing for numbers, percentages, dates, quoted strings, conjunctions, and common sort direction phrases.
- Compiler from resolved intent to `ViewPlan`.
- Plan validation, policy enforcement, diff generation, deterministic summary rendering, and audit-event redaction.
- Generic `IntentProvider` and `GridAdapter` interfaces.
- No React, TanStack, Jev, DOM, or network imports.

### `@gridcue/provider-jev`

- Jev implementation of the generic intent-provider interface.
- Injected transport so unit tests make no network calls.
- Candidate questions derived only from allowed operations, schema metadata, current view state, and host-approved values.
- Explicit `none`/unsupported options and confidence propagation.
- No secrets in browser-facing code. Expose server-only entry points where appropriate.
- Verify the current official TypeSafe API contract before implementing transport details; do not infer endpoints or response fields from this brief.

### `@gridcue/react`

- Accessible command bar and preview panel.
- Headless hook/controller plus minimally styled reference components.
- States: idle, resolving, ready, needs clarification, unsupported, applying, applied, and error.
- Apply, cancel, edit request, and undo affordances.
- No provider credential handling.

### `@gridcue/tanstack-table`

- Adapter between the canonical protocol and TanStack Table view state.
- Support the MVP operations only.
- Implement the shared adapter contract tests.

### `apps/demo`

- Synthetic advisor/trading account table; no copied production data.
- Text input that works equally with typing or OS-level dictation such as Wispr Flow.
- Deterministic local mock provider, so the demo works after `pnpm install` with no account or API key.
- Toggleable developer panel showing the plan, confidence, validation result, and before/after view state.
- Optional local server route demonstrating where Jev transport belongs, disabled unless configured.

## MVP operations

Implement:

- add or clear filters;
- set one or more sorts;
- set or clear grouping;
- show or hide columns;
- set visible-column order when the adapter supports it;
- reset the view;
- preview, apply atomically, and undo.

Define but do not implement aggregation, pinning, density, saved views, and additional grid adapters unless they fall out trivially from the same contract. Unsupported requests must return a typed result rather than pretending to succeed.

## Required example cases

The mock provider and eval set must cover at least these requests:

1. “Show accounts over $1 million.”
2. “Only taxable accounts with concentration above 10%.”
3. “Group by advisor and sort market value largest first.”
4. “Hide custodian and account number.”
5. “Keep only account, household, market value, and unrealized gain.”
6. “Clear the filters and sorting.”
7. “Show restricted holdings, then place the trades.” The view portion may be proposed; trade placement must be rejected explicitly and nothing may apply until the user resolves the mixed request.
8. “Make it look better.” Must clarify or abstain.
9. A request referencing an unknown column. Must not guess.
10. A request referencing a column present in metadata but disallowed by policy. Must refuse without leaking its values.

## Build sequence

1. Initialize the workspace, shared TypeScript configuration, scripts, formatting/linting, and CI.
2. Implement the protocol types and runtime validators in core.
3. Implement an in-memory reference adapter and shared adapter contract suite.
4. Implement the deterministic mock provider and compiler pipeline.
5. Build the React command bar and preview/apply/undo flow against the in-memory adapter.
6. Add the TanStack Table adapter and wire the demo.
7. Implement the Jev adapter with mocked transport tests and a documented server-side integration seam.
8. Add synthetic eval cases and a command that reports exact plan match, safe abstention, and invalid-plan rejection.
9. Add README setup and one minimal integration example.
10. Run the full quality gate and fix all failures.

Make a checkpoint after steps 3, 6, and 10 if the environment supports commits. Do not rewrite user-owned history.

## Acceptance criteria

- A fresh clone can run `pnpm install && pnpm check` without credentials.
- `pnpm dev` opens a working demo and documents its URL.
- At least one compound request produces multiple ordered operations.
- The preview states exactly what will change using deterministic text.
- Cancel changes nothing; apply changes only view state; undo restores the prior state.
- Unknown, ambiguous, mixed-scope, stale-revision, and disallowed requests fail safely.
- Core has no framework/provider/grid imports.
- The browser bundle contains no provider secret and makes no direct Jev request.
- Unit, contract, and eval fixtures contain synthetic data only.
- CI runs install, lint/format check, typecheck, tests, and build.
- README labels the project as an independent open-source project and does not imply TypeSafe or Wispr endorsement.

## Out of scope for this work order

- Editing data or triggering domain actions.
- Natural-language answers about row-level data.
- Speech recording or transcription.
- Authentication, billing, hosted persistence, telemetry, or cloud deployment.
- AG Grid, MUI Data Grid, Handsontable, or custom enterprise adapters.
- Generative explanations, SQL generation, autonomous agents, or model training.
- Package publication, domain purchase, logo work, or trademark claims.

## Final handoff

Return:

- the implemented vertical slice;
- a concise tree of created files;
- commands and checks run with results;
- known limitations;
- decisions still requiring the owner, especially license and public package-name availability.
