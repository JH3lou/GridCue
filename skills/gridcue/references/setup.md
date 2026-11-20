# Setup: from nothing to a working Preview

Docs: [Your grid in 5 minutes](https://gridcue.dev/docs/get-started/quick-start), [Vite and TanStack Table](https://gridcue.dev/docs/guides/vite-tanstack), [Next.js with the Rows Adapter](https://gridcue.dev/docs/guides/next-rows-adapter), [Rows on a server](https://gridcue.dev/docs/guides/rows-on-a-server).

## 1. Read the stack

Look at `package.json` and the table component:

| You find | Use |
| --- | --- |
| `@tanstack/react-table` v9 (`useTable`, `tableFeatures`) | The TanStack adapter: `gridcue/tanstack-table` |
| Rows in memory (all of them), rendered by any table | The Rows Adapter: `createRowsAdapter` and `applyView` from `gridcue` |
| Rows fetched from a server by the app's own Data Query (paged, or filtered and sorted there) | The Query Adapter: `createQueryAdapter` from `gridcue`. It holds the View State and never fetches: subscribe to it and build the Data Query from the state. Catch fetch errors inside the subscriber, since an error it throws fails GridCue's change, and don't call `setState` from it. Never the Rows Adapter, which would preview a count the server doesn't keep. Leave `countBeforePaging` out unless the server sorts, cuts to the count, then pages, and its count keeps the rows `applyView` keeps: never a row with no value in the first sorted column. Follow [Rows on a server](https://gridcue.dev/docs/guides/rows-on-a-server), and run the Query Check (`queryCheck` from `gridcue/testing`, [Testing](https://gridcue.dev/docs/api/testing)) in the app's tests against its Data Query. Never import `gridcue/testing` in client code. |
| TanStack Table v8 (`useReactTable`) | The v8 steps below. Tell the User first that `useLegacyTable` is TanStack's deprecated bridge and the guide ends by moving to `useTable`. |
| AG Grid Community 34, 35 or 36 (`ag-grid-community`, `createGrid` or `AgGridReact`) | The AG Grid adapter: `schemaFromAgGrid`, `gridcueColumnDefs` and `createAgGridAdapter` from `gridcue/ag-grid` ([AG Grid](https://gridcue.dev/docs/guides/ag-grid)). Give the grid `columnDefs={gridcueColumnDefs(schema, columnDefs)}`, built once beside the schema (the app's own `defaultColDef` stays as it is), set `cellDataType` on number and date columns, never filter a schema column through a `valueGetter` or `filterValueGetter`, and create the adapter from `onGridReady`'s `e.api` with the same `schema`. It can't group, pin, total or count, and Enterprise and version 33 or older are not tested: tell the User, and stop and ask on those. On the Infinite Row Model, build the Data Query from the View State as in the Query Adapter row above, never from the request's `filterModel`. |
| Another grid (MUI, or any other) | Stop and ask. The Rows Adapter works only if the app can render from a plain array of rows it holds. For rows on a server, see the Query Adapter above. |

**TanStack Table v8 steps.** Docs: [TanStack Table v8 apps](https://gridcue.dev/docs/guides/tanstack-v8). The app needs React 18 or later for v9, and React 19 for the command bar. If it can't move to v9, use the Rows Adapter.

1. Install v9: `npm i @tanstack/react-table@9`.
2. Change the import to the legacy entry: `useReactTable` becomes `useLegacyTable` from `@tanstack/react-table/legacy`, with the guide's renames for the row models, column and table types, `VisibilityState`, and `sortingFn` and `sortingFns` (now `sortFn` and `sortFns`). Search for `sortingFn`: the type check can miss it, and v9 then ignores it. Keep the v8 code otherwise. Run the type check and fix what the guide's "What may also need changing" lists.
3. Add GridCue as for v9, with `useLegacyTable` where the quick start has `useTable`, and no `features` list. Add `getGroupedRowModel` if the table has none.
   - **The app's own filter inputs.** `defaultColumn: { filterFn: gridcueFilterFn }` turns off the app's filter on every column that relied on `auto`, and a column whose `filterFn` is a name ignores GridCue's filter. Give every column the app filters itself the guide's `besideGridCue(filterFn_…)`, with the built-in it named or the one `auto` picks (text `includesString`, numbers `inNumberRange`, true or false `equals`, dates `inDateRange`, lists `arrIncludes`).
   - **Sort options GridCue can't follow.** On a column with `enableSorting: false` or `invertSorting: true` (or a table with `enableSorting: false`), the table doesn't show GridCue's sort. Pass `schemaFromTanStack(table, { columns: { <id>: { capabilities: ["filter", "group", "show", "hide", "reorder"] } } })` for each such column, so GridCue asks instead.

Also note: Vite or Next.js (it decides where the server route goes later), React 19, and whether Tailwind and shadcn/ui are set up (it decides the UI).

## 2. Wire it with the Mock

For TanStack Table, three additions to the existing table (the quick start shows the full code):

1. `defaultColumn: { filterFn: gridcueFilterFn }`, and the table features GridCue reads and writes: filtering, sorting, grouping, visibility, and column order, with their row models.
2. `schemaFromTanStack(table, options)` for the View Schema.
3. One controller: `createGridCue({ schema, adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() })`.

Optional, once the Mock works: let a request name a value the rows hold. Add `localValues: localValuesFromTable(table, ["<name column>"])` to the controller for TanStack Table, or `localValues: { <name column>: () => rows.map((row) => row.<name column>) }` for the Rows Adapter. Ask the User which columns hold names. **Check:** "<a real name>'s accounts" previews `Filter <Column> to exactly “<name>”`.

**Create the controller once**, with `useState(() => …)`. Never use `useMemo` keyed on `table`: `useTable` returns a new object on every state change, so the controller would be rebuilt and undo lost.

For the Rows Adapter, create the adapter and controller outside render, subscribe with `useSyncExternalStore(adapter.subscribe, adapter.getState, adapter.getState)`, and render `applyView(rows, state, schema).rows`.

**Check:** start the app. Type "sort by <a real column label>, largest first". A Preview lists the change and ends "No records will be changed." Apply changes the table; Undo puts it back.

## 3. Pick the UI

| The app has | Use |
| --- | --- |
| Tailwind + shadcn/ui | The shadcn command bar: `npx shadcn@latest add https://gridcue.dev/r/command-bar.json`. The app owns the copied source. |
| Anything else | `GridCueBar` from `gridcue/react`, with `import "gridcue/styles.css"`, restyled through its `--gridcue-*` CSS variables |

Docs: [Components](https://gridcue.dev/docs/components). **Check:** it renders and reads well in light and dark themes, and keyboard use works: Enter previews, Ctrl/⌘ Enter applies, and Escape cancels.
