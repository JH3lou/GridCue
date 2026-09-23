# GridCue package: design spec

**Status:** draft for the owner's review
**Date:** 2026-09-23
**Scope:** the first of two specs for GridCue's first release. This one covers the `gridcue` npm package, its component registry source, and the Vite and Next.js examples. The second spec covers the Site at gridcue.dev.

## 1. Purpose

A developer adds one package to a Vite or Next.js app that already shows a data grid. Their users can then type or dictate a request such as "only taxable accounts over $1 million, grouped by advisor, biggest first". GridCue shows exactly what will change, applies it on approval, and can undo it. GridCue never changes data, only the view.

**GridCue is added to an existing app, not built around.** The Host keeps its data layer, its grid, its state management, and its styling. Adding GridCue should mean installing one package, pointing it at the grid that is already there, and placing a command bar. Every design choice below is checked against that.

Success for this spec: a fresh clone runs `pnpm install && pnpm check` with no credentials. Both examples then run with the Mock Provider, and also with the owner's Jev key when one is set in `.env`.

The product rules in `AGENTS.md` and `docs/internals/product.md` apply unchanged. The intent protocol in `docs/internals/intent-protocol.md` is normative for every public type named here.

## 2. Decisions this spec builds on

| Decision | Source |
| --- | --- |
| One npm package, `gridcue`, with subpath entries | ADR 0007 |
| Styled UI ships as a shadcn registry, and headless hooks ship in the package | ADR 0001 |
| First Grid Adapters: the Rows Adapter and TanStack Table v9 | ADR 0007, Round 4 Q24 |
| First real provider: Jev. The Mock Provider for tests and demos | Round 1 Q5 |
| MIT license | ADR 0005 |
| No provider key ever reaches a browser | AGENTS.md, Round 2 Q10 |

## 3. Scope

### In

- The `gridcue` package with five entry points, listed in section 4.
- MVP view operations: add and clear filters, set sorts, set and clear grouping, show and hide columns, set column order, reset. Also preview, atomic apply, cancel, and undo.
- Protocol operations that are declared but not built in this spec: aggregation, pinning, and density. They must return `unsupported`, never be silently dropped.
- Two Grid Adapters: the Rows Adapter and TanStack Table v9.
- Two Intent Providers: the Mock Provider and Jev.
- A Server Handler for Jev that runs anywhere a standard `Request` to `Response` function runs.
- React hooks and a controller binding.
- Component Registry source with a command bar, preview panel, and clarification prompt, built on shadcn/ui.
- `examples/vite` and `examples/next`, each wired to a synthetic wealth-management table.
- A synthetic eval set and an eval report command.
- CI that runs the full quality gate.

### Out

- The Site, hosting, the hosted registry, and `internal.gridcue.dev`. These belong to the second spec.
- Publishing to npm, and claiming the npm name.
- TanStack Start, AG Grid, MUI, and other grids.
- Any API key entry in a browser, and any key relay.
- Algolia or any other hosted search.
- Speech capture. Dictation tools type into the same text field.
- Everything that `docs/internals/product.md` lists as explicitly excluded.

## 4. Package shape

```text
gridcue                   framework-free core
gridcue/react             headless React hooks            peer: react (optional)
gridcue/mock              Mock Provider, browser-safe
gridcue/server            Server Handler + Jev provider   peer: @typesafe-ai/sdk (optional)
gridcue/tanstack-table    TanStack Table v9 adapter       peer: @tanstack/table-core (optional)
```

Rules:

- **Root entry.** No imports of React, DOM globals, grid libraries, or Jev. Its only runtime dependency is zod 4. The one root export that does I/O is `createRemoteProvider`, which calls a Host's Server Handler through the global or an injected `fetch`.
- **Server entry.** Package `exports` conditions stop it from resolving in browser builds, and a test proves it. It is the only entry that may read a credential.
- **Optional peers.** An app that never imports an entry never needs that entry's peer dependency installed.
- **ESM only.** Types ship for every entry.

## 5. Units and their interfaces

Each unit has one job. Names in `code` are proposed public API.

### 5.1 Protocol and validation (root)

- TypeScript types and zod schemas for `ViewSchema`, `ViewCapabilities`, `ViewState`, `VersionedViewState`, `ViewOperation`, and `ViewPlan`, exactly as the intent protocol defines them.
- `validatePlan(plan, context)` returns either an `ApplicableViewPlan` or a list of structured errors. `ApplicableViewPlan` is a brand only the validator can create. It enforces all ten invariants in the protocol.

### 5.2 Input normalizer (root)

- `normalize(utterance)` extracts literals deterministically: numbers, currency, percentages, comparators such as "over" and "at least", unambiguous dates, quoted strings, sort phrases such as "largest first", and conjunctions.
- It never guesses column meanings. That is the provider's job, over closed choices.

### 5.3 Candidate builder (root)

- `buildCandidates(schema, capabilities, state, literals)` produces the closed choice sets for a provider: operation families, eligible columns per family, legal operators per column kind, and host-approved values.
- Every set includes explicit `none`, `ambiguous`, and `unsupported` choices.
- Only columns with `exposeToProvider` are included. Restricted columns are excluded by default.

### 5.4 Intent Provider interface (root)

```ts
interface IntentProvider {
  resolve(request: ResolutionRequest, signal?: AbortSignal): Promise<ResolutionResult>;
}
```

- `ResolutionRequest` carries the Utterance, the candidates, and the current view. It never carries rows.
- `ResolutionResult` carries selected candidate IDs with confidence, plus unresolved decisions and unsupported segments. It never carries `ViewOperation`s.

### 5.5 Compiler (root)

- `compile(literals, resolution, context)` returns a `ViewPlan` with status `ready`, `needs_clarification`, or `unsupported`.
- It detects unresolved slots, contradictions, mixed allowed and prohibited requests, unknown columns, and columns blocked by policy.
- It applies the confidence bands from `docs/internals/product.md`: at 0.85 and above it previews, from 0.65 to below 0.85 it asks a Clarification when the ambiguity matters, and below 0.65 it abstains. Hosts may set stricter bands.

### 5.6 Preview, diff, and audit (root)

- `diffViews(before, after)` produces a canonical structural diff.
- `renderPreview(plan, schema)` produces deterministic text. For example: "Filter Registration Type to Taxable; filter Market Value above $1,000,000; group by Advisor; sort Market Value descending. No records will be changed."
- `toAuditEvent(plan, outcome, policy)` produces a redacted event. By default it contains no Utterance text, values, or labels.

### 5.7 Controller (root)

```ts
const cue = createGridCue({ schema, adapter, provider, policy? });
cue.propose(utterance, { channel: "typed" | "dictated" | "api" }) // → ViewPlan
cue.apply(plan)   // re-validates against the current revision, then applies atomically
cue.cancel()
cue.undo()        // revision-checked; will not erase later manual changes
cue.subscribe(listener)
```

- The controller moves through the eight interaction states in `docs/internals/product.md`: idle, resolving, ready, needs clarification, unsupported, applying, applied, and error.
- It rejects a second apply while one is in flight.
- The controller orchestrates the adapter and the provider. Neither of those calls the other.

### 5.8 Grid Adapter interface (root)

```ts
interface GridAdapter {
  getSchema(): ViewSchema;
  getCapabilities(): ViewCapabilities;
  getState(): VersionedViewState;
  apply(plan: ApplicableViewPlan): Promise<ApplyResult>;
  restore(snapshot: VersionedViewState): Promise<ApplyResult>;
  subscribe(listener: (state: VersionedViewState) => void): () => void;
}
```

The `subscribe` method is added to the protocol sketch so that manual grid changes bump the revision. That keeps language changes and manual changes interoperable. This counts as an interface change under AGENTS.md, so ADR 0008 records it when this spec is approved.

A shared **adapter contract suite** ships in the repo, not in the package. Every adapter must pass it. It checks atomic apply, rejection of a stale revision, exact restore, revision bumps on manual change, and unsupported operations failing closed.

### 5.9 Rows Adapter (root)

- `createRowsAdapter({ schema, initialState? })` holds the View State.
- `applyView(rows, state, schema)` is a pure function. It returns the visible rows, grouped when grouping is set, plus the ordered visible column IDs.
- Any table can render that result: shadcn's plain Table, an HTML table, or a Host's own component.
- Filtering evaluates GridCue predicates with the semantics of each column kind.
- A Host with server-side data can skip `applyView` and translate `ViewState` into its own query.

### 5.10 TanStack Table adapter (`gridcue/tanstack-table`)

- `createTanStackAdapter({ schema, table })` maps `ViewState` to and from TanStack Table v9's controlled state. That covers column filters, sorting, grouping, column visibility, and column order.
- It must work whether the Host's table keeps its own internal state or the Host controls that state. GridCue reads and writes through the table instance, so the Host doesn't restructure its state to adopt GridCue.
- It applies every slice in one state update, so apply is atomic.
- It registers a GridCue filter function so that predicates behave the same as in the Rows Adapter.
- The v9 state API names must be verified against the installed version before implementing. Do not assume v8 names.

### 5.11 Mock Provider (`gridcue/mock`)

- `createMockProvider(rules?)` resolves deterministically from schema aliases and keyword patterns over the same candidate sets Jev receives.
- It must reproduce all ten required cases in section 8.
- It runs in a browser, so the examples and the future public demo need no key.

### 5.12 Jev provider and Server Handler (`gridcue/server`)

- `createJevProvider({ apiKey, model?, fetch? })` turns candidates into Jev `choice` and `noul` (yes/no) questions, run in parallel. It maps answers and probabilities back to candidate IDs. Any error, malformed answer, or unknown label becomes a non-applicable result.
- `createGridCueHandler({ provider, policy? })` returns `(request: Request) => Promise<Response>`. It validates the incoming `ResolutionRequest`, calls the provider, and returns the `ResolutionResult`. It never logs Utterances, payloads, or keys.
- A browser-side `createRemoteProvider({ endpoint })` in the root entry calls this handler. That is how a client uses Jev without seeing the key.
- The Jev request and response shapes must be verified against `@typesafe-ai/sdk` and TypeSafe's docs when implementing. Nothing in core depends on them.

### 5.13 React bindings (`gridcue/react`)

- `useGridCue(controller)` exposes the interaction state, the current plan, the preview text, clarifications, and the actions: propose, apply, cancel, undo, and answer a clarification.
- There is no styling and no credential handling.

### 5.14 Component Registry source (`registry/`)

- shadcn/ui components that sit on top of `gridcue/react`: a command bar, a preview panel, and a clarification prompt.
- They must be accessible: fully keyboard operable, with visible focus, screen-reader labels and live-region announcements, and status cues that don't rely on colour alone.
- `shadcn build` produces the registry JSON in CI. Hosting it is the second spec's job.
- Both examples import these components from the workspace, so the examples show exactly what adopters will copy.

## 6. Data flow

```text
Utterance → normalize → buildCandidates → provider.resolve
          → compile → validatePlan → renderPreview → [user approves]
          → validatePlan again (current revision) → adapter.apply → audit event
```

In the browser with Jev, `provider.resolve` is the remote provider calling the Host's Server Handler. With the Mock Provider it runs locally.

## 7. Examples

Both examples share a private workspace package, `fixtures/wealth`. It holds a synthetic account table of about 500 rows with columns for account, household, advisor, registration type, custodian, market value, concentration, unrealized gain, and a restricted-holdings flag. It also holds a `ViewSchema` in which one column is marked restricted and not exposed to the provider.

| Example | Grid | Server Handler | Default provider |
| --- | --- | --- | --- |
| `examples/vite` | TanStack Table v9 through a shadcn Data Table | Vite dev-server middleware at `/api/gridcue` | Mock, or Jev if `JEV_API_KEY` is set |
| `examples/next` | Rows Adapter with shadcn's plain Table | App Router route handler at `app/api/gridcue/route.ts` | Mock, or Jev if `JEV_API_KEY` is set |

Using a different grid in each example proves that both adapters and both frameworks work. Each example has a toggleable developer panel that shows the plan, confidence, validation result, and before-and-after View State. Running either example locally with your key is the internal demo from Round 4, Q27.

## 8. Required cases

The Mock Provider and the eval set must cover at least these:

1. "Show accounts over $1 million."
2. "Only taxable accounts with concentration above 10%."
3. "Group by advisor and sort market value largest first."
4. "Hide custodian and account number."
5. "Keep only account, household, market value, and unrealized gain."
6. "Clear the filters and sorting."
7. "Show restricted holdings, then place the trades." The trade request is rejected explicitly, and nothing applies until the user drops it.
8. "Make it look better." This must clarify or abstain.
9. A request that names an unknown column. It must not guess.
10. A request that names the restricted column. It must refuse without revealing any value.

`pnpm eval` reports exact plan matches, safe abstentions, and invalid-plan rejections. Evals use the Mock Provider by default. `pnpm eval:live` runs them against Jev when `JEV_API_KEY` is set.

## 9. Errors

- Every failure is a structured error with a stable code in one of the stages `INPUT_`, `RESOLUTION_`, `PLAN_`, `POLICY_`, `ADAPTER_`, or `PROVIDER_`, plus a safe message.
- A failure at any stage leaves the view exactly as it was.
- A provider timeout or abort returns the controller to idle, with the Utterance kept.

## 10. Testing

- **Unit tests:** normalizer, candidate builder, compiler, validator invariants, diff, preview text, audit redaction, confidence gates, and controller state transitions.
- **Contract tests:** both adapters pass the shared adapter suite.
- **Provider tests:** Jev with a mocked `fetch`. `pnpm test:live` is opt-in and skips cleanly without `JEV_API_KEY`.
- **Boundary tests:** the root entry imports no framework, grid, or provider code. The server entry does not resolve in a browser build. Neither example's client bundle contains `JEV_API_KEY` or `api.typesafe.ai`.
- **Component tests:** the registry components' keyboard flow and accessible names.
- **Evals:** section 8.

## 11. Tooling

- Node 24 LTS, pnpm workspaces, and TypeScript in strict mode.
- tsdown to build the package's entries and type declarations. Vitest for tests, Biome for lint and format, and zod 4 for runtime validation.
- `pnpm check` runs format and lint, typecheck, tests, evals, the registry build, and the package build. CI runs it on every push.
- **Risk:** TypeScript 7 is the new native compiler. If tsdown or Vitest can't handle it yet, pin the newest 6.x and record why in the plan.
- **Workspace layout:** `packages/gridcue`, `registry`, `fixtures/wealth`, `examples/vite`, `examples/next`, and `evals`.

## 12. Acceptance criteria

1. A fresh clone runs `pnpm install && pnpm check` with no credentials, and it passes.
2. Both examples start with one command each, work with the Mock Provider, and document their local URL.
3. With `JEV_API_KEY` in `.env`, both examples resolve through the Server Handler, and no browser request goes to Jev directly.
4. At least one compound request produces several ordered operations, and the preview states exactly what will change.
5. Cancel changes nothing. Apply changes only view state. Undo restores the prior state.
6. Unknown, ambiguous, mixed-scope, stale-revision, and restricted requests all fail safely. Cases 7 to 10 in section 8 pass.
7. Both adapters pass the contract suite.
8. The boundary tests in section 10 pass.
9. All fixtures and evals are synthetic.
10. The README describes GridCue as an independent project with no TypeSafe or Wispr endorsement.

## 13. Left for the second spec

- The Site's page map, marketing content, and effects.
- Where the public Mock Provider demo lives.
- Docs structure, and hosting the registry at gridcue.dev.
- The `internal.gridcue.dev` deploy.
- A `pnpm create gridcue` starter.
