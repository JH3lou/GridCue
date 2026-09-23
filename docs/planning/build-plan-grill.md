# Build plan: grilling log

This file records the design-tree interview that turns the bootstrap proposal and the owner's framework note into an approved build plan. It follows two processes:

- **superpowers brainstorming, architectural path.** Questions, then approaches, then a written spec in `docs/superpowers/specs/`, then an implementation plan in `docs/superpowers/plans/`. Nothing is scaffolded before both are approved.
- **grill-with-docs.** Questions are asked in rounds over the current frontier, each with a recommended answer. Resolved terms go into `CONTEXT.md`. Hard-to-reverse decisions become ADRs in `docs/adr/`.

## Inputs

| Source | What it says |
| --- | --- |
| `FrameworkAndConcepts` (owner note) | TypeScript utility. Vite, React, Tailwind, shadcn/ui, shadcn typeset. Algolia site search for docs. React Bits and a card-swap effect for the marketing page. Deliverables: an easily instantiated backend interface, integrated UI components, a marketing page, developer docs. |
| Bootstrap packet (`README.md`, `AGENTS.md`, `BUILD_AGENT.md`, `docs/*.md`) | A headless, safety-first "intent-to-view compiler" for data grids. Packages for core, a Jev provider, React UI, and a TanStack Table adapter, plus a demo. The work order stops at one tested vertical slice. |

## Tensions found on first read

1. **Scope.** The note asks for a marketing page and developer docs. The proposal's work order excludes both and stops at a library plus demo.
2. **UI styling.** The note wants shadcn/ui components. The proposal wants headless hooks with "minimally styled" reference components and says nothing about shadcn or Tailwind.
3. **"Backend interface."** The note's "backend interface/component that user can instantiate easily" has no direct match in the proposal. It could mean the core controller, a server-side handler, or both.
4. **Svelte in a React stack.** The note names sveltebits.xyz for a card-swap effect. That library is Svelte, and every other choice in both documents is React.
5. **Provider.** The proposal makes TypeSafe's Jev the first real provider. The note never mentions a provider at all.

## Facts gathered (2026-09-23)

These were looked up, not decided. Items marked *unverified* came from search snippets only.

- **shadcn typeset** is a single copied `typeset.css` file for docs-page typography. It replaces `@tailwindcss/typography`. It is not a component and has no npm package.
- **shadcn registries** let any project ship installable components. Users run `npx shadcn add @gridcue/command-bar` after adding a namespace. `shadcn build` generates the registry files.
- **shadcn's Data Table** is built on TanStack Table, so the proposal's first grid adapter matches the shadcn ecosystem.
- **Algolia SiteSearch** is an open-source search UI shipped as a shadcn registry. It still needs an Algolia index. **Algolia DocSearch** is the free hosted crawler and index for public docs, and needs a live, verified domain.
- **React Bits** is licensed MIT plus Commons Clause. It may be used inside an app or site, but its components may not be redistributed. The free tier has **CardSwap** (uses gsap) and **ScrollStack** (uses lenis). The Pro "Scroll Stack" is a different, paid component. Pro pricing is *unverified*.
- **sveltebits.xyz** is a Svelte port of React Bits. It cannot drop into a React site.
- **Jev is real and public.** The SDK is `@typesafe-ai/sdk`. A request carries a `state` plus typed questions: choice, score, or yes/no. Each answer returns a choice with confidence and full probabilities. This matches the proposal's "closed candidates plus confidence" design. Pricing and free credit are *unverified*.
- **Jev in the browser.** The Jev SDK refuses to run in a browser unless the caller passes `dangerouslyAllowBrowser: true`. Whether the Jev API allows browser requests (CORS) is *unverified*.
- **Fumadocs** is React, Tailwind, and Radix based, and can run on Vite through React Router. Starlight is Astro, VitePress is Vue, and Docusaurus is webpack. None of those three match shadcn styling out of the box.
- **npm names** `gridcue` and `@gridcue/core` are both unclaimed.
- **Current stable versions:** Node 24 LTS, pnpm 12.6, TypeScript 7.0, Vite 8.3, React 19.3, Tailwind 4.3, TanStack Table 9.2, Vitest 5.0, zod 4.6, Biome 2.5, shadcn CLI 4.21.

## Routine calls made without asking

- Node 24 LTS as the floor, instead of the proposal's Node 22, because 24 is the current LTS.
- Biome for lint and format, instead of ESLint plus Prettier, because it is one fast tool with no plugin sprawl.
- zod 4 for runtime validation of public inputs and provider responses.
- Brainstorming path: **architectural**. This is a new project, so it gets a written spec and a written plan.

## Round 1

Answer by number. A bare "agree" accepts the recommendation.

❓ **Q1 - Purpose.** What is GridCue for, and what does success look like in three months?
(a) An open-source library you want real teams to adopt. (b) A portfolio or showcase piece. (c) A commercial product with an open-source core.

➡️ (a). The proposal's safety rules, license choice, and eval harness all assume real adoption. The marketing page and docs then act as the library's front door.

---

❓ **Q2 - Product boundary.** Do you accept the proposal's definition as the product? That means a view-only, intent-to-view compiler: preview before apply, fail closed, undo, and no row data sent to the provider. The demo uses synthetic wealth-management data.

➡️ Yes, adopt it unchanged. It is coherent and your note does not contradict it. Financial data is the proving ground only, and the core stays domain-neutral.

---

❓ **Q3 - "Backend interface/component that user can instantiate easily."** What did you mean?
(a) A single browser-side factory such as `createGridCue({ schema, adapter, provider })`. (b) A server-side handler that keeps the provider's API key off the browser. (c) Both.

➡️ (c). The factory is the one call a developer makes to wire a grid. The server handler is a small Fetch-standard `Request` to `Response` function, so it runs on Node, edge runtimes, or any framework. The demo's mock provider needs no server at all.

---

❓ **Q4 - How the styled UI ships.**
(a) Headless hooks on npm, plus shadcn-styled components shipped through a GridCue shadcn registry. (b) One npm package of pre-styled Tailwind components. (c) Headless hooks only.

➡️ (a). This matches how shadcn users already work. Developers own and restyle the copied components, and the headless hooks stay framework-light. The registry source lives in the repo from day one, and hosting it waits for the website.

---

❓ **Q5 - First real intent provider.**
(a) Jev only, as proposed. (b) A general LLM provider, such as Claude with constrained tool choices, instead. (c) Both in the first build.

➡️ (a). Jev's typed choice questions with probabilities are exactly the closed-choice shape the design needs. A general LLM provider can come later through the same interface. Tests and the demo use the mock provider, so no paid key is needed to build.

---

❓ **Q6 - Build order.** Your note adds a website that the proposal excludes. How should the work split?
(a) Two sub-projects, each with its own spec and plan. First the library slice with shadcn-styled components in the demo, then the website with marketing, docs, and the hosted registry. (b) One combined build. (c) Website first, to show the idea, then the library.

➡️ (a). The docs need a real API to document, and the marketing page needs a working demo to show. Splitting also keeps each plan small enough to review.

---

❓ **Q7 - Website stack.** Must the website also be Vite, or is Next.js acceptable?
(a) One Vite app using Fumadocs on React Router. It serves marketing at `/` and docs at `/docs`, styled with shadcn and typeset. (b) Next.js with Fumadocs, the most documented path. (c) Astro Starlight.

➡️ (a). It keeps "Vite, React, Tailwind, shadcn" true across the whole repo. One app also means one deploy, one theme, and one place to host the registry.

---

❓ **Q8 - Marketing effects.** Sveltebits is Svelte and cannot run in a React site.
(a) Use the free React Bits CardSwap and ScrollStack, and drop Svelte. (b) Also buy React Bits Pro for its fancier Scroll Stack. (c) Skip animated effects.

➡️ (a). Both free components exist and match your note. React Bits' license forbids redistributing its components, so they must stay in the website and never enter a published GridCue package.

---

❓ **Q9 - Owner decisions the proposal left open.** Keep the name GridCue, the Apache-2.0 license, and the `@gridcue` npm scope?

➡️ Yes to all three. The npm names are free today. Claim the `@gridcue` npm org before anything is published, since claiming an org is cheap and not reversible by anyone else.

## Round 1 answers (owner, 2026-09-23)

| Q | Answer | Recorded as |
| --- | --- | --- |
| Q1 Purpose | Agree: open-source library for real adoption | Settled |
| Q2 Boundary | Agree: adopt the proposal's view-only boundary unchanged | Settled |
| Q3 Backend interface | The internal demo links to the owner's Jev account. The public demo offers a fake version, a downloadable demo that uses the visitor's own credentials, or a Swagger-style credential input to try it live. | Taken as (c) both a browser factory and a server handler, since a demo tied to a Jev account needs the handler. Demo modes open Round 2. |
| Q4 Styled UI | Agree: headless npm hooks plus a shadcn registry | ADR 0001 |
| Q5 Provider | Partial agree: Jev first, with the demo modes from Q3 | Settled for v1. Demo modes open Round 2. |
| Q6 Build order | Agree: library first, then website | Settled |
| Q7 Website stack | Agree. Vite is required for the website only. The utility must work with Vite, React, TanStack, and others. | ADR 0002. Integration breadth opens Round 2. |
| Q8 Marketing effects | Free only. The links are inspiration, not a fixed list. Effects stay in the marketing site, never in a package. Components are shadcn/ui. | ADR 0003 |
| Q9 Name, license, scope | Agree: GridCue, Apache-2.0, `@gridcue` | ADR 0004 |

## Superseded: waiting on Round 1

These branches were open before Round 1. Round 2 below replaces this list.

- **Docs search.** Fumadocs' built-in local search, or Algolia DocSearch with the SiteSearch UI. This depends on Q7 and on having a public domain.
- **Hosting and domain** for the website and registry. This depends on Q6 and Q7.
- **Where the demo lives.** Its own app, or embedded as live examples in the docs. This depends on Q6 and Q7.
- **Jev integration depth.** Live, opt-in tests against the real API, and who holds the key. This depends on Q5.
- **First spec's acceptance criteria.** Whether to keep `BUILD_AGENT.md`'s list as-is, plus shadcn styling. This depends on Q2, Q4, and Q6.

## Round 2

❓ **Q10 - Swagger-style "try it with your key" on the public site.** A visitor pastes their own Jev key into the website. Where does that key go?
(a) Straight from the visitor's browser to Jev. The key lives only in page memory and is never saved. Jev's SDK allows this only with an explicit `dangerouslyAllowBrowser` flag. Whether Jev's API accepts browser calls at all is *unverified*, because the proxy here blocks it.
(b) Through a small relay function on the GridCue site that forwards each request and never stores or logs the key.
(c) No key entry on the website. Visitors get the fake demo, or download the demo and run it with their key locally.

➡️ (a), with (b) as the fallback if Jev's API refuses browser calls. The key then never touches a GridCue server, which is how Swagger's "Authorize" button works. The page warns visitors to use a low-limit key and saves nothing. This is a deliberate exception to the "no credentials in the browser" rule, so it gets its own ADR. Host integrations still keep keys on their own servers.

---

❓ **Q11 - Where the internal demo runs.**
(a) Locally only. `pnpm dev` reads your Jev key from a git-ignored `.env` file.
(b) Also deployed at a private URL behind a login.

➡️ (a) for the library build. A private deployed demo needs hosting and a login, so it belongs with the website build.

---

❓ **Q12 - Form of the downloadable demo.**
(a) The demo app inside this repo. Clone it, add a key to `.env`, and run it.
(b) A standalone starter such as `pnpm create gridcue`, which doubles as the getting-started path for adopters.
(c) A one-click online sandbox such as StackBlitz.

➡️ (a) in the library build, because it comes for free. (b) in the website build, where it becomes the docs' quick start. (c) needs no key storage but depends on StackBlitz, so it is optional.

---

❓ **Q13 - "Vite, React, TanStack, any others?"** The core is plain TypeScript with no framework or bundler ties, so it already works in Vite, Next.js, webpack, or plain Node. What else ships in v1?
(a) React bindings plus the TanStack Table adapter only. AG Grid is the named next adapter.
(b) Also a second grid adapter in v1, such as AG Grid or MUI X Data Grid.
(c) Also a framework-free command bar, such as a web component, for Vue, Svelte, or plain HTML hosts.

➡️ (a). A second adapter is the best proof the adapter contract is real, but it doubles the testing surface before the design has met a user. The shared adapter contract suite makes adding AG Grid later cheap. AG Grid is the most common enterprise grid in finance, which is the proving ground.

---

❓ **Q14 - Docs search.** Your note names Algolia.
(a) Algolia's SiteSearch UI, installed as shadcn components, reading a free DocSearch index. DocSearch needs a live public domain, so the docs use Fumadocs' built-in local search until launch.
(b) Fumadocs' built-in local search only. No account is needed.
(c) Algolia from day one, with a paid or self-filled index.

➡️ (a). It keeps your Algolia choice and costs nothing, and the switch at launch is a small config change.

---

❓ **Q15 - Hosting and domain for the website.** The website, the component registry, and any relay from Q10 need a home. Do you already own a domain, such as `gridcue.dev`?
(a) Cloudflare Pages plus Workers. (b) Vercel. (c) Netlify.

➡️ (a). The server handler from Q3 is a standard `Request` to `Response` function, which runs on Cloudflare Workers unchanged. The free tier covers a docs site. Please tell me which domain you own, or whether to shortlist some.

## Superseded: waiting on Round 2

- **First spec's acceptance criteria.** `BUILD_AGENT.md`'s list plus shadcn registry components, the demo modes, and opt-in live Jev tests. This depends on Q10 to Q13.
- **Relay design, if any.** Depends on Q10 and Q15.
- **Website page map and content.** Hero, how-it-works, live demo, and docs sections. This depends on Q10, Q12, and Q14.

## Round 2 answers (owner, 2026-09-23)

| Q | Answer | Recorded as |
| --- | --- | --- |
| Q10 Key entry on the Site | "b or c" | Decided (c) for the first release: no key entry on the Site. Visitors use the Mock Provider demo, or download the demo and use their own key locally. No GridCue server ever handles a visitor's key. (b), a stateless relay, can follow later on the same Server Handler. |
| Q11 Internal demo | "I bought gridque.dev for hosting", corrected later to gridcue.dev | Domain recorded as gridcue.dev. Where the internal demo runs is still open, see Q20. |
| Q12 Downloadable demo | Agree | Clone and run in the library build, starter command with the Site. |
| Q13 First release | The first release ships the utility on Next.js, Vite, and TanStack, plus the Vite Site with marketing, demo, and docs. | Replaces Q6's "library first, website later". See Q19. |
| Q14 Docs search | Drop Algolia entirely | Fumadocs' built-in search only. |
| Q15 Hosting | Agree: Cloudflare | ADR 0006 |

## Other owner instructions (2026-09-23)

- **Use T3 Code as the model** for repo layout, docs, AGENTS.md, CLAUDE.md, skills, and contributing guidelines. Done: CLAUDE.md imports AGENTS.md. AGENTS.md follows T3's sections. Design docs moved to `docs/internals/`. Project skills live in `.agents/skills/` with a `.claude/skills` link. CONTRIBUTING.md, a PR template, issue forms, and SECURITY.md were added. T3's `.repos/` vendoring was not copied, since nothing needs it yet.
- **MIT license.** Added `LICENSE`. ADR 0005 supersedes the Apache-2.0 part of ADR 0004.
- **Planning skills** are enabled as Claude Code plugins in `.claude/settings.json` instead of being copied in. Both are MIT.

## Round 3

❓ **Q16 - Domain spelling.** You bought **gridque.dev**, with "que". The project and npm scope are **GridCue**, with "cue". A domain that doesn't match the name makes people mistype it and search for the wrong thing.
(a) Keep the name GridCue, and also buy gridcue.dev if it's free, pointing gridque.dev at it. (b) Rename the project to GridQue to match the domain. (c) Keep both as they are.

➡️ (a), if gridcue.dev is available. Otherwise tell me whether "que" was deliberate, and I'll check GridQue's npm names before we commit to (b).

---

❓ **Q17 - What "TanStack" means in "Next.js, Vite, TanStack".**
(a) TanStack Start, the full-stack framework alongside Next.js. (b) TanStack Table, the grid library. (c) Both.

➡️ (c). TanStack Table is already the first grid adapter. A TanStack Start example is cheap, because the Server Handler is a standard web function that Start route handlers accept directly.

---

❓ **Q18 - What "ships on Next.js" means.**
(a) The React package works in Next.js client components, and the Server Handler mounts in a Next.js route handler. A tested `examples/next` app and a docs page prove it. (b) A dedicated `@gridcue/next` package.

➡️ (a). A separate package adds a release to maintain without adding behaviour. Add one only if the examples show real Next-specific glue.

---

❓ **Q19 - Shape of the first release.** The Site is now part of it.
(a) One release, built from two specs and plans. The library plus Vite, Next.js, and TanStack examples come first. Then the Site with marketing, demo, docs, and the hosted registry. Nothing is published until both are done. (b) One combined spec and plan. (c) Publish the packages to npm as soon as the library is done, and launch the Site afterward.

➡️ (a). Each spec stays reviewable, and the launch still happens as one event on your domain.

---

❓ **Q20 - Where the internal demo with your Jev key runs.**
(a) Locally only, with the key in a git-ignored `.env` file. (b) Also at a private address on your domain, such as `internal.gridcue.dev`, behind Cloudflare Access login. Access is free for small teams. The key is stored as a Cloudflare Worker secret.

➡️ (a) during the library build, then (b) with the Site. You get a shareable live Jev demo without exposing the key.

---

❓ **Q21 - Committing plans.** T3 Code says never to commit plans, and to track work in GitHub issues instead. Superpowers commits specs and plans to `docs/superpowers/`.
(a) Commit them until the first release, as your approval record, then delete them and move to issues. (b) Follow T3 strictly: keep them out of the repo from now on. (c) Keep them forever.

➡️ (a). AGENTS.md currently says this, so change it if you choose otherwise.

---

❓ **Q22 - Contribution posture.** T3 Code says it is "not actively accepting contributions". Your goal is real adoption.
(a) Open but scoped: bugs in issues, ideas and new adapters in Discussions first, small PRs. (b) T3's closed stance for now.

➡️ (a). The draft `CONTRIBUTING.md` already says this. Adapters are where outside help pays off most.

---

❓ **Q23 - Copyright line.** `LICENSE` says "Copyright (c) 2026 The GridCue Authors".
(a) Keep that. (b) Use your name or a company name. Tell me which.

➡️ (a), unless you want a legal entity named. It stays valid as contributors join.

## Round 3 answers (owner, 2026-09-23)

| Q | Answer | Recorded as |
| --- | --- | --- |
| Q16 Domain | "I bought gridcue.dev" | Settled. The name, npm package, and domain all match. ADR 0006 names the domain. |
| Q17 TanStack | "Drop TanStack from scope" | TanStack Start and TanStack Table are both out of the first release. That removes the first grid adapter, see Q24. |
| Q18 Next.js | "It should be one npm package that works with Next or Vite" | ADR 0007: one `gridcue` package with subpath exports, replacing the four `@gridcue/*` packages. |
| Q21 Committing plans | "Commit is allowed" | Specs and plans are committed to `docs/superpowers/`. AGENTS.md updated. |
| Q19, Q20, Q22, Q23 | Not answered yet | Carried into Round 4. |

## Superseded: waiting on Round 3

- **First spec's acceptance criteria.** These depend on Q17 to Q20. Once Round 3 is answered, I write the first spec in `docs/superpowers/specs/` for your review.
- **Site page map.** Hero, how it works, live Mock Provider demo, docs sections, and download. This depends on Q19.

## Round 4

❓ **Q24 - Which grid does GridCue drive without TanStack Table?** GridCue changes a grid's view, so the first release needs at least one grid to control.
(a) GridCue's own built-in adapter. The Host keeps rows in memory, GridCue applies the View State to them, and any table renders the result, including shadcn's plain Table. A Host with server-side data can instead turn the View State into its own query.
(b) AG Grid as the first external grid.
(c) Keep TanStack Table, but only inside the Site demo, not in the package.

➡️ (a). It adds no third-party grid dependency, suits a single package, and works the same in Vite and Next.js. The adapter interface stays, so AG Grid or TanStack Table can arrive later as new subpaths. If you meant to drop only TanStack Start, say so and we keep TanStack Table as the first adapter.

---

❓ **Q25 - The package's entry points.**
- `gridcue`: the framework-free core.
- `gridcue/react`: headless hooks. React is an optional peer dependency.
- `gridcue/server`: the Server Handler and the Jev provider. The Jev SDK is an optional peer dependency, so it only installs for people who use Jev.
- `gridcue/mock`: the Mock Provider, safe in a browser.

➡️ Use this layout. Each entry maps to one of AGENTS.md's boundaries, and the server entry is the only one that can ever hold a key.

---

❓ **Q26 - Shape of the first release.** This repeats Q19, updated for one package.
(a) One launch built from two specs and plans. The first covers the package plus the Vite and Next.js examples. The second covers the Site: marketing, demo, docs, and the hosted registry. Nothing is published until both are done.
(b) One combined spec and plan.
(c) Publish the package as soon as it's done, and launch the Site later.

➡️ (a).

---

❓ **Q27 - Where the internal demo with your Jev key runs.** This repeats Q20.
(a) Locally only, with the key in a git-ignored `.env` file.
(b) Also at `internal.gridcue.dev` behind Cloudflare Access login, with the key stored as a Worker secret.

➡️ (a) during the package build, then (b) with the Site.

---

❓ **Q28 - Contribution posture.** This repeats Q22.
(a) Open but scoped, as the current `CONTRIBUTING.md` says.
(b) T3's closed stance for now.

➡️ (a).

---

❓ **Q29 - Copyright line.** This repeats Q23.
(a) Keep "The GridCue Authors".
(b) Use your name or a company name.

➡️ (a).

## Superseded: waiting on Round 4

- **The first spec**, for the package and its examples, is written once Q24 to Q27 are answered. That is the next step after this round.
- **Site page map** depends on Q26.

## Round 4 answers (owner, 2026-09-23)

| Q | Answer | Recorded as |
| --- | --- | --- |
| Q24 Grid | "GridCue works with any of the supported frameworks' tables, including TanStack. Let's add it back." | Two Grid Adapters in the first release: the built-in Rows Adapter for any table, and TanStack Table v9, which also covers shadcn's Data Table. TanStack Start stays out. ADR 0007 updated. |
| Q25 Entry points | Agree | `gridcue`, `gridcue/react`, `gridcue/server`, `gridcue/mock`, plus `gridcue/tanstack-table`. |
| Q26 Release shape | Agree | Two specs and plans, one launch. |
| Q27 Internal demo | Agree | Local `.env` first, then `internal.gridcue.dev` behind Cloudflare Access with the Site. |
| Q28 Contributions | Agree | Open but scoped. |
| Q29 Copyright | Agree | "The GridCue Authors". |

## Status

The frontier for the first spec is empty. The spec is written at `docs/superpowers/specs/2026-09-23-gridcue-package-design.md` and waits for the owner's review. The Site's page map and content are grilled after the first plan is approved, as the second spec.

## Owner direction (2026-09-23)

> "The idea is something people can add to their existing app or site."

Recorded in the spec's purpose as a design test: GridCue is added to an existing app, not built around. Checked against the draft spec, three gaps remain. They are Q30 to Q33.

## Round 5

❓ **Q30 - How far "existing app or site" reaches in the first release.**
(a) Existing React apps on Vite or Next.js, which is the current spec.
(b) Also any website, through a script tag that adds a command bar to an ordinary HTML `<table>`, with no React or build step.
(c) Also Vue and Svelte apps.

➡️ (a) for the first release, with (b) named as the next step. The grids worth steering by language hold thousands of rows inside apps, and those are mostly React. A script-tag version needs its own styling and table adapter, which roughly doubles the UI work. The core already has no framework ties, so (b) can be added later without redesign.

---

❓ **Q31 - Setup effort.** The draft spec makes the developer hand-write a `ViewSchema` for every column. That is the biggest barrier to adding GridCue to an existing app.
(a) Infer it. GridCue reads the existing TanStack column definitions, or the Rows Adapter's column list, and builds the schema automatically. The developer only adds aliases and marks sensitive columns.
(b) Keep writing it by hand, with good docs.

➡️ (a). Target a quick start of about ten lines. The safety defaults stay intact: only column labels and types are ever sent to the provider, never values. Enum values are sent only when the developer lists them, and a column marked restricted is never sent. A helper that lists what will be sent lets the developer check before shipping.

---

❓ **Q32 - Apps that don't use shadcn or Tailwind.** The styled components ship only through the shadcn registry (ADR 0001).
(a) Keep that. Other apps build their own small UI on the headless hooks, and the docs include a recipe.
(b) Also ship a plain-CSS `<GridCueBar />` inside the package that works in any React app with no Tailwind. This changes ADR 0001.
(c) shadcn only, with no guidance for other apps.

➡️ (b). A drop-in component that works on first render is what "add to an existing app" means for most people. shadcn users still get the registry version they can restyle. The plain version uses CSS variables, so it can pick up a Host's colours.

---

❓ **Q33 - Where the Server Handler runs in an existing app.** Next.js has route handlers, but a plain Vite app has no server in production. Many existing apps use Express or another Node backend.
(a) Ship a tiny `toNodeHandler()` in `gridcue/server` so the handler mounts in Express, Fastify, or plain Node in one line. Add docs recipes for Hono and Cloudflare Workers.
(b) Fetch-standard only, with recipes in the docs.

➡️ (a). It is a few lines of code, and it removes the most common "where do I put this?" question. Apps that only use the Mock Provider need no server at all.

## Round 5 answers (owner, 2026-09-23)

"Agree all." Q30: existing React apps on Vite or Next.js first, with a script-tag version as the named next step. Q31: the schema is inferred. Q32: a plain-CSS `<GridCueBar />` ships in the package (ADR 0008). Q33: `toNodeHandler()` ships in `gridcue/server`. The spec is updated and back with the owner for final review.
