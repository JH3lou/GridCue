# AG Grid Community through AG Grid's own filters

**Status:** accepted with the more grids spec (2026-11-13). Built in more grids PR 6, which puts the setting on each column rather than in one default column definition (below).

GridCue gains a Grid Adapter for AG Grid Community, in a new `gridcue/ag-grid` entry. It writes filters into AG Grid's own column filters, set to GridCue's meanings, and reads them back.

AG Grid was named the next adapter in the build-plan grill. Three facts shaped how it is reached (more grids grill, 2026-11-13):

- **Row grouping is not in Community.** It, the Server-Side Row Model, and the Set Filter need AG Grid Enterprise, which is under a commercial licence.
- **AG Grid's filters mean something else by default.** "Not equal" leaves out empty cells, a range leaves out its ends, and a cell holding only spaces counts as empty. GridCue's meanings differ on all three. This was read from AG Grid's docs and types, not run. A spike runs it before any adapter code.
- **An optional peer dependency is not free.** In an offline test, npm reported a conflict for a Host whose AG Grid is outside the range, even one that uses GridCue only for the Rows Adapter. What npm does against the registry was not run.

What was decided:

- **Community only.** The adapter supports the Client-Side and Infinite row models. It does not list `group.set`, so a grouping request ends in "This grid can't group rows." Enterprise is never a dependency and is not tested, and the docs say so.
- **AG Grid's own filters, set to GridCue's meanings.** The Host passes its column definitions through `gridcueColumnDefs(schema, columnDefs)`, which sets GridCue's settings on each column of the schema. Each column's filter lists only the options GridCue can read on it. Where a setting can't give GridCue's meaning, a custom filter option that carries GridCue's own test does. A row check against `applyView` settled which, option by option. The grill chose one default column definition; PR 6's review found that on AG Grid 34 and 35 a default gives every column the same options, so a User could set a filter GridCue can't read, and "clear the filters" would leave it.
- **Filters are read back.** A filter the User sets in AG Grid's menu is part of the View State, so the Preview, "clear the filters", and undo all see it. A filter GridCue can't read stays the Host's. It is kept on every write, and a GridCue filter on that column fails at Apply with nothing changed.
- **No AG Grid import and no peer dependency.** The entry is typed against the calls it uses. It checks the grid when the adapter is created and names anything missing. The docs name the AG Grid majors the gate tests. `gridcue/tanstack-table` keeps the same policy.

This changes no accepted ADR. It follows ADR 0007: a new grid is a new subpath, not a new package.

The grill weighed a GridCue custom filter and an external filter, and the owner approved AG Grid's own filters. Only that choice keeps one filter in AG Grid's menus and GridCue's Preview. It does not keep an existing Infinite Row Model datasource working unchanged: GridCue's custom filter options and meanings are not AG Grid's, so the Host builds its Data Query from the View State and its own filters (more grids spec 5.5). A custom filter would hide GridCue's filters from the menus too. An external filter never shows in the menus and works on rows in the browser only.

The cost is a call every Host must wrap its column definitions in, and no grouping on the grid most common in finance. An AG Grid major nobody tested is found when the adapter is created, not at install. A filter AG Grid can't hold, such as an OR across two columns, fails at Apply with nothing changed, not before the Preview.

It would change if a Host on Enterprise asks for grouping and the owner settles how the gate may run Enterprise, if AG Grid can't be set to a meaning GridCue needs (that operator is then removed on AG Grid), if Hosts can't adopt `gridcueColumnDefs` beside their own column settings, if the tested majors become 36 and later only (one default column definition could then do it), or if a run against the registry shows npm only warns about an optional peer.
