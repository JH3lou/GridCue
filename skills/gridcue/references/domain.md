# Describe the domain

Docs: [Describe your domain](https://gridcue.dev/docs/get-started/describe-your-domain), [Requests](https://gridcue.dev/docs/concepts/requests).

The Mock matches column labels as written; Jev understands more, but both do better with the app's own words. All of this goes in the options of `schemaFromTanStack(table, options)` or `defineSchema(columns, options)`.

## Work from the app's real data

1. List the columns: id, label, and what's in them. Read the column definitions and a few rows.
2. Ask the User how people ask for things: the words they use for columns and values. If they can't say, propose some and let them edit.

## What to declare

- **`aliases`** for a column or a value: "rep" for Advisor, "roth" for Roth IRA, "aum" for Market value. They match as whole words, and plurals match too.
- **`enumValues`** for category columns: the values GridCue may use, each with an id, a label, and aliases. This makes the column an `enum`.
- **`description`** where a column's meaning isn't obvious, such as "'Accounts over $X' refers to this column."
- **`restricted`**: every column whose name or values are sensitive (tax ids, personal data, internal notes). GridCue never sends or acts on them, and a request that names one is refused. Add the aliases people might use, so the refusal catches them. When unsure, ask the User.
- **`rowNoun`**: what one row is ("account"), so "biggest accounts first" means the rows, not the Account number column.
- **`entity`** on a column that names another record ("household", "advisor"), so "largest households first" asks what the User means instead of guessing.
- **`valueGroups`** for the User's own categories over one column's values ("Retirement" = IRA + Roth IRA).
- **`capabilities`** or **`allowedOperators`**, only to narrow a column that must not be sorted, grouped, or filtered in some way.

`defineSchema` and `schemaFromTanStack` throw on a restricted or configured id that matches no column. Fix the id, don't catch the error.

With the Mock, `createMockProvider({ defaultColumnForKind: { currency: "<column id>" } })` says which column a bare amount like "$1M" means.

**Check:** ask the User for three requests in their own words, and try each. Each should preview the right change, or ask a sensible question. Adjust aliases and values until they do; never change GridCue's code to make one pass.
