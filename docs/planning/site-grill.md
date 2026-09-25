# Site: grilling log

This log covers the second spec from the first build: the public Site at gridcue.dev, holding the marketing page, the live demo, the developer docs, and the hosted Component Registry. It follows `.claude/skills/gridcue-planning`: the grill comes first, then a design pass (`emil-design-eng`, `better-ui`, `principle-experience-first`, recorded as a Before/After table), then the spec, then the plan. Nothing is scaffolded before the owner approves the spec and the plan.

## Already decided (not re-asked)

| Decision | Source |
| --- | --- |
| One Vite + React + Tailwind + shadcn/ui app. Marketing at `/`, docs at `/docs` with Fumadocs, docs prose styled with shadcn typeset. Vite applies to the Site only. | ADR 0002, build-plan grill Q7 |
| Free effects only (React Bits CardSwap, ScrollStack), rebuilt on shadcn/ui. They stay in the Site and never reach the package or the registry. No React Bits Pro. | ADR 0003, Q8 |
| No Algolia: Fumadocs' built-in search only. | Q14 ("Drop Algolia entirely") |
| Hosted on Cloudflare, at gridcue.dev. | ADR 0006, Q15, Q16 |
| No visitor keys on the Site. The public demo uses the Mock Provider; a visitor can run the examples locally with their own key. | Q10 |
| `internal.gridcue.dev` sits behind Cloudflare Access and uses the owner's Jev key as a Worker secret. | Q20, Q27 |
| A `pnpm create gridcue` starter is wanted. | Q12 |
| Docs recipes for Hono and Cloudflare Workers, a note that the TanStack adapter refuses OR filters, and "protect the endpoint" guidance. | Q33, handoff follow-ups, v1 grill Q2 |
| The strategy-comparison demo and the developer-panel gaps move to the Site. | v1 grill Q4, chassis grill Q2 |
| Docs layout draws on kobra.systems' *information architecture and interaction patterns* only, never its code or assets. | Handoff step 4 |

## Facts gathered (2026-09-24)

- **Fumadocs** is at 16.15, MIT. It supports React Router, TanStack Start, Next.js, Astro and Waku; it has no plain-Vite guide. *Verified.*
  - It is server-first. A static build uses React Router's `ssr:false` with `prerender()`, or TanStack Start's `spa.prerender`.
  - Its built-in search now runs on ZBSearch, a fork of Orama, and has a **static, in-browser mode**.
  - It takes its colors from a shadcn theme via `fumadocs-ui/css/shadcn.css`, and needs Tailwind 4.
  - Its own `prose` styles may conflict with other typography CSS. Whether shadcn **typeset** coexists with it is *unverified*.
- **Cloudflare** now recommends **Workers with static assets over Pages** for new projects. *Verified.*
  - Requests for static assets are free and unlimited. The Worker free plan allows 100k requests a day at 10 ms of CPU each.
  - **The Cloudflare Vite plugin does not support React Router's SPA mode or prerendering.** It does document TanStack Start with prerendering. *Verified.*
  - A custom domain on Workers needs gridcue.dev as an active zone; Cloudflare then creates the DNS records and certificate.
- **Cloudflare Access has no shared password.** *Verified.*
  - Options are an email one-time PIN, an identity provider, or Cloudflare-account and email-domain policies.
  - Zero Trust needs payment details even on the Free plan, which is *unverified* as free for up to 50 users.
  - Workers with static assets don't receive `ctx.access`.
- **React Bits** is MIT plus Commons Clause: fine inside a website, never redistributed. *Verified.*
  - CardSwap needs **gsap**, under GSAP's "Standard no-charge" license, not MIT. ScrollStack needs **lenis**, which is MIT.
  - Both install with `npx shadcn add @react-bits/<Name>-TS-TW`.
- **The shadcn registry** can be served as static JSON. A namespace would be `"@gridcue": "https://gridcue.dev/r/{name}.json"`. *Verified.*
  - It can be listed in shadcn's registry index by PR, after which `npx shadcn add @gridcue/command-bar` works with no setup. The requirements are open source, schema-valid, and a flat layout.
  - `@gridcue` isn't listed yet.
- **kobra.systems** uses three panes on a component page:
  - a left navigation grouped by category;
  - a centre live preview with a source dock underneath (file tabs, copy, download);
  - a right panel with an install command, a variant picker, and a props table (prop, type, default).

  Search is a command-palette modal. The site is **proprietary**, so we take patterns only. *Verified in a live browser.*
- **Workspace.** No `apps/` folder exists yet; AGENTS.md already names `apps/site`. The registry builds to `registry/dist/r`, with `homepage: https://gridcue.dev` and no serving URL fixed. Whether `@typesafe-ai/sdk` runs under workerd is still *unverified* (ADR 0011).
- **Versions:** Vite 8.3.1, React 19.3, React Router 8.4, TanStack Start 1.168, Tailwind 4.3.3, wrangler 4.139, `@cloudflare/vite-plugin` 1.60, shadcn 4.21.

## Round 1

Answer by number. A bare "agree" accepts the recommendation.

❓ **Q1 - Build and deploy, given the React Router finding.**
(a) **React Router with prerendering, built by plain Vite, deployed with wrangler.** The static pages go to Workers static assets, and a small separate Worker serves only `internal.gridcue.dev`'s API. ADR 0002 stands unchanged.
(b) **TanStack Start with prerendering and the Cloudflare Vite plugin.** Documented to work together. ADR 0002's "React Router" becomes "TanStack Start"; still Vite.
(c) React Router with server rendering on Workers. Every page view costs Worker CPU, and the free plan allows 10 ms each.

➡️ (a). Every public page is static, which is free, fast and good for search engines. Only the internal API needs a Worker. It keeps the approved ADR. Choose (b) if you'd like one toolchain for both, since TanStack is also one of GridCue's own targets.

---

❓ **Q2 - Page map.**
(a) **These pages:**
   - `/` marketing:
     - **Hero:** one sentence, and a live command bar over a small grid (Mock Provider).
     - **How it works:** utterance, then Preview, then apply and undo.
     - **Safety:** view-only, preview before apply, rows are never sent.
     - **Adapting to your domain:** declarations and strategies.
     - **Quick start**, then a call to action.
   - `/demo`: a full-screen playground (see Q3).
   - `/docs/…`: the docs (see Q4).
   - `/r/…`: registry JSON (see Q5).
   - `/changelog`.
(b) Marketing and docs only. The demo is embedded in the docs.

➡️ (a). The hero demo is the product explaining itself in two seconds. `/demo` is where someone evaluating GridCue tries their own sentences.

---

❓ **Q3 - The public demo, and the strategy comparison without visitor keys.**
(a) **Live Mock Provider plus recorded Jev results.**
   - `/demo` runs the command bar live on the Mock Provider, over the synthetic wealth grid.
   - It has a developer panel showing the plan, confidence, evidence, and before and after View State.
   - A "Compare strategies" tab shows **recorded** live-Jev runs for about 12 curated requests: Preview, question count and latency for Focused, Fan-out and Mock, side by side. It is labelled plainly as "recorded from live Jev on <date>", and generated by the eval CLI so it can be refreshed.
   - Live comparison runs only on `internal.gridcue.dev`.
(b) Live comparison on the public Site, through the owner's key behind a rate-limited Worker.
(c) Mock only, with no comparison.

➡️ (a). It shows the real difference honestly without spending your credits or exposing a key endpoint to the internet. Option (b) invites abuse and cost, and the free Worker CPU limit is tight.

---

❓ **Q4 - Docs structure and the component explorer.**
(a) **Six sections:**
   - **Get started:** install, quick start, run the examples.
   - **Concepts:** the glossary terms, with one diagram of the pipeline.
   - **Guides:**
     - Vite with TanStack;
     - Next.js with the Rows Adapter;
     - Express, Hono and Workers handler recipes;
     - protecting the endpoint;
     - describing your domain;
     - choosing a strategy;
     - running the evals.
   - **Components:** an explorer modelled on kobra's patterns (our own implementation). Per component:
     - centre: live preview, with the source in tabs underneath;
     - right panel: the install command, then props (prop, type, default).
     It covers the command bar, preview panel, clarification prompt, and the plain `GridCueBar`.
   - **API reference:** `createGridCue`, adapters, providers, schema, and the protocol types.
   - **Safety and protocol.**

   Search is Fumadocs' built-in static search, in a command palette.
(b) Fumadocs' default layout only, with no component explorer.

➡️ (a). The explorer is how shadcn users decide to install. The rest is standard Fumadocs.

---

❓ **Q5 - Registry URL.**
(a) **`https://gridcue.dev/r/{name}.json`**, with `@gridcue` as the namespace in the docs' setup snippet. After launch, submit `@gridcue` to shadcn's registry index, so `npx shadcn add @gridcue/command-bar` works with no setup.
(b) Serve the registry from GitHub only (`JH3lou/GridCue/command-bar`).

➡️ (a). It matches `shadcn build --output dist/r`, which is already in place, and the index listing is the lowest-friction install.

---

❓ **Q6 - Effects.**
(a) **Two effects:**
   - CardSwap in the hero, cycling "request → Preview → applied grid" cards.
   - ScrollStack for "How it works".

   Both respect reduced motion and fall back to static layouts. The design pass sets timing and whether each earns its place. gsap's no-charge license is noted in the spec.
(b) No effects in the first Site.

➡️ (a), subject to the design pass. They were your original ask, and they stay in the Site as ADR 0003 requires.

---

❓ **Q7 - Docs typography.**
(a) **Shadcn typeset, per ADR 0002,** verified against Fumadocs' prose in the plan. If they conflict, typeset styles the docs content and Fumadocs styles the layout chrome, and the plan records how.
(b) Fumadocs' prose only, which amends ADR 0002.

➡️ (a). It was already decided. The only question is whether it fits cleanly, and the plan proves that in a real build.

---

❓ **Q8 - Access for `internal.gridcue.dev`.**
(a) **Cloudflare Access with an email one-time PIN,** allowing only the email addresses you list. You enable Zero Trust, which asks for payment details even on the free plan. It runs the live strategy comparison and the demo on your key.
(b) A GitHub login through Access.
(c) Drop the internal site for now; use the examples locally.

➡️ (a). There's no password to share or leak, and adding a collaborator is one email address.

---

❓ **Q9 - The `pnpm create gridcue` starter.**
(a) **Its own small spec after the Site launches.** Until then, the quick start uses `npm i gridcue` and points to the two examples.
(b) Build it inside the Site spec.

➡️ (a). It is a separate package with its own publishing, and the Site doesn't depend on it.

---

❓ **Q10 - Analytics.**
(a) **Cloudflare Web Analytics:** cookieless and free, so no consent banner is needed.
(b) None.
(c) A third-party tool.

➡️ (a). You'll want to know whether the demo gets used, and it collects no personal data.

---

❓ **Q11 - Where the Site lives and how it deploys.**
(a) **`apps/site` in this workspace** (AGENTS.md already names it). It deploys to Cloudflare from `main` through Cloudflare's Git integration, with preview URLs for PRs. The Site's CI runs its build and a Playwright smoke test in light and dark.
(b) A separate repository.

➡️ (a). The docs import the real package and the registry source, so they can never drift from the code. Whether Cloudflare's Git integration fits a pnpm monorepo gets verified in the plan; the fallback is a GitHub Action with a scoped API token.

---

❓ **Q12 - gridque.dev.**
Do you still own `gridque.dev`? If so, it should redirect to `gridcue.dev`.

➡️ Redirect it if you own it; it catches the misspelling.

## Owner direction (2026-09-24)

> "Keep implementation free. Why do I need my Jev key on a hosted site?"

Recorded as follows:

- **Everything is free.** No paid plans, and no services that require payment details, such as Zero Trust.
- **No Jev key on any hosted site.**
  - `internal.gridcue.dev` is **dropped**, which supersedes build-plan grill Q20 and Q27.
  - Live Jev runs only locally, with `.env.local`.
  - The Site's strategy comparison uses results recorded from local live runs, labelled with their date.
- **This changes the recommendations for Q1 and Q8.**
  - **Q1:** the Site is entirely static. React Router prerenders every page, and Cloudflare Workers static assets serves them, which is free with unlimited requests. There is no Worker code, no secret and no server; ADR 0002 stands.
  - **Q8:** removed.
  - **ADR 0011's open item**, whether `@typesafe-ai/sdk` runs under workerd, is checked locally with `wrangler dev` in the plan, as a docs-recipe check for Hosts. It is not a deploy.

## Round 1 answers (owner, 2026-09-24)

> "Yes I don't know what the internal site was intended for. Just an open source framework for Jev integration for this capability. I never owned gridQue that was a typo"

| Q | Recorded as |
| --- | --- |
| Q1 | A static Site: React Router prerender, deployed on Cloudflare Workers static assets. ADR 0002 stands. |
| Q2 | Page map: `/`, `/demo`, `/docs`, `/r`, `/changelog`. |
| Q3 | `/demo` runs live on the Mock Provider with a developer panel, plus a recorded "Compare strategies" tab. |
| Q4 | Docs sections as recommended, plus a Components explorer on kobra.systems' patterns. |
| Q5 | Registry at `https://gridcue.dev/r/{name}.json`, namespace `@gridcue`, and an index submission after launch. |
| Q6 | CardSwap in the hero and ScrollStack for "How it works", subject to the design pass. |
| Q7 | Shadcn typeset, verified against Fumadocs' prose. |
| Q8 | Removed: there is no internal site. |
| Q9 | The `pnpm create gridcue` starter gets its own spec after launch. |
| Q10 | Cloudflare Web Analytics. |
| Q11 | `apps/site`, deployed through Cloudflare's Git integration, with preview URLs. |
| Q12 | No redirect: `gridque.dev` was never owned. |

**Positioning:** "an open source framework for Jev integration for this capability". The Site presents GridCue as the open-source way to put Jev behind a data grid.

Within the independence rule: the Site names TypeSafe's Jev as the model it is built for, with no endorsement implied, and keeps the provider-neutral core visible, since the Mock Provider and any other provider plug in the same way.

## Owner direction: positioning (2026-09-24)

> "The positioning is used natural language to get the data insights on complicated data, dense grids and tables"

This replaces the earlier "framework for Jev integration" framing as the lead message. The Site leads with the User's benefit: plain-language questions answered from complicated data, dense grids and tables. GridCue as the open-source way to do this with Jev comes second.

The copy stays accurate to the product: GridCue answers a question by changing the view (filters, sorts, groups and columns). It does not compute new data.

## Owner direction: build (2026-09-24)

> "build the site, so i can review locally. if it helps you can create a few mockups in a shared session to review with me"

Recorded as approval of the Site spec, including the design pass (CardSwap replaced by the live product; ScrollStack made CSS-only). The owner reviews the running Site locally instead of a written plan, and the build itself is the proof for the spec's unverified items: typeset alongside Fumadocs' prose, and static prerendering with search.
