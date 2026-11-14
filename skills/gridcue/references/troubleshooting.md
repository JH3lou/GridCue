# Troubleshooting

Look up the symptom, check the cause, then fix. Read the linked docs page before changing code.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Nothing previews; "I'm not sure what to change" | The request's words aren't column labels or aliases | Add aliases and `enumValues` ([Describe your domain](https://gridcue.dev/docs/get-started/describe-your-domain)) |
| "Which column should be sorted by?" for "largest first" | No column name in the request, or `rowNoun` unset | Expected on the Mock. Set `rowNoun`; with Jev, the provider often picks the column. |
| "Keep only the first 10 rows of the new view, or show every row?" | The view has a count and the request changes the sort or the filters | Expected: pick one. "Show every row" clears the count at any time ([Requests](https://gridcue.dev/docs/concepts/requests)) |
| A filter previews but the table doesn't change | `gridcueFilterFn` isn't the table's default filter function | `defaultColumn: { filterFn: gridcueFilterFn }` ([Vite and TanStack Table](https://gridcue.dev/docs/guides/vite-tanstack)) |
| Undo stops working after the table changes | The controller is rebuilt on each render | Create it once with `useState(() => …)`, not `useMemo` on `table` |
| "The grid couldn't apply that change. Nothing was changed." on a TanStack table whose state the Host controls | A controlled slice (sorting, filters, and so on) has no change handler, or its handler sets state only after a fetch. The table doesn't hold the change within 1,000 ms. A handler that sets state later still changes the table after this message, and that change can't be undone. | Give every controlled slice its `on…Change` handler, and set state first, fetch after ([Vite and TanStack Table](https://gridcue.dev/docs/guides/vite-tanstack)) |
| "…the view changed meanwhile, so GridCue left it as it is." after about a second, on a controlled TanStack table, when no one changed the view | The slice's change handler stores something other than what it is given, such as an added tiebreaker sort, so the table never holds GridCue's value | Store exactly the value the handler is given. Adjust it where you read it, such as in the fetch ([Vite and TanStack Table](https://gridcue.dev/docs/guides/vite-tanstack)) |
| Undo refused on a controlled table | Older GridCue returned before the table had rendered the change, so the Revision was already out of date | Update `gridcue`. An apply now returns the Revision the table holds. |
| "The view changed since this preview" | The User changed the table between Preview and Apply | Expected: preview again. GridCue never overwrites a manual change. |
| "That request mentions a restricted column" | The request named a restricted column or alias | Expected. Don't unrestrict a column to make a request pass. |
| `gridcue/server` throws in the browser | Server code imported into a client component | Keep `gridcue/server` in server routes only; the browser uses `createRemoteProvider` ([Server Handler recipes](https://gridcue.dev/docs/guides/server-handler)) |
| `INPUT_CONFIG`: "The Jev provider needs @typesafe-ai/sdk" | The SDK isn't installed where the server runs | `npm i @typesafe-ai/sdk` in the server's package |
| The command bar shows "Couldn't interpret that request" | The endpoint failed: missing key, 401 or 429, or the route isn't mounted | Check the server logs and the network tab ([Protect the endpoint](https://gridcue.dev/docs/guides/protect-the-endpoint)) |
| "That took too long" | The provider exceeded `providerTimeoutMs` (8 s by default) | Check the endpoint's latency; raise the limit only if needed |
| Too many questions with Jev | `strategy: "focused"`, or sparse aliases | Use the default `"fan-out"`, and add aliases ([Choosing a strategy](https://gridcue.dev/docs/guides/choosing-a-strategy)) |
