# GridCue

> Say what you need to see; GridCue safely configures the view.

GridCue is an open-source, headless toolkit for controlling dense data tables with ordinary language. It is built for advisor desktops, trading systems, operations consoles, and other applications where users can already filter, sort, group, aggregate, and manage columns—but must fight the interface to reach the view they have in mind.

```text
“Show taxable accounts with more than 10% in one position,
 group by advisor, and sort the largest concentration first.”
```

GridCue turns that request into a typed view plan, validates it against the host application's actual columns and permissions, previews the change, and applies it through a grid adapter. It never gives a model direct control of the UI or the underlying records.

## Why the name

**GridCue** is the recommended working name. A user gives the grid a cue; the grid presents the right view. It is short, descriptive, and does not make the project sound like an official TypeSafe product.

The initial collision search found no obvious software project using the exact name, but GitHub organization, npm scope, domain, and trademark availability must be checked again immediately before public launch.

Other viable names:

| Name | Strength | Tradeoff |
| --- | --- | --- |
| ViewSpeak | Immediately conveys language-driven views | Sounds voice-only |
| GridIntent | Technically explicit | Existing commercial use makes it a poor launch choice |
| LensCue | Broader than tables | Less immediately clear |
| ViewShift | Conveys transformation | More crowded phrase |

Avoid `JevView`, `Jeview`, and `Jev Lens`: similar names already exist in the young Jev ecosystem, and a vendor name would unnecessarily constrain the architecture.

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

- **View-only by default.** Filter, sort, group, aggregate, and arrange; never mutate records.
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

Add GridCue to an existing TanStack Table app in three lines:

```tsx
import { createGridCue, createRemoteProvider } from "gridcue";
import { GridCueBar } from "gridcue/react";
import { createTanStackAdapter, gridcueFilterFn, schemaFromTanStack } from "gridcue/tanstack-table";
import "gridcue/styles.css";

const table = useTable({ features, columns, data, defaultColumn: { filterFn: gridcueFilterFn } }); // 1

const [cue] = useState(() => {
  const schema = schemaFromTanStack(table, { restricted: ["tax_id"] }); // 2
  return createGridCue({ schema, adapter: createTanStackAdapter({ schema, table }), provider: createRemoteProvider({ endpoint: "/api/gridcue" }) }); // 3
});

<GridCueBar controller={cue} />
```

Mount the server side where your API lives. It keeps your provider key off the browser:

```ts
import { createGridCueHandler, createJevProvider, toNodeHandler } from "gridcue/server";

// Next.js: app/api/gridcue/route.ts
export const POST = createGridCueHandler({ provider: createJevProvider({ apiKey: process.env.JEV_API_KEY }) });

// Express or plain Node
app.post("/api/gridcue", toNodeHandler(createGridCueHandler({ provider })));
```

Using shadcn/ui? Copy the styled components instead of `GridCueBar`: see `registry/`. Keeping rows in memory instead of TanStack? Use `createRowsAdapter` and `applyView`, as `examples/next` does. `examples/vite` runs this quick start, with the registry `CommandBar` in place of `GridCueBar`.

Create the controller once, as above. TanStack's `useTable` returns a new object whenever table state changes, so a `useMemo` keyed on `table` would rebuild the controller.

## Try it

```bash
pnpm install
pnpm dev:vite    # http://localhost:5173, TanStack Table + shadcn
pnpm dev:next    # http://localhost:3100, plain table, no Tailwind
```

Both use the Mock Provider unless `JEV_API_KEY` is set in a `.env` file. See `.env.example`. Both examples follow your OS light or dark setting.

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
