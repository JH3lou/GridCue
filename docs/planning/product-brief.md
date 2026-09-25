# GridCue: open-source product brief

**Date:** 2026-09-24 · **Author role:** product (developer tools and open source) · **Status:** recommendation for the owner

Legend: **VERIFIED** means I checked it in the repo or at a cited URL on 2026-09-24. **Unverified** means only secondary sources say it. Anything unmarked is my judgment.

---

## 0. The brief in six lines

1. **Lead with the User's outcome, and keep the claim honest.** "Ask a dense grid a plain question. See the view that answers it." GridCue answers by *arranging the view*. It does not compute answers.
2. **The differentiator is trust, not "NL for grids."** AG Grid and MUI already ship natural-language grid control, but only in their paid tiers, and both let the LLM write the grid state. GridCue is the free, grid-agnostic option where the model only picks among closed choices, code decides, and the User previews before anything applies. It has measured evidence behind it.
3. **Make the first success keyless.** The Mock Provider works on any schema that uses explicit wording, so the quick start should start there and add Jev second.
4. **Fix the repo's front door before launch.** The About text, topics, npm keywords and Discussions (which are linked but disabled) are all missing or broken, and so is a code of conduct.
5. **Be the best showcase of Jev without being single-vendor.** Get listed in community Jev resources, and publish a reference non-Jev provider in `examples/`.
6. **Decision for the owner:** "insights" pulls toward aggregation. I recommend group subtotals as *view state* in 0.3 (the grid computes them locally), and never text answers or charts.

---

## 1. Positioning and message hierarchy

**Owner's line (north star):** "used natural language to get the data insights on complicated data, dense grids and tables."

**Sharpened**
- **Tagline:** *Ask a dense grid a plain question. See the view that answers it.*
- **One paragraph:** GridCue is an open-source TypeScript toolkit that lets people use plain language to get to the insight hidden in complicated data, dense grids and tables. A User types or dictates "taxable accounts over 10% in one position, grouped by advisor, biggest first". GridCue turns that into a validated filter, sort, group and column change, shows exactly what will change, and applies it only on approval, with undo. Rows never leave the host app. The model only picks among choices the app has declared, and code does the rest. It is MIT-licensed and headless, works with TanStack Table or any in-memory table, and is built for TypeSafe's Jev.

**Three pillars** (each is something the product actually does)

| Pillar | Claim | Proof in the repo |
|---|---|---|
| **Ask, don't configure** | One sentence replaces a dozen filter, sort and group clicks, including compound, nested and "also" requests. | Fan-out strategy and chassis rules (ADRs 0014 and 0015). **VERIFIED** |
| **See it before it happens** | A deterministic Preview, atomic apply, and undo. Ambiguity gets a Clarification, not a guess. | AGENTS.md non-negotiables 2 and 3. **VERIFIED** |
| **Your data stays yours** | Only column metadata and approved values go to the provider. Keys stay server-side. View changes only, never edits. | intent-protocol payload rules; the `check:bundles` leak check. **VERIFIED** |

**Evidence line**, used everywhere with its scope: "176 labelled live requests on a synthetic wealth schema, 0 wrong views (jev-1.13.0, Sept 2026)". That is 31 + 56 + 50 + 39 cases (ADR 0015). **VERIFIED**. Always state the schema and the model; never say "100% accurate".

**Surfaces**

| Surface | Hero reader | Draft copy |
|---|---|---|
| **README** (top) | A developer who arrived from a link and is deciding whether to try it | **GridCue** — *Ask a dense grid a plain question. See the view that answers it.* Plain-language filter, sort, group and column control for data grids. Headless, previewed, undoable; rows never leave your app. [Live demo] · `npm i gridcue` · MIT. Then a 15-second GIF. |
| **Site hero** | Both readers; the demo does the talking | H1: *Ask your data a plain question. See the view that answers it.* Sub: *Get to the insight in complicated data, dense grids and tables without learning the grid's controls. GridCue previews every change and never touches your data.* |
| **npm description** | Someone searching npm | "Ask data grids in plain language: validated, previewable, undoable filter, sort, group and column changes. Headless core, React, TanStack Table, Jev provider." Add `keywords` (there are none today, **VERIFIED**): data-grid, datagrid, table, natural-language, tanstack-table, react, shadcn, ai, llm, jev, filter, command-bar. |
| **GitHub About** | A GitHub browser or searcher | "Ask a dense data grid in plain language; get a previewed, undoable view change. Headless TypeScript, React, TanStack Table, shadcn. MIT." Today it reads "Jev Native Orchestration for Constructing Views…" (**VERIFIED**), which is jargon; replace it. Set the homepage to `https://gridcue.dev` (the scheme is missing) once the Site is live, and add up to 20 topics, the same as the npm keywords plus `typescript` and `headless`. |
| **Social launch post** | Frontend developers scrolling | "Your users shouldn't need 14 clicks to see 'taxable accounts over 10% in one position, by advisor, biggest first.' GridCue turns that sentence into a previewed, undoable view change on your own grid. The model never writes the filter; it picks from choices you declared. MIT. Demo ↓" |

**Copy guardrail:** "insight" is allowed only next to "the view that answers it". Never write "answers your questions about your data", "AI analyst" or "chat with your data". The README currently says GridCue lets users "aggregate", but aggregation is not in `MVP_OPERATIONS` (**VERIFIED**, `core/adapter.ts`). Remove it until it ships.

---

## 2. Users and jobs-to-be-done

| Persona | Setting | Job they hire GridCue for |
|---|---|---|
| **Advisor or portfolio manager** (end User) | Wealth desktop: households, accounts, positions | "Before a client call, get to the accounts that need attention without rebuilding filters." |
| **Ops or support lead** (end User) | Exception queues, ticket and order consoles | "Triage: show only what's breached, grouped the way I work, worst first." |
| **Product engineer at a B2B SaaS company** (adopter) | Admin panels, CRM, internal tools on TanStack or shadcn | "Ship an 'ask your table' feature this sprint without building an LLM pipeline or leaking customer rows." |
| **Platform or security-minded lead** (approver) | Regulated firms: finance, health, insurance | "Approve AI in the UI because it can't edit data, can't see rows, and every change is previewed and audited." |

**Where it lands hardest:** wealth and trading (the proving ground), operations and supervision queues, logistics and order management, CRM and account lists, and internal admin panels. The common trait is many columns, enumerated values and repeated triage.

**Demo datasets:** keep **wealth as the flagship**, because it is the hardest vocabulary and has the eval evidence. **Add one second dataset after launch:** *shipments and orders* (carrier, region, status, days late, value). It reads instantly to any developer, and it proves the chassis is not wealth-shaped, which is currently unproven because every eval is on one schema. Ship it with a small labelled eval set of its own. It is not a launch blocker.

---

## 3. Competitive landscape

| Option | Open source? | How it works | Data posture | Preview/undo |
|---|---|---|---|---|
| **AG Grid AI Toolkit** | **No.** Enterprise licence only (**VERIFIED**, [docs](https://www.ag-grid.com/react-data-grid/ai-toolkit/)) | `getStructuredSchema()` gives a JSON Schema; any LLM generates the state; `setState()` applies it. Covers filter, sort, group, aggregation, pivot, visibility and sizing. | Rows not sent by default, but the docs suggest adding "a few rows" or the "entire dataset" as CSV (**VERIFIED**) | None documented |
| **MUI X Data Grid "Ask Your Table"** | **No.** Premium licence; a hosted MUI service with credits, then possibly a paid plan (**VERIFIED**, [docs](https://mui.com/x/react-data-grid/ai-assistant/)) | Prompt → MUI service or your own backend → filter, sort, group, aggregate, pivot and charts. Voice via the Web Speech API. | Opt-in random cell sampling (`allowAiAssistantDataSampling`) (**VERIFIED**) | Not documented; changes stay editable in the UI |
| **openstatus data-table-filters** | **Yes, MIT**, about 2.3k stars, shadcn + TanStack (**VERIFIED**, [repo](https://github.com/openstatusHQ/data-table-filters), [AI filters](https://data-table.openstatus.dev/docs/ai-filters.md)) | Vercel AI SDK `streamObject` produces filter state, applied while it streams. **Filters only.** | Schema metadata only | None |
| **Airtable Omni, Notion AI** | No, and platform-bound | NL produces a filter or view inside their own apps (unverified secondary sources: [eesel](https://www.eesel.ai/blog/airtable-ai), [aifire](https://www.aifire.co/p/a-guide-to-notion-3-0-for-ai-powered-workflow-automation)) | Vendor sees everything | Varies |
| **Retool, text-to-SQL** | No, or DIY | LLM writes SQL over the data source ([Retool tutorial](https://retool.com/blog/ai-filtering-on-table-component-tutorial), **VERIFIED**) | Query runs over the data; SQL is generated | No |
| **Syncfusion, ComponentOne smart grids** | No (.NET/Blazor) | LLM produces a filter | Varies | No |
| **DIY: LLM function calling plus a JSON schema** | n/a | About 50 lines to a demo | Whatever you send | Whatever you build |

**GridCue's defensible differentiation**
1. **The model never writes the plan.** Closed typed choices, then a deterministic compiler, validation and policy. Everyone else lets an LLM generate grid state and hopes the schema holds.
2. **Preview, atomic apply, undo, Clarification and Abstention** are built in. No competitor documents a preview step.
3. **Free and grid-agnostic.** The paid grids gate NL control behind their licences; GridCue brings it to TanStack, shadcn and in-memory tables today, and to AG Grid *Community* next.
4. **Measured.** A public labelled eval set, 0 wrong views, and ablations per signal. Nobody else publishes accuracy.
5. **Never sends rows** by design, not as a toggle.

**Honest weaknesses**
- **Narrower operations** than AG Grid and MUI: no aggregation, pivot or charts.
- **One real provider.** Jev is young; direct signups were reportedly paused on Sept 22 (unverified, [secondary](https://jev-ai.live/get-access/)).
- **One eval schema,** English-only rules, React-only UI, and two adapters.
- **A solo maintainer at 0.x.**
- **The DIY bar is low for a demo.** GridCue must win on the long tail: compound requests, ambiguity, refusals, undo.

---

## 4. The open-source product

**Adoption funnel and what blocks each step today**

| Step | Target | Blocker today |
|---|---|---|
| Discover | GitHub, npm, HN, shadcn directory, Jev community | Weak About text, no topics or npm keywords, not on npm (**VERIFIED**: `npm view gridcue` → 404), no Site |
| Try the demo | Useful within 5 s, no signup | The Site isn't built; the README has no GIF |
| Install | `npm i gridcue` | Not published |
| **First working command bar** | **≤ 10 minutes, no key, in the developer's own app** | The quick start leads with `createRemoteProvider`, a Server Handler and a Jev key. The Mock Provider is schema-generic (it matches Mentions against any declared columns, **VERIFIED** in `src/mock/index.ts`), so a keyless first success is possible; it just isn't documented first. |
| Production | Jev behind their own auth | No auth hook (docs only, per the v1 grill) and no "going to production" checklist |

**Recommendation:** rewrite the quick start as *Step 1: Mock in the browser (no server, no key) → Step 2: turn on Jev with the Server Handler*. Measure time-to-first-success by having three people who have never seen GridCue follow the README into a fresh Vite + TanStack app.

**Where things belong**

| Core (`gridcue`) | Examples (`examples/`) | Registry (`@gridcue`) |
|---|---|---|
| Protocol, compiler, validation, adapters (Rows, TanStack), Mock, Jev, Server Handler, `GridCueBar` | Vite, Next.js, **a reference non-Jev LLM provider**, Hono and Workers handlers, the second dataset | Command bar, Preview panel, Clarification prompt |

**Extension points to invite**, each with a contract suite and a docs page:
- **Grid adapters:** AG Grid Community first, then MUI X (Community), Glide Data Grid.
- **Intent Providers:** through the `IntentProvider` interface. Export a provider contract suite, like the adapter one.
- **Frameworks:** Vue and Svelte bindings on the framework-free core.
- **Domain packs:** aliases and value groups only, never executable code.
- **Locales:** Preview strings first.

**0.x stability promise** (put it in README and CHANGELOG):
- Minors may break the public API, always listed under "Breaking" in CHANGELOG.
- Patches never break.
- **Safety is stable from 0.1:** view-only, preview-before-apply, no rows by default. Loosening any of these is a major decision with an ADR.
- The protocol has its own version.

**Maintainer model: what exists and what's missing**

| Have (**VERIFIED**) | Missing or broken |
|---|---|
| MIT, CONTRIBUTING, SECURITY.md with private reporting, a bug template, a PR template, CI (`pnpm check`), ADRs, public planning logs | **Discussions are disabled,** yet CONTRIBUTING and `ISSUE_TEMPLATE/config.yml` send ideas there. Turn them on. |
| | **No CODE_OF_CONDUCT.md.** Add Contributor Covenant 2.1. |
| | No labels (`good first issue`, `adapter`, `provider`, `eval`, `docs`) |
| | No public roadmap. Add a "Roadmap" section in the README pointing to a GitHub Project board. |
| | No release workflow or CHANGELOG yet (both planned in the v1 grill) |
| | No social preview image |
| | Governance line missing. Add to CONTRIBUTING: "The owner decides; decisions are recorded as ADRs." |

**Good first issues to seed:**
- Add one eval case per open finding from ADR 0015, for example "Remove the custodian column".
- Add "to" to the preposition list, with a test.
- Deduplicate the percent and currency formatting.
- Type `FAMILY_PHRASE` as `Record<Family, string>`.
- Write the Hono handler docs recipe.
- Add a dark-mode screenshot to the README.

---

## 5. Relationship to TypeSafe and Jev

- **Naming:** "GridCue, built for TypeSafe's Jev" and `createJevProvider`. Never "official", never the TypeSafe logo, and no "Jev" in the product name. Keep the footer and README independence line.
- **Listings** (free, community-run, no endorsement implied):
  - A PR to [awesome-typesafe-jev](https://github.com/AbdelStark/awesome-typesafe-jev). It is independent, accepts projects, and has a "Community projects → applications" section (**VERIFIED**).
  - A post in the TypeSafe Discord (`discord.gg/typesafe`, linked from that list, **VERIFIED**).
  - Link the community [jev-cookbook](https://github.com/paramjeetn/jev-cookbook).
- **Fill a real gap:** TypeSafe's official cookbooks cover function calling, re-ranking and parallel questions, but nothing on UI or table control (**VERIFIED**, [llms.txt](https://docs.typesafe.ai/llms.txt)). Write a GridCue-hosted write-up, "Driving a UI with typed judgments: closed choices, fan-out, calibration bands", and offer it to TypeSafe as a cookbook link *if they want it*. Don't ask for endorsement.
- **Make other providers first-class:**
  - Ship the provider contract suite.
  - Write a "Build a provider" guide.
  - Add `examples/provider-openai-compatible`: a reference provider that asks any OpenAI-compatible endpoint closed-enum questions. It runs free against a local model through Ollama, is labelled "reference: slower and less calibrated than Jev", and is kept out of core.

  The message becomes "Jev is the recommended provider, not the only one".
- **Access risk:** Jev is reportedly also reachable through OpenRouter and Vercel AI Gateway (unverified, [OpenRouter](https://openrouter.ai/typesafe/jev-1.13)). Check whether those routes support typed questions before promising them.

---

## 6. Launch plan (free channels, gated)

| # | Step | Must be true first |
|---|---|---|
| 0 | **Front-door fixes:** About text, topics, npm keywords, Discussions on, CoC, labels, roadmap, social preview, remove the "aggregate" claim | Nothing |
| 1 | **npm 0.1.0** through the tag workflow with provenance | v1 hardening merged; `pnpm check` green; the README quick start works against the `npm pack` tarball in a fresh app |
| 2 | **GitHub polish:** GIF at the top of the README, npm and CI badges, "Try the demo" link | Step 1 done; a 15–20 s GIF recorded with free tools (QuickTime + gifski) |
| 3 | **Site live** at gridcue.dev | Spec acceptance criteria 1–9; the hero works offline on the Mock Provider |
| 4 | **shadcn registry directory PR** (`@gridcue`) | Registry served at `gridcue.dev/r/{name}.json`, schema-valid, open source (process **VERIFIED**, [shadcn docs](https://ui.shadcn.com/docs/registry/registry-index)) |
| 5 | **Soft launch** in the TypeSafe Discord, the awesome-list PR, and the TanStack and shadcn community channels | Steps 1–3; the owner can answer questions for a week |
| 6 | **Technical post: "Why we don't let the model write the filter"**, on the Site, cross-posted to dev.to | Real failure stories (below) |
| 7 | **Show HN**: "Show HN: GridCue – ask a data grid in plain English, preview the view change (MIT)" | Soft-launch feedback fixed; demo stable; the owner is free for 6 hours; post Tue–Thu morning US time |
| 8 | **r/reactjs** and an **X thread** with the GIF | Same as step 7. Skip r/dataengineering: pipeline engineers, not grid UI builders. |

**Angle for the post:** use the real bugs, not theory. "Roth IRAs grouped by rep" once grouped and silently dropped the filter (ADR 0012). "Not at Northgate or Harborline" once filtered *to* Harborline (ADR 0015). Show how closed choices, deterministic rules and a labelled eval set caught both, then give the 0 wrong views result with its scope. Honest failure stories are what earn trust on HN.

---

## 7. Success metrics (free to measure; targets are guesses)

| Metric | Source | 30 days | 90 days |
|---|---|---|---|
| npm weekly downloads | npm downloads API | 75 | 300 |
| GitHub stars / forks | GitHub | 150 / 10 | 500 / 40 |
| Issues or Discussions opened by people other than the owner | GitHub | 10 | 40, plus 3 merged outside PRs |
| `/demo` visits; docs quick-start visits | Cloudflare Web Analytics (page views only; it records no interaction events, unverified) | 2,000; 400 | 6,000; 1,500 |
| Time to first success | Three people new to GridCue, recorded quarterly | ≤ 10 min, keyless | ≤ 5 min with `create-gridcue` |
| Wrong views in the live eval set | `pnpm eval:live` | **0 (a release gate)** | 0, on ≥ 2 schemas |
| Named adopters or pilots | Discussions "Show and tell" | 1 | 3 |

---

## 8. Roadmap: the next three releases

**0.1.x (launch patch):** the Mock-first quick start, the production checklist, and fixes from launch feedback.

| Release | Theme | Contents | Why now |
|---|---|---|---|
| **0.2** | **First success in minutes, many grids per app** | `pnpm create gridcue` (the Vite example as a template, Mock by default); **grid routing** across entity grids through a Host navigation callback (already planned, and it builds on `entity`); an exported provider contract suite plus the reference OpenAI-compatible provider | Time-to-first-success is the biggest adoption lever. Routing is the owner's advisor-desktop reality. |
| **0.3** | **Insight views** | **Aggregation as view state:** group subtotals (count, sum, avg, min, max), computed locally by the adapter or grid and shown in the Preview. **AG Grid Community adapter** (filter, sort, columns; grouping where the grid supports it). Second dataset with its own eval set. | Directly serves "insights on complicated data", and the AG Grid adapter is a free alternative to their Enterprise-only AI Toolkit |
| **0.4** | **Reach** | Localised Preview and Clarification strings; a Vue or Svelte binding if Discussions ask for it; a Host `authorize` hook if adopters ask for it | Broadens the audience without moving the boundary |

**Boundary decisions for the owner:**
- **Aggregation stays view-only** if it is expressed as grid view state, computed locally, never sent to the provider, and never phrased as a text answer. It is already in the protocol (`aggregation.set`), so it needs an ADR, not a new product. **Charts, "top N" row limits and text answers** would move the boundary; I recommend no.
- **Voice** stays out. Dictation tools already type into the field; at most, document the browser's built-in speech input as a Host option.
- **Request-language locales** (non-English Utterances) are a bigger job, because the normalizer and Mention rules are English. Defer them until demand appears.

---

## 9. Changes I'd make to the Site spec (`2026-09-24-site-design.md`)

1. **Hero sub-line (§5.1.1):** drop "Open source, built on TypeSafe's Jev" from the first line and move it to a small badge row ("MIT · Headless · Built for Jev"). Use: *"Get to the insight in complicated data, dense grids and tables. GridCue previews every change and never touches your data."* The first line should be about the User's benefit, matching the owner's ordering.
2. **Hero chips as questions, not commands:** replace "hide the custodian column" with an insight-shaped compound ("Taxable accounts over $1M, biggest concentration first") and **add one refusal chip** ("Sell anything over 10%"). The refusal shows the safety story in one click. Check in the prototype step that the Mock resolves each chip.
3. **Add a section, "Why the model doesn't write the filter",** between *How it works* and *Safe by design*. It is a three-row comparison, *LLM writes grid state* vs *GridCue*, with the dated eval line. This is the differentiation, and the page currently doesn't state it.
4. **Add a "What GridCue is not" strip** (not SQL, not a chatbot, doesn't edit data or compute answers), taken from the README boundary. It protects the "insight" claim.
5. **Quick start (§5.1.5) and docs order (§5.4):** make *Get started → "Your grid in 5 minutes (Mock, no key)"* the first page, then *"Turn on Jev"*, then *Describe your domain*. Add a "Going to production" guide (auth, rate limit, timeouts, audit), and a "Build a provider" and "Build an adapter" pair under Guides.
6. **CTAs:** primary "Try it" (inline), secondary a copyable `npm i gridcue`, tertiary "Star on GitHub". Add "Add to shadcn" on component pages.
7. **Providers and grids band:** logos-as-text for "Jev · Mock · your provider" and "TanStack · any array · AG Grid (next)". It makes provider neutrality visible without implying partnership.
8. **Open Graph image = GitHub social preview**, one asset. Reserve `/blog` for the launch post (one MDX route, so no new stack).
9. **`/demo`:** keep wealth. Plan a dataset switcher for the second dataset in 0.3, so the layout leaves room for it now.

---

## 10. Open questions for the owner

| # | Question | My recommendation |
|---|---|---|
| 1 | Should 0.3 add **aggregation (group subtotals) as view state**, under an ADR? | **Yes.** It's the honest way to deliver "insights" inside view-only. No charts, no text answers. |
| 2 | Should the quick start lead with the **Mock Provider (keyless)** and add Jev second? | **Yes.** It removes the key and signup from first success. |
| 3 | Should `examples/` ship a **reference non-Jev provider** (OpenAI-compatible, free locally through Ollama)? | **Yes.** It proves provider neutrality; keep Jev as the recommended default and the provider out of core. |
| 4 | Next adapter: **AG Grid Community or MUI X?** | **AG Grid Community.** It's the finance default and a free alternative to their Enterprise-only AI Toolkit. |
| 5 | Add a **second demo dataset** (shipments and orders) with its own eval set? | **Yes, after launch.** Wealth stays the flagship. |
| 6 | **Launch order:** a soft launch in the Jev, TanStack and shadcn communities, then Show HN a week or two later? | **Yes.** Collect fixes from friendly users before the one-shot HN launch. |

---

Sources: [AG Grid AI Toolkit](https://www.ag-grid.com/react-data-grid/ai-toolkit/) · [MUI X AI Assistant](https://mui.com/x/react-data-grid/ai-assistant/) · [openstatus data-table-filters](https://github.com/openstatusHQ/data-table-filters) · [its AI filters docs](https://data-table.openstatus.dev/docs/ai-filters.md) · [Retool AI filtering](https://retool.com/blog/ai-filtering-on-table-component-tutorial) · [Airtable AI review (eesel)](https://www.eesel.ai/blog/airtable-ai) · [Notion 3.0 guide (aifire)](https://www.aifire.co/p/a-guide-to-notion-3-0-for-ai-powered-workflow-automation) · [shadcn registry index](https://ui.shadcn.com/docs/registry/registry-index) · [awesome-typesafe-jev](https://github.com/AbdelStark/awesome-typesafe-jev) · [jev-cookbook](https://github.com/paramjeetn/jev-cookbook) · [TypeSafe docs index](https://docs.typesafe.ai/llms.txt) · [Jev on OpenRouter](https://openrouter.ai/typesafe/jev-1.13) · [Jev access (secondary)](https://jev-ai.live/get-access/)

---

## Owner decisions (2026-09-24)

The owner replied "agreed" to the brief and to all six open questions as recommended:

| # | Decision |
| --- | --- |
| 1 | 0.3 adds **aggregation (group subtotals) as view state**, under an ADR. No charts and no text answers. |
| 2 | The quick start **leads with the keyless Mock Provider**, and Jev comes second. |
| 3 | `examples/` gets a **reference non-Jev provider** (OpenAI-compatible, free locally through Ollama). It stays out of core, and Jev stays the recommended default. |
| 4 | The next adapter is **AG Grid Community**. |
| 5 | A **second demo dataset** (shipments and orders), with its own eval set, comes after launch. |
| 6 | **Soft launch** in the Jev, TanStack and shadcn communities, then Show HN a week or two later. |

The Site spec takes section 9's changes. The front-door fixes (section 6, step 0) go in right away.

**Found while applying the fixes:** `packages/gridcue` has no README, so the npm page would have been blank. An npm-facing README is added with the v1 release.
