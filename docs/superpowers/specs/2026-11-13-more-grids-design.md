# Reaching the grids enterprises run: design spec

Status: approved by the owner on 2026-11-13. Answers in docs/planning/more-grids-grill.md.

**Date:** 2026-11-13
**Scope:** grill answers Q1 to Q7 in `docs/planning/more-grids-grill.md`, as recommended, including the fact check's change to Q7 (no peer dependency) and its correction to Q6 (an `in` AG Grid can't hold fails at Apply, not before the Preview). The owner approved them as the order plan states them: D9 and D23 to D28, with D3 for a grid that can't group (`docs/superpowers/plans/2026-11-13-five-opportunities-order.md`, section 7).
**Plan:** `docs/superpowers/plans/2026-11-13-more-grids.md`
**Build order:** opportunity 3 of the five the owner put before the four bets on 2026-11-13. It is designed on today's code, where every request goes through an Intent Provider. Section 15 says where it meets the four bets.

This is the current best design. Every mechanism below has an evidence bar in section 10, fixed before any code. A mechanism that misses its bar is reworked or removed; the bar does not move. Each unit says what evidence would change it.

## 1. Purpose

GridCue drives two kinds of grid today: rows held in memory (the Rows Adapter) and TanStack Table v9. Most apps that could use it run something else. This work reaches three more, without generating SQL, without a new runtime dependency (ADR 0007), and without a new way to show a wrong view:

1. **TanStack Table v8 apps,** through v9's own `useLegacyTable` bridge, which runs today's adapter unchanged.
2. **Grids whose rows live on a server,** through a Query Adapter that is safe by default, a guide, and a Query Check the Host runs against its own Data Query.
3. **AG Grid Community,** through a new `gridcue/ag-grid` entry that writes into AG Grid's own filters, set to GridCue's meanings.

Along the way it fixes two defects found in the grill: undo is lost on a TanStack table whose state the Host controls, and Apply reports "View updated." when a Host-controlled table never took the change.

Success means:

- 0 wrong views on every labelled set and every row check, old and new;
- each mechanism meets its bar in section 10, on cases labelled or seeds chosen before its code exists;
- a Host on the Rows Adapter or the TanStack adapter, with state the table owns, sees no change at all.

## 2. Decisions this spec builds on

| Decision | Source |
| --- | --- |
| v8 apps move through `useLegacyTable`. No v8 entry | Grill Q1 (D9) |
| A guide, a tested example, and a Query Check in `gridcue/testing`. GridCue ships no translator | Grill Q2 (D25) |
| A named Query Adapter in the root entry, without `limit.set` unless the Host says its server cuts before paging; its `without` option only removes | Grill Q3 (D23) |
| An apply on a server grid is done when the View State changes. Loading and fetch errors stay with the Host | Grill Q4 (D24) |
| AG Grid Community only: Client-Side and Infinite row models, no `group.set` | Grill Q5 (D26) |
| AG Grid's own filters, set to GridCue's meanings by `gridcueColDef(schema)`, and read back | Grill Q6, as corrected (D27) |
| `gridcue/ag-grid`, typed structurally, with no peer dependency and a check at creation | Grill Q7, changed in the fact check (D28) |
| A grid that can't do something asks a question with no choices, applies nothing, and says so from one shared piece of code. No protocol change | Order plan D3 |
| One concern per PR; additive, optional names; the protocol stays 0.1 | AGENTS.md, ADR 0010 precedent |

## 3. Scope

### In

- **PR 1:** an apply or restore on the TanStack adapter resolves only when the table holds what was written; one new test in the shared adapter contract suite (5.1).
- **PR 2:** the v8 path: a contract-suite run on `useLegacyTable`, a guide, and the agent skill's v8 row (5.2).
- **PR 3:** a grid that can't group says so, and the "not sure" hint names only what the grid does (5.3).
- **PR 4:** `createQueryAdapter` (5.4).
- **PR 5:** `gridcue/testing` with `queryCheck`, the "Rows on a server" guide, and a paged page in the Next.js example, checked on the ledger fixture as a second schema (5.5).
- **PR 6:** `gridcue/ag-grid`: the adapter, `gridcueColDef`, `schemaFromAgGrid`, a Vite example, a Next.js page, and the guide (5.6).
- ADRs 0031, 0032 and 0033 (section 7), three new terms, and one sentence added to the Rows Adapter's entry (section 8).

### Out

- **Generating SQL, ORM calls, or REST parameters.** GridCue hands the Host a View State. The example's query is Host code, and it is labelled so.
- **A v8 entry** (`gridcue/tanstack-table-v8`). Reconsidered only on the evidence in 5.2.
- **AG Grid Enterprise:** row grouping, the Server-Side Row Model, the Set Filter. An Enterprise grid can use the adapter; only Community is tested, and the docs say so.
- **AG Grid's pivoting, charts, and editing.** Editing is outside GridCue's view-only rule.
- **Where empty cells go in a sort with no count.** The adapters already differ (grill, "Sorting is not shared"). Opportunity 2 owns the count; the order of empty cells is left to its own change. The Query Check does not test it until core defines it.
- **`limit.set` on the TanStack adapter.** Opportunity 2 owns it. This spec adds one constraint to it (section 14).
- **Shipping the adapter contract suite** as a public API. It stays a file adopters copy.
- **MUI X, Glide, and other grids.** "Build an adapter" stays the path.
- **A loading state in GridCue's UI** for a server fetch. The Host's grid shows its own.

## 4. Shared pieces

### 4.1 What a filter means, written down once

The guide, the Query Check, and the AG Grid settings all copy one table. It is today's `matchesPredicate` (`evaluate.ts`), not a new rule.

| View State | Keeps | Leaves out | A Data Query that copies it naively |
| --- | --- | --- | --- |
| `neq "x"` | every row whose cell isn't `x`, **including empty cells** (`null`, missing, `""`) | rows equal to `x` | SQL `<>` drops `NULL` rows. *Verified in SQLite* |
| `eq`, `in` on a text column | equal **ignoring case** | empty cells | SQL `=` is case-sensitive in some databases |
| `eq`, `in` on an enum, number, date, or yes/no column | exactly equal | empty cells | |
| `contains`, `startsWith` | ignoring case, always | empty cells | `LIKE` case rules vary by database |
| `gt`, `gte`, `lt`, `lte` | as written | empty cells | |
| `between {min, max}` | **both ends included** | empty cells | an exclusive range drops the ends |
| `isEmpty` | `null`, missing, `""` | everything else, **including whitespace-only text** | AG Grid's "blank" includes whitespace-only text |
| A count (`limit`) | the first N rows of the sorted, filtered rows, before grouping | the rest | cutting after paging keeps the first N of one page |

The table states sorting only as "by each sort column in turn, in its direction". Where empty cells go is not stated yet (section 3, Out).

The table follows core. Two rows change before the Query Check is built (order plan): a count never keeps a row with no value in the first sorted column (operation set 5.1), and a date in a filter means the whole day in the calendar's time zone, on date and date-and-time columns alike (named filters 5.5). The guide, the Query Check and the AG Grid settings copy the table as it stands when they are built, with those two rows in it.

### 4.2 An apply is done when the grid holds it

`GridAdapter.apply` already promises "every operation or none". This adds the second half: **`apply` and `restore` resolve with `ok: true` only once the grid holds the state that was written,** and the Revision they return is the one the grid now has. A table whose state the Host controls updates on its next render, so an adapter waits for it. An adapter whose grid updates at once returns at once, as today.

This changes no type and no existing adapter's behaviour where the grid owns its state. It is ADR 0031 (section 7) because it tightens the adapter interface's contract, and the shared contract suite gains a test for it.

## 5. Units

### 5.1 Host-controlled TanStack state (PR 1)

| Request and setup | Today | After |
| --- | --- | --- |
| "sort by team ascending", Apply, then Undo, on a table that owns its state | Applies; undo restores | Unchanged |
| The same, with `state: { sorting }, onSortingChange: setSorting` | Applies; undo refused: "The view changed after that update, so undo would erase newer changes." | Applies; undo restores |
| The same, with `state: { sorting }` and **no** `onSortingChange` | "View updated."; the table stays unsorted | "The grid couldn't apply that change. Nothing was changed." |
| A filter and a sort, where the Host controls only `sorting` | Undo refused | Applies; undo restores |
| The User clicks a header while GridCue waits for the render | Not reachable today | Apply fails; the Controller's existing recovery runs: "…the view changed meanwhile, so GridCue left it as it is." |

- After its write, the adapter compares the table's View State with what it wrote. Equal: it returns, with the Revision the store change produced. Not equal: it waits for the table's store to notify, and checks again on each notification.
- **The wait is bounded at 1,000 ms,** a constant with a test. When it runs out, `apply` throws. The Controller already handles a throwing apply: it puts the previous view back when nothing else changed, and says which happened (`controller.ts:345-370`). With no change handler, the table never changed, so the message is "Nothing was changed."
- `restore` waits the same way, so undo and reset are covered.
- The adapter keeps counting Revisions from store notifications, as today. Its own write no longer returns a Revision the table doesn't hold.
- **Docs:** the TanStack guide says a controlled slice needs its change handler, and that the Host sets state first and fetches after.

*Would change if:* a real Host sets table state only after its fetch returns, so 1,000 ms is too short. Then the bound becomes an adapter option, never unbounded.

### 5.2 TanStack Table v8 apps (PR 2)

| Setup | Today | After |
| --- | --- | --- |
| The agent skill finds `@tanstack/react-table` 8 | "Stop and tell the User: GridCue's adapter targets v9." | The steps: install `@tanstack/react-table@9`, change the import to `@tanstack/react-table/legacy`, keep the v8 code, add GridCue as for v9 |
| A v8 table moved to `useLegacyTable`, state owned by the table | Works (grill probe) | Works, and CI proves it with the contract suite |
| The same, with Host-controlled state | Undo lost (same defect as 5.1) | Fixed by PR 1 |
| A Host on React 16 or 17 | No path | Still no path: v9 needs React 18, and `gridcue/react` needs 19. The guide says so; the Rows Adapter remains |

- **No new code in the package.** CI runs the shared contract suite on a `useLegacyTable` table, both owned and Host-controlled, through `renderHook`. `@tanstack/react-table` 9.2.4 is a dev dependency of `packages/gridcue` by then, pinned exactly: PR 1 adds it for its own harnesses.
- **The guide is a migration, not a home.** `useLegacyTable` is itself marked as "a compatibility layer for migrating from v8". The guide shows the one-import move, then the move to `useTable` with `tableFeatures`, which the existing Vite guide covers.

*Would change if:* the held-out run in section 10 shows common v8 tables failing on the bridge, a real Host can't move to v9, or TanStack removes `useLegacyTable`. Then a v8 entry (grill Q1 (b)) comes back to the owner.

### 5.3 A grid that can't group says so (PR 3)

| Request, on a grid that doesn't list `group.set` | Today | After |
| --- | --- | --- |
| "group by advisor" | "I'm not sure what to change for “group by advisor”. Try asking to filter, sort, group, or show or hide columns." | "This grid can't group rows." |
| "taxable accounts grouped by custodian" | "I'm not sure what to do with “custodian”. Try rephrasing that part." | "This grid can't group rows." Nothing applies |
| "ungroup" | Asked | "This grid can't group rows." |
| "whatever looks risky" (no family read) | "…Try asking to filter, sort, group, or show or hide columns." | "…Try asking to filter, sort, or show or hide columns." |
| Any request, on a grid that lists `group.set` | — | Unchanged |

- **A grouping verb** ("group", "grouped by", "ungroup") read by code, in a part, on a grid without `group.set`, ends the request in a required Clarification with that prompt and no options. Nothing applies, including other parts of the same request. Asking is the narrowest reading: the User asked for both changes, and showing one would be a different view.
- **The hint** in `compile.ts:661` lists only the families the grid's capabilities offer.
- No protocol change: a Clarification with no options already exists. No new reading: a request that today ends in a question still ends in a question, with a truer one.
- **One piece of code for every "this grid can't".** This PR builds one function that takes the operation the grid doesn't list, and wires it for grouping, the only operation with a labelled set here. It lands before the operation set's pins, density and totals, which reuse it for a grid whose Host hasn't turned them on (operation set 4.2). A count the grid doesn't list is not part of it: the plan still sorts alone, with ADR 0018's note. The owner chose this over a new unsupported category in the protocol, which would have needed an ADR (order plan D3).
- AG Grid Community (5.6) and a Query Adapter with `without: ["group.set"]` (5.4) are where Users meet this.

*Would change if:* the held-out set shows a grouping word read where the User meant something else ("group" as a value or a column name). Then the rule narrows to the verb at the start of a part.

### 5.4 The Query Adapter (PR 4)

```ts
import { createQueryAdapter } from "gridcue";

const adapter = createQueryAdapter({
  schema,
  initialState,              // optional, as for the Rows Adapter
  countBeforePaging: false,  // default; true only when the Host's server sorts, cuts to N, then pages
  without: ["group.set"],    // optional; can only remove
});

adapter.subscribe(({ state }) => refetch(state)); // the Host's own Data Query
adapter.setState((s) => ({ ...s, sorts: [{ columnId: "market_value", direction: "desc" }] })); // a header click
```

| Request, wealth schema | Rows Adapter used for a server grid (today's only option) | Query Adapter, defaults | Query Adapter, `countBeforePaging: true` |
| --- | --- | --- | --- |
| "top 10 accounts by market value" | Preview "Show only the first 10 rows"; a Host that ignores `limit` shows every row. **Wrong view** | Sort by Market value, descending. Note: "Count not applied: this grid can't show only the first 10" | Sort and "Show only the first 10 rows"; the Host's server cuts before paging |
| "group by advisor", with `without: ["group.set"]` | Groups, if the Host's table can; nothing says if it can't | "This grid can't group rows." (5.3) | Same |
| "taxable accounts over $1m" | Applies | Applies, the same View State | Same |

- **It shares the Rows Adapter's code.** Both are built from one internal state holder. The Query Adapter's Revisions read `query:n`. It has the same `setState` for the Host's own controls.
- **Operations:** `MVP_OPERATIONS`, minus `without`, plus `limit.set` only when `countBeforePaging` is true.
- **Pins, density and totals** (operation set, built first). The shared holder carries the `renders` option, so a Query Adapter lists `columns.pin` and `density.set` only when the Host names them. It never lists `aggregation.set`: a total over rows on a server is a Data Query of its own, and the Query Check doesn't test one. `renders: ["totals"]` throws `INPUT_CONFIG` here.
- **`without` fails closed.** A name that isn't in the list throws `INPUT_CONFIG` at creation, naming it. A typo can never leave an operation listed by accident.
- **An apply is done when the View State changes** (grill Q4). The Host's subscription fires, it refetches, and loading and fetch errors are its own, as for a header click. Undo works the same way.
- **The count follows core.** With `countBeforePaging`, the Host's server must keep what `applyView` keeps. The operation set changes that first, so an empty cell is never in the top N (its 5.1). The Query Check tests the meaning core holds when it runs.
- **The Rows Adapter is unchanged.** Its docs say it is for rows in memory and point server Hosts here.

*Would change if:* the owner prefers one adapter with a required "where are the rows" option (grill Q3).

### 5.5 The Query Check and the server guide (PR 5)

```ts
import { queryCheck } from "gridcue/testing";

const check = queryCheck(schema, { id: "account_id", operations: adapter.getCapabilities().operations });
await loadIntoTestDatabase(check.rows);            // synthetic rows only
for (const c of check.cases) {
  const ids = await myDataQuery(c.state);          // the Host's own query, ids in order
  const result = c.compare(ids);
  if (!result.ok) throw new Error(`${c.name}: ${result.message}`);
}
// A failure reads: "not equal keeps empty cells (Custodian is not Northgate): 2 rows missing, ids 4 and 7"
```

**`gridcue/testing`** is a new entry with no test-runner import and no new dependency. It never reads or sends real rows.

- **`rows`** are synthetic, built from the schema: for each column, values that hit an edge in 4.1. Empty cells (`null` and `""`), whitespace-only text, the same text in two cases, negative numbers, both ends of a range and values just past them, dates on a boundary, each declared enum value. Restricted columns get plain values and are never used in a case. `notNull` names columns the Host's database can't leave empty; they get no empty cells.
- **`cases`** are View States, one per edge for each column and operator the column allows, plus a few with filters on two columns and sorts on two columns. A count case appears only when `operations` lists `limit.set`. Each case's expected ids come from `applyView` on `rows`.
- **`compare(ids)`** checks the ids as a set. When the case sorts, it also checks the order of rows whose sort cells aren't empty. It returns a plain message naming the case, the missing ids, and the extra ids.
- The same `queryCheck` drives the AG Grid row check in 5.6.

**The guide, "Rows on a server",** is one Site page:

1. Pick the adapter: TanStack in manual mode keeps the TanStack adapter; any other table uses the Query Adapter; AG Grid's Infinite Row Model uses `gridcue/ag-grid`.
2. Build the Data Query from `adapter.getState().state` on every change, never from the grid's own model. (TanStack's `columnFilters` wraps GridCue's predicates; AG Grid's model can't carry the meanings in 4.1.)
3. The table in 4.1.
4. Never put a value or a column name into query text. Values are parameters; column IDs are checked against the schema.
5. Run the Query Check in your tests.
6. `countBeforePaging` only when your server sorts and cuts before paging.
7. Loading, errors, and the number of rows are yours. Opportunity 5's `countRows` is where a server's number of rows reaches the bar, when it lands.

**The example** is a second page in the Next.js example, `/paged`. A route handler pages through the wealth fixture's rows in an in-memory SQLite database (`node:sqlite`, so no new dependency) and builds its query from the View State. The query code is marked as the Host's, not GridCue's. The Query Check runs against it in CI on both schemas.

**The second schema** is the ledger fixture that named filters' PR 2 adds (order plan). It has number, date and date-and-time columns, which the wealth fixture lacks. This PR adds nothing to `fixtures/`.

| Host's translation of the View State | Today | After |
| --- | --- | --- |
| `neq` as SQL `<>` | Drops rows with an empty cell, silently | The Query Check fails: "not equal keeps empty cells …: rows missing" |
| `between` as an exclusive range | Drops both ends, silently | Fails: "between includes both ends …" |
| `eq` on text as a case-sensitive `=` | Drops "TAXABLE" when asked for "taxable" | Fails: "equal ignores case on text …" |
| A correct translation | No way to know | Every case passes |

*Would change if:* Hosts show they translate correctly from the table alone, or the cases can't be run against a real server in a few lines (grill Q2).

### 5.6 The AG Grid adapter (PR 6)

```ts
import { createAgGridAdapter, gridcueColDef, schemaFromAgGrid } from "gridcue/ag-grid";

const schema = schemaFromAgGrid(columnDefs, { sampleRows: rowData, columns: { /* aliases, enums */ } });

<AgGridReact
  columnDefs={columnDefs}
  defaultColDef={gridcueColDef(schema)}
  onGridReady={(e) => setController(createGridCue({ schema, adapter: createAgGridAdapter({ schema, api: e.api }), provider }))}
/>
```

**What it lists.** `MVP_OPERATIONS` without `group.set`. It reads and writes filters, sorts (several columns, through `sortIndex`), hidden columns, and order, through `setFilterModel`, `getFilterModel`, `applyColumnState` and `getColumnState`. Pins, totals, density and counts are not listed, though the operation set adds them first (order plan). A request for one ends as it does on any grid that doesn't list it. The adapter writes back whatever pins the grid has, so undo never moves them.

**Row models.** Client-Side, where AG Grid filters and sorts the rows. Infinite, where AG Grid calls the Host's datasource on every filter or sort change and the datasource builds its query from the View State, as in 5.5.

**Filters: AG Grid's own, set to GridCue's meanings.** `gridcueColDef(schema)` returns a default column definition:

- Text, number, and date columns use AG Grid's text, number, and date filters. Each offers only the options GridCue can read.
- Number and date filters set `inRangeInclusive: true` and `includeBlanksInNotEqual: true`.
- Date filters compare whole days in the schema calendar's time zone (named filters 5.5), with a custom comparator or option where AG Grid's own date filter can't.
- The text filter sets `caseSensitive: true` and a `textMatcher` that applies GridCue's meaning for the column's kind, so enum IDs match exactly and text ignores case.
- "Is empty" and "Is not empty" are AG Grid custom filter options carrying GridCue's own predicate, because AG Grid's "blank" also matches whitespace-only text.
- Each column holds as many conditions as it has declared values (at least 2), so any `in` GridCue validates fits.
- **Which options use AG Grid's settings and which use a custom option with GridCue's predicate is settled by the row check in section 10, not by this spec.** The list above is the starting point.

**Reading back.** A filter the User sets in AG Grid's menu is read into the View State: each AND condition is a predicate, an OR of conditions on one column is a nested OR group, and equals-OR-equals on one column is `in`. So the Preview, "clear the filters", undo, and later the View Sentence see it. A filter GridCue can't read stays the Host's: it is left out of the View State, kept on every write, and a GridCue filter on that column fails at Apply with `ADAPTER_UNSUPPORTED_FILTER` rather than replace it.

**Checks at creation, all `INPUT_CONFIG`, each naming what is wrong:**

- the grid lacks a call the adapter uses (Q7: no peer dependency, so this is where an untested major is caught);
- a column the schema lets GridCue filter doesn't carry `gridcueColDef`'s filter settings. The Host fixes the column or removes `filter` from that column's capabilities.

`schemaFromAgGrid` gives a column whose filter is `false` or a custom component no `filter` capability, so GridCue never offers it.

**Writes.** One apply sets the filter model and the column state, then waits until the grid reads back what was written (4.2), then notifies once. A filter that AG Grid can't hold (an OR across columns, an `in` with another filter on the same column) fails with `ADAPTER_UNSUPPORTED_FILTER` before anything is written. Revisions read `ag-grid:n`. The default state is the grid's view when the adapter was created.

**Enterprise.** Not tested, and the docs say so. A grouping the User set on an Enterprise grid is read into the View State and written back unchanged, so undo keeps it; GridCue never changes it. A grouping request ends as in 5.3.

**Types and dependency.** The entry imports nothing from AG Grid. It types the calls it uses as `AgGridApiLike`. No peer dependency. The docs and the skill name the majors CI tests: 36, and the oldest that passes the API check in plan task 6.1 (34 is the target).

| Request, AG Grid Community, Client-Side Row Model | Today | After |
| --- | --- | --- |
| "taxable accounts over $1m sorted by market value desc" | No adapter | Filters in AG Grid's own Registration type and Market value filters; sorted; the funnel icons show |
| The User sets "Custodian not equal Northgate" in AG Grid's menu, then asks "clear the filters" | No adapter | The Preview lists the Custodian filter, and clearing removes it |
| "custodian is not Northgate", with rows whose Custodian is empty | No adapter | Empty rows stay, as on every other adapter |
| "market value between $1m and $5m" | No adapter | Rows at exactly $1m and $5m stay |
| "group by advisor" | No adapter | "This grid can't group rows." |
| "top 10 by market value" | No adapter | Sort alone, with the count note |
| A column with the Host's own custom filter | No adapter | Not offered for filtering; sorting and hiding work |

*Would change if:* AG Grid can't be set to a meaning GridCue needs, even with a custom option (then that operator is removed from that kind on AG Grid, and the Preview never offers it), or Hosts can't adopt `gridcueColDef` because their own default column definition conflicts.

## 6. Public API and protocol

All additive. Nothing is removed or renamed. The protocol stays 0.1.

| Name | Entry | PR |
| --- | --- | --- |
| `apply` and `restore` resolve when the table holds the write (behaviour) | `gridcue/tanstack-table` | 1 |
| "applies, then undoes" test in the copied contract suite | docs (`build-an-adapter`) | 1 |
| The can't-group prompt; the hint names only the grid's families (wording) | root | 3 |
| `createQueryAdapter`, `QueryAdapter`, `QueryAdapterOptions` | root | 4 |
| `queryCheck`, `QueryCheck`, `QueryCheckCase`, `QueryCheckOptions` | `gridcue/testing` (new) | 5 |
| `createAgGridAdapter`, `AgGridAdapterOptions`, `AgGridApiLike` | `gridcue/ag-grid` (new) | 6 |
| `gridcueColDef(schema)` | `gridcue/ag-grid` | 6 |
| `schemaFromAgGrid(columnDefs, options)` | `gridcue/ag-grid` | 6 |
| `exports` entries `./testing` and `./ag-grid`; matching `tsdown` entries | `package.json` | 5, 6 |

No new error codes: `INPUT_CONFIG`, `ADAPTER_UNSUPPORTED_FILTER` and the Controller's `ADAPTER_FAILED` exist. No new peer or runtime dependency.

## 7. ADRs

Three ADRs record the decisions here that are hard to reverse. They merge with the planning record (PR 0), so each is in before the PR that needs it.

| ADR | Decides | Needed by |
| --- | --- | --- |
| 0031, An apply is done when the grid holds it (`docs/adr/0031-an-apply-is-done-when-the-grid-holds-it.md`) | A Grid Adapter's `apply` and `restore` succeed only once the grid holds the written state, and return the Revision the grid now has. An adapter over a grid that updates later waits within a bound, and fails when it runs out. ADR 0009 is unchanged | PR 1 |
| 0032, Rows on a server: the Host's own Data Query (`docs/adr/0032-rows-on-a-server-the-hosts-own-data-query.md`) | GridCue never writes a Data Query. The Query Adapter holds the View State and lists `limit.set` only when the Host says its server sorts and cuts before paging. An apply is done when the View State changes. `gridcue/testing` ships the Query Check. It refines ADR 0018's `limit.set` bullet, which the planning record rewrites | PR 4 |
| 0033, AG Grid Community through AG Grid's own filters (`docs/adr/0033-ag-grid-community-through-ag-grids-own-filters.md`) | `gridcue/ag-grid` supports Community with the Client-Side and Infinite row models, without `group.set`. It writes into AG Grid's own filters, set to GridCue's meanings, and reads them back. The entry is typed structurally, has no peer dependency, and checks the grid at creation | PR 6 |

## 8. Terms added to CONTEXT.md

All four changes go in with the planning record (PR 0). "Contract suite" stays the name for the Grid Adapters' shared tests.

**Data Query**:
The Host's own request to its server for the rows a View State asks for, such as a database query or an API call. GridCue never writes one.
_Avoid_: Backend query, server filter, SQL

**Query Adapter**:
GridCue's built-in Grid Adapter for Hosts whose rows come from their own Data Query. It holds the View State and lists only the View Operations that Data Query can carry out.
_Avoid_: Remote adapter, server adapter, SQL adapter

**Query Check**:
Synthetic rows and View States, built from a View Schema, that a Host runs through its own Data Query to prove it keeps the same rows GridCue would.
_Avoid_: Conformance suite, contract suite, SQL tests

The Rows Adapter's entry gains one sentence: "For rows on a server, see Query Adapter."

## 9. UI

**No new UI element and no visual change.** The built-in `<GridCueBar />` and the Component Registry are untouched. Two messages change wording (5.3); they come from core and show in the existing status row in both UIs, with no change to layout, motion, or tokens.

Design pass on that copy, with `emil-design-eng`, `better-ui` and `principle-experience-first`:

| Before | After | Why |
| --- | --- | --- |
| "I'm not sure what to change for “group by advisor”. Try asking to filter, sort, group, or show or hide columns." | "This grid can't group rows." | The User asked clearly. Saying "not sure" blames the wording, and suggesting "group" sends them round again (experience first: error states) |
| "…Try asking to filter, sort, group, or show or hide columns." on a grid without grouping | "…Try asking to filter, sort, or show or hide columns." | A hint names only what works here |
| Status row: live region, `min-height`, colour and text | Unchanged | Text, not colour, already carries the state |

The new example pages (`/paged` and `/ag-grid` in the Next.js example, and `examples/ag-grid`) are Host code built from the existing examples' styles and `<GridCueBar />`. Their build tasks load the three design skills, check light and dark in a real browser, and record their own Before/After in the PR, as AGENTS.md requires. The paged page's loading state is the Host's, and the example shows one way to do it.

## 10. Evals and evidence

Every set and every row is synthetic. Every held-out set is written and labelled, or its seeds chosen, before the code it tests, by someone who has not seen that code.

| Mechanism | Dev | Held-out | Bar | Reported, with no bar |
| --- | --- | --- | --- | --- |
| Apply is done when the grid holds it (5.1, 4.2) | The contract suite, with the new "applies, then undoes" test, on three TanStack harnesses: table-owned; Host-controlled sorting and filters with handlers; `useLegacyTable` Host-controlled. A fourth harness, Host-controlled sorting with no handler, takes no write, so it runs one test: the apply fails | Two harnesses the lead writes after the build: all five slices Host-controlled on `useTable`; Host-controlled with pagination auto-reset on `useLegacyTable` | Every test passes on every harness that takes writes. On the no-handler harness the apply fails, the table is unchanged, and the Controller says "Nothing was changed". On a table-owned harness, apply resolves in the same tick as today | The wait, median and worst, on the controlled harnesses |
| v8 bridge (5.2) | The contract suite on `useLegacyTable`, owned and Host-controlled | Six of TanStack's own v8 examples, named before the run (basic, sorting, filters, column ordering, column visibility, controlled pagination), moved by an agent using only the guide | The contract suite passes on both | How many of the six run unchanged after the import change, and what each other one needed. A failure is a fact for the owner, not a bar |
| Can't group says so (5.3) | 25 grouping and mixed requests on an adapter without `group.set` | 25 more, labelled before the code; and every existing eval set, run on an adapter without `group.set` | 0 wrong views everywhere. On the held-out set, every request whose only change is grouping ends in the can't-group prompt. On the Rows Adapter, every existing verdict is unchanged | Safe misses on the held-out set |
| Query Adapter (5.4) | The contract suite; unit tests for each operations rule and each bad `without` name | Every existing eval set on a default Query Adapter | 0 wrong views. Every case that expects `limit.set` ends as a sort with the count note | — |
| Query Check (5.5) | The example's Data Query on the wealth schema | The ledger schema; and at least 12 wrong translations (mutants), written by a labeller from the table in 4.1 and common SQL habits before `queryCheck` exists, never shown to the builder | The example's query: 0 rows differ on both schemas. Every mutant fails at least one case | Cases and rows per schema; run time |
| AG Grid (5.6) | The contract suite on the Client-Side and Infinite row models; the Query Check's cases run through AG Grid on the wealth schema (the row check) | The ledger schema's cases and fresh seeds, chosen by the lead after the build; and at least 30 filter models a User can set in AG Grid's menus, labelled from AG Grid's docs before the reader exists, each with the View State it should read as, or "unreadable" | 0 rows differ, as sets, on every case; the same order where sort cells aren't empty. 0 menu filters misread: a readable one's `applyView` rows equal AG Grid's rows. Every unreadable one is kept and blocks GridCue's writes to its column | Where empty cells sort, against `applyView`; the share of menu filters read |
| Every PR | The existing eval sets with the Mock Provider, on the Rows Adapter | — | Unchanged | — |

- **A held-out wrong view** goes back to the builder as a class, not as the failing case, and that class gets a fresh held-out set (the four bets rule).
- **No live run with Jev.** Nothing here changes what is sent to a provider or how a proposal is checked.

## 11. Surfaces

| Surface | What changes |
| --- | --- |
| Entry points | Root: `createQueryAdapter`, the PR 3 wording. `gridcue/tanstack-table`: the wait. New `gridcue/testing` and `gridcue/ag-grid`. `gridcue/react`, `gridcue/server`, `gridcue/mock`: no change. `AGENTS.md` lists the package's entries in two places ("Hit every surface" and "Where code lives"); both gain `gridcue/testing` in PR 5, and `gridcue/ag-grid` and the Query Adapter in PR 6 (order plan D2) |
| Both UIs | No component change. The PR 3 messages are checked in both, light and dark |
| Frameworks and tables | Vite: new `examples/ag-grid`. Next.js: new `/paged` and `/ag-grid` pages. Grid Adapters: the Rows Adapter (unchanged), TanStack (PR 1), the Query Adapter, and AG Grid, each passing the contract suite. The new entries are client-safe, and the bundle leak check covers the new example pages. `gridcue/testing` is never imported by an example's client code |
| The Site | New guides: "Rows on a server", "AG Grid", "Coming from TanStack Table v8". Updated: `api/adapters` (Query Adapter, AG Grid), a new `api/testing`, `guides/build-an-adapter` (the new contract test, and 4.2), `guides/vite-tanstack` (controlled state), `get-started/quick-start` (which adapter to pick). The marketing page's list of supported grids, if it has one. The Site demo is unchanged |
| Agent skill | `skills/gridcue/references/setup.md`: the v8 row, an AG Grid row, a server-rows row. `troubleshooting.md`: "undo refused" on a controlled table, and the `INPUT_CONFIG` messages. `pnpm check:skills` |
| Failure paths | Cancel and undo work on every new adapter (contract suite). A Host-controlled table that never takes a write fails with recovery. A grid that can't group says so. An AG Grid filter GridCue can't write fails at Apply with nothing changed. A misconfigured AG Grid fails at creation, by name. A Host's fetch error is the Host's |

## 12. Testing

- Unit tests for the wait: owned, controlled, no handler, a manual change during the wait, the bound.
- The contract suite's new test, on every adapter in the repo.
- Unit tests for each row of the table in 5.3, plus "group" as a value and as a column name.
- Unit tests for the Query Adapter's operations and every `without` error.
- Unit tests for `queryCheck`: every edge in 4.1 produces a case, `notNull` is honoured, restricted columns never appear, and `compare` names missing and extra ids.
- A Vitest test that runs the Query Check against the Next.js example's query function on both schemas, and against each mutant.
- AG Grid: the contract suite, the row check, the menu-filter set, and the creation checks. Where AG Grid can't run in jsdom, these run in a browser test runner (plan task 6.1 decides).
- The bundle leak check passes with the new example pages.
- Every UI change is checked in a real browser, light and dark: the PR 3 messages in both UIs, and each new example page.

## 13. Acceptance

1. `pnpm check` passes with no credentials after each PR.
2. Every bar in section 10 is met and reported in its PR, with the numbers and the misses.
3. Each PR says which surfaces in section 11 it touched.
4. ADRs 0031 to 0033 are in before the PRs that need them; `CONTEXT.md` has the terms in section 8.
5. PRs with pages carry before and after screenshots, light and dark.

## 14. Risks

- **npm's handling of an optional peer was only partly run.** The fact check saw `ERESOLVE` offline, not against the registry. Q7's change rests on it; a registry run could reverse it (grill Q7).
- **TanStack may drop `useLegacyTable`.** The guide treats it as a first step, and CI pins the tested version.
- **AG Grid's defaults were read, not run.** Task 6.1 runs them before any adapter code. If a setting doesn't give GridCue's meaning, a custom option does; if neither can, that operator is removed on AG Grid.
- **AG Grid may not run in jsdom.** Then its tests need a browser runner, which adds a dev dependency.
- **AG Grid 34 and 35 may lack a call 36 has.** The tested range narrows to what passes.
- **The Query Check only helps a Host that runs it.** The guide and the skill put it in the first steps.
- **The example's SQL will be copied.** It uses parameters and checks every column ID against the schema; the review includes a security pass.
- **`node:sqlite` may warn as experimental, or not load in Next.js's route runtime.** The fallback is an in-memory SQL engine as a dev dependency of the example only.
- **A Host that sets state after its fetch** will hit the 1,000 ms bound. The guide says to set state first.
- **Opportunity 2's TanStack count must not run on a manual table.** Its row-model wrapper would keep the first N rows of one page. That adapter must not list `limit.set` when pagination, sorting, or filtering is manual. The operation set's spec now says so (its 5.5).
- **Empty cells sort differently on each adapter** until core defines it. The row checks don't test it and say so.

## 15. Meeting the four bets

- **The Local Resolver's closed grammar.** Its Count form produces `limit.set` only where the adapter lists it, so a default Query Adapter or AG Grid gives the sort and the count note. Its Group form on a grid without `group.set` reaches 5.3's prompt; the bets should treat "this grid can't" as a final result, like a refusal, so the request doesn't go to a provider that can't help. The grammar itself is grid-independent.
- **`controller.read`.** It reads the Utterance against the schema and never touches the adapter. One choice for the bets: on a grid without `group.set`, a grouping word's mark should say "this grid can't group" or carry no mark, never "Custodian column" alone.
- **`describeView` and the View Sentence.** Grid-independent. On AG Grid it sees the User's menu filters, because 5.6 reads them into the View State; an OR within one column reads as "an OR filter", already on the sentence's list of reasons it can't round-trip. On the Query Adapter it reads as on the Rows Adapter.
- **`proposeView`.** A saved view holding `limit.set` or `group.set`, opened on a grid without them, ends as "That saved view holds a setting this grid can't apply", as the four bets spec says. New adapters get `restore` right by passing the contract suite.
- **The second schema.** Named filters adds the ledger fixture; this work and the four bets' PR 3 reuse it.
