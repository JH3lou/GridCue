# Setup: from nothing to a working Preview

Docs: [Your grid in 5 minutes](https://gridcue.dev/docs/get-started/quick-start), [Vite and TanStack Table](https://gridcue.dev/docs/guides/vite-tanstack), [Next.js with the Rows Adapter](https://gridcue.dev/docs/guides/next-rows-adapter).

## 1. Read the stack

Look at `package.json` and the table component:

| You find | Use |
| --- | --- |
| `@tanstack/react-table` v9 (`useTable`, `tableFeatures`) | The TanStack adapter: `gridcue/tanstack-table` |
| Rows in memory, rendered by any table | The Rows Adapter: `createRowsAdapter` and `applyView` from `gridcue` |
| TanStack Table v8 (`useReactTable`) | Stop and tell the User: GridCue's adapter targets v9. The Rows Adapter is the fallback. |
| Another grid (AG Grid, MUI) | Stop and ask. The Rows Adapter works only if the app can render from a plain array of rows. |

Also note: Vite or Next.js (it decides where the server route goes later), React 19, and whether Tailwind and shadcn/ui are set up (it decides the UI).

## 2. Wire it with the Mock

For TanStack Table, three additions to the existing table (the quick start shows the full code):

1. `defaultColumn: { filterFn: gridcueFilterFn }`, and the table features GridCue reads and writes: filtering, sorting, grouping, visibility, and column order, with their row models.
2. `schemaFromTanStack(table, options)` for the View Schema.
3. One controller: `createGridCue({ schema, adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() })`.

**Create the controller once**, with `useState(() => …)`. Never use `useMemo` keyed on `table`: `useTable` returns a new object on every state change, so the controller would be rebuilt and undo lost.

For the Rows Adapter, create the adapter and controller outside render, subscribe with `useSyncExternalStore(adapter.subscribe, adapter.getState, adapter.getState)`, and render `applyView(rows, state, schema).rows`.

**Check:** start the app. Type "sort by <a real column label>, largest first". A Preview lists the change and ends "No records will be changed." Apply changes the table; Undo puts it back.

## 3. Pick the UI

| The app has | Use |
| --- | --- |
| Tailwind + shadcn/ui | The shadcn command bar: `npx shadcn@latest add https://gridcue.dev/r/command-bar.json`. The app owns the copied source. |
| Anything else | `GridCueBar` from `gridcue/react`, with `import "gridcue/styles.css"`, restyled through its `--gridcue-*` CSS variables |

Docs: [Components](https://gridcue.dev/docs/components). **Check:** it renders and reads well in light and dark themes, and keyboard use works: Enter previews, Ctrl/⌘ Enter applies, and Escape cancels.
