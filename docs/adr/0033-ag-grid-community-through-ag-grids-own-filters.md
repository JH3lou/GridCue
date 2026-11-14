# AG Grid Community through AG Grid's own filters

**Status:** accepted with the more grids spec (2026-11-13). Not yet built.

GridCue gains a Grid Adapter for AG Grid Community, in a new `gridcue/ag-grid` entry. It writes filters into AG Grid's own column filters, set to GridCue's meanings, and reads them back.

AG Grid was named the next adapter in the build-plan grill. Three facts shaped how it is reached (more grids grill, 2026-11-13):

- **Row grouping is not in Community.** It, the Server-Side Row Model, and the Set Filter need AG Grid Enterprise, which is under a commercial licence.
- **AG Grid's filters mean something else by default.** "Not equal" leaves out empty cells, a range leaves out its ends, and a cell holding only spaces counts as empty. GridCue's meanings differ on all three. This was read from AG Grid's docs and types, not run. A spike runs it before any adapter code.
- **An optional peer dependency is not free.** In an offline test, npm reported a conflict for a Host whose AG Grid is outside the range, even one that uses GridCue only for the Rows Adapter. What npm does against the registry was not run.

What was decided:

- **Community only.** The adapter supports the Client-Side and Infinite row models. It does not list `group.set`, so a grouping request ends in "This grid can't group rows." Enterprise is never a dependency and is not tested, and the docs say so.
- **AG Grid's own filters, set to GridCue's meanings.** The Host adds one default column setting, `gridcueColDef(schema)`. Where a setting can't give GridCue's meaning, a custom filter option that carries GridCue's own test does. A row check against `applyView` settles which, option by option.
- **Filters are read back.** A filter the User sets in AG Grid's menu is part of the View State, so the Preview, "clear the filters", and undo all see it. A filter GridCue can't read stays the Host's. It is kept on every write, and a GridCue filter on that column fails at Apply with nothing changed.
- **No AG Grid import and no peer dependency.** The entry is typed against the calls it uses. It checks the grid when the adapter is created and names anything missing. The docs name the AG Grid majors the gate tests. `gridcue/tanstack-table` keeps the same policy.

This changes no accepted ADR. It follows ADR 0007: a new grid is a new subpath, not a new package.

The grill weighed a GridCue custom filter and an external filter, and the owner approved AG Grid's own filters. Only that choice keeps one filter in three places: AG Grid's menus, GridCue's Preview, and what a Host's datasource receives. A custom filter would hand every existing datasource a form it can't read. An external filter never shows in the menus and works on rows in the browser only.

The cost is a setting every Host must add, and no grouping on the grid most common in finance. An AG Grid major nobody tested is found when the adapter is created, not at install. A filter AG Grid can't hold, such as an OR across two columns, fails at Apply with nothing changed, not before the Preview.

It would change if a Host on Enterprise asks for grouping and the owner settles how the gate may run Enterprise, if AG Grid can't be set to a meaning GridCue needs (that operator is then removed on AG Grid), if Hosts can't adopt `gridcueColDef` beside their own column settings, or if a run against the registry shows npm only warns about an optional peer.
