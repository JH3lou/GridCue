# Download stats: grilling log

This log covers an admin dashboard for `gridcue`'s npm downloads. It follows `.claude/skills/gridcue-planning`: the grill comes first, then a design pass, then the spec and the plan.

## Already decided (not re-asked)

| Decision | Source |
| --- | --- |
| The Site is fully static on Workers static assets, with no Worker code and no secrets. | ADR 0016 |
| Effect and chart libraries stay in the Site and never enter a package. | ADR 0003 |
| Follow "npm stats the right way" (TanStack blog, 2025-12-02): use `/range/` in chunks under 18 months. | Owner's brief |
| Components from dashboardcn. Design guided by `taste-skill`, `emil-design-eng` and `high-end-visual-design`. Built with superpowers and reviewed with ponytail. | Owner's brief |

## Facts gathered (2026-11-03)

- **npm silently truncates download ranges at about 18 months** (549 days). Both `/downloads/point/` and `/downloads/range/` return the same truncated totals for longer ranges and don't report an error. TanStack fetches `/downloads/range/{from}:{to}/{pkg}` in chunks of 500 days or less and sums them. *Verified from the post's source in TanStack/tanstack.com.*
- **The post's sample code counts each boundary day twice.** It sets the next chunk's start to the previous chunk's end, and both ends are inclusive. Our chunks start the day after the previous chunk ends. *Verified by reading the code.*
- **`gridcue` was first published on 2026-09-25.** Its versions are 0.1.0 and 0.2.0. One chunk covers its history until about February 2028; chunking is still needed after that. *Verified from registry.npmjs.org.*
- **`/versions/{pkg}/last-week`** returns per-version downloads for the last 7 days. *From npm's API docs; unverified here.*
- **api.npmjs.org allows browser requests (CORS).** Browser tools such as npm-stat.com call it directly. *Unverified here: this sandbox's network blocks api.npmjs.org, so the browser check uses a mocked API.*
- **dashboardcn** (NoahGdev/dashboardcn) is MIT. Its components are shadcn registry items built on recharts 3 and Tailwind 4, with a shadcn `chart` primitive. *Verified from the repository; dashboardcn.com itself is blocked here.*
- **livedocs.xyz** couldn't be reached, and no source repository turned up. It isn't used.
- The Site has no `--chart-*` tokens and no accent hue. It's neutral shadcn with Inter and lucide icons.

## Round 1 (2026-11-03)

| # | Question | Owner's answer |
| --- | --- | --- |
| 1 | Where does the download data come from? | Browser fetches npm (recommended) |
| 2 | How is the dashboard protected? | Unlisted + noindex (recommended) |
| 3 | Where does it live? | Site route /admin/downloads (recommended) |
| 4 | Which views? | KPIs with deltas, daily trend chart, downloads by version, weekly/monthly table |

## Design pass

`taste-skill`'s app-screen rules govern, because this is a screen you work in, not a page you scroll. Where `high-end-visual-design` contradicts them (Section 2 bans Inter and lucide, and it asks for `py-24` sections and scroll-reveal entrances), the Site's existing type, icons and density win (better-ui: "Keep the project's component library, tokens and density"). The dashboard borrows only its concentric radii, its diffused shadow and its small eyebrow label.

| Before (dashboardcn defaults) | After | Why |
| --- | --- | --- |
| `kpi-card`: one tile per KPI with a sparkline | One card split by 1px hairlines into 4 columns, with no sparklines | taste: no tile of its own, no sparkline. The chart below is the trend. |
| Four KPIs at the same size | All time at `text-3xl` (30px), the others at `text-2xl` (24px) | taste: the answer figure leads at 1.3 times its siblings or more |
| `delta-badge` coloured pill, up = green | Only the number is coloured, `text-xs`, with the window in words ("vs prior 7 days"). A delta with no baseline is grey ("new"). | taste: colour only the number; zero or undefined changes are grey |
| `trend-chart` `type="monotone"`, gradient fill at 0.6 | Daily downloads as grey bars, a 7-day average line in one hue, `curve="linear"`, no fill | taste: straight segments, one hue on the main data, fill 14% or less |
| `chart-1..5` rainbow defaults | One token in the logo's orange (#F25619): `--chart-1: oklch(0.64 0.2 40)` light and `oklch(0.7 0.18 42)` dark, with bars in `var(--muted-foreground)` at 0.35 opacity | taste: one hue per chart, one subject keeps one hue |
| Chart animates on every data change, 500ms | Animation off (`animate={false}`) | emil: a dashboard reloaded many times a day doesn't animate. Crisp and fast. |
| Range switch as a filled `Tabs` | A 32px segmented control, 30d / 90d / All, with `aria-pressed` and `scale(0.96)` on press over 160ms `--ease-out` | better-ui: scale on press is 0.96; emil: press feedback 100–160ms |
| Flat `Card` with `shadow-sm` and a border | The Site's `--shadow-raised` with a `ring-1 ring-border` hairline, `rounded-xl` | better-ui: shadows for elevation; high-end: soft diffused shadow |
| Tabular figures not set | `tabular-nums` on every figure, numeric columns right-aligned | taste §7.4 |
| Loading shows nothing | Skeleton blocks at final sizes, and an error card with "Try again" | AGENTS.md: every way in needs a way out |
