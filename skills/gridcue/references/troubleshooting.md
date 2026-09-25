# Troubleshooting

Look up the symptom, check the cause, then fix. Read the linked docs page before changing code.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Nothing previews; "I'm not sure what to change" | The request's words aren't column labels or aliases | Add aliases and `enumValues` ([Describe your domain](https://gridcue.dev/docs/get-started/describe-your-domain)) |
| "Which column should be sorted by?" for "largest first" | No column name in the request, or `rowNoun` unset | Expected on the Mock. Set `rowNoun`; with Jev, the provider often picks the column. |
| A filter previews but the table doesn't change | `gridcueFilterFn` isn't the table's default filter function | `defaultColumn: { filterFn: gridcueFilterFn }` ([Vite and TanStack Table](https://gridcue.dev/docs/guides/vite-tanstack)) |
| Undo stops working after the table changes | The controller is rebuilt on each render | Create it once with `useState(() => …)`, not `useMemo` on `table` |
| "The view changed since this preview" | The User changed the table between Preview and Apply | Expected: preview again. GridCue never overwrites a manual change. |
| "That request mentions a restricted column" | The request named a restricted column or alias | Expected. Don't unrestrict a column to make a request pass. |
| `gridcue/server` throws in the browser | Server code imported into a client component | Keep `gridcue/server` in server routes only; the browser uses `createRemoteProvider` ([Server Handler recipes](https://gridcue.dev/docs/guides/server-handler)) |
| `INPUT_CONFIG`: "The Jev provider needs @typesafe-ai/sdk" | The SDK isn't installed where the server runs | `npm i @typesafe-ai/sdk` in the server's package |
| The command bar shows "Couldn't interpret that request" | The endpoint failed: missing key, 401 or 429, or the route isn't mounted | Check the server logs and the network tab ([Protect the endpoint](https://gridcue.dev/docs/guides/protect-the-endpoint)) |
| "That took too long" | The provider exceeded `providerTimeoutMs` (8 s by default) | Check the endpoint's latency; raise the limit only if needed |
| Too many questions with Jev | `strategy: "focused"`, or sparse aliases | Use the default `"fan-out"`, and add aliases ([Choosing a strategy](https://gridcue.dev/docs/guides/choosing-a-strategy)) |
