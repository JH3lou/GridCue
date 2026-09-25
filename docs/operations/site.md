# The Site

The Site is `apps/site`: the marketing page at `/`, the demo at `/demo`, the docs at `/docs`, the changelog, and the Component Registry at `/r/`. It is fully static (ADR 0016).

## Run it locally

```bash
pnpm install
pnpm dev:site        # builds the package and registry, then serves http://localhost:5173
```

After the first run, `pnpm --filter @gridcue-internal/site dev` is enough unless the package or registry changed.

`pnpm build:site` writes the static Site to `apps/site/build/client`: prerendered HTML for every page, `404.html`, `sitemap.xml`, `robots.txt`, the static search index, and `llms.txt`. To serve that output the way Cloudflare does, run `npx wrangler dev` in `apps/site`.

## Refresh the recorded strategy runs

The demo's "Compare strategies" tab shows live Jev runs recorded locally. The Site never calls Jev. With your key in the repo-root `.env.local`:

```bash
pnpm eval:record     # writes apps/site/app/data/strategy-runs.json
```

Review the diff before committing it. Every "ready" preview must be the view the request asked for.

## Deploy

It runs on Cloudflare's free plan, as the Worker `gridcue-site` with the custom domain `gridcue.dev`, both set in `apps/site/wrangler.jsonc`. There is no Worker code and there are no secrets.

```bash
npx wrangler login              # once; opens the browser
pnpm build:site
cd apps/site && npx wrangler deploy
```

`html_handling` is `drop-trailing-slash`, so pages are served at the slashless URLs the Site links to and lists in its sitemap. Missing paths get `404.html`.

To deploy on every push instead, connect the repository under **Workers & Pages → gridcue-site → Settings → Build**:

- **Build command:** `pnpm install --frozen-lockfile && pnpm build:site`
- **Deploy command:** `cd apps/site && npx wrangler deploy`
- **Environment variable (optional):** `VITE_CF_ANALYTICS_TOKEN` for Cloudflare Web Analytics. It is a public beacon token, not a secret.

Never add `JEV_API_KEY`, or any other secret, to the Site's build or deploy settings. `pnpm check:bundles` builds the Site with a canary key and fails if it appears in the output.
