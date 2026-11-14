# GridCue

GridCue turns a plain-language request about how a data grid should look into a checked, previewable change to that grid's view. It never changes the records behind the grid.

This glossary is seeded from the bootstrap proposal. Terms marked **(open)** are still being decided in `docs/planning/build-plan-grill.md`.

## Parties

**Host**:
The application that embeds GridCue and owns the data, the grid, authorization, credentials, and the final decision to apply a change.
_Avoid_: Client, consumer, integrator

**User**:
The person typing or dictating a request inside the Host's interface.
_Avoid_: Operator, end-customer

## Requests

**Utterance**:
The raw text of one request as the User typed or dictated it.
_Avoid_: Prompt, query, command

**Clause**:
One part of an Utterance that asks for one kind of change, split out deterministically, as in "group by advisor" and "sort by market value" from one request. The User sees it called a "part".
_Avoid_: Step, sub-request, segment

**Operation Family**:
The kind of change a Clause asks for, such as filter, sort, show only some columns, or reset the view. An Intent Provider scores each family; the compiler decides which ones are used.
_Avoid_: Intent, action type, command

**Mention**:
A column or enum value a Clause names by one of the Host's declared labels or aliases, found by deterministic code before any provider call. A name used for the rows themselves, as in "biggest accounts first", is not a Mention. A Local Value and a House Term are not Mentions either: a Mention is sent to the Intent Provider, and they never are.
_Avoid_: Match, hit, reference

**Row Noun**:
What one row of a grid is, such as "account", declared by the Host. In a request it means the rows, not a column.
_Avoid_: Entity type, record type

**Declared Grid**:
One of the grids the Host lists as places a request can be sent, each with its own Row Noun.
_Avoid_: Screen, page, route, tab

**Value Group**:
A Host-named category over several enum values of one column, such as Retirement = IRA and Roth IRA.
_Avoid_: Category, bucket, tag

**Local Value**:
A value of a text column that GridCue reads from the grid's own rows in the User's browser, with the Host's approval. It is never sent to an Intent Provider.
_Avoid_: Distinct value, facet, lookup

**House Term**:
A Host-named list of fixed conditions on the rows, all of which must hold, such as Large = Market value above $1,000,000. It is never sent to an Intent Provider.
_Avoid_: Semantic alias, business rule, macro

**Strategy**:
Which questions an Intent Provider asks for each Clause, chosen by the Host. Jev offers "focused" (fewest questions) and "fan-out" (the default).
_Avoid_: Mode, profile, preset

**Clarification**:
A single focused question GridCue asks when a request cannot be resolved without a choice only the User can make.
_Avoid_: Follow-up, disambiguation prompt

**Abstention**:
GridCue declining to propose any change because the request is too ambiguous or low-confidence to act on safely.
_Avoid_: Fallback, no-op success

**Unsupported Segment**:
A part of an Utterance that asks for something outside the view-only boundary, such as editing data or placing a trade.
_Avoid_: Rejected intent, error

**Grid Offer**:
GridCue's offer to open another Declared Grid when a request names that grid or is about its rows. The User chooses, and the Host opens the grid.
_Avoid_: Redirect, jump, navigation

## Views

**View State**:
The complete arrangement of a grid at a moment: filters, sorts, grouping, totals, count, which columns show in what order, which are pinned, and density.
_Avoid_: Grid state, table config, layout

**Count**:
How many rows a grid shows from the top of the sorted view, as in "top 10".
_Avoid_: Limit, page size, top-N

**Total**:
A sum or an average of one column, shown for each group, or once for the whole view when it isn't grouped.
_Avoid_: Aggregation, summary, subtotal

**Pinned Column**:
A column kept in view at the start or the end of the grid while the rest scrolls.
_Avoid_: Frozen column, locked column, sticky column

**Revision**:
An identifier for one specific View State, used to detect that the view changed underneath a pending plan.
_Avoid_: Version, etag

**View Schema**:
The Host's declaration of which columns exist, what they mean, and what may be done with each.
_Avoid_: Metadata, column config

**Calendar**:
The Host's time zone and the first month of its year, which turn date words in a request into dates.
_Avoid_: Locale, date settings

**View Operation**:
One atomic kind of view change, such as adding a filter or setting the sort.
_Avoid_: Action, command, step

**View Plan**:
An ordered set of View Operations proposed for one Utterance, tied to the Revision it was built against.
_Avoid_: Patch, diff, intent

**Applicable Plan**:
A View Plan that has passed every validation check against the current Revision and may be applied.
_Avoid_: Approved plan, valid plan

**Preview**:
The deterministic, human-readable description of exactly what a View Plan would change, shown before anything is applied.
_Avoid_: Summary, explanation

**View Sentence**:
The plain-English reading of a whole View State, such as "Taxable accounts over $1,000,000, grouped by Advisor." The View State is the record; the sentence is how it reads.
_Avoid_: Description, caption, summary

**Saved View**:
A View State the Host stores under a name the User chose. GridCue saves and opens one by request through the Host, and never stores it.
_Avoid_: Bookmark, preset, layout, favourite

## Integration points

**Intent Provider**:
A pluggable service that picks among closed, Host-approved choices to help interpret an Utterance. It never produces View Operations directly.
_Avoid_: Model, LLM, AI backend

**Controller**:
The single object a developer creates to wire one grid to GridCue. It takes a View Schema, a Grid Adapter, and an Intent Provider, and runs a request from Utterance to applied View Plan.
_Avoid_: Client, engine, instance

**Grid Adapter**:
The translator between GridCue's View State and one specific grid library.
_Avoid_: Driver, connector, plugin

**Rows Adapter**:
GridCue's built-in Grid Adapter for Hosts that hold their rows in memory. It applies View State to the rows so any table can render the result. For rows on a server, see Query Adapter.
_Avoid_: Default adapter, in-memory grid, local engine

**Data Query**:
The Host's own request to its server for the rows a View State asks for, such as a database query or an API call. GridCue never writes one.
_Avoid_: Backend query, server filter, SQL

**Query Adapter**:
GridCue's built-in Grid Adapter for Hosts whose rows come from their own Data Query. It holds the View State and lists only the View Operations that Data Query can carry out.
_Avoid_: Remote adapter, server adapter, SQL adapter

**Query Check**:
Synthetic rows and View States, built from a View Schema, that a Host runs through its own Data Query to prove it keeps the same rows GridCue would.
_Avoid_: Conformance suite, contract suite, SQL tests

**Candidate**:
One option in a closed set of choices offered to an Intent Provider, always including an explicit "none" or "unsupported" option.
_Avoid_: Suggestion, completion

**Mock Provider**:
An Intent Provider that answers from fixed rules instead of a model, so GridCue runs with no account or key. It powers tests and the public fake demo.
_Avoid_: Fake model, stub, dummy provider

**Local Resolver**:
GridCue's own deterministic reader, which runs in the User's browser. It resolves a request it can read in full and declines the rest, so an Intent Provider is called only for what it declines.
_Avoid_: Rules engine, offline mode, fast path

**Server Handler**:
A small Host-side endpoint that holds the Intent Provider's credentials and answers resolution requests, so keys never reach the User's browser.
_Avoid_: Backend, proxy, API route

## Distribution

**Component Registry**:
GridCue's shadcn-styled UI components, published so developers copy them into their own app with the shadcn CLI.
_Avoid_: UI kit, component library, theme

**Site**:
The public GridCue website, which holds the marketing page, the public demo, the developer docs, and the Component Registry.
_Avoid_: Landing page, docs app, homepage
