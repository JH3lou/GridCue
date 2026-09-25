<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/site/public/logo-dark.svg">
    <img alt="GridCue" src="apps/site/public/logo.svg" height="56">
  </picture>
</h1>

> Ask a dense grid a plain question. See the view that answers it.

GridCue is an open-source, headless toolkit for controlling dense data tables with ordinary language. It is built for advisor desktops, trading systems, operations consoles, and other applications where users can already filter, sort, group, and manage columns—but must fight the interface to reach the view they have in mind.

```text
“Show taxable accounts with more than 10% in one position,
 group by advisor, and sort the largest concentration first.”
```

GridCue turns that request into a typed view plan, validates it against the host application's actual columns and permissions, previews the change, and applies it through a grid adapter. It never gives a model direct control of the UI or the underlying records.

## The product boundary

GridCue is an **intent-to-view compiler**, not:

- a new data grid;
- a chatbot over enterprise data;
- a natural-language-to-SQL engine;
- a row editor or autonomous workflow agent;
- a speech transcription product.

Wispr Flow and similar tools can dictate into GridCue's normal text field. No dedicated voice integration is required for the first version.

## How it works

```mermaid
flowchart LR
    A["Typed or dictated request"] --> B["Bounded intent resolution"]
    B --> C["Validated ViewPlan"]
    C --> D["Preview and policy check"]
    D --> E["Grid adapter applies view state"]
```

Jev is the first semantic decision provider. It is a good fit because it maps unstructured state to predefined typed decisions and probabilities. GridCue does not ask Jev to generate arbitrary JSON or executable instructions. It supplies closed candidate choices; deterministic code compiles and validates the result.

## Design principles

- **View-only by default.** Filter, sort, group, and arrange columns; never mutate records.
- **Closed world.** The host declares every available column, operator, and capability.
- **Model proposes; code decides.** A provider resolves semantic choices. Code validates and executes.
- **Preview, then apply.** Plans are visible, atomic, and undoable.
- **No rows required.** Schema metadata and host-approved candidates are sufficient for the normal path.
- **Adapters over lock-in.** Core is independent of Jev, React, and any grid implementation.
- **Uncertainty is a feature.** Low confidence produces clarification or no-op behavior.
- **Enterprise-safe integration.** The host retains authorization, credentials, data access, and audit policy.

## What ships

| Package | Purpose |
| --- | --- |
| `gridcue` | The one npm package. Its root entry holds the protocol, compiler, validation, policy, diff, audit, and provider and adapter interfaces |
| `gridcue` React entry | Headless hooks, plus a ready-made `<GridCueBar />` styled with plain CSS |
| `gridcue` server entry | The Server Handler and the Jev provider, never reachable from a browser bundle |
| `gridcue` TanStack Table entry | Adapter for TanStack Table v9, including shadcn's Data Table |
| Component Registry | shadcn/ui command bar, preview, and clarification components, installed with the shadcn CLI |

The examples and evals use synthetic wealth-management data and a deterministic Mock Provider, so contributors need no external account or API key.

## Quick start

**1. Try it with no key.** The Mock Provider runs in the browser: no server, no account. Add GridCue to an existing TanStack Table app:

```tsx
import { createGridCue } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { GridCueBar } from "gridcue/react";
import { createTanStackAdapter, gridcueFilterFn, schemaFromTanStack } from "gridcue/tanstack-table";
import "gridcue/styles.css";

const table = useTable({ features, columns, data, defaultColumn: { filterFn: gridcueFilterFn } }); // 1

const [cue] = useState(() => {
  const schema = schemaFromTanStack(table, { restricted: ["tax_id"] }); // 2
  return createGridCue({ schema, adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() }); // 3
});

<GridCueBar controller={cue} />
```

Type "sort by market value, largest first", review the Preview, and apply. The Mock Provider understands requests that use your column names and declared aliases.

**2. Turn on Jev.** Swap the provider for `createRemoteProvider({ endpoint: "/api/gridcue" })` (from `gridcue`), and mount the server side where your API lives. It keeps your provider key off the browser:

```ts
import { createGridCueHandler, createJevProvider, toNodeHandler } from "gridcue/server";

// Next.js: app/api/gridcue/route.ts
export const POST = createGridCueHandler({ provider: createJevProvider({ apiKey: process.env.JEV_API_KEY }) });

// Express or plain Node
app.post("/api/gridcue", toNodeHandler(createGridCueHandler({ provider })));
```

Using shadcn/ui? Copy the styled components instead of `GridCueBar`: see `registry/`. Keeping rows in memory instead of TanStack? Use `createRowsAdapter` and `applyView`, as `examples/next` does. `examples/vite` runs this quick start, with the registry `CommandBar` in place of `GridCueBar`.

Create the controller once, as above. TanStack's `useTable` returns a new object whenever table state changes, so a `useMemo` keyed on `table` would rebuild the controller.

### Protect the endpoint

`/api/gridcue` spends your Jev credits, so put it behind the same auth and rate limits as the rest of your app. GridCue adds no auth of its own. For example:

```ts
// Next.js: app/api/gridcue/route.ts
export async function POST(request: Request) {
  const session = await auth(); // your app's session check
  if (!session) return new Response("Unauthorized", { status: 401 });
  return handler(request); // handler = createGridCueHandler({ provider })
}

// Express
app.post("/api/gridcue", requireLogin, rateLimit({ windowMs: 60_000, limit: 30 }), toNodeHandler(handler));
```

## Describe your domain, choose a strategy

GridCue is a chassis: your data, grids, and words differ from anyone else's. Three optional schema declarations teach GridCue your domain:

```ts
defineSchema(columns, {
  rowNoun: "account", // what one row is: "biggest accounts first" means the rows
  columns: {
    household: { entity: "household" }, // "largest households first" means households as whole records, so GridCue asks
    registration_type: {
      enumValues: [/* … */],
      valueGroups: [{ label: "Retirement", values: ["ira", "roth_ira"] }], // "retirement accounts" = IRA or Roth IRA
    },
  },
});
```

The Jev provider has two strategies, and each individual question can be switched off:

| Strategy | Questions per part (9 columns) | Best for |
| --- | --- | --- |
| `"fan-out"` (default) | about 65 | Compound requests: "Roth IRAs grouped by rep", "also group by advisor", "advisor within custodian" |
| `"focused"` | 27 | Simple, single-change requests, with the fewest tokens |

```ts
createJevProvider({ apiKey, strategy: "focused" });
createJevProvider({ apiKey, signals: { values: true } }); // opt in: one yes/no per enum value, for undeclared categories
```

Measure your own requests with `pnpm eval:live -- --strategy=focused` or `--without=<signal>`.

## Try it

```bash
pnpm install
pnpm dev:vite    # http://localhost:5173, TanStack Table + shadcn
pnpm dev:next    # http://localhost:3100, plain table, no Tailwind
```

Both use the Mock Provider unless `JEV_API_KEY` is set in the repo-root `.env.local`. See `.env.example`. Both examples follow your OS light or dark setting.

## Roadmap

These are plans, not promises; each lands through a spec and an ADR (see `docs/planning/product-brief.md`).

- **0.2: first success in minutes, many grids per app.** A `pnpm create gridcue` starter, routing a request to the right grid on a multi-grid screen, and a provider contract suite with a reference non-Jev provider in `examples/`.
- **0.3: insight views.** Group subtotals as view state (computed by the grid, never sent to a provider), an AG Grid Community adapter, and a second demo dataset with its own evals.
- **0.4: reach.** Localised Preview strings, and other framework bindings if there is demand.

## Repository status

The first package build is implemented. See `docs/operations/development.md` for commands, and `AGENTS.md` before contributing.

## Independence

GridCue is an independent project. It is not made, sponsored, or endorsed by TypeSafe AI or Wispr Flow. Jev is intended as the first provider integration; Wispr Flow is simply one possible way to enter text.

## Source notes

- [TypeSafe AI: Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [TypeSafe AI documentation](https://docs.typesafe.ai/)
- [Wispr Flow for developers](https://wisprflow.ai/developers)

## License

[MIT](LICENSE).
