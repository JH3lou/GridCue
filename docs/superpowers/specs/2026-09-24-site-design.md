# Site: design spec

**Status:** draft, waiting for the owner's approval
**Date:** 2026-09-24
**Scope:** the public Site at gridcue.dev: the marketing page, a live demo, developer docs, the hosted Component Registry, and the changelog. The decisions are in `docs/planning/site-grill.md` (Round 1 and the owner's direction). This is the second spec from the first build.

## 1. Purpose and positioning

**Use natural language to get the insights you need from complicated data, dense grids and tables.** A User asks in plain words; GridCue turns the request into a checked, previewable change to the grid's view (filters, sorts, groups and columns), so the answer is on screen without learning the grid's controls. It is open source and built on TypeSafe's Jev.

Positioning in the owner's words: "used natural language to get the data insights on complicated data, dense grids and tables".

The Site speaks to two readers: the people who work in dense grids (the insight they need in one sentence), and the developers who add GridCue to their app. Its job is to let a developer **touch the product in seconds, then install it in minutes**:
- the hero is the working product, not a picture of it;
- the demo shows what the model decided and why;
- the docs get a developer from `npm i gridcue` to a working command bar.

**Free throughout.** No paid plans, no services that need payment details, no hosted Jev key, and no server: the Site is static files.

**Independence.** The Site names TypeSafe's Jev as the model GridCue is built for, and says in the footer: "GridCue is an independent open-source project, not affiliated with or endorsed by TypeSafe." The core stays visibly provider-neutral: the demo runs on the Mock Provider, and the docs show how other providers plug in.

## 2. Design pass (emil-design-eng, better-ui, principle-experience-first)

Each row is a decision the design skills changed or fixed. **Before** is the grill's working assumption or the common default; **After** is what this spec adopts. Values are exact.

| Before | After | Why |
| --- | --- | --- |
| CardSwap in the hero, cycling "request → Preview → applied grid" cards | **The hero is the live command bar over a real grid.** No CardSwap, so no gsap. | The Sonner principle: let people touch the product. A picture of the flow competes with the flow itself. Experience-first: fewer, better features. It also drops the one non-MIT dependency. |
| ScrollStack, built on lenis smooth scrolling, for "How it works" | **Three sticky steps, drawn with CSS scroll-driven animation** (`animation-timeline: view()`) on native scrolling, using only `transform` and `opacity`. No lenis. | Smooth-scroll libraries replace native scrolling, which breaks keyboard, find-in-page and reduced motion. Scroll-driven CSS runs off the main thread (emil: CSS beats JS under load). This keeps the effect's intent under ADR 0003's rule. |
| One motion speed for everything | **Tokens:** `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`. Dropdowns and popovers 180 ms, press feedback 160 ms, the Preview panel entering 240 ms, marketing steps 600 ms. | emil: strong custom curves, and UI under 300 ms. Only explanatory motion runs longer. |
| The command palette (docs search, ⌘K) animates open | **No animation** on open, close, or list navigation. | emil: keyboard-initiated and high-frequency actions never animate. |
| Buttons with hover only | **`scale(0.96)` on `:active`** for every pressable element, 160 ms `--ease-out`, `static` opt-out. Hover effects only under `@media (hover: hover) and (pointer: fine)`. | better-ui: always 0.96. emil: gate hover off touch devices. |
| The Preview appears instantly after a request | **Enter: `opacity 0 → 1`, `translateY(8px) → 0`, 240 ms `--ease-out`,** with its lines staggered at 40 ms. Exit: `translateY(4px)`, 150 ms. | It is infrequent and explanatory, so staging it is worth it. Exits are softer than enters (better-ui). |
| The theme toggle cross-fades the whole page | **Suppress transitions during a theme switch** (inject `transition:none`, force a reflow, remove on the next frame). The toggle's sun/moon icon cross-fades with scale `0.25→1`, opacity `0→1`, blur `4px→0`. | better-ui's theme-switch and contextual-icon recipes. |
| Borders around every card and panel | **Layered shadows for elevation; borders only for structure** (dividers, the grid, focus). Concentric radii: outer = inner + padding. | better-ui surfaces. The grid itself keeps its borders, because they are structure. |
| Motion as the only sign that the grid changed | **Every change also has a static cue:** the Preview's line list, an "Applied: 2 changes" status with an icon, and highlighted changed column headers for 1.2 s, all of which stay readable in reduced motion. | better-ui: motion is never the only feedback channel. |
| Reduced motion turns everything off | **Reduced motion keeps opacity and color, and drops movement.** The sticky steps become a static three-column list. | emil: fewer and gentler, not none. |
| A developer panel always open in `/demo` | **Collapsed by default, one click to open.** It shows the plan, each decision's evidence and confidence, and the before and after View State. | Experience-first: the core loop (type, preview, apply) comes first; the panel serves developers who ask. |
| "Compare strategies" as a separate page | **A tab inside `/demo`** that reuses the same grid and command bar and shows recorded results side by side. | One place to learn the product. It reuses what's already there. |
| Component pages with preview, props and code stacked in one long column | **kobra.systems-style three panes** (our own implementation): left navigation, centre live preview with a source dock of file tabs underneath, right panel with the install command and a props table. It collapses to one column below 1024 px. | The owner's inspiration note. Preview, install and props are the three things a shadcn user checks before installing. |
| Icons from mixed sets | **One set (lucide, as the registry already uses), with a 1.5 px stroke beside 400-weight text and 2 px beside 600,** recolored by `currentColor` per state. | better-ui icon rules, consistent with the registry's `iconLibrary`. |

**Prototype first.** Before the plan's production code, the hero and `/demo` are prototyped as throwaway HTML in the scratch workspace and checked in a real browser, light and dark, at 10% animation speed. Only the values that survive go into the plan (experience-first: design decisions are cheaper in throwaway HTML).

## 3. Decisions this spec builds on

| Decision | Source |
| --- | --- |
| One Vite app with React Router, Fumadocs, shadcn/ui and shadcn typeset. Marketing at `/`, docs at `/docs`. | ADR 0002, site grill Q7 |
| A fully static Site on Cloudflare Workers static assets. No Worker code, no secrets, no internal site. | Site grill Q1 and the owner's direction; updates ADR 0006 |
| Page map: `/`, `/demo`, `/docs`, `/r`, `/changelog` | Q2 |
| Live demo on the Mock Provider, plus a recorded strategy comparison | Q3 |
| Docs sections plus a Components explorer | Q4 |
| Registry at `https://gridcue.dev/r/{name}.json` under `@gridcue` | Q5 |
| Effects stay in the Site, never in the package or registry. Free only. | ADR 0003, Q6, and the design pass above |
| Fumadocs' built-in static search. No Algolia. | Build-plan grill Q14 |
| Cloudflare Web Analytics (cookieless) | Q10 |
| `apps/site` in the workspace, deployed by Cloudflare's Git integration | Q11 |
| No `gridque.dev` redirect | Q12 |
| Positioning, messaging, calls to action, and page changes | `docs/planning/product-brief.md` §9, agreed by the owner |

## 4. Scope

### In

- `apps/site`: React Router 8 in prerender mode (`ssr: false`, with every route prerendered), Vite 8, Tailwind 4, shadcn/ui, and Fumadocs (core, ui, mdx) with static search.
- **Marketing page `/`** (section 5.1).
- **`/demo`** (5.2), with the recorded comparison generated by a new eval-CLI output (5.3).
- **Docs `/docs`** (5.4), including the Components explorer (5.5).
- **Registry hosting** (5.6): `registry/dist/r` copied into the Site's static output at `/r`.
- **`/changelog`**, rendered from `packages/gridcue/CHANGELOG.md`.
- **`/blog`:** one MDX route, reserved for the launch post "Why we don't let the model write the filter" (brief §6).
- **One Open Graph image,** also used as the GitHub social preview.
- **SEO:** a title, description and Open Graph image per page, `sitemap.xml`, and `robots.txt`.
- **Deploy:** `wrangler.jsonc` with `assets` only, and Cloudflare Git integration. The owner connects the repository and the domain.
- **A local check that `gridcue/server` with `@typesafe-ai/sdk` builds and runs under workerd** (`wrangler dev`), closing ADR 0011's open item. It is a docs-recipe check, not a deploy.
- **Docs updates:** ADR 0006 moves from Pages to Workers static assets, with no internal site. ADR 0003's stale wording (Apache-2.0, `@gridcue/*`) is corrected.

### Out

- The `pnpm create gridcue` starter (its own spec), grid routing (0.2), and any hosted Jev key or internal site.
- Submitting `@gridcue` to shadcn's registry index. That happens after launch, once the URL is live.
- Paid services and paid component libraries (React Bits Pro, Kobra).

## 5. Pages

### 5.1 `/`, marketing

1. **Hero.**
   - **Headline:** "Ask your data a plain question. See the view that answers it."
   - **Sub-line:** "Get to the insight in complicated data, dense grids and tables. GridCue previews every change and never touches your data."
   - **Badge row:** "MIT · Headless · Built for Jev" (product brief §9.1: the User's benefit first, Jev as a badge). The final wording is settled in the prototype step.
   - **Demo:** a **live command bar over a 12-row synthetic grid**, running on the Mock Provider in the browser. A Preview appears, then Apply, then Undo.
   - **Chips, shaped as insights**, each filling the bar in one click: "Taxable accounts over $1M, biggest concentration first", "Roth IRAs grouped by rep", and "largest accounts first". Add **one refusal chip**, "Sell anything over 10%", which shows the safety story in one click. The prototype checks that the Mock resolves every chip.
   - **Calls to action:** primary "Try it" (inline); secondary a copyable `npm i gridcue`; tertiary "Star on GitHub".
2. **How it works.** Three sticky steps, as in the design pass: *You ask* → *GridCue previews exactly what will change* → *You apply, and can undo*.
3. **Why the model doesn't write the filter.** A three-row comparison, *an LLM writes the grid state* against *GridCue*: closed choices, code decides, preview and undo. It carries the dated evidence line, "176 labelled live requests on a synthetic wealth schema, 0 wrong views (jev-1.13.0, Sept 2026)", always with its scope (product brief §1 and §9.3).
4. **Safe by design.** Four short points:
   - view-only (never edits data);
   - preview before apply;
   - rows never leave your app, only column names and approved values;
   - no provider key in the browser.
5. **What GridCue is not.** A one-line strip: not SQL, not a chatbot; it doesn't edit data or compute answers. It protects the "insight" claim (brief §9.4).
6. **Providers and grids.** A text-only band: "Jev · Mock · your provider" and "TanStack · any array · AG Grid (next)". It shows neutrality without implying partnership (brief §9.7).
7. **Fits your domain.** A side-by-side code block: the three schema declarations (`rowNoun`, `entity`, `valueGroups`), and the choice of `strategy`.
8. **Quick start, keyless first.** Install, then the Mock Provider in the browser (no server, no key), then "Turn on Jev". Link to the docs.
9. **Footer:** GitHub, docs, changelog, the MIT license, and the independence line from section 1.

### 5.2 `/demo`

- **Layout.**
  - A full-width grid of the 500-row synthetic wealth fixture.
  - The command bar across the top.
  - The Preview panel to the right; below 1024 px it becomes a sheet.
- **Suggestions.** About 8 example requests covering filter, sort, group, show and hide, several changes in one part, nesting, "also", an exclusion, a value group, and a refusal ("delete these rows").
- **Developer panel** (collapsed by default), tabbed:
  - the plan's operations;
  - each decision's evidence and confidence;
  - the before and after View State;
  - the resolution request as the provider saw it, showing that no rows were sent.
- **Compare strategies** tab (section 5.3).
- The theme follows the system setting, with a toggle.
- The layout leaves room for a **dataset switcher**, for the second dataset (shipments and orders) planned after launch.

### 5.3 The recorded strategy comparison

- **Generated data.** `pnpm eval:live -- --record=apps/site/src/data/strategy-runs.json` (new) runs a curated set of about 12 requests under Focused, Fan-out and Mock. For each, it records:
  - the Preview lines;
  - the question count and latency;
  - the verdict.

  It also records the model id (`jev-1.13.0`) and the date.
- **Rendering.** The tab shows the three columns side by side for the selected request, with the caption "Recorded from live Jev on <date>. The live demo above runs on the Mock Provider." There is no hosted key.
- **Refreshing.** The owner reruns the command locally with `.env.local` whenever the model or questions change.

### 5.4 `/docs`

- **Structure** (Fumadocs, MDX, with typeset prose):
  - **Get started:** "Your grid in 5 minutes (Mock, no key)"; "Turn on Jev"; "Describe your domain"; "Run the examples". The keyless page is first (owner decision 2).
  - **Concepts:** the pipeline diagram, then one page per glossary cluster:
    - Requests (Utterance, Clause, Mention, Clarification);
    - Views (View State, View Plan, Preview);
    - Providers and confidence.
  - **Guides:**
    - Vite with TanStack Table;
    - Next.js with the Rows Adapter;
    - Server Handler recipes (Next.js, Express, Hono, Cloudflare Workers);
    - protecting the endpoint;
    - describing your domain;
    - choosing a strategy;
    - running evals;
    - **"Going to production"** (auth, rate limits, timeouts, audit);
    - **"Build a provider"** and **"Build an adapter"**, each with its contract suite.
  - **Components:** the explorer (5.5).
  - **API reference:**
    - `createGridCue` and the Controller;
    - `defineSchema` and `schemaFromTanStack`;
    - adapters;
    - providers (Jev, Mock, remote, custom);
    - the protocol types.

    Each entry gives its signature, a props or options table, and an example.
  - **Safety and protocol.** The data boundary, restricted columns, and a note that the TanStack adapter refuses OR and nested filters.
- **Search.** Fumadocs static search in a ⌘K command palette, not animated.

### 5.5 The Components explorer

- **Scope.** One page per component: the registry's command bar, preview panel and clarification prompt, plus the package's plain-CSS `GridCueBar`.
- **Left pane.** Docs navigation, with a "Components" group.
- **Centre pane.** A live preview on a neutral stage, running on the Mock Provider, with a variant switch (for example, with or without the Preview open) and a light/dark switch. Underneath is a resizable **source dock** with file tabs, a copy button per file, and "Copy install command".
- **Right pane.**
  - the title and a one-line description;
  - **Install:** `npx shadcn@latest add https://gridcue.dev/r/command-bar.json` (and the `@gridcue/...` form with the namespace setup snippet);
  - **Props:** Prop, Type and Default, generated at build time from the TypeScript types so it can't drift;
  - **Built with:** the shadcn primitives it depends on.
- **Narrow screens.** Below 1024 px the panes stack: preview, install, props, source.

### 5.6 Registry hosting

The Site build runs `pnpm registry:build` and copies `registry/dist/r` to `/r`, serving `/r/registry.json` and `/r/<item>.json`. The docs give both install forms. A CI check fetches each item from the built output and validates it against shadcn's schema.

## 6. Build and deploy

- **Rendering.** React Router's `prerender()` lists every route, including every `content/docs/**/*.mdx`. The output is plain static files. Fumadocs search uses the static index route.
- **`apps/site/wrangler.jsonc`:** `assets.directory` pointing at the build output, `not_found_handling: "404-page"`, and no `main`, so there is no Worker code. It is free, with unlimited asset requests.
- **Deploy.** Cloudflare's Git integration builds from `main`, with preview URLs for PRs. If it can't run a pnpm workspace build, the fallback is a GitHub Action with `wrangler deploy` and a Cloudflare API token scoped to this one Worker. Both are free.
- **CI.** It runs `pnpm check`, plus the Site's build, a link check, the registry validation, and a Playwright smoke test of `/`, `/demo` and one docs page in light and dark: type a request, see the Preview, apply, and undo.
- **Owner steps.** Add gridcue.dev to Cloudflare, connect the repository, and attach the custom domain. The plan's `docs/operations/site.md` lists them.

## 7. Acceptance criteria

1. `pnpm check` passes, including the Site build and its checks, with no credentials.
2. Every route is prerendered to static HTML with its own title and description. `sitemap.xml` lists them all.
3. The hero and `/demo` work with the Mock Provider in a browser with no network access beyond the Site itself. No request goes to any provider.
4. The recorded comparison shows its date and model, and is regenerated by one command.
5. Both registry install forms work against a local build.
6. The Playwright smoke test passes in light and dark, and with reduced motion.
7. `wrangler dev` runs a Worker using `gridcue/server` with the Jev SDK locally, and ADR 0011 records the result.
8. No browser bundle contains a provider key, `api.typesafe.ai`, or `TypeSafeClient`; `check:bundles` covers `apps/site`.
9. The footer carries the independence line. No page implies TypeSafe endorsement.

## 8. Risks

- **Fumadocs on React Router with full prerendering and static search** is documented, but typeset alongside Fumadocs' prose is *unverified*. The plan proves both in a real build first.
- **Cloudflare Git integration with a pnpm monorepo** is *unverified*. The fallback is a scoped-token GitHub Action.
- **CSS scroll-driven animation support.** Browsers without it get the static three-column layout, the same as reduced motion.
- **The recorded comparison ages.** It shows its date and model, and the handoff lists refreshing it when the model changes.

## 9. Deviations recorded during the build

| Spec said | Built | Why |
| --- | --- | --- |
| shadcn typeset styles the docs prose (§3, §5.4) | Fumadocs' own prose styles | typeset is generated in shadcn's web builder, with no CLI or registry item to install from a build. The owner can generate `typeset.css` there and drop it in later. |
| Props tables generated from the TypeScript types (§5.5) | Read from each component's source at build time: its exported `…Props` interface and its destructured defaults | Same guarantee (no drift), without a type-checker in the Site build. It relies on the components' props staying one member per line. |
| `pnpm eval:live -- --record` (§5.3) | A separate `pnpm eval:record` (`evals/record.ts`) | Recording runs fixed requests through focused, fan-out and the Mock, which is not the eval's pass/fail loop. Keeping them apart keeps both simple. |
| Right-pane props as a table (§5.5) | A stacked list: name and type, then default | At 300 px a three-column table broke types mid-word. |
| ADR 0006 updated in place (§4) | New ADR 0016, with 0006 marked superseded in part | The planning rule: an overturned decision gets a new ADR. |
