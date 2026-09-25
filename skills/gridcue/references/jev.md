# Turn on Jev

Docs: [Turn on Jev](https://gridcue.dev/docs/get-started/turn-on-jev), [Server Handler recipes](https://gridcue.dev/docs/guides/server-handler), [Protect the endpoint](https://gridcue.dev/docs/guides/protect-the-endpoint), [Choosing a strategy](https://gridcue.dev/docs/guides/choosing-a-strategy).

Only when the User wants a real model. It needs a Jev API key from TypeSafe, which the User provides; never ask them to paste it into the chat. Have them put it in the environment themselves.

## The shape

```
browser: createRemoteProvider({ endpoint: "/api/gridcue" })  →  your server route  →  createGridCueHandler + createJevProvider (holds the key)  →  Jev
```

1. **Install the SDK on the server:** `npm i @typesafe-ai/sdk`. Only `createJevProvider` uses it.
2. **Browser:** replace `createMockProvider()` with `createRemoteProvider({ endpoint: "/api/gridcue" })` from `gridcue`.
3. **Server route**, by stack:
   - **Next.js:** `app/api/gridcue/route.ts` exports `POST = createGridCueHandler({ provider: createJevProvider({ apiKey: process.env.JEV_API_KEY }) })`.
   - **Vite:** in development, mount the handler in Vite's dev server with a small plugin and `toNodeHandler`. In production, a real server serves `dist/` and mounts the same handler (Express shown in the docs). If the app has no server yet, **stop and ask**: adding one is the User's decision.
   - **Cloudflare Workers, Hono, or plain Node:** see the Server Handler recipes.
4. **The key:** a server environment variable named `JEV_API_KEY`, locally in a git-ignored `.env.local`. Never `VITE_JEV_API_KEY` or `NEXT_PUBLIC_JEV_API_KEY`; those prefixes put it in the browser bundle.
5. **Protect the endpoint:** put the route behind the app's existing session check and rate limit, as for any other API route. GridCue adds no auth of its own.
6. **Strategy:** keep the default, `"fan-out"`. Use `"focused"` only if the User's requests are simple (one change at a time) and they want fewer questions sent per request. Focused asks the User more often; it doesn't guess.

## Check

- Build the app with a fake key (`JEV_API_KEY=gridcue-canary npm run build`) and search the browser output (`dist/` or `.next/static`) for `gridcue-canary`. It must not be there.
- With the real key, a request previews through the endpoint.
- Without a session, the endpoint refuses.
