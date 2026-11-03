# Download stats dashboard: implementation plan

**Goal:** `/admin/downloads` on the Site shows gridcue's npm downloads (all time, 1/7/30 days, daily trend, versions, weekly/monthly totals), fetched in the browser in chunks of 500 days or less.

**Spec:** `docs/superpowers/specs/2026-11-03-download-stats-design.md`

**Architecture:** pure data functions in `apps/site/app/lib/npm-downloads.ts`, tested with Vitest; a client-loaded route built from dashboardcn components; no package or registry change.

**Branch:** `feat/download-stats`, cut from `main`.

## Task 1: the data module, test first

Files: `vitest.config.ts`, `apps/site/app/lib/npm-downloads.ts`, `apps/site/app/lib/npm-downloads.test.ts`

1. Add the project `{ test: { name: "site", root: "apps/site", include: ["app/**/*.test.ts"] } }` to `vitest.config.ts`.
2. Write failing tests for `chunkRanges`, `fetchDailyDownloads` (with a fake `fetch`: chunk URLs, 429 retry with `retryDelayMs: 0`, giving up after 3 retries, a malformed body), `fetchVersionDownloads`, `summarize`, `totalsBy` and `movingAverage`, using the cases in spec §7.
3. Run `pnpm vitest run --project site` and see them fail.
4. Implement the module (spec §3) until they pass.
5. Commit: `feat(site): chunked npm download stats`.

## Task 2: dashboardcn components

Files: `apps/site/package.json`, `apps/site/app/components/ui/{chart,composed-chart,bar-list}.tsx`, `apps/site/app/lib/format.ts`, `apps/site/app/app.css`

1. `pnpm --filter @gridcue-internal/site add recharts@3.10.1 react-is@19.3.0 --save-exact`.
2. Copy the four files from NoahGdev/dashboardcn at `main`, fix the import paths to the Site's `@/` aliases, and add the source and licence header.
3. Add `--chart-1` for light and dark to `app.css` (values from the grill's design pass).
4. `pnpm --filter @gridcue-internal/site typecheck` passes.
5. Commit: `feat(site): add dashboardcn chart components`.

## Task 3: the route

Files: `apps/site/app/routes.ts`, `apps/site/app/routes/admin.downloads.tsx`, `apps/site/app/components/admin/*.tsx` as needed, `apps/site/scripts/postbuild.mjs`

1. Register `route("admin/downloads", "routes/admin.downloads.tsx")`, with `meta` noindex.
2. Build the screen from spec §4: title row, KPI strip, chart card with range control, versions card, totals card; loading, error and retry states.
3. Leave `/admin` out of `sitemap.xml` in postbuild.
4. `pnpm build:site` succeeds and its link check passes.
5. Commit: `feat(site): admin downloads dashboard`.

## Task 4: browser check

1. Serve `apps/site/build/client`, mock `api.npmjs.org` in Playwright with synthetic data, and take screenshots at 1440×900 and 390×844, in light and dark. Also screenshot the error state.
2. Fix what the screenshots show, and review against the grill's design-pass table.

## Task 5: docs and gate

1. Add a "Downloads dashboard" section to `docs/operations/site.md`.
2. Run `pnpm lint` and fix it, then `pnpm typecheck`, `pnpm test`, and `pnpm build:site`. Run the full `pnpm check` if time allows.
3. Ponytail review of the branch diff, then fix its must-fix and should-fix findings.
4. Commit: `docs(site): downloads dashboard runbook`, then push the branch.
