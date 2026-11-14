import { readdirSync } from "node:fs";
import { wealthMockOptions } from "@gridcue-internal/wealth-fixtures";
import { createMockProvider } from "gridcue/mock";
import { describe, expect, it } from "vitest";
import { judge, loadCases, mockOptionsFor, onGridWithoutGrouping, runCase, runWithoutGrouping } from "./run";

const provider = createMockProvider(wealthMockOptions);

describe("evals with the Mock Provider", () => {
  for (const c of loadCases()) {
    it(c.id, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).toMatch(/^(exact|safe_abstention|rejected)$/);
    });
  }
});

// Reading cases: a question where a plan was expected is a reported miss; a wrong view fails.
describe("reading evals with the Mock Provider", () => {
  for (const file of ["cases-reading.jsonl", "cases-reading-heldout.jsonl"]) {
    for (const c of loadCases(new URL(`./${file}`, import.meta.url))) {
      it(`${file}: ${c.id}`, async () => {
        const result = await runCase(c, provider);
        expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
      });
    }
  }
});

// Quoted text and dates that showed rows the User didn't ask for (named filters spec, 5.1). Each now asks, so with the
// Mock Provider every case must match: the controls exactly, the rest with the expected question. The held-out set was
// labelled from the spec alone, before the fixes, and first run after them (2026-11-13): 16 exact, 37 asked as
// labelled, 0 wrong views, of 53. 31 of its requests showed a wrong view before the fixes and now ask. The text forms
// these sets asked about are read since spec 5.2 (2026-11-14), and their cases now expect the spec's reading: 7 in the
// dev set, 6 in this held-out set and 7 in the second.
describe("named-filter fixes with the Mock Provider", () => {
  for (const file of ["cases-named-fixes.jsonl", "cases-named-fixes-heldout.jsonl"]) {
    for (const c of loadCases(new URL(`./${file}`, import.meta.url))) {
      it(`${file}: ${c.id}`, async () => {
        const result = await runCase(c, provider);
        expect(result.verdict, JSON.stringify(result.plan, null, 1)).toMatch(/^(exact|safe_abstention|rejected)$/);
      });
    }
  }
});

// A second held-out set for the same fixes, first run after the round-1 review's fixes (2026-11-13): 34 exact, 34 asked
// as labelled, 6 safe misses, 0 wrong views, of 74, after two labels were corrected to ask. After the round-2 fixes: 37
// exact, 34 asked as labelled, 3 safe misses. A safe miss is reported by `pnpm eval`; a wrong view fails.
describe("named-filter fixes, second held-out set, with the Mock Provider", () => {
  for (const c of loadCases(new URL("./cases-named-fixes-heldout-r2.jsonl", import.meta.url))) {
    it(`cases-named-fixes-heldout-r2.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
    });
  }
});

// A count follows its rows (operation set spec, 5.1; ADR 0027). After a count, a change to the sort or the filters asks
// whether to keep the count, and the count's own words set and clear it. Labelled before the code. With the Mock
// Provider every case must match: 25 exact and 15 asked as labelled, of 40 (2026-11-13). Before the fix, 11 of these
// requests kept a count over different rows without saying so.
describe("a count follows its rows, with the Mock Provider", () => {
  for (const c of loadCases(new URL("./cases-count.jsonl", import.meta.url))) {
    it(`cases-count.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).toMatch(/^(exact|safe_abstention|rejected)$/);
    });
  }
});

// The same classes in other words, labelled from the spec alone before the code and first run after it (2026-11-13):
// with the Mock Provider 19 exact, 26 asked as labelled, 3 safe misses, 0 wrong views, of 48. 15 of its requests kept a
// count over different rows before the fix and now ask. A safe miss is reported by `pnpm eval`; a wrong view fails.
describe("a count follows its rows, held-out set, with the Mock Provider", () => {
  for (const c of loadCases(new URL("./cases-count-heldout.jsonl", import.meta.url))) {
    it(`cases-count-heldout.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
    });
  }
});

// A grid that can't group says so (more grids spec, 5.3). The dev set runs on a grid without `group.set`: requests
// that group or ungroup, alone and beside a filter or sort, and controls where "group" is part of a value or a column's
// label. Labelled before the code. With the Mock Provider every case must match: 6 exact and 19 asked as labelled, of 25
// (2026-11-13). Before the fix, 18 of them asked a question that blamed the wording or offered grouping.
describe("a grid that can't group, with the Mock Provider", () => {
  for (const c of loadCases(new URL("./cases-cant-group.jsonl", import.meta.url))) {
    it(`cases-cant-group.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).toMatch(/^(exact|safe_abstention|rejected)$/);
    });
  }
});

// The same classes in other words, labelled from the spec alone before the code and first run after it (2026-11-13):
// with the Mock Provider 4 exact, 24 asked as labelled, 2 safe misses, 1 wrong view (h-groupwise-word), of 31. After
// the fix for that class ("group" after a name), 4 exact, 25 asked as labelled, 2 safe misses, no wrong view. After the
// fix for any word built on "group" (third set), 4 exact, 26 asked as labelled, 1 safe miss (h-value-group-in-household),
// no wrong view. Every case runs on a grid without `group.set`. A safe miss is reported by `pnpm eval`; a wrong view
// fails.
describe("a grid that can't group, held-out set, with the Mock Provider", () => {
  for (const c of loadCases(new URL("./cases-cant-group-heldout.jsonl", import.meta.url))) {
    it(`cases-cant-group-heldout.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
    });
  }
});

// A second held-out set, labelled from the spec alone and first run after the fix for "group" after a name
// (2026-11-13): "group" as a noun beside a value, requests that group or ungroup alone and beside other parts, the hint,
// and controls. With the Mock Provider 35 asked as labelled, 1 refused as labelled, 1 safe miss (an edit asked instead
// of being refused), 1 wrong view (r2-noun-a-group-of: "a group of" before a name read as a filter), of 38. After the
// fix for that class ("group" as a noun after an article), 36 asked as labelled, 1 refused as labelled, 1 safe miss, no
// wrong view. Every case runs on a grid without `group.set`. A safe miss is reported by `pnpm eval`; a wrong view fails.
describe("a grid that can't group, second held-out set, with the Mock Provider", () => {
  for (const c of loadCases(new URL("./cases-cant-group-heldout-r2.jsonl", import.meta.url))) {
    it(`cases-cant-group-heldout-r2.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
    });
  }
});

// A third held-out set, labelled from the spec alone and first run after the fix for "group" as a noun after an article
// (2026-11-13): "group" as a noun before or after a name, requests that group or ungroup alone and beside other parts,
// adversarial text, hidden and unknown columns, other grouping words, the hint, and a view that starts grouped. With the
// Mock Provider 19 asked as labelled, 15 asked and 1 refused where only a ready plan fails, 1 safe miss
// (r3-verb-stop-grouping asks the general question instead of the can't-group one), 1 wrong view (r3-noun-groups-of:
// "groups of" before a name, with no article, read as a filter), of 37. After the fix for that class (any word built on
// "group", with or without an article), 20 asked as labelled, 16 asked and 1 refused where only a ready plan fails, no
// safe miss, no wrong view. Every case runs on a grid without `group.set`. A safe miss is reported by `pnpm eval`; a
// wrong view fails.
describe("a grid that can't group, third held-out set, with the Mock Provider", () => {
  for (const c of loadCases(new URL("./cases-cant-group-heldout-r3.jsonl", import.meta.url))) {
    it(`cases-cant-group-heldout-r3.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
    });
  }
});

// A fourth held-out set, labelled from the spec and the lead's ruling alone and first run after the fix for any word
// built on "group" (2026-11-14): other words built on "group" ("regroup", "subgroup", "groupwise", "groupby",
// "group-by"), a grouping word said to stay or left out with and without more words after it, a grouping word after
// "like", "named" or "contains" and inside quotes, listed verbs alone and beside other parts, and plain controls. With
// the Mock Provider 13 exact, 13 asked as labelled, 26 asked where only a ready plan fails, 3 safe misses
// (r4-keep-nothing-after, r4-keep-and-join and r4-quoted-household ask, as they do on a grid that can group), no wrong
// view, of 55. Every case runs on a grid without `group.set`. A safe miss is reported by `pnpm eval`; a wrong view fails.
describe("a grid that can't group, fourth held-out set, with the Mock Provider", () => {
  for (const c of loadCases(new URL("./cases-cant-group-heldout-r4.jsonl", import.meta.url))) {
    it(`cases-cant-group-heldout-r4.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
    });
  }
});

// Text forms (named filters spec, 5.2; ADR 0023), labelled before the code on the wealth and ledger fixtures, each case
// with the Mock Provider set up for its fixture. Every case must match. First run after the code (2026-11-14):
// - the form set: 31 exact, 9 asked as labelled, of 40. Before the code, 1 wrong view ("accounts with no advisor over
//   $1m" filtered Market value and dropped "no advisor");
// - sentences that hold a form and are not view requests: 19 asked, 1 refused, none ready, of 20;
// - the limit on a provider's picks, each case with a scripted answer that proposes a sort, a column or a value for the
//   form's words: 14 exact, 6 asked as labelled, of 20. Before the code, 8 wrong views.
// Each set gained 10 cases that hold a House Term, labelled before its code and run with the schema's terms declared
// (named filters spec, 5.3): the sentences that are not requests all ask, before and after; of the provider picks, 9
// exact and 1 asked as labelled, where 9 showed a wrong view before.
// Two classes a review found joined the first two sets with their fixes (2026-11-14). These cases were written beside
// the fix, from the lead's rulings, so they are regression cases and not a held-out measure:
// - a column asked for beside a form ("show only household where advisor is empty"): 22 cases that must not be ready,
//   and 10 controls that must stay ready ("households with no advisor", "my accounts with no advisor"). Before the fix,
//   13 of the 22 were ready with the form's filter alone;
// - statements made only of words GridCue places ("advisor is missing from my account", "every advisor is empty"): 24
//   cases. Before the fix all 24 were ready.
// The review's next fixes added 19 more, written the same way:
// - 5 columns asked for beside a form after any verb that chooses rows, after "a" or "an", or after "my" ("show me an
//   advisor where household is empty", "my household with no advisor"), all 5 ready with the form's filter alone
//   before, and 3 controls that must be ready ("show every household with no advisor", "my restricted accounts with no
//   advisor", "my settled entries with no vendor"), 2 of which asked before. The form set is now 44 exact, 36 asked as
//   labelled, of 80;
// - 11 statements ("include me in accounts with no advisor", "that advisor is missing", "accounts which were without
//   an advisor"), all 11 ready before. That set is now 54 asked, 1 refused, none ready, of 55.
// The lead's rulings on statements around a form (round 4) added 27 more, written the same way:
// - 16 statements: a form of "be" before "without" or "no" ("accounts are without an advisor"), "has" after "that" and
//   the rows ("that account has no advisor"), a question word before the column ("which advisor is missing"), and only
//   a preposition and the rows after the form ("advisor is empty for every account"). All 16 were ready before. That
//   set is now 70 asked, 1 refused, none ready, of 71;
// - 10 controls with the plans they had before ("accounts whose advisor is empty", "advisor is empty for taxable
//   accounts"), and "advisor is empty for accounts over $1m", which asks as before. The form set is now 54 exact, 37
//   asked as labelled, of 91.
describe("text forms, with the Mock Provider", () => {
  const ledgerProvider = createMockProvider(mockOptionsFor({ schema: "ledger" }));
  for (const file of ["cases-text-forms.jsonl", "cases-not-requests.jsonl", "cases-provider-picks.jsonl"]) {
    for (const c of loadCases(new URL(`./${file}`, import.meta.url))) {
      it(`${file}: ${c.id}`, async () => {
        const result = await runCase(c, c.schema === "ledger" ? ledgerProvider : provider);
        expect(result.verdict, JSON.stringify(result.plan, null, 1)).toMatch(/^(exact|safe_abstention|rejected)$/);
      });
    }
  }
});

// The held-out sets for the text forms, labelled before the code and first run after it (2026-11-14), each case with
// the Mock Provider set up for its fixture:
// - the form set, from spec 5.2 alone: 43 exact, 42 asked as labelled, 1 refused as labelled, 1 safe miss (h2f-23 asks
//   whether "hide custodian" leaves out rows), 2 wrong views (h2f-54 "Cleared is empty" filters Cleared to Yes, as it
//   did before the code; h2f-59 "Advisor is empty and over 5%" is ready where an empty form followed by an amount
//   asks), of 89;
// - the natural set, by a labeller who saw only the product definition and the schemas: 6 exact, 8 asked as labelled,
//   22 safe misses, 2 wrong views, both as before the code (n1-led-ambig-blanks-last drops "with the blanks last";
//   n1-wea-advisor-exact shows only the Advisor column for "just the accounts where the advisor is exactly …"), of 38.
// A safe miss is reported by `pnpm eval`; a wrong view fails.
describe("text forms, held-out sets, with the Mock Provider", () => {
  const ledgerProvider = createMockProvider(mockOptionsFor({ schema: "ledger" }));
  for (const file of ["cases-text-forms-heldout.jsonl", "cases-text-forms-natural-heldout.jsonl"]) {
    for (const c of loadCases(new URL(`./${file}`, import.meta.url))) {
      it(`${file}: ${c.id}`, async () => {
        const result = await runCase(c, c.schema === "ledger" ? ledgerProvider : provider);
        expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
      });
    }
  }
});

// A second held-out set for the text forms, labelled from the spec and first run after the fixes for the first sets'
// wrong views (2026-11-14), each case with the Mock Provider set up for its fixture: an empty form on a yes/no column,
// an empty form followed by an amount with no name of its own, a word for empty values in a sort, a change to show only
// some columns beside other words, each form alone and beside other parts, and plain controls. With the Mock Provider
// 16 exact, 30 asked as labelled, 1 refused as labelled, no safe miss, no wrong view, of 47, after two labels were
// corrected to the spec's reading (r2-text-starts-with-and-amount: an amount after a text form takes its column as
// today; r2-just-the-advisor: "just" and a column show only that column, as today). 15 of its requests showed a wrong
// view before the code and now ask. A safe miss is reported by `pnpm eval`; a wrong view fails.
describe("text forms, second held-out set, with the Mock Provider", () => {
  const ledgerProvider = createMockProvider(mockOptionsFor({ schema: "ledger" }));
  for (const c of loadCases(new URL("./cases-text-forms-heldout-r2.jsonl", import.meta.url))) {
    it(`cases-text-forms-heldout-r2.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, c.schema === "ledger" ? ledgerProvider : provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
    });
  }
});

// A third held-out set for the text forms, labelled from the spec and the lead's rulings for a column asked for beside
// a form ("show only household where advisor is empty"), for statements that are not requests ("advisor is missing
// from my account", "every advisor is empty"), and for the question after an empty form ("the date", "the amount"),
// first run after the fixes for them (2026-11-14), each case with the Mock Provider set up for its fixture. With the
// Mock Provider 49 exact, 58 asked as labelled, 1 safe miss (r3-plain-l04 "Show category and amount only", which has
// no form and asks as it did before the code), no wrong view, of 108, after 11 labels were corrected: r3-r1-w12 and
// r3-r1-l09 name the column with "column" and the plan shows it beside the form's filter, as spec 4.2 reads them, and
// 9 plain controls said only "ready". 13 of its requests showed a wrong view before the code and now ask. A safe miss
// is reported by `pnpm eval`; a wrong view fails.
describe("text forms, third held-out set, with the Mock Provider", () => {
  const ledgerProvider = createMockProvider(mockOptionsFor({ schema: "ledger" }));
  for (const c of loadCases(new URL("./cases-text-forms-heldout-r3.jsonl", import.meta.url))) {
    it(`cases-text-forms-heldout-r3.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, c.schema === "ledger" ? ledgerProvider : provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
    });
  }
});

// Held-out sentences that hold a form and are not view requests, and held-out scripted provider picks, labelled before
// the code and first run after it (2026-11-14). Every case must match: of 25 sentences, 20 asked and 5 refused, none
// ready; of 25 picks, 25 exact, each pick the words don't name dropped. Before the code, 9 picks showed a wrong view.
describe("not requests and provider picks, held-out sets, with the Mock Provider", () => {
  const ledgerProvider = createMockProvider(mockOptionsFor({ schema: "ledger" }));
  for (const file of ["cases-not-requests-heldout.jsonl", "cases-provider-picks-heldout.jsonl"]) {
    for (const c of loadCases(new URL(`./${file}`, import.meta.url))) {
      it(`${file}: ${c.id}`, async () => {
        const result = await runCase(c, c.schema === "ledger" ? ledgerProvider : provider);
        expect(result.verdict, JSON.stringify(result.plan, null, 1)).toMatch(/^(exact|safe_abstention|rejected)$/);
      });
    }
  }
});

// House Terms (named filters spec, 5.3; ADR 0024). The dev set was labelled after the lead declared three terms on each
// schema and before the code (2026-11-14); each case runs on its schema with them declared. With the Mock Provider: 23
// exact, 12 asked as labelled, 6 safe misses, no wrong view, of 41 (2026-11-14). Before the code: 1 wrong view ("show
// large taxable accounts" filtered Taxable alone), 10 asked as labelled and 30 safe misses.
//
// The 6 safe misses are the Mock Provider's, not the reading's: each part starts with a word the Mock doesn't know (a
// term, or the plural "entries" before "needing"), so the Mock reads the part as acting on something and proposes
// nothing (`viewRequest` in `core/lead.ts`). A term is never sent to a provider, so the Mock can't know better. The term
// is still read, but the sort, the grouping and the amount's column come from the provider (spec 4.1, 4.2), and the
// part asks. Each must ask, never be ready; with a provider that proposes them, each is ready as labelled.
const MOCK_MISSES = new Set([
  "ht-large-over-5m",
  "ht-large-sorted",
  "ht-large-grouped",
  "ht-material-over-50k",
  "ht-uncoded-sorted",
  "ht-review-sorted",
]);
describe("House Terms, with the Mock Provider", () => {
  const ledgerProvider = createMockProvider(mockOptionsFor({ schema: "ledger" }));
  for (const c of loadCases(new URL("./cases-house-terms.jsonl", import.meta.url))) {
    it(`cases-house-terms.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, c.schema === "ledger" ? ledgerProvider : provider);
      const want = MOCK_MISSES.has(c.id) ? /^mismatch$/ : /^(exact|safe_abstention|rejected)$/;
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).toMatch(want);
      if (MOCK_MISSES.has(c.id)) expect(result.status).toBe("needs_clarification");
    });
  }
});

// The House Terms held-out sets, labelled before the code from the declared terms and first run after it (2026-11-14),
// each case run with its schema's terms declared and the Mock Provider set up for its fixture:
// - the form set: 55 exact, 65 asked as labelled, 3 refused as labelled, 4 safe misses, 1 wrong view
//   (h1-contain-largely: "accounts largely in taxable" filters Taxable and drops "largely", as it did before the code),
//   of 128;
// - sentences that hold a term and are not requests: 20 asked, 1 refused, none ready, of 21;
// - scripted provider picks for a term's words: 19 exact, 5 asked as labelled, of 24. Before the code, 21 showed a
//   wrong view;
// - the natural set, by a labeller who saw only the product definition, the schemas and the terms: 21 exact, 20 asked
//   as labelled, 1 refused as labelled, 13 safe misses, 1 wrong view (hn-w-largest-advisor: "which advisor has the
//   largest accounts?" sorts by Advisor, as it did before the code), of 56.
// The fix narrowed each wrong view's class to a question (order plan, D4), so these sets are regression cases now: a
// word made from a term's name in a part with no code-read filter asks, and a size word on its own sorts only a column
// that holds an amount or a date. Now the form set has 66 asked and the natural set 21, with no wrong view.
// A safe miss is reported by `pnpm eval`; a wrong view fails.
describe("House Terms, held-out sets, with the Mock Provider", () => {
  const ledgerProvider = createMockProvider(mockOptionsFor({ schema: "ledger" }));
  for (const file of [
    "cases-house-terms-heldout.jsonl",
    "cases-house-terms-not-requests-heldout.jsonl",
    "cases-house-terms-picks-heldout.jsonl",
    "cases-house-terms-natural-heldout.jsonl",
  ]) {
    for (const c of loadCases(new URL(`./${file}`, import.meta.url))) {
      it(`${file}: ${c.id}`, async () => {
        const result = await runCase(c, c.schema === "ledger" ? ledgerProvider : provider);
        expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
      });
    }
  }
});

// A second held-out set for House Terms, labelled from the declared terms and the spec and first run after the fix for
// the first sets' wrong views (2026-11-14), each case run with its schema's terms declared and the Mock Provider set up
// for its fixture: words made from a term's name ("largely", "bigly"), a size word after "which" and a column, each
// term alone and beside an amount, a term left out, in a column slot, with "or", and in sentences that are not view
// requests. With the Mock Provider: 10 exact, 29 asked as labelled, 1 refused as labelled, no safe miss, 2 wrong views
// (r2-form-largely-8: "records largely in the Travel category" filters Category to Travel and drops "largely", on the
// ledger, where no term is made from it; r2-nat-size-2: "accounts by advisor, largest first" sorts Advisor descending),
// of 42, after one label was corrected to the spec's reading (r2-term-ready-10: "just the material ones" holds only a
// row verb, small words and the term, so it filters Amount above $10,000, spec 4.2 and 5.3). Both wrong views were
// ready the same way before the code. 9 of its requests were ready before the code with a view the User didn't ask
// for, and now ask. The fix narrowed each wrong view's class to a question (order plan, D4): an adverb nothing reads
// beside what a part keeps asks about the word, with or without terms ("largely", "mostly", "roughly"), and a size or
// age word's phrase ("largest first", "newest first") sorts a column that holds no size only where the part says "sort"
// or "order" itself. Now: 10 exact, 31 asked, 1 refused, no wrong view. A safe miss is reported by `pnpm eval`; a wrong
// view fails.
describe("House Terms, second held-out set, with the Mock Provider", () => {
  const ledgerProvider = createMockProvider(mockOptionsFor({ schema: "ledger" }));
  for (const c of loadCases(new URL("./cases-house-terms-heldout-r2.jsonl", import.meta.url))) {
    it(`cases-house-terms-heldout-r2.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, c.schema === "ledger" ? ledgerProvider : provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
    });
  }
});

// A third held-out set for House Terms, labelled from the declared terms and the spec and first run after the fix for
// the second set's wrong views (2026-11-14), most cases run with their schema's terms declared and three without:
// adverbs nothing reads ("largely", "mostly", "roughly") beside a value, an amount or a term, a size word's phrase after
// "by" and a column that holds no size, each term's aliases, and a term left out, in a column slot, with "or", or in a
// sentence that is not a view request. With the Mock Provider: 7 exact, 33 asked as labelled, 1 safe miss (r3-term-1:
// "which big accounts do we have" asks about "do we", which spec 4.2 does not place), no wrong view, of 41, after 7
// labels were corrected: r3-term-1 to r3-term-6 held a predicate "type" the harness drops, and r3-term-ask-15
// ("material entries without a category") is ready with the Material filter and Category empty, as spec 5.2, 5.3 and
// 4.2 read it. 14 of its requests showed a view the User didn't ask for before the code and now ask. A safe miss is
// reported by `pnpm eval`; a wrong view fails.
describe("House Terms, third held-out set, with the Mock Provider", () => {
  const ledgerProvider = createMockProvider(mockOptionsFor({ schema: "ledger" }));
  for (const c of loadCases(new URL("./cases-house-terms-heldout-r3.jsonl", import.meta.url))) {
    it(`cases-house-terms-heldout-r3.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, c.schema === "ledger" ? ledgerProvider : provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
    });
  }
});

// Every existing set, run again on a grid without `group.set` (more grids spec, 10). A case whose expected plan groups
// or ungroups must end not applied; every other case must keep the verdict it has on the Rows Adapter. A case that
// starts grouped is left out, since a grid that can't group never holds a grouping, and so is a case with a scripted
// provider answer, written for a grid that can.
describe("every existing set on a grid without group.set, with the Mock Provider", () => {
  const dir = new URL("./", import.meta.url);
  const files = readdirSync(dir)
    .filter((name) => /^cases.*\.jsonl$/.test(name))
    .sort();
  for (const file of files) {
    for (const c of loadCases(new URL(file, dir))) {
      if (!onGridWithoutGrouping(c)) continue;
      it(`${file}: ${c.id}`, async () => {
        const result = await runWithoutGrouping(c, provider);
        expect(result?.pass, JSON.stringify({ before: result?.before.verdict, after: result?.after.plan }, null, 1)).toBe(true);
      });
    }
  }
});

describe("the verdict", () => {
  const show = { type: "columns.show", columnIds: ["custodian"] };
  const hide = { type: "columns.hide", columnIds: ["custodian"] };
  const sort = { type: "sort.set", sorts: [{ columnId: "market_value", direction: "desc" }] };
  const group = { type: "group.set", columnIds: ["advisor_name"] };
  const verdict = (got: unknown[], want: unknown[]) =>
    judge({ id: "t", utterance: "", expect: { status: "ready", operations: want } }, { operations: got } as never, "ready");

  it("ignores order between a sort and a grouping", () => {
    expect(verdict([group, sort], [sort, group])).toBe("exact");
  });

  it("keeps the order of column changes", () => {
    expect(verdict([hide, show], [show, hide])).toBe("unsafe");
  });

  it("fails only a ready plan for a case that must not be ready", () => {
    const c = { id: "t", utterance: "", expect: { mustNotBeReady: true, neverApplies: "group.set" } };
    const plan = (operations: unknown[]) => ({ operations }) as never;
    expect(judge(c, plan([]), "needs_clarification")).toBe("safe_abstention");
    expect(judge(c, plan([]), "unsupported")).toBe("rejected");
    expect(judge(c, plan([sort]), "ready")).toBe("unsafe");
    expect(judge(c, plan([group]), "ready")).toBe("unsafe");
  });

  it("moves a case that groups to a grid without group.set as one that must not be ready", () => {
    const grouped = { id: "g", utterance: "group by advisor", expect: { status: "ready" as const, operations: [group] } };
    const asked = { id: "a", utterance: "ungroup", expect: { status: "needs_clarification" as const } };
    const other = { id: "o", utterance: "sort by value", expect: { status: "ready" as const, operations: [sort] } };
    const startsGrouped = { ...other, state: { groupBy: ["advisor_name"] } };
    expect(onGridWithoutGrouping(grouped)).toEqual({
      case: { ...grouped, grid: "no-group", expect: { mustNotBeReady: true, neverApplies: "group.set" } },
      groups: true,
    });
    expect(onGridWithoutGrouping(asked)?.groups).toBe(true);
    expect(onGridWithoutGrouping(other)).toEqual({ case: { ...other, grid: "no-group" }, groups: false });
    expect(onGridWithoutGrouping(startsGrouped)).toBeUndefined();
  });
});
