# The Site

The Site is `apps/site`: the marketing page at `/`, the demo at `/demo`, the docs at `/docs`, the changelog, and the Component Registry at `/r/`. It is fully static (ADR 0016).

## Run it locally

```bash
pnpm install
pnpm dev:site        # builds the package and registry, then serves http://localhost:5173
```

After the first run, `pnpm --filter @gridcue-internal/site dev` is enough unless the package or registry changed.

`pnpm build:site` writes the static Site to `apps/site/build/client`: prerendered HTML for every page, `404.html`, `sitemap.xml`, `robots.txt`, the RFC 9727 API catalog, the static search index, and `llms.txt`. It also copies `_headers`, which adds the Site's agent-discovery `Link` headers to `/` and the catalog response. To serve that output the way Cloudflare does, run `npx wrangler dev` in `apps/site`.

## Refresh the recorded strategy runs

The demo's "Compare strategies" tab shows live Jev runs recorded locally. The Site never calls Jev. With your key in the repo-root `.env.local`:

```bash
pnpm eval:record     # writes apps/site/app/data/strategy-runs.json
```

Review the diff before committing it. Every "ready" preview must be the view the request asked for.

## Downloads dashboard

`/admin/downloads` shows `gridcue`'s npm downloads: the all-time total, the last day, 7 days and 30 days, daily downloads with a 7-day average, downloads by version, and weekly or monthly totals. The browser fetches them from npm's public API (`api.npmjs.org`) on each visit, in chunks of 500 days or less, because npm silently cuts longer ranges at about 18 months. There is no server, storage or key, so it stays within ADR 0016.

The page is unlisted, not private. It isn't linked from the Site, it's left out of `sitemap.xml`, and it's marked `noindex`, but anyone with the URL sees the same public numbers npm shows. To restrict it, add a Cloudflare Access application for `gridcue.dev/admin/*` in the Zero Trust dashboard. No code changes.

npm publishes a day's counts after the day ends in UTC, so the newest data is yesterday's.

## Deploy

It runs on Cloudflare's free plan, as the Worker `gridcue-site` with the custom domain `gridcue.dev`, both set in `apps/site/wrangler.jsonc`. There is no Worker code and there are no secrets. Cloudflare Workers Static Assets reads `apps/site/public/_headers` to add response headers without origin code.

**`main` is what's live.** Cloudflare builds and deploys every push to `main`, so nothing reaches gridcue.dev without a merge. Pull requests, including ones from forks, are never deployed; CI's site build (broken MDX, broken internal links, the canary-key check) is their check.

### Connect the repository (owner, once)

1. In the Cloudflare dashboard, open **Workers & Pages → gridcue-site → Settings → Build**, and connect the `JH3lou/GridCue` repository.
2. Set:
   - **Production branch:** `main`
   - **Non-production branch builds:** off
   - **Root directory:** `/`
   - **Build command:** `pnpm install --frozen-lockfile && pnpm build:site`
   - **Deploy command:** `cd apps/site && npx wrangler deploy`
   - **Build variables:** optionally `VITE_CF_ANALYTICS_TOKEN` for Cloudflare Web Analytics (a public beacon token, not a secret). Leave `NODE_VERSION` unset: the build reads the Node version from `.node-version`, which CI and release use too.
3. Merge something to `main`, and check the build log and https://gridcue.dev.

Never add `JEV_API_KEY`, or any other secret, to the Site's build settings. `pnpm check:bundles` builds the Site with a canary key and fails if it appears in the output.

### Manual deploy (fallback)

Only from an up-to-date `main`, so the live Site never differs from it:

```bash
git checkout main && git pull
npx wrangler login              # once; opens the browser
pnpm build:site
cd apps/site && npx wrangler deploy
```

`html_handling` is `drop-trailing-slash`, so pages are served at the slashless URLs the Site links to and lists in its sitemap. Missing paths get `404.html`.
