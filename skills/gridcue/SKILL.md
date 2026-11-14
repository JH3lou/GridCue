---
name: gridcue
description: Sets up GridCue, the open-source toolkit that lets people ask a data grid or table for a view in plain language ("taxable accounts over $1M, largest first") and get a checked, previewed, undoable filter, sort, group, or column change. Use when adding a natural-language command bar, "ask your data", or AI search to a data grid, TanStack Table, or other table in a React app; when configuring GridCue's schema, aliases, or domain words; when turning on the Jev provider or a GridCue server route; when writing GridCue evals; or when debugging a GridCue setup.
---

# Set up GridCue

GridCue turns a plain-language request into a change to a grid's **view**: filters, sorts, grouping, and which columns show. A model picks only among closed choices the app declares; code builds the plan, the User previews it, applies it, and can undo it. GridCue never changes data, and it never sends table rows to a model.

Your job is to add it to the User's app in small steps, checking each one works before the next.

## Where facts come from

**The live docs are the source of truth.** This skill gives you the order of work and the rules. Read the docs for every API detail, and never invent options.

1. Check the installed version first: `gridcue` in `package.json` or the lockfile. If it isn't installed, you'll install the latest.
2. Read the page list at `https://gridcue.dev/llms.txt`.
3. Fetch each page you need as Markdown: a page listed as `/docs/<path>` is at `https://gridcue.dev/llms.mdx/docs/<path>/content.md`.
4. If the docs describe a newer API than the installed version, say so and follow the installed package's types.
5. Without network access, use the installed package's README and type declarations (`node_modules/gridcue/dist/*.d.ts`), and tell the User you did.

## The setup path

Do these in order. Finish each step's check before moving on, and tell the User what you checked.

1. **Detect the stack.** Is it Vite or Next.js? Does the table use TanStack Table v9 or a plain array of rows? Is it React 19? Are Tailwind and shadcn/ui set up? Read [references/setup.md](references/setup.md).
2. **Install.** `npm i gridcue` (plus `@tanstack/react-table` if the app uses it). **Check:** the app still builds.
3. **Wire the Mock Provider and a command bar.** The Mock needs no key and no server. **Check:** in the running app, a request naming a real column ("sort by <column>, largest first") shows a Preview, and Apply and Undo work.
4. **Pick the UI.** Use `GridCueBar` (plain CSS, any React app) or the shadcn command bar from GridCue's Component Registry (Tailwind + shadcn apps). **Check:** it renders in light and dark themes.
5. **Describe the domain** from the app's real columns: aliases, approved values, restricted columns, and the three domain declarations. Read [references/domain.md](references/domain.md). **Check:** three requests in the User's own words preview correctly.
6. **Turn on Jev**, only if the User wants a real model. It runs behind a server route the app controls. Read [references/jev.md](references/jev.md). **Check:** a build with a fake key finds no key in the browser bundle.
7. **Offer evals** on the app's own schema. Read [references/evals.md](references/evals.md).

When something doesn't work, read [references/troubleshooting.md](references/troubleshooting.md) before changing code.

## Counts

"Top 10 accounts by market value" sets a count: the view keeps its first 10 rows. The Rows Adapter supports it. The TanStack Table adapter doesn't list `limit.set` yet, on any table, so there GridCue sorts alone and the Preview says the count was not applied. A count stays on the view until something clears it, so a change to the sort or the filters asks first ("Keep the first 10" or "Show every row"). That is expected, not a bug. To clear a count the User says "show every row", "show all rows", "remove the count" or "no count"; "show only the first 5 rows" sets one. Don't add code to clear or keep a count: the Controller does it, with a Preview, and Undo restores it. See [Requests](https://gridcue.dev/docs/concepts/requests).

## Text and empty forms

GridCue's own code reads four forms, with no provider: `advisor starts with "Av"` (also "starting", "begins", "beginning"), `advisor is exactly "Avery Lane"` (also `exactly`, `=`, "equals", "equal to"; letter case ignored), "accounts with no advisor" or `advisor is empty` (also "blank", "missing", "without an advisor"), and "accounts that have an advisor" or `advisor is not empty`. Exact and starts-with need a text column. Empty is for text, category, date and date-and-time columns. On a number, currency or percent column it asks, and "no restricted holdings" on a yes/no column keeps meaning No. Empty means no value (missing, `null` or `""`), so a placeholder like "Unassigned" is a value that "no advisor" does not find.

A part with one of these forms is ready only when every word in it is one GridCue places, so "accounts with no advisor assigned to the new team" asks about "to" and "new team". That is expected, not a bug: don't add code or aliases to make it pass, and don't widen the words. So is a question for the form's column named again ("show only advisor for accounts with no advisor"), for a column asked for beside the form ("show only household where advisor is empty" asks about "household"; "accounts with no advisor, show only household" does both), and for a statement ("my advisor is missing", "every advisor is empty", "every account has an advisor", "that account has no advisor", "accounts are without an advisor", "which advisor is missing", "advisor is empty for every account", "advisor is missing from my account"). "My accounts with no advisor", "show me accounts with no advisor", "accounts whose advisor is empty", "which accounts have no advisor?" and "advisor is empty for taxable accounts" are read. Two parts with no form ask too: a word for empty values outside a form ("sort by market value, blanks last"), and a word beside a change to show only some columns that isn't its own ("just the accounts where the advisor is Blake Moreno"). `advisor is "Lane"` still means containing, and `advisor ends with "Lane"` asks. To turn a form off for a column, leave its operator (`startsWith`, `eq`, `isEmpty`, `isNotEmpty`) out of that column's `allowedOperators`. A custom Grid Adapter or filter must treat empty as `undefined`, `null` or `""`, and `eq` on a text column as case-insensitive: call `matchesPredicate`. See [Requests](https://gridcue.dev/docs/concepts/requests).

## Hard rules

Never trade these away, even if asked to "just make it work":

- **The Jev key lives only on the server.** Never put it in a `VITE_` or `NEXT_PUBLIC_` variable, client code, logs, fixtures, or commits. Browser code talks to the app's own endpoint with `createRemoteProvider`.
- **Rows never go to a provider.** Only column names, labels, aliases, and approved values are sent. Mark any column whose names or values are sensitive as `restricted`.
- **Never bypass preview, apply, or undo.** Don't write filter, sort, or grouping state from model output directly; GridCue's controller does that after the User approves.
- **Protect the endpoint** with the app's own authentication and rate limits.
- **View-only.** Never wire GridCue to edit records, trade, export, email, or navigate.
- **Use only documented options.** If an option isn't in the docs or the types, it doesn't exist.

## Stop and ask the User when

- Turning on Jev means adding or changing a server the app doesn't already have.
- The table isn't TanStack Table and doesn't render from a plain array of rows, so neither built-in adapter fits.
- The User asks GridCue to change data, not the view.
- A column's names or values might be sensitive, and you can't tell whether to mark it `restricted`.
