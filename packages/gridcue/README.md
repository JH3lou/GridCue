# gridcue

> Ask a dense grid a plain question. See the view that answers it.

GridCue lets people use natural language to get the insight they need from complicated data, dense grids and tables. A request such as “taxable accounts over 10% in one position, grouped by advisor, biggest first” becomes a validated filter, sort, group and column change that the user previews and applies, with undo.

- **View-only.** It never edits data.
- **Preview before apply.** Ambiguity becomes a question, not a guess.
- **Rows never leave your app.** Only column names and values you approve go to the model, and the model only picks among closed choices; code builds the plan.
- **Headless and grid-agnostic.** A framework-free core, React bindings, TanStack Table and in-memory adapters, and a plain-CSS command bar.

## Try it with no key

```bash
npm i gridcue
```

```tsx
import { createGridCue } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { GridCueBar } from "gridcue/react";
import { createTanStackAdapter, gridcueFilterFn, schemaFromTanStack } from "gridcue/tanstack-table";
import "gridcue/styles.css";

const table = useTable({ features, columns, data, defaultColumn: { filterFn: gridcueFilterFn } });
const [cue] = useState(() => {
  const schema = schemaFromTanStack(table);
  return createGridCue({ schema, adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() });
});

<GridCueBar controller={cue} />
```

The Mock Provider runs in the browser with no server or account. For production, use the Jev provider behind your own endpoint with `gridcue/server`. It keeps your key off the browser; put the endpoint behind your app's auth and rate limits.

## Entries

| Entry | What it holds |
| --- | --- |
| `gridcue` | The Controller, schema, protocol, Rows Adapter, and remote provider |
| `gridcue/react` | `useGridCue` and the plain-CSS `GridCueBar` |
| `gridcue/tanstack-table` | The TanStack Table adapter and schema inference |
| `gridcue/server` | The Server Handler, Node helper, and Jev provider (server only) |
| `gridcue/mock` | The keyless Mock Provider |

Full documentation, examples, and the shadcn components are in the [GitHub repository](https://github.com/JH3lou/GridCue).

GridCue is an independent open-source project, not affiliated with or endorsed by TypeSafe. MIT licensed.
