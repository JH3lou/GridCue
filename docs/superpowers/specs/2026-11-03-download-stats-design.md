# Download stats dashboard: design spec

**Status:** approved by the owner on 2026-11-03
**Date:** 2026-11-03
**Scope:** Round 1 of `docs/planning/download-stats-grill.md`

## 1. Purpose

The owner wants to see how `gridcue` is being adopted: how many people download it, whether that is growing, and which versions they're on. The screen's one question is **"Is gridcue's adoption growing?"**, and the line under the title states the answer as a finding, for example "1,284 downloads in the last 7 days, +18.2% on the week before".

## 2. Decisions

| Decision | Source |
| --- | --- |
| The browser fetches npm's public API. No server, storage, cron or secrets. | Grill Q1 |
| Unlisted and `noindex`. Kept out of the sitemap and the nav. No auth code. | Grill Q2 |
| A Site route at `/admin/downloads`. Only the Site gets the new dependency, recharts. | Grill Q3 |
| KPIs with deltas, a daily trend chart, downloads by version, and weekly/monthly totals | Grill Q4 |
| Chunked `/range/` requests, with each chunk 500 days or less and none overlapping | TanStack post; grill facts |

No ADR: this keeps the Site static (ADR 0016) and touches no package.

## 3. Data

`apps/site/app/lib/npm-downloads.ts` holds plain functions with no React.

- `FIRST_PUBLISHED = "2026-09-25"` is a constant, because a package's first publish date never changes. It saves a call to the registry, which may not allow CORS.
- `chunkRanges(start, end, maxDays = 500)` returns inclusive `[from, to]` pairs. Each chunk starts the day after the previous one ends, so no day is counted twice.
- `fetchDailyDownloads(pkg, start, end, { fetch, retryDelayMs })` runs one GET per chunk, in order, to `https://api.npmjs.org/downloads/range/{from}:{to}/{pkg}`.
  - It retries a 429 or a 5xx up to 3 times, waiting 1s, 2s and then 4s, and throws on any other failure.
  - It checks each response's shape: `downloads` must be an array of `{ day: string, downloads: number }`.
  - The end date is yesterday in UTC, because npm only publishes a day's counts after the day ends.
- `fetchVersionDownloads(pkg, { fetch })` gets `https://api.npmjs.org/versions/{pkg}/last-week`, checks its shape, and returns `{ version, downloads }[]` sorted by semver, newest first.
- `summarize(days)` returns the all-time total and, for windows of 1, 7 and 30 days ending on the last day of data, `{ current, previous, delta }`.
  - `delta` is a fraction.
  - It is `null` when the previous window is empty or reaches back before the first publish, which the UI shows as "new".
- `totalsBy(days, "week" | "month")` returns one row per period, newest first, as `{ start, downloads, delta, partial }`.
  - Weeks start on Monday, in UTC. Months use `YYYY-MM`.
  - `partial` marks the current period and any period cut short by the first publish date. The UI tags those rows and doesn't colour their delta.
- `movingAverage(values, 7)` averages the trailing window. The first six days average whatever data exists before them.

Nothing is cached in the browser. One page view costs about two requests, and npm's CDN caches them.

## 4. Screen

Route: `apps/site/app/routes/admin.downloads.tsx` at `/admin/downloads`. It is prerendered as a shell, and the data loads on the client in a `useEffect`. It uses `HomeLayout` like the blog page, so the theme toggle and nav work the same way.

The layout has a max width of 1152px, gutters of `px-4` (`md:px-8`), and one gap of 16px.

1. **Title row.**
   - An eyebrow label, "Admin", above the h1 "Downloads" (24px, semibold).
   - Under the title, the finding sentence in grey.
   - On the right: "Updated 14:02 · npm" and a Refresh button.
2. **KPI strip.** One card split into four columns by hairlines (2×2 on a phone):
   - All time, which leads at 30px, with the subline "since Sep 25, 2026";
   - Last day, Last 7 days and Last 30 days, at 24px, each with a delta "vs prior N days".
3. **Daily downloads.** A full-width card holding a dashboardcn `composed-chart`.
   - Daily downloads are grey bars, and the 7-day average is a line in the accent colour.
   - A y-axis with round ticks and no animation.
   - In the header, a segmented 30d / 90d / All control, defaulting to 90d.
   - Dates are shown in UTC.
4. **Two cards side by side** (stacked below `lg`):
   - **By version, last 7 days**: a dashboardcn `bar-list` with each version's share.
   - **Totals**: a Week / Month segmented control and a table with the columns Period, Downloads and Change, showing 6 rows. Partial periods are marked "so far".

States:

- **Loading:** skeletons at the final sizes.
- **Error:** a card that says what failed ("npm didn't respond") with a Try again button. The versions card fails on its own without blanking the page.
- **Empty days:** drawn as zero, never padded.

## 5. Components

The following are copied from dashboardcn (MIT, by NoahGdev) into `apps/site/app/components/ui/`, each with a one-line source and licence header:

- `chart.tsx`, which is shadcn's chart primitive;
- `composed-chart.tsx`;
- `bar-list.tsx`;
- `lib/format.ts`.

Edits to them follow the design pass in the grill log. `recharts` 3.10.1 and `react-is` 19.3.0 are added to the Site, pinned exactly.

## 6. Unlisted

- `meta` returns `{ name: "robots", content: "noindex, nofollow" }`.
- `scripts/postbuild.mjs` leaves `/admin` paths out of `sitemap.xml`.
- No nav link. `llms.txt` lists only the docs, so it needs no change.

## 7. Tests

- A new Vitest project, `site`, covers `apps/site/app/**/*.test.ts`.
- `npm-downloads.test.ts` covers:
  - chunk boundaries: none overlap, there are no gaps, the maximum length holds, and a single day works;
  - the retry on 429, and giving up after 3 tries;
  - rejecting a malformed response;
  - deltas, including `null` for "new";
  - ISO weeks across a year boundary, and partial periods;
  - the moving average.
- The browser check runs in Playwright against the built Site, with `api.npmjs.org` mocked by synthetic data, in light and dark, at 1440 and 390 widths.

## 8. Surfaces

- **Entry points, registry, examples, agent skill:** untouched. No package change.
- **Site:** the new route. No public API changes, so the docs don't change.
- **Failure paths:** loading, error with retry, the versions card failing on its own, and refresh.
- **`docs/operations/site.md`:** one paragraph on where the dashboard is, and how to put Cloudflare Access on `/admin/*` later if wanted.

## 9. Out of scope

GitHub stars, other packages, stored history, alerts, CSV export, and auth.
