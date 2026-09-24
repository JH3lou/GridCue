# Product definition

## Vision

Dense enterprise tables expose enormous capability but demand that users translate a simple question into UI mechanics: find the right column, add the right operator, enter a value in the right format, repeat for each filter, arrange columns, establish grouping, and choose sort precedence.

GridCue lets the user state the outcome instead:

> “Show the accounts that need attention: taxable, over $1 million, more than 10% in one security. Group by advisor and put the largest concentration first.”

The product converts that request into a precise, reviewable view configuration using only capabilities the host application has explicitly allowed.

## Target users and settings

- Financial advisors navigating household, account, position, model, proposal, and service dashboards.
- Traders and portfolio managers triaging exceptions, drift, restrictions, cash, losses, gains, and concentration.
- Operations and supervision teams working in large exception queues.
- Any enterprise application whose primary interface is a configurable, information-dense grid.

Financial services is the proving ground, not a hard-coded domain. Domain meaning belongs in host-supplied column metadata, aliases, policies, and example packs.

## Core user journey

1. The user opens a command bar above an existing grid.
2. They type a request or dictate into the field using their normal transcription tool.
3. GridCue resolves the request against the current view, available columns, allowed operations, and domain aliases.
4. GridCue displays a deterministic preview such as:
   - Add filters: `Registration = Taxable`; `Concentration > 10%`
   - Group by: `Advisor`
   - Sort: `Concentration`, descending
   - No data will be changed
5. The user applies, edits, or cancels the proposal.
6. Apply changes the view atomically and offers Undo.
7. An audit event records safe structural details according to host policy.

## MVP capabilities

### Included

- Single and compound requests.
- Add and clear filters.
- Single and multi-column sorting.
- Set or clear grouping.
- Show, hide, and reorder columns.
- Reset view.
- Deterministic preview, apply, cancel, and undo.
- Schema aliases and concise domain descriptions.
- Confidence-aware clarification and safe abstention.
- Provider- and grid-independent core.
- Synthetic evaluation cases and a no-credential demo.

### Designed in the protocol, deferred in implementation

- Aggregations and subtotals.
- Column pinning and density.
- Named/saved views.
- Additional grid libraries.
- Host-defined custom view operations.

### Explicitly excluded

- Editing row or cell values.
- Placing trades, sending orders, approving exceptions, or contacting clients.
- Exporting, downloading, or copying protected data.
- Navigating to records or privileged application areas.
- Answering analytical questions from raw rows.
- Generating SQL.
- Recording audio or performing transcription.
- Training on host data.

## Product principles

### 1. The semantic model is not the executor

Jev—or any later provider—selects among allowed semantic candidates. It does not receive a browser-control tool, emit arbitrary code, or apply a change.

### 2. The host application remains authoritative

The host declares:

- columns, types, labels, aliases, and descriptions;
- supported filter operators and view features;
- which fields may be exposed to the provider;
- which values may be suggested or resolved;
- authorization and confirmation policy;
- the adapter that reads and writes view state.

### 3. Data minimization is the normal path

Most view commands can be resolved from the utterance plus schema metadata. Row contents remain local. If a host enables a distinct-value resolver, it must explicitly govern which values may be disclosed.

### 4. Ambiguity is visible

“Show large accounts” has no universal threshold. Unless the host supplies an approved meaning for `large`, GridCue asks what the user means. It does not quietly choose $1 million.

### 5. Mixed-scope requests fail safely

For “show restricted holdings and place the trades,” GridCue identifies a valid view request and a prohibited business action. It must not partially apply the view until the user removes or resolves the prohibited portion.

### 6. Existing controls remain first-class

GridCue is an alternate control surface over the same view state, not a replacement for filters, column menus, or saved views. Manual and language-driven changes must remain interoperable.

## Interaction states

| State | Meaning | Required UI behavior |
| --- | --- | --- |
| Idle | No active request | Input is available |
| Resolving | Provider/compiler is working | Preserve input; allow cancel |
| Ready | Valid plan can be reviewed | Show exact structural diff |
| Needs clarification | One or more required slots are unresolved | Ask one focused question and offer bounded choices where possible |
| Unsupported | Request is outside declared capabilities | Explain the boundary without pretending success |
| Applying | Adapter is committing the plan | Prevent duplicate apply |
| Applied | View revision changed | Confirm success and offer Undo |
| Error | Technical failure | Preserve prior view; expose safe retry details |

## Confidence policy

Confidence supports workflow decisions but never bypasses validation.

Suggested initial bands, to be tuned with eval evidence:

- `>= 0.85`: show a normal preview.
- `0.65–0.849`: show a warning or ask a bounded clarification when the ambiguity is material.
- `< 0.65`: do not construct an applicable plan; clarify or abstain.

The host may set stricter bands. Auto-apply is off in the MVP regardless of confidence.

The defaults are `ready` 0.85 and `clarify` 0.65. They are unchanged since the first live run and need an ADR to change. Around them, the compiler applies fixed rules:

- **Competing families** (ADR 0012).
  - A family with nothing to act on yields to one that has something.
  - A confident family drops middling ones.
  - Show-only absorbs show and hide.
  - Reset and the clears: the higher score wins.
  - A lead of at least 0.10 decides between column families.
  - Otherwise, GridCue asks the User to split the part.
- **Host-declared names** (ADR 0013).
  - A column or value named by a declared label or alias counts as confidence 1.
  - This does not apply when the name sits where the rows go, or when the provider scores the column below 0.40.
  - A named value is never silently ignored.
- **Fan-out answers** (ADR 0014).
  - Change-type answers bind columns to changes, so one part can carry several changes.
  - A main-change-type pick decides between close families.
  - An add-a-level answer appends to the current sort or grouping.
  - With reversal wording, an outer answer decides nesting.
  - A value named before another change's verb is a filter.

## Domain examples

| User request | Expected interpretation |
| --- | --- |
| “Taxable households with more than $50,000 of losses” | Filter registration/tax status and unrealized loss using host-defined fields |
| “Biggest sleeve drift first; group by strategist” | Sort drift descending, group by strategist |
| “Only accounts with a restriction, and show the restriction reason” | Filter restriction flag; reveal permitted reason column |
| “Hide PII and give me a compact exceptions view” | Hide columns tagged as PII if the host exposes that alias; density is deferred or unsupported |
| “Show gains close to becoming long term” | Clarify or use an explicit host-defined semantic alias; never invent the day threshold |
| “Sell anything over 10%” | Reject: trade execution is outside the view-only boundary |

## Success measures

Measure by intent outcome, not conversational fluency:

- exact or semantically equivalent match for operations, fields, operators, values, and precedence;
- safe-abstention rate on ambiguous and unsupported requests;
- zero application of invalid, unauthorized, or stale plans;
- preview-to-apply rate and clarification rate;
- successful undo rate;
- end-to-end latency by pipeline stage;
- row-data disclosure count, expected to remain zero on the default path.

Do not optimize acceptance rate by lowering abstention safety. A confident wrong view in a trading or supervisory system is more damaging than one clarification.

## Future direction

Once the view-only engine is demonstrably safe and accurate, the same protocol could support saved-view suggestions, domain vocabulary packs, additional adapters, and optional insight modules. Record-editing or workflow actions should be a separate product surface with a separate risk model, not an incremental flag in the view engine.
