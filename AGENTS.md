# GridCue repository instructions

## Purpose

GridCue is an open-source, headless intent-to-view compiler for dense data grids. A user describes the view they need in ordinary language—typed directly, dictated with a tool such as Wispr Flow, or supplied by another host UI—and GridCue produces a validated, reviewable patch to the grid's view state.

The first provider is TypeSafe AI's Jev. Jev helps resolve bounded semantic choices; deterministic code owns parsing, validation, policy, preview, execution, and undo.

## Instruction precedence

1. The current user request or work order.
2. This file.
3. The relevant document named in **Context routing**.
4. Existing code, tests, and established local conventions.

If instructions conflict, stop and report the conflict. Do not silently reinterpret product boundaries.

## Context routing

Always read this file. Then read only what the task needs:

| Task | Read next |
| --- | --- |
| Empty-repo or initial scaffold | `docs/planning/build-plan-grill.md`, then `BUILD_AGENT.md` (a proposal until the owner approves a plan) |
| Project vocabulary | `CONTEXT.md` |
| Product behavior, UX, scope, examples | `docs/PRODUCT.md` |
| Package boundaries, data flow, security | `docs/ARCHITECTURE.md` |
| Public types, operations, validation semantics | `docs/INTENT_PROTOCOL.md` |

Do not preload every document, scan the whole repository, or research adjacent features without a task-specific reason. Use targeted file and symbol searches first.

## Non-negotiable product rules

- GridCue changes **view state**, not underlying records.
- The MVP may filter, sort, group, aggregate, show, hide, reorder, or pin columns; change density; and reset a view.
- The MVP must not edit cells, place trades, submit orders, export data, navigate to privileged screens, or trigger business workflows.
- Model output is a proposal, never executable authority.
- Every proposal is validated against a host-supplied schema and capability registry before preview or apply.
- Unknown columns, operators, values, and actions fail closed.
- Ambiguous or low-confidence requests ask for clarification or do nothing. Never invent a plausible interpretation.
- Applying a multi-operation plan is atomic. A failed operation applies nothing.
- Applied plans are undoable and produce a structured audit event.
- Raw row data is not sent to an intent provider by default. Provider inputs are limited to the utterance, approved schema metadata, current view state, and host-approved candidate values.
- API keys and provider credentials never enter browser bundles, logs, examples, fixtures, or source control.
- Voice is an input method, not a core dependency. Wispr Flow can populate the same text field used by typed commands.

## Architecture boundaries

- `packages/core` is framework-, grid-, and provider-independent. Keep it deterministic except for the injected intent provider.
- `packages/provider-jev` translates bounded resolution questions to and from Jev. It never applies a view change.
- `packages/react` renders optional UI and depends on public core contracts only.
- Grid adapters translate the canonical view protocol to a grid library. They do not contain intent logic.
- `apps/demo` demonstrates the public API. Do not make production packages depend on demo code.
- Host applications own data access, authorization, sensitive-field policy, and the final apply decision.
- Prefer small interfaces and explicit dependency injection over globals, registries with hidden mutation, or provider-specific branches in core.

## Working method

1. Restate the smallest observable outcome for the task.
2. Inspect only the files and symbols that can affect that outcome.
3. Add or update a failing test or eval case when behavior changes.
4. Implement the smallest coherent vertical slice.
5. Run the narrowest relevant checks, then the repository-wide quality gate.
6. Update documentation only when a public contract, architectural decision, setup step, or user-visible behavior changed.

Do not add speculative abstractions, placeholder services, unrelated cleanup, or dependencies for hypothetical future features. Do not implement later phases merely because they are described in a roadmap.

## Expected commands after initial scaffold

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

`pnpm check` must run the merge gate: formatting/linting, type checking, unit and contract tests, and build. Live provider tests must be separate and opt-in.

## Code and API standards

- TypeScript strict mode; ESM; no untyped `any` at public boundaries.
- Public inputs and provider responses receive runtime validation.
- Public package exports are explicit. Avoid deep-import contracts.
- Canonical operations use stable IDs, not display labels.
- User-facing summaries are rendered deterministically from validated operations; do not ask a model to explain its own plan.
- Preserve accessibility: keyboard operation, visible focus, screen-reader labels, and non-color-only status cues.
- Use structured errors with stable codes and safe messages.
- Treat utterances, schema descriptions, aliases, and enum labels as untrusted input.
- Keep telemetry off by default. Never record raw utterances or schema details without explicit host configuration.

## Testing rules

- Unit-test parsing, compilation, validation, diffing, confidence gates, and redaction.
- Every grid adapter implements the shared adapter contract suite.
- Provider tests use mocked transport by default; no network or secret is required for `pnpm test`.
- Live Jev tests require an explicit command and `JEV_API_KEY`; they must skip cleanly otherwise.
- Evals use synthetic data only and include ambiguity, unsupported actions, hidden fields, aliases, compound requests, and adversarial text.
- A regression that could apply the wrong view is release-blocking.

## Dependency and security rules

- Use current stable releases, pin exact resolved versions in the lockfile, and avoid prerelease dependencies unless the task explicitly requires one.
- Minimize runtime dependencies, especially in `core`.
- Never expose provider credentials to the browser. The reference Jev path goes through a host-controlled server endpoint or callback.
- Do not log row contents, credentials, full provider payloads, or sensitive schema labels.
- Do not commit `.env` files. Maintain `.env.example` with names and safe descriptions only.

## Changes that require an explicit decision

Record a short ADR before changing any of these:

- the canonical intent protocol;
- the view-only safety boundary;
- the provider or grid adapter interfaces;
- default confirmation or confidence behavior;
- telemetry defaults;
- licensing or public package names.

## Definition of done

A change is done when the intended behavior works through the public API, failure paths are safe, relevant tests pass, `pnpm check` passes, documentation is current, and no secret or real client data appears in the diff.

In the handoff, report the outcome, files changed, checks run, and any unresolved decision. Keep the summary proportional to the change.
