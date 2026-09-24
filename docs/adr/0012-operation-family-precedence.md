# The compiler decides between competing Operation Families

A provider scores every Operation Family on its own, so several can come back high for one Clause. On the first live Jev run, "Reset the view." gave reset 0.96 and clear-filters 0.83, and "Keep only account, household, …" gave show-only 0.97 and hide 0.88. The compiler judged each family alone, so it asked about the weaker one or told the User to split the request. Six of fifteen requests asked a question where a person would have acted.

The compiler now applies fixed rules before it builds operations, in this order:

1. **Confident beats middling.** Once any view family is at or above `ready`, middle-band view families are dropped instead of asked about.
2. **Show-only absorbs show and hide.**
3. **Reset versus the clears.** Reset wins only when its score is higher than every accepted clear. Otherwise the explicit clears win. A User's confirmation counts as 1.
4. **Margin.** If two or more column families remain and the top one leads the next by at least 0.10, only the top one is kept.
5. **Split.** If two or more column families still remain, GridCue asks the User to split the Clause.

Each dropped family is recorded in the plan's evidence with source `deterministic`, so the audit trail says why it was not applied.

We chose this over asking Jev a single Choice for the Clause's main family (grill Q1, option b). The rules work the same for every provider, including the Mock and third-party ones. They change no provider questions, and each one is a unit test. Dropping a family never applies anything the User can't see: the Preview shows exactly what will change, and nothing applies without approval.

The margin (0.10) is a compiler constant, not a Host setting. It exists because Jev's scores move between runs: "Show accounts over $1 million" gave show-columns 0.85 in one run and 0.83 in the next, so a rule that depended on `ready` alone would flip. Revisit it, and option b, when the larger eval set shows a family being dropped that Users meant.

The confidence defaults (`ready` 0.85, `clarify` 0.65) are unchanged. Changing them needs its own ADR, backed by the larger eval set.
