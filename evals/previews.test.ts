import { describe, expect, it } from "vitest";
import { labelledRequests } from "./payloads";
import { loadPreviews, previewOf } from "./previews";

// The Preview pin (named filters plan, Task 2.4). `previews.jsonl` holds the Preview every labelled request led to with
// the Mock Provider before the text forms were read (2026-11-14), recorded from the source as it was then. `CHANGED`
// lists each request whose Preview the text forms changed, with its Preview now, so the pull request can say what
// changed line by line. `null` means the request has no Preview now: it asks. The four held-out sets for the text forms
// joined after the code, so their Previews were recorded then, as the code gave them, the four wrong views' Previews
// included; the fix for those four lists them here as asking. So were the Previews of the ten controls that joined
// `cases-text-forms.jsonl` with the fix for a column asked for beside a form ("households with no advisor"), and of
// the three that joined it with the review's next fixes ("show every household with no advisor", "my restricted
// accounts with no advisor", "my settled entries with no vendor"), and of the ten ready controls that joined it with the
// lead's rulings on statements around a form ("accounts whose advisor is empty", "advisor is empty for taxable
// accounts"), each the Preview it had before those rulings.
//
// None of the changes rewords a Preview line a request had before. Each is one of:
// - a new Preview for a request that holds a text or empty form, which asked before (spec 5.2, and section 9's lines
//   "Filter Advisor to exactly …", "Show only rows where Advisor is empty" and "… is not empty");
// - a request whose Preview showed rows the User didn't ask for, and which now reads the form or asks
//   ("accounts with no advisor over $1m" filtered Market value alone; a scripted provider's sort, grouping or column
//   change for the form's words).
//
// A later change records again (`pnpm build && pnpm eval:previews`), which folds this list into the record, and lists
// its own changes here.
const CHANGED: Record<string, string[] | null> = {
  "cases-provider-picks.jsonl: pp-sort-for-no-advisor": ["Show only rows where Advisor is empty"],
  "cases-provider-picks.jsonl: pp-group-for-have-advisor": ["Show only rows where Advisor is not empty"],
  "cases-provider-picks.jsonl: pp-only-for-is-empty": ["Show only rows where Advisor is empty"],
  "cases-provider-picks.jsonl: pp-sort-for-not-empty": ["Show only rows where Advisor is not empty"],
  "cases-provider-picks.jsonl: pp-sort-for-counterparty-empty": ["Show only rows where Counterparty is empty"],
  "cases-provider-picks.jsonl: pp-hide-for-booked-blank": ["Show only rows where Booked is empty"],
  "cases-provider-picks.jsonl: pp-amount-after-empty": null,
  "cases-provider-picks.jsonl: pp-pin-beside-empty": null,
  "cases-text-forms.jsonl: tf-spec-empty-then-amount": null,
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-08": ["Filter Advisor starting with “av”"],
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-09": ["Filter Household starting with “alder”"],
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-11": ["Filter Advisor to exactly “avery lane”"],
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-12": ["Filter Household to exactly “cedar household”"],
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-13": ["Filter Advisor to exactly “moreno”"],
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-14": ["Filter Advisor to exactly “ortiz”"],
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-27": ["Filter Custodian to Northgate", "Filter Advisor starting with “mo”"],
  "cases-named-fixes-heldout.jsonl: h1-form-starts": ["Filter Advisor starting with “qu”"],
  "cases-named-fixes-heldout.jsonl: h1-form-exactly": ["Filter Advisor to exactly “mara quinn”"],
  "cases-named-fixes-heldout.jsonl: h1-form-equals-sign": ["Filter Advisor to exactly “mara quinn”"],
  "cases-named-fixes-heldout.jsonl: h1-form-household-starts": ["Filter Household starting with “ha”"],
  "cases-named-fixes-heldout.jsonl: h1-form-begins": ["Filter Advisor starting with “qu”"],
  "cases-named-fixes-heldout.jsonl: h1-form-equals-word": ["Filter Household to exactly “hale”"],
  "cases-named-fixes.jsonl: nf-form-starts-with": ["Filter Advisor starting with “av”"],
  "cases-named-fixes.jsonl: nf-form-exactly": ["Filter Advisor to exactly “avery lane”"],
  "cases-named-fixes.jsonl: nf-form-equals": ["Filter Advisor to exactly “avery lane”"],
  "cases-named-fixes.jsonl: nf-form-household-starts": ["Filter Household starting with “hale”"],
  "cases-named-fixes.jsonl: nf-form-account-starts": ["Filter Account number starting with “ac-1”"],
  "cases-named-fixes.jsonl: nf-form-begins": ["Filter Advisor starting with “av”"],
  "cases-named-fixes.jsonl: nf-form-sentence": ["Filter Market value above $1,000,000", "Filter Advisor starting with “av”"],
  "cases-provider-picks.jsonl: pp-sort-for-starts-with": ["Filter Advisor starting with “av”"],
  "cases-provider-picks.jsonl: pp-value-for-exactly": ["Filter Advisor to exactly “casey ortiz”"],
  "cases-provider-picks.jsonl: pp-hide-for-begins-with": ["Filter Household starting with “alder”"],
  "cases-provider-picks.jsonl: pp-other-column-for-no-advisor": ["Show only rows where Advisor is empty"],
  "cases-provider-picks.jsonl: pp-extra-column-for-starts-with": ["Filter Advisor starting with “av”"],
  "cases-provider-picks.jsonl: pp-value-for-trust-no-advisor": [
    "Filter Registration type to Trust",
    "Show only rows where Advisor is empty",
  ],
  "cases-provider-picks.jsonl: pp-boolean-for-having-assigned": ["Show only rows where Advisor is not empty"],
  "cases-provider-picks.jsonl: pp-group-for-owner-starts": ["Filter Owner starting with “av”"],
  "cases-text-forms.jsonl: tf-starts-with": ["Filter Advisor starting with “av”"],
  "cases-text-forms.jsonl: tf-starting-with-ledger": ["Filter Counterparty starting with “cedar”"],
  "cases-text-forms.jsonl: tf-begins-with": ["Filter Advisor starting with “bl”"],
  "cases-text-forms.jsonl: tf-beginning-with-ledger": ["Filter Owner starting with “bl”"],
  "cases-text-forms.jsonl: tf-is-exactly": ["Filter Advisor to exactly “avery lane”"],
  "cases-text-forms.jsonl: tf-exactly": ["Filter Advisor to exactly “avery lane”"],
  "cases-text-forms.jsonl: tf-equals-sign": ["Filter Advisor to exactly “avery lane”"],
  "cases-text-forms.jsonl: tf-equals": ["Filter Advisor to exactly “casey ortiz”"],
  "cases-text-forms.jsonl: tf-equal-to-ledger": ["Filter Counterparty to exactly “cedar works”"],
  "cases-text-forms.jsonl: tf-is-empty": ["Show only rows where Advisor is empty"],
  "cases-text-forms.jsonl: tf-is-blank": ["Show only rows where Advisor is empty"],
  "cases-text-forms.jsonl: tf-is-missing-ledger-date": ["Show only rows where Booked is empty"],
  "cases-text-forms.jsonl: tf-no-advisor": ["Show only rows where Advisor is empty"],
  "cases-text-forms.jsonl: tf-with-no-advisor": ["Show only rows where Advisor is empty"],
  "cases-text-forms.jsonl: tf-without-advisor": ["Show only rows where Advisor is empty"],
  "cases-text-forms.jsonl: tf-without-a-ledger": ["Show only rows where Counterparty is empty"],
  "cases-text-forms.jsonl: tf-without-any-assigned": ["Show only rows where Advisor is empty"],
  "cases-text-forms.jsonl: tf-no-advisor-set": ["Show only rows where Advisor is empty"],
  "cases-text-forms.jsonl: tf-is-not-empty": ["Show only rows where Advisor is not empty"],
  "cases-text-forms.jsonl: tf-isnt-empty": ["Show only rows where Advisor is not empty"],
  "cases-text-forms.jsonl: tf-is-not-blank-ledger-datetime": ["Show only rows where Posted at is not empty"],
  "cases-text-forms.jsonl: tf-have-an-advisor": ["Show only rows where Advisor is not empty"],
  "cases-text-forms.jsonl: tf-having-assigned": ["Show only rows where Advisor is not empty"],
  "cases-text-forms.jsonl: tf-has-category-set-ledger": ["Show only rows where Category is not empty"],
  "cases-text-forms.jsonl: tf-beside-amount": ["Filter Market value above $1,000,000", "Filter Advisor starting with “av”"],
  "cases-text-forms.jsonl: tf-beside-enum-taxable-no-advisor": [
    "Filter Registration type to Taxable",
    "Show only rows where Advisor is empty",
  ],
  "cases-text-forms.jsonl: tf-beside-enum-exactly": ["Filter Registration type to Trust", "Filter Advisor to exactly “casey ortiz”"],
  "cases-text-forms.jsonl: tf-beside-enum-has-ledger": ["Filter Category to Services", "Show only rows where Counterparty is not empty"],
  // The four wrong views of the held-out run, each narrowed to a question as a class: an empty form after a yes/no
  // column; an amount after an empty form with no name of its own, past "and"; a word for empty values in a sort; and
  // a change to show only some columns that would drop the part's other words.
  "cases-text-forms-heldout.jsonl: h2f-54": null,
  "cases-text-forms-heldout.jsonl: h2f-59": null,
  "cases-text-forms-natural-heldout.jsonl: n1-led-ambig-blanks-last": null,
  "cases-text-forms-natural-heldout.jsonl: n1-wea-advisor-exact": null,
};

describe("the Preview of every labelled request", () => {
  const recorded = loadPreviews();
  for (const { file, id, case: c } of labelledRequests()) {
    const key = `${file}: ${id}`;
    it(key, async () => {
      const changed = CHANGED[key];
      const want = key in CHANGED ? (changed ? { lines: changed, notes: [] } : null) : (recorded.get(key) ?? null);
      expect(await previewOf(c)).toEqual(want);
    });
  }

  it("lists only changes: each listed Preview differs from the record", () => {
    for (const [key, lines] of Object.entries(CHANGED)) {
      expect(JSON.stringify(recorded.get(key) ?? null), key).not.toBe(JSON.stringify(lines ? { lines, notes: [] } : null));
    }
  });
});
