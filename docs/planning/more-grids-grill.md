# Reaching the grids enterprises run: grilling log

Status: answered by the owner on 2026-11-13; see "Owner's answers" at the end. Fact-checked against the code the same day while the spec was drafted: one line number corrected, eight facts added, and the recommendation for Q7 changed. Each is marked where it stands.

This is opportunity 3 of the five the owner put ahead of the four bets on 2026-11-13: "5 opportunities first then four bets in terms of build priority." GridCue drives two kinds of grid today: rows held in memory (the Rows Adapter) and TanStack Table v9. Most apps that could use it run something else. TanStack Table v8 is still most of TanStack's installs, and the agent skill tells those Users to stop. AG Grid, the grid most common in finance, was named the next adapter in the build-plan grill and never started. And every path assumes the rows are in the browser, so a grid that pages through a server has no documented, tested way to turn the View State into the Host's own data query. This round decides how GridCue reaches each one without generating SQL, without new runtime dependencies (ADR 0007), and without a new way to show a wrong view. It designs on today's code, where every request goes through an Intent Provider, and says where it meets what the four bets add later. Only decisions go to the owner.

## Facts gathered (2026-11-13)

Each fact cites a file and line on branch `fix/reading-wrong-views`, or a command. Probes are scratch scripts outside the repo, run from the repo root with `pnpm exec tsx` and the Mock Provider. No model was called. *Verified* means a probe or command ran. *Read* means taken from code or docs. *Unverified* means nobody checked.

### The adapter contract today

- **The interface has seven members:** `getSchema`, `getCapabilities`, `getState`, `getDefaultState`, `apply`, `restore`, and `subscribe` (`packages/gridcue/src/core/adapter.ts:7-18`). `apply` "applies every operation or none" and returns the new state and Revision (`:4`, `:13-14`). *Read.*
- **Manual changes must be reported** through `subscribe`, or the adapter says it can't and the Controller re-reads before apply (ADR 0009). *Read.*
- **The contract suite checks state, not rows.** Ten tests: multi-operation apply, negative amounts, one notification per apply, unvalidated plans refused, stale plans refused, exact restore, no unsupported operations, capabilities can't be corrupted, unsubscribe, `ADAPTER_` codes (`packages/gridcue/test/adapter-contract.ts:38-161`). Nothing checks that the grid shows the rows `applyView` would. *Read.*
- **The suite is not shipped.** Adopters copy the file (`apps/site/content/docs/guides/build-an-adapter.mdx:153`). *Read.*
- **Validation already narrows by grid and by column.** An operation the adapter doesn't list fails with `PLAN_OPERATION_UNSUPPORTED` (`packages/gridcue/src/core/validate.ts:118-120`). An operator outside the column's `allowedOperators` fails with `PLAN_OPERATOR_NOT_ALLOWED` (`:136-137`, `packages/gridcue/src/core/schema.ts:19-21`). The compiler reads `allowedOperators` too: with no `in`, an exclusion becomes one `neq` or GridCue says it can't (`packages/gridcue/src/core/compile.ts:867-881`). There is no adapter-level operator list. *Read.*
- **Operators by kind:** text has `eq`, `neq`, `contains`, `startsWith`, `in`, empty and not empty. Numbers add `gt`, `gte`, `lt`, `lte`, `between`. Enums have `eq`, `neq`, `in`, empty and not empty (`packages/gridcue/src/core/schema.ts:7-16`). *Read.*

### What a filter means in GridCue

- **Every adapter shipped today filters with `matchesPredicate`,** so the meaning of a filter is the same everywhere (`packages/gridcue/src/core/evaluate.ts:11-44`; the TanStack filter function calls it at `packages/gridcue/src/tanstack/index.ts:64-66`). *Read.*
- **Sorting is not shared.** *Added in the fact check.* `applyView` sorts with its own `compareValues` (`rows-adapter.ts:68-75`); TanStack sorts with its own sorting functions. On rows with values 300, empty, 100, 200, ascending by value gives the empty row last in `applyView` and first in TanStack; text with an empty cell and mixed case orders differently again. *Verified* (`spec/sort-blanks.mts`). Opportunity 2 already owns the count part of this ("an empty value is never one of the top 10", `operation-set-grill.md:152`) and leaves the order of empty cells in a sort with no count to its own change (`:184`). A Host's data query meets the same question, so the server guide must say what it can and can't rely on.
- **The meanings a Host's own query must copy.** *Verified* (`probe.mts`, section 3):

  | Operator | On a blank cell | Other rules |
  | --- | --- | --- |
  | `neq "x"` | **matches** (null and "" both true) | |
  | `eq`, `in` | no match | case ignored on text columns (`evaluate.ts:14-15`) |
  | `gt`, `gte`, `lt`, `lte` | no match | |
  | `between` | no match | both ends included (`evaluate.ts:39-41`) |
  | `contains`, `startsWith` | no match | case always ignored |

  In SQL, `col <> 'x'` leaves out NULL rows, so a direct translation of `neq` drops rows GridCue keeps. On rows `'x'`, NULL, `''` and `'y'`, SQLite's `c <> 'x'` keeps 2 rows and `c IS NOT 'x'` keeps 3, which is GridCue's count. SQLite also puts NULL last in a descending sort, where `applyView` puts an empty cell first. *Verified* (sqlite3 CLI, in the fact check). Other databases differ on where NULL sorts and on letter case in `=`; that is *Read* from general knowledge, not run.
- **A count is cut before grouping:** "top 10 grouped by advisor" is ten rows (`packages/gridcue/src/core/rows-adapter.ts:91-92`). *Read.*

### Counts on a grid that pages

- **ADR 0018 already decided this for counts.** A grid whose rows come a page at a time doesn't list `limit.set`. The plan then sorts alone, and the Preview says the count was not applied (`docs/adr/0018-size-words-main-value-column-and-counts.md`, the `limit.set` bullet; `compile.ts:1199-1210`; *corrected* from `:1197-1206`). *Verified* (`probe.mts`, section 1): "top 10 accounts by market value" gives "Sort by Market value, descending | Show only the first 10 rows" on the Rows Adapter, and "Sort by Market value, descending" with the note "Count not applied: this grid can't show only the first 10" when `limit.set` is removed.
- **The Rows Adapter always lists `limit.set`** (`rows-adapter.ts:32-40`). The build-plan grill said "a Host with server-side data can instead turn the View State into its own query" (`docs/planning/build-plan-grill.md:281`). A Host that does that with the Rows Adapter and ignores the count shows every row under a Preview that promised ten. Nothing in the docs warns of it. *Read.*
- **A server can apply a count exactly.** `ORDER BY ... LIMIT 10` before paging is the true first ten. ADR 0018's reason ("can't show the true first ten") is about a grid that only holds one page. *Read, reasoning.*

### Server-side data today

- **The View State is already a plain, validated value.** After "taxable accounts over $1m sorted by market value desc", the adapter holds `{"combinator":"and","children":[{"columnId":"registration_type","operator":"eq","value":"taxable"},{"columnId":"market_value","operator":"gt","value":1000000}]}` and `[{"columnId":"market_value","direction":"desc"}]`. *Verified* (`probe.mts`, section 2).
- **The Rows Adapter never touches rows.** It takes a schema and a state (`rows-adapter.ts:7-12`). `applyView` is a separate function (`:78`). But the glossary defines it as the adapter "for Hosts that hold their rows in memory" (`CONTEXT.md`, Rows Adapter). *Read.*
- **The Provider needs no rows.** Candidate values come from the Host's declared `enumValues`; `sampleRows` only infer kinds and "never leave the caller" (`packages/gridcue/src/core/schema.ts:55-56`). `schemaFromTanStack` samples the first 50 core rows (`tanstack/index.ts:84-94`), which in manual mode is one page. Enough for kinds. *Read.*
- **TanStack's manual mode stores GridCue's filters in its own wrapper.** `columnFilters` holds `{ gridcue: 1, kind, predicates, host? }` (`tanstack/index.ts:48-53`, `:161-171`). A Host that builds its query from `columnFilters` must unwrap it. `adapter.getState().state.filters` gives the plain form. *Read.*
- **The Site docs have no server-side page.** The adapters page says `applyView` "does not paginate" (`apps/site/content/docs/api/adapters.mdx:165`) and that a paged adapter "should not list `limit.set`" (`:91`). Nothing else. *Read.*
- **Opportunity 5 needs a count from the Host.** The command-bar grill recommends an optional `countRows(state)` that may return a promise, "including a server count for a paged grid" (`docs/planning/command-bar-grill.md:118-122`). A server-side guide is where that is shown. *Read.*

### A defect found along the way: Host-controlled TanStack state breaks undo

- **When the Host controls a TanStack slice** (`state: { sorting }, onSortingChange: setSorting`, the usual pattern for server-side tables), the setter only queues a React update. `apply` returns the old state and Revision. *Verified* (`probe2.mts`): right after apply, sorts `[]` and `tanstack:0`; after the render, `tanstack:1`.
- **The Controller records that old Revision for undo** (`packages/gridcue/src/core/controller.ts:383`), so undo sees a newer Revision and refuses: "The view changed after that update, so undo would erase newer changes." (`controller.ts:174-181`). *Verified* on v9 `useTable` (`probe3.mts`): undo works when the table owns its state and is refused when the Host controls sorting. It fails closed, so no wrong view, but undo is lost.
- **A controlled slice with no change handler is worse.** *Added in the fact check.* With `state: { sorting }` and no `onSortingChange`, "sort by team ascending" previews, Apply reports "View updated.", and the table's sorting stays `[]`. The Revision stays `tanstack:0`. *Verified* (`spec/probe-nohandler.mts`). The User is told the view changed when it didn't. The same fix covers it: an apply is done only when the table holds what was written.
- **It is in scope here** because server-side TanStack tables are where Hosts control state. The fix belongs in the adapter, with a contract test that applies and undoes on a Host-controlled table. It needs no decision.

### TanStack Table v8 against v9

- **Usage.** Last week `@tanstack/react-table` 8.x had 27,412,565 downloads and 9.x had 8,230,504, so v8 is 77%. *Verified* (`curl https://api.npmjs.org/versions/@tanstack%2Freact-table/last-week`). 9.0.0 shipped 2026-08-04. The last v8, 8.21.3, shipped 2025-04-14 (`npm view @tanstack/table-core time`). Latest is 9.3.1; the repo pins 9.2.4 (`packages/gridcue/package.json` devDependencies, `apps/site/package.json:13`, `examples/vite/package.json:13`).
- **GridCue's adapter needs two v9-only things:** `table.store` (state plus `subscribe`) and `table._reactivity.batch` (`tanstack/index.ts:31-41`). *Read.*
- **A v8 table has neither.** `getState()` returns `options.state`, and `setState` only calls `options.onStateChange` (`@tanstack/table-core@8.21.3`, `src/core/table.ts:367-373`). `useReactTable` keeps state in React and rewrites `onStateChange` on every render (`@tanstack/react-table@8.21.3`, `src/index.tsx:57-90`). So a v8 adapter can't read its own write back before the next render, and can't watch the table unless the Host wires it. *Read*, from the packed tarballs in scratch.
- **v9 ships a v8-style bridge.** `@tanstack/react-table/legacy` exports `useLegacyTable` and the v8 row-model functions as markers (`apps/site/node_modules/@tanstack/react-table/package.json:30`, `dist/useLegacyTable.d.ts`). It builds a v9 `useTable` under the hood (`dist/useLegacyTable.js:132-163`). *Read.*
- **GridCue's adapter runs on it unchanged.** On a `useLegacyTable` table with `getCoreRowModel`, `getFilteredRowModel` and `getSortedRowModel`: `store` and `_reactivity.batch` exist, a filter-and-sort plan applies (Revision `tanstack:0` to `tanstack:1`, rows `[20, 12]` shown), and a manual sort is reported. *Verified* (`probe.mts`, section 4). Only a basic table was tried. How much real v8 code runs unchanged on it is *unverified*.
- **The bridge is itself marked for migration.** *Added in the fact check.* `useLegacyTable` is tagged `@deprecated This is a compatibility layer for migrating from v8. Use useTable with an explicit features option instead` (`dist/useLegacyTable.d.ts`, the hook's own doc comment). A later major may remove it. v9's React package needs React 18 or later; v8 allowed 16.8 (`npm` package metadata for 9.2.4 and 8.21.3). *Read.*
- **The React binding marks `table.store` deprecated for render reads** (`apps/site/node_modules/@tanstack/react-table/dist/useTable.d.ts:7-14`). The adapter reads it outside render, which the note allows. *Read.*
- **The skill stops v8 Users:** "Stop and tell the User: GridCue's adapter targets v9. The Rows Adapter is the fallback." (`skills/gridcue/references/setup.md:13`). *Read.*

### AG Grid

- **What was decided.** AG Grid is "the named next adapter" and "the most common enterprise grid in finance"; a second adapter was left out of v1 to keep the test surface small, and "the shared adapter contract suite makes adding AG Grid later cheap" (`docs/planning/build-plan-grill.md:162-166`). New grids arrive "as new subpaths" (`:285`) and "a new subpath, not a new package" (`docs/adr/0007-one-npm-package.md:12`). *Read.*
- **Versions and use.** `ag-grid-community`, `ag-grid-enterprise` and `ag-grid-react` are all 36.3.0 (released 2026-11-04). Last week's downloads by major: 35 had 1,596,946, 36 had 1,571,687, 34 had 802,153, 33 had 590,906, 32 had 457,872. *Verified* (`npm view`, `api.npmjs.org/versions/ag-grid-community/last-week`).
- **Licence.** Community is MIT (`npm view ag-grid-community license`). Enterprise is "Commercial" (`npm view ag-grid-enterprise license`). The licensing page says Enterprise "requires a commercial, EULA licence", can be tested without a key but then "will display a watermark and an error message in the console", and "requires a licence to use in production". *Read* (ag-grid.com/javascript-data-grid/licensing). Whether an open-source CI may run Enterprise unlicensed is *unverified*.
- **What Community has.** Its module list includes `ClientSideRowModelModule`, `InfiniteRowModelModule`, `TextFilterModule`, `NumberFilterModule`, `DateFilterModule`, `CustomFilterModule`, `ExternalFilterModule`, `QuickFilterModule`, `SortModule`, `ColumnMoveModule`, `PinnedColumnModule`, `PaginationModule`, and `GridStateModule`. *Verified* (grep of `export const ...Module` in the 36.3.0 type declarations).
- **What only Enterprise has.** `RowGroupingModule`, `ServerSideRowModelModule`, `SetFilterModule`, `MultiFilterModule` and `AdvancedFilterModule` are not in Community's list. `setRowGroupColumns` is tagged `@agModule RowGroupingModule` (`dist/types/src/api/gridApi.d.ts:1297-1302`). The licensing page lists "Row Grouping" and "Server-Side Row Model" as Enterprise features. So `group.set`, one of the eight MVP operations, needs Enterprise. *Verified* (types), *Read* (page). The same page lists "Multi-Column Sorting" next to grouping; whether Community sorts by several columns is *unverified*.
- **The API GridCue would use.** `applyColumnState({ state, applyOrder })` sets sort, sort index, hidden, order, pinned and row group in one call (`gridApi.d.ts:595`; `ColumnState` fields `hide`, `sort`, `sortIndex`, `pinned`, `rowGroup`, `rowGroupIndex`). `setFilterModel` and `getFilterModel` cover filters (`:902`, `:907`). `addEventListener` takes `sortChanged`, `filterChanged`, `columnVisible`, `columnMoved`, `columnPinned`, `columnRowGroupChanged`, and `stateUpdated` (`gridApi.d.ts:313`, `eventTypes.d.ts:6`). `isModuleRegistered(name)` tells which modules are present (`gridApi.d.ts:73`). *Read.*
- **AG Grid's filters mean something else by default.**
  - A text, number or date filter has a fixed option list: `equals`, `notEqual`, `contains`, `notContains`, `startsWith`, `endsWith`, `lessThan`, `lessThanOrEqual`, `greaterThan`, `greaterThanOrEqual`, `inRange`, `blank`, `notBlank` (`dist/types/src/filter/provided/iSimpleFilter.d.ts:88-94`). *Read.*
  - It holds up to `maxNumConditions` conditions joined by AND or OR, default 2 (`iSimpleFilter.d.ts:17`, `:60-62`). An `in` over three values does not fit by default. *Read.*
  - Blank cells are left out of every comparison "by default", including not-equal, unless `includeBlanksInNotEqual` and the like are set (`iScalarFilter.d.ts:14-22`; ag-grid.com/javascript-data-grid/filter-number). GridCue's `neq` keeps blanks. *Read.* The docs leave the default column empty, so the default is inferred from the prose. *Unverified* by running.
  - AG Grid's "blank" is `null`, `undefined`, or an empty **or whitespace-only** string (`iScalarFilter.d.ts:13-22`). GridCue's empty is `null`, `undefined` or `""` only (`evaluate.ts:3`). A cell holding `"  "` is blank to AG Grid and not to GridCue. *Read; added in the fact check.*
  - The text filter takes a `textMatcher` callback that receives the cell value, the filter text, the option, and the column (`text/iTextFilter.d.ts`, `TextMatcherParams extends BaseColDefParams`). With `caseSensitive: true` it gets the values as they are. So GridCue can give AG Grid's own text filter GridCue's exact text meaning per column kind, without a custom filter. *Read; added in the fact check.* Whether blank cells reach `textMatcher` is *unverified*.
  - `inRange` includes its ends only when `inRangeInclusive` is set. GridCue's `between` always includes them. *Read*, same page. *Unverified* by running.
  - The text filter ignores case unless `caseSensitive` is set (`text/iTextFilter.d.ts:35-75`). GridCue ignores case on text columns but compares enum IDs exactly. *Read.*
- **The external filter works only with the Client-Side Row Model.** "This form of filtering is only compatible with the Client-Side Row Model." (ag-grid.com/javascript-data-grid/filter-external). *Read.*
- **Server row models read AG Grid's own filter model.** The Server-Side Row Model calls the datasource's `getRows(params)`, "a request containing filter metadata contained in the `filterModel` property" (ag-grid.com/javascript-data-grid/server-side-model-filtering). The Infinite Row Model API is tagged `InfiniteRowModelModule` (`gridApi.d.ts:482-493`). Its datasource's `getRows(params)` receives `sortModel` and `filterModel` (`interfaces/iDatasource.d.ts:13-26`). *Read from the types in the fact check; not run.*
- **Multi-column sorting looks like Community.** `suppressMultiSort`, `alwaysMultiSort` and `multiSortKey` sit in the grid options with no Enterprise module tag, `SortModule` is a Community module, and `applyColumnState` (tagged `ColumnApiModule`, Community) takes `sortIndex`. *Read; added in the fact check.* Running it is still *unverified*.
- **No hook exists to refuse an AG Grid filter before the Preview.** `ViewCapabilities` holds operations, sort and group limits, and three flags (`packages/gridcue/src/core/protocol.ts:147-155`); nothing describes how many values a column filter holds. So an `in` that AG Grid can't hold is found at Apply, which then fails with nothing changed, not before the Preview. *Read; added in the fact check.* Q6 below is corrected to match.
- **Whether AG Grid renders in jsdom, so its tests can run in Vitest,** is *unverified*.

### Packaging

- **One package, five entries:** `.`, `./react`, `./mock`, `./server`, `./tanstack-table` (`packages/gridcue/package.json`, `exports`). *Read.*
- **The TanStack entry has no dependency on TanStack at all.** It imports only from `../index` and types the table structurally as `TanStackTableLike` (`tanstack/index.ts:1-41`). `@tanstack/table-core` is a dev dependency only; the peer list is `@typesafe-ai/sdk` and `react`, both optional (`packages/gridcue/package.json`, `peerDependencies`, `peerDependenciesMeta`). So a package manager never warns about a TanStack version GridCue wasn't tested on. *Read.*
- **The only runtime dependency is `zod`** (`packages/gridcue/package.json`, `dependencies`). *Read.*
- **An optional peer is not free at install.** *Added in the fact check.* Two local packages, one with an optional peer `>=9 <10` on the other, installed beside version 8.0.0 of it: npm 11.16 logs `ERESOLVE overriding peer dependency` (`peerOptional ... error: 'INVALID'`) and tries to fetch a matching version from the registry; pnpm 11.9 installs both and warns "Issues with peer dependencies found". *Verified* offline (`peer/`); what npm does once it reaches the registry is *unverified*. So a Host on AG Grid 32 that installs GridCue only for the Rows Adapter would meet that conflict. Under pnpm's strict layout, a peer on `@tanstack/table-core` is also never visible from GridCue when the Host installs only `@tanstack/react-table`, so it would not warn when it should (*reasoning, not run*).
- **"Remote" already names something.** `createRemoteProvider` calls the Host's Server Handler (`packages/gridcue/src/core/remote.ts:11`). An adapter called `createRemoteRowsAdapter` would read as related. *Read; added in the fact check.*
- **A grid that can't group asks a question that suggests grouping.** *Added in the fact check.* On an adapter that lists neither `group.set` nor `limit.set`, "group by advisor" ends "I'm not sure what to change for “group by advisor”. Try asking to filter, sort, group, or show or hide columns." (`compile.ts:661`), and "taxable accounts grouped by custodian" asks about "custodian". Nothing applies, so no wrong view, but every grouping request on an AG Grid Community grid would meet it. *Verified* (`spec/without-group.mts`).

### Where this meets the other opportunities and the four bets

- **Opportunity 2, the operation set,** decides `limit.set` on TanStack and pins, totals and density on both adapters (`docs/planning/operation-set-grill.md:5`). An AG Grid adapter must cover whatever it adds. AG Grid has pinning in Community (`PinnedColumnModule`) and `aggFunc` in its column state. *Read.*
- **Opportunity 4, saved views,** relies on `restore` and `proposeView` (`docs/planning/routing-and-saved-views-grill.md:18`). A new adapter gets that for free if it passes the contract suite.
- **Opportunity 5, the command bar,** wants a Host count (`command-bar-grill.md:118`). See above.
- **Opportunity 2's TanStack count meets server tables.** Its recommended count is a row-model wrapper that keeps the first N rows (`operation-set-grill.md:139`). On a table in manual mode, the rows TanStack holds are one page, so the wrapper would keep the first N of the page. The adapter must not list `limit.set` on a table whose pagination, sorting or filtering is manual. *Reasoning; added in the fact check.*
- **The Local Resolver's closed grammar** has a Count form ("top 10") (`docs/superpowers/specs/2026-11-10-four-bets-design.md`, 5.4). It produces `limit.set` only where the adapter lists it, through the same compiler path (`compile.ts:1197-1206`). Nothing in the grammar depends on the grid.
- **`controller.read`** reads the Utterance against the schema. It never touches the adapter. No change.
- **`describeView`** reads a View State and a schema, so it reads the same on every adapter. What it can't see is a filter that isn't in the View State. Today that is a Host's own TanStack filter (`tanstack/index.ts:111` reads only GridCue's predicates). For AG Grid it depends on Q6.
- **`proposeView`** turns a saved View State into a plan validated against the current adapter (four bets spec, 5.3). On a grid without `limit.set` or `group.set`, a saved view holding one ends as "That saved view holds a setting this grid can't apply." That is already specified.

### What each part would have to prove

These are the proposed bars. Each is fixed before the work starts.

| Part | Evidence | Bar |
| --- | --- | --- |
| TanStack, Host-controlled state | A new contract harness on a table whose sorting and filters the Host controls | Apply then undo succeeds. Today undo is refused (`probe3.mts`) |
| TanStack v8 bridge | The contract suite on a `useLegacyTable` table, in CI | Passes every test. The Vite example on the legacy hook works in a real browser, light and dark |
| Server-side data | Edge-case View States from two schemas, run through the example's backend and through `applyView` on the same rows | 0 rows differ. A deliberately wrong translation (`neq` dropping blanks, `between` excluding its ends) must fail the check, to prove the cases can catch it |
| AG Grid | The contract suite, plus a new row check: after every applied plan, the rows AG Grid shows equal `applyView`'s on synthetic rows, for every operator the schema keeps | 0 rows differ, on the Client-Side and Infinite row models |
| Every part | The existing eval sets with the Mock Provider | Unchanged. No reading changes in this opportunity, except the one below |
| A grid that can't group says so (added in the fact check; no decision needed, since it only replaces a question with "can't") | Grouping requests on an adapter without `group.set`, a dev set and a held-out set labelled first; every existing set run on that adapter | 0 wrong views. Every request whose only change is grouping ends unsupported with the grid's reason. On the adapters that group, every existing verdict is unchanged |

### Out of scope

- Generating SQL, ORM calls, or REST parameters. GridCue hands the Host a View State; the Host writes its own data query.
- MUI X Data Grid, Glide, and other grids. The guide for building an adapter stays the path.
- AG Grid's pivoting, charts, and editing. Editing is outside GridCue's view-only rule.
- Shipping the adapter contract suite as a public API. It stays a file adopters copy.
- A TanStack Start example, which the owner dropped in the build-plan grill (Q17).
- The build order inside this opportunity. The spec proposes it from these answers; the owner approves it with the spec.

## Round 1

Answer by number. A bare "agree" accepts the recommendation.

❓ **Q1 - TanStack Table v8.**
(a) ➡️ **Recommended: reach v8 apps through TanStack's own bridge.** v9 ships `useLegacyTable`, a v8-style hook that returns a v9 table, and GridCue's adapter runs on it unchanged. GridCue adds a guide for moving a v8 table to it, runs the contract suite on a `useLegacyTable` table in CI, and changes the skill from "stop" to those steps. No new entry.
(b) A separate v8 adapter, `gridcue/tanstack-table-v8`, for apps that stay on v8. Because a v8 table can't be read back or watched without the Host, GridCue holds the five view slices and the Host passes them to `useReactTable` as controlled state, much like the Rows Adapter.
(c) Both.

Why (a): the probe shows it working with no new code. A v8 adapter is a different shape that asks more wiring of the Host, and doubles the TanStack surface to test. The guide still reaches the 77% on v8, since the move is one package version and one import. Would change if: a real Host can't move to `@tanstack/react-table` 9, because another library pins v8, its policy freezes majors, or it is on React 16 or 17; common v8 code fails on `useLegacyTable`; or TanStack removes `useLegacyTable`, which its own doc comment calls a migration layer. The guide therefore treats the bridge as the first step of a move to `useTable`, not as a place to stay.

---

❓ **Q2 - What GridCue gives a Host whose rows live on a server.**
(a) ➡️ **Recommended: a guide, a tested example, and edge cases to test against.** The Host reads the View State from its adapter on every change and turns it into its own data query. GridCue ships no translator. The guide has the table of meanings above: blanks, case, and range ends. A new `gridcue/testing` entry, with no test-runner dependency, builds edge-case View States from the Host's own schema and gives the rows `applyView` keeps for each on the Host's sample rows. The Host checks its backend returns the same rows.
(b) The guide and the example only. The Host uses `applyView` as the reference in tests it writes itself.
(c) Also a neutral description of the View State in the root entry, such as `toFilterList(state)`, with blank handling spelled out on each item.

Why (a): the traps are silent. A Host that writes `neq` as SQL `<>` drops blank rows under a Preview that says nothing about blanks, and GridCue can't see it happen. Generated cases from the Host's own schema find that in its own tests, and they cost no dependency. (b) leaves each Host to find the traps alone. (c) is a second form of the View State to keep in step with the first, and still doesn't test the Host's code. Would change if: Hosts show they translate correctly from the table alone, or the cases can't be made to run against a real backend in a few lines.

---

❓ **Q3 - The adapter that holds the View State for a server grid.**
(a) ➡️ **Recommended: a new, named adapter in the root entry that is safe by default.** It shares the Rows Adapter's code but leaves out `limit.set` unless the Host says its backend cuts the count from the whole sorted result before paging. An `operations` option can only remove, so a backend that can't group removes `group.set`. Working name: `createRemoteRowsAdapter`. It enters `CONTEXT.md` once named. *Fact check:* "remote" already names `createRemoteProvider`, so the spec proposes **Query Adapter** (`createQueryAdapter`), after the Host's own Data Query. The recommendation is unchanged.
(b) The Rows Adapter with a new `operations` option. The docs tell server Hosts to remove `limit.set` unless their backend applies it.
(c) No change. Hosts use the Rows Adapter as it is and narrow by column capabilities.

Why (a): a Host that forgets to remove `limit.set` from the Rows Adapter shows every row under a Preview that promised ten. That is a wrong view, and (b) and (c) make it the default. A separate name also keeps the glossary true, since the Rows Adapter is defined as the one for rows in memory. Would change if: the owner prefers one adapter with a required option, so a Host can't create it without saying where its rows are.

---

❓ **Q4 - When an apply is done, on a server grid.**
(a) ➡️ **Recommended: when the View State changes, as it is for a header click.** The Host's fetch follows. Loading and fetch errors stay with the Host's grid, and the User can undo. What the backend can't do is removed before any Preview, through Q3's operations and the columns' `allowedOperators`.
(b) Apply waits for a Host `load(state)` callback, and fails with nothing changed if it rejects. Undo waits too.

Why (a): it keeps the adapter interface and ADR 0009 as they are, and treats GridCue's change like any other change to the grid. The failures left after validation are network failures, which the Host already shows for its own clicks. (b) puts a network wait inside Apply and ties GridCue to how the Host loads data, which needs an ADR. Would change if: a real Host's backend rejects valid View States, such as a filter too costly to run, and Users are left with a view whose data never loads.

---

❓ **Q5 - Which AG Grid editions the first adapter supports.**
(a) ➡️ **Recommended: Community only.** The Client-Side and Infinite row models. It does not list `group.set`, since row grouping needs Enterprise. It writes filters and sorts into AG Grid's own models, so an Enterprise Server-Side Row Model datasource receives them unchanged, but only Community is tested and the docs say so.
(b) Community, plus Enterprise row grouping when `isModuleRegistered` says the row grouping module is there. CI installs `ag-grid-enterprise` and runs it without a licence key.
(c) As (b), with a trial or licence key the owner holds, as a CI secret.

Why (a): Community is MIT, and every MVP operation but grouping works on it. Running Enterprise in an open-source CI without a licence is unsettled, and production use needs one. Grouping on an Enterprise grid then says "unsupported" rather than guessing. Would change if: a Host on Enterprise asks for grouping, and the owner settles how CI may run Enterprise.

---

❓ **Q6 - How the AG Grid adapter writes and reads filters.**
(a) ➡️ **Recommended: AG Grid's own text, number and date filters, set to GridCue's meanings.** The Host adds one line, `defaultColDef: gridcueColDef` (working name), like TanStack's `defaultColumn: { filterFn: gridcueFilterFn }`. It makes ranges include their ends, counts blanks as "not equal", and offers only the options GridCue can read. GridCue writes into these filters and reads them back. A filter the User sets in AG Grid's own menu is then part of the View State, so the Preview, "clear the filters", undo, and later the View Sentence all see it. A column whose filter GridCue can't read loses its filter capability in the schema. *Corrected in the fact check:* nothing in today's capabilities can refuse an `in` before the Preview, so the setting is a function of the schema, `gridcueColDef(schema)`, that lets each column hold as many conditions as it has declared values. Any `in` GridCue validates then fits; a filter AG Grid still can't hold fails at Apply with nothing changed. Text columns get GridCue's exact meaning through AG Grid's `textMatcher` hook, so letter case follows the column's kind.
(b) A GridCue custom column filter, through Community's `CustomFilterModule`, that tests every operator with `matchesPredicate`. Every meaning is exact and it shows as an active filter. A server datasource receives a GridCue model it must learn to read.
(c) An external filter (`doesExternalFilterPass`). Exact, but it works with the Client-Side Row Model only and never shows in AG Grid's menus.

Why (a): it is the only choice where what the User sees in AG Grid's menus, what GridCue previews, and what a server datasource receives are the same filter. The meanings that differ by default are settings, not code, and the row check in the evidence table proves they match. (b) breaks every existing server datasource. (c) hides GridCue's filters from the grid's own UI and stops at the browser. Would change if: AG Grid can't be set to a meaning GridCue needs (to be checked when the adapter is built, since the defaults above are read, not run), or Hosts can't add the default column settings because they already use their own.

---

❓ **Q7 - The AG Grid entry and its dependency.**
(a) `gridcue/ag-grid`, typed against the parts of `GridApi` it uses, with `ag-grid-community` as an optional peer dependency and no import from it. The peer range is the majors CI tests, so a package manager warns on an untested version. `gridcue/tanstack-table` gets the same treatment for `@tanstack/table-core` 9.
(b) ➡️ **Recommended (changed in the fact check): `gridcue/ag-grid`, typed the same way, with no peer dependency, as `gridcue/tanstack-table` is today.** The adapter checks at creation that the grid has every call it uses, and throws an `INPUT_CONFIG` error naming the missing ones. The docs and the skill name the majors CI tests.
(c) `gridcue/ag-grid`, importing AG Grid's own types, with an optional peer dependency.

Why (b): structural types keep the entry free of AG Grid's code and survive a major that doesn't change the calls GridCue uses. The draft recommended (a) because "the optional peer costs nothing at install". The fact check found it does: npm reports `ERESOLVE` for an optional peer present at a version outside its range and tries to fetch another, so a Host on AG Grid 32 that installs GridCue only for the Rows Adapter would meet a conflict. And under pnpm a peer on `@tanstack/table-core` is invisible when the Host installs only `@tanstack/react-table`, so (a) would warn the wrong people and miss the right ones. A check at creation fails where the problem is, with a plain message. (c) ties GridCue's declaration files to AG Grid's types, which change often across majors. Would change if: a registry run shows npm only warns and never replaces or fails, and the owner prefers an install-time warning to a runtime check.

## Owner's answers (2026-11-13)

The seven questions went to the owner inside the build-order plan (`docs/superpowers/plans/2026-11-13-five-opportunities-order.md`, section 7), as decisions among D1 to D45, each with its recommended answer and the lead's words "a bare agree accepts every recommendation". The owner gave one reply to the whole list. It is recorded against each question as it was given.

| Question | Order plan | Answer (owner, 2026-11-13) | Recommended answer it accepts |
| --- | --- | --- | --- |
| Q1 - TanStack Table v8 | D9 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | (a) Reach it through TanStack's own `useLegacyTable` bridge. No v8 entry |
| Q2 - What a server-data Host gets | D25 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | (a) A guide, a tested example, and a Query Check in `gridcue/testing`. No translator |
| Q3 - The adapter for a server grid | D23 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | (a) A named Query Adapter, without `limit.set` unless the backend cuts before paging. Its `without` option only removes |
| Q4 - When an apply is done | D24 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | (a) When the View State changes. The Host's fetch follows, and its errors are the Host's |
| Q5 - AG Grid editions | D26 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | (a) Community only: Client-Side and Infinite row models, no grouping |
| Q6 - AG Grid filters | D27 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | (a) AG Grid's own filters, set to GridCue's meanings by `gridcueColDef(schema)`, and read back |
| Q7 - AG Grid entry and dependency | D28 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | (b) `gridcue/ag-grid`, typed structurally, no peer dependency, checked at creation |

The reply approved the recommended answers as section 7 of the order plan states them, and with them the spec and the plan. The last column is section 7's wording, not the owner's. Where section 7 differs from this log, section 7 stands. For this record the differences are:

- **Q3 (D23).** The adapter is the **Query Adapter** (`createQueryAdapter`), the name the fact check proposed, not the working name `createRemoteRowsAdapter`. Its option that removes operations is `without`, not `operations`.
- **Q2 (D25).** The edge cases in `gridcue/testing` are named the **Query Check**.
- **Q6 (D27).** The answer is the one corrected in the fact check: `gridcueColDef(schema)` is a function of the schema, and an `in` AG Grid can't hold fails at Apply, not before the Preview.
- **Q7 (D28).** The answer is (b), the recommendation as changed in the fact check, not the draft's (a).
- **A grid that can't group (D3).** This log's evidence table says a request whose only change is grouping "ends unsupported with the grid's reason", and that it needs no decision. The cross-check made it a decision. D3 as approved: GridCue asks a question with no choices ("This grid can't group rows."), nothing is applied, it comes from one shared piece of code, and the protocol does not change. A new unsupported category was the other way, and was not chosen.
- **The build order (D1).** This log left the order inside the opportunity to the spec. D1 as approved puts the Host-controlled TanStack fix first, then "this grid can't group" once the first named-filters and operation-set fixes are in, then the v8 guide. The Query Adapter, the Query Check and the AG Grid adapter follow the operation set.
- **Edits to approved documents (D2).** `AGENTS.md`'s lists of entries gain `gridcue/testing` with the Query Check's PR, and `gridcue/ag-grid` and the Query Adapter with the AG Grid PR.

D4 changes nothing in this record: it adds no reading. D5 touches one sentence. "Count" stays the word for "top 10", so the server guide says "the number of rows" for what the command bar's `countRows` returns. The lead recommended two trims in the same message (order plan, section 7). Neither touches this record.

The terms **Data Query**, **Query Adapter** and **Query Check** entered `CONTEXT.md` with these answers, and the Rows Adapter's entry gained a pointer to the Query Adapter. ADRs 0031, 0032 and 0033 record the decisions that are hard to reverse.
