# The Site is fully static on Cloudflare Workers static assets

Supersedes ADR 0006 on how the Site is hosted. It is still on Cloudflare, under `gridcue.dev`.

The Site is prerendered HTML plus the Component Registry's JSON, served by Workers static assets with no Worker code. It has no server functions and no secrets, and there is no internal or hosted-key site. Its demo runs on the Mock Provider in the browser. Its live-Jev comparison shows runs recorded locally by `pnpm eval:record` and committed as data.

We chose this because the owner asked for a free implementation and saw no reason to put a Jev key on a hosted site. A static Site can't leak a key, costs nothing on the free plan, and makes the Site one build output. We chose Workers static assets over Pages because Cloudflare now points new projects to Workers. We deploy without the Cloudflare Vite plugin because that plugin can't prerender a React Router SPA build.

Packages still never depend on Cloudflare-specific APIs; only `apps/site/wrangler.jsonc` does. The Server Handler stays a standard `Request` to `Response` function that users host themselves (ADR 0011).
