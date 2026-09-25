<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://gridcue.dev/logo-dark.svg">
    <img alt="GridCue" src="https://gridcue.dev/logo.svg" height="56">
  </picture>
</h1>

> Ask a dense grid a plain question. See the view that answers it.

GridCue lets people use natural language to get the insight they need from complicated data, dense grids and tables. A request such as “taxable accounts over 10% in one position, grouped by advisor, biggest first” becomes a validated filter, sort, group and column change that the user previews and applies, with undo.

- **View-only.** It never edits data.
- **Preview before apply.** Ambiguity becomes a question, not a guess.
- **Rows never leave your app.** The model gets the request text, the values read from it, and the columns and values you expose. It only picks among closed choices; code builds the plan.
- **Headless and grid-agnostic.** A framework-free core, React bindings, TanStack Table and in-memory adapters, and a plain-CSS command bar.

## Try it with no key

With TanStack Table v9 and React 19:

```bash
npm i gridcue @tanstack/react-table
```

```tsx
import {
  type ColumnDef, type RowData, columnFilteringFeature, columnGroupingFeature, columnOrderingFeature, columnVisibilityFeature,
  createFilteredRowModel, createGroupedRowModel, createSortedRowModel, rowSortingFeature, tableFeatures, useTable,
} from "@tanstack/react-table";
import { createGridCue } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { GridCueBar } from "gridcue/react";
import { createTanStackAdapter, gridcueFilterFn, schemaFromTanStack } from "gridcue/tanstack-table";
import { useState } from "react";
import "gridcue/styles.css";

const features = tableFeatures({
  columnFilteringFeature, rowSortingFeature, columnGroupingFeature, columnVisibilityFeature, columnOrderingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  groupedRowModel: createGroupedRowModel(),
});

export function Grid<Row extends RowData>({ columns, data }: { columns: ColumnDef<typeof features, Row>[]; data: Row[] }) {
  const table = useTable({ features, columns, data, defaultColumn: { filterFn: gridcueFilterFn } });
  // Create the controller once: useTable returns a new object whenever the table's state changes.
  const [cue] = useState(() => {
    const schema = schemaFromTanStack(table);
    return createGridCue({ schema, adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() });
  });
  return (
    <>
      <GridCueBar controller={cue} />
      {/* render the table as you already do */}
    </>
  );
}
```

The Mock Provider runs in the browser, with no server and no account. Not using TanStack Table? The Rows Adapter in `gridcue` works over any array.

## Turn on Jev

Jev runs behind an endpoint you control, so your key never reaches the browser:

```bash
npm i @typesafe-ai/sdk
```

```ts
// A server route, such as app/api/gridcue/route.ts in Next.js
import { createGridCueHandler, createJevProvider } from "gridcue/server";

export const POST = createGridCueHandler({ provider: createJevProvider({ apiKey: process.env.JEV_API_KEY }) });
```

In the browser, swap `createMockProvider()` for `createRemoteProvider({ endpoint: "/api/gridcue" })` from `gridcue`. Put the endpoint behind your app's auth and rate limits.

## Entries

| Entry | What it holds |
| --- | --- |
| `gridcue` | The Controller, schema, protocol, Rows Adapter, and remote provider |
| `gridcue/react` | `useGridCue` and the plain-CSS `GridCueBar` |
| `gridcue/tanstack-table` | The TanStack Table adapter and schema inference |
| `gridcue/server` | The Server Handler, Node helper, and Jev provider (server only) |
| `gridcue/mock` | The keyless Mock Provider |

Docs, a live demo, and the shadcn components: [gridcue.dev](https://gridcue.dev). Source: [GitHub](https://github.com/JH3lou/GridCue).

GridCue is an independent open-source project, not affiliated with or endorsed by TypeSafe. MIT licensed.
