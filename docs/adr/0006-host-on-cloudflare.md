# Host the Site on Cloudflare

**Superseded in part by ADR 0016:** the Site is fully static on Workers static assets, with no server functions.

The Site, the Component Registry files, and any server functions it needs are hosted on Cloudflare Pages and Workers, under the owner's domain, `gridcue.dev`. We chose Cloudflare over Vercel and Netlify because GridCue's Server Handler is a standard `Request` to `Response` function that runs as a Worker unchanged, and the free tier covers a docs site. Packages must never depend on Cloudflare-specific APIs; only the Site's deploy configuration may.
