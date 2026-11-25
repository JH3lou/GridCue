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
// accounts"), each the Preview it had before those rulings. The pinning and density set (`cases-view-words.jsonl`)
// joined after its code, with each case on a Rows Adapter built with its `renders`, so its Previews were recorded then,
// as the code gave them (operation set plan, Task 2.4). So were those of its held-out set
// (`cases-view-words-heldout.jsonl`, Task 2.5), the wrong view's Preview included ("pin rate and cleared to the start").
// The fix for that wrong view lists it here as asking. Its round 2 (`cases-view-words-heldout-r2.jsonl`) joined after
// that fix, so its Previews were recorded then, as the code gave them. The totals set (`cases-totals.jsonl`) joined
// with its code, each case on a Rows Adapter built with its `renders`, and its Previews were recorded then (operation
// set plan, Task 3.3). The totals wording (spec 4.5: "Show the total of Market value", where "Summarize Market value
// (sum)" was) changed no recorded line: no labelled request reached a total before it. Its three held-out sets
// (`cases-totals-heldout.jsonl`, `cases-totals-ranked-heldout.jsonl`, `cases-totals-natural-heldout.jsonl`, Task 3.5)
// joined after the code, so their Previews were recorded then, as the code gave them, the wrong view's Preview included
// ("total market value and average concentration"). The fix for that wrong view lists it here with its Preview now.
// Their round 2 (`cases-totals-heldout-r2.jsonl`) joined after that fix, so its Previews were recorded then, as the
// code gave them. The set for a Query Adapter's `without` (`cases-query-without.jsonl`) joined with its code, each case
// on a Query Adapter built with its `without`, so its Previews were recorded then, as the code gave them. So were those
// of its held-out set (`cases-query-without-heldout.jsonl`), which joined after the code.
//
// None of the changes rewords a Preview line a request had before, but for dates: spec 5.5 and section 9 reword every
// date filter's line ("Filter Opened above “2026-01-31”" is "Filter Opened after 2026-01-31"), and seven recorded
// Previews held one. They are listed below with the dates. Each other change is one of:
// - a new Preview for a request that holds a text or empty form, which asked before (spec 5.2, and section 9's lines
//   "Filter Advisor to exactly …", "Show only rows where Advisor is empty" and "… is not empty");
// - a request whose Preview showed rows the User didn't ask for, and which now reads the form or asks
//   ("accounts with no advisor over $1m" filtered Market value alone; a scripted provider's sort, grouping or column
//   change for the form's words).
//
// A later change records again (`pnpm build && pnpm eval:previews`), which folds this list into the record, and lists
// its own changes here.
/** The note under a date filter on a date-and-time column, at the fixed clock's Calendar (evals/clock.ts). */
const WHOLE_DAYS = "Whole days, in America/New_York time";
/** The same note on a schema with no Calendar, which takes the browser's time zone: the machine's, in a test. */
const WHOLE_DAYS_HERE = `Whole days, in ${new Intl.DateTimeFormat().resolvedOptions().timeZone} time`;
/** A Preview now: its lines alone when it has no notes, or its lines and notes, or `null` when it asks. */
type Now = string[] | { lines: string[]; notes: string[] } | null;
const CHANGED: Record<string, Now> = {
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
  // House Terms (named filters spec, 5.3 and 4.5). Each request says `"terms": true`; their Previews were recorded
  // before a term was read (2026-11-14), when each asked, or showed rows the User didn't ask for. A filter a term made
  // names the term in brackets, as the Host declared it, also when the User typed an alias ("big", "orphaned").
  // - "show large taxable accounts" showed Taxable alone, dropping "large";
  "cases-house-terms.jsonl: ht-large-taxable": ["Filter Market value above $1,000,000 (Large)", "Filter Registration type to Taxable"],
  // - a scripted provider's sort, grouping, column change or value for the term's own words was shown; it is dropped;
  "cases-provider-picks.jsonl: pp-ht-sort-for-large": ["Filter Market value above $1,000,000 (Large)"],
  "cases-provider-picks.jsonl: pp-ht-group-for-big": ["Filter Market value above $1,000,000 (Large)"],
  "cases-provider-picks.jsonl: pp-ht-hide-for-attention": [
    "Filter Concentration above 10% (Needs attention)",
    "Show only rows where Restricted holdings is Yes (Needs attention)",
  ],
  "cases-provider-picks.jsonl: pp-ht-value-for-unassigned": ["Show only rows where Advisor is empty (Unassigned)"],
  "cases-provider-picks.jsonl: pp-ht-sort-for-material": ["Filter Amount above $10,000 (Material)"],
  "cases-provider-picks.jsonl: pp-ht-group-for-uncoded": ["Show only rows where Category is empty (Uncoded)"],
  "cases-provider-picks.jsonl: pp-ht-value-for-needs-review": [
    "Show only rows where Cleared is No (Needs review)",
    "Filter Amount above $5,000 (Needs review)",
  ],
  "cases-provider-picks.jsonl: pp-ht-show-column-for-large": ["Filter Market value above $1,000,000 (Large)"],
  "cases-provider-picks.jsonl: pp-ht-group-extra-with-sort": [
    "Filter Market value above $1,000,000 (Large)",
    "Sort by Unrealized gain, ascending",
  ],
  // - "sort by large" with a provider that sorts by Market value: a term where a column goes asks;
  "cases-provider-picks.jsonl: pp-ht-sort-by-large": null,
  // - and each of these asked before, and now reads the term.
  "cases-house-terms.jsonl: ht-large-accounts": ["Filter Market value above $1,000,000 (Large)"],
  "cases-house-terms.jsonl: ht-big-alias": ["Filter Market value above $1,000,000 (Large)"],
  "cases-house-terms.jsonl: ht-large-bare": ["Filter Market value above $1,000,000 (Large)"],
  "cases-house-terms.jsonl: ht-big-lead-in": ["Filter Market value above $1,000,000 (Large)"],
  "cases-house-terms.jsonl: ht-needs-attention": [
    "Filter Concentration above 10% (Needs attention)",
    "Show only rows where Restricted holdings is Yes (Needs attention)",
  ],
  "cases-house-terms.jsonl: ht-needing-attention": [
    "Filter Concentration above 10% (Needs attention)",
    "Show only rows where Restricted holdings is Yes (Needs attention)",
  ],
  "cases-house-terms.jsonl: ht-needs-attention-label": [
    "Filter Concentration above 10% (Needs attention)",
    "Show only rows where Restricted holdings is Yes (Needs attention)",
  ],
  "cases-house-terms.jsonl: ht-unassigned": ["Show only rows where Advisor is empty (Unassigned)"],
  "cases-house-terms.jsonl: ht-orphaned-alias": ["Show only rows where Advisor is empty (Unassigned)"],
  "cases-house-terms.jsonl: ht-big-hide-column": ["Filter Market value above $1,000,000 (Large)", "Hide Custodian"],
  "cases-house-terms.jsonl: ht-two-terms": [
    "Filter Market value above $1,000,000 (Large)",
    "Filter Concentration above 10% (Needs attention)",
    "Show only rows where Restricted holdings is Yes (Needs attention)",
  ],
  "cases-house-terms.jsonl: ht-two-terms-comma": [
    "Show only rows where Advisor is empty (Unassigned)",
    "Filter Market value above $1,000,000 (Large)",
  ],
  "cases-house-terms.jsonl: ht-material-entries": ["Filter Amount above $10,000 (Material)"],
  "cases-house-terms.jsonl: ht-sizeable-alias": ["Filter Amount above $10,000 (Material)"],
  "cases-house-terms.jsonl: ht-needs-review": [
    "Show only rows where Cleared is No (Needs review)",
    "Filter Amount above $5,000 (Needs review)",
  ],
  "cases-house-terms.jsonl: ht-needing-review": [
    "Show only rows where Cleared is No (Needs review)",
    "Filter Amount above $5,000 (Needs review)",
  ],
  "cases-house-terms.jsonl: ht-uncoded": ["Show only rows where Category is empty (Uncoded)"],
  "cases-house-terms.jsonl: ht-uncategorised-alias": ["Show only rows where Category is empty (Uncoded)"],
  "cases-house-terms.jsonl: ht-material-fees": ["Filter Amount above $10,000 (Material)", "Filter Category to Fees"],
  "cases-house-terms.jsonl: ht-material-grouped": ["Filter Amount above $10,000 (Material)", "Group by Owner"],
  "cases-house-terms.jsonl: ht-hide-rate-show-material": ["Hide Rate", "Filter Amount above $10,000 (Material)"],
  "cases-house-terms.jsonl: ht-uncoded-needs-review": [
    "Show only rows where Category is empty (Uncoded)",
    "Show only rows where Cleared is No (Needs review)",
    "Filter Amount above $5,000 (Needs review)",
  ],
  // The two wrong views of the House Terms held-out run, each narrowed to a question as a class (order plan, D4), and
  // each ready the same way before the terms: a word made from a term's name ("largely") in a part with no code-read
  // filter, and a size word on its own giving its direction to a column that holds no amounts.
  "cases-house-terms-heldout.jsonl: h1-contain-largely": null,
  "cases-house-terms-natural-heldout.jsonl: hn-w-largest-advisor": null,
  // The two wrong views of the second held-out run, each ready the same way before the terms, and each narrowed to a
  // question as a class: an adverb nothing reads beside what a part keeps ("records largely in the Travel category"),
  // whatever the terms are named, and a size word's phrase giving its direction to a column that holds no size where
  // nothing says to sort ("accounts by advisor, largest first").
  "cases-house-terms-heldout-r2.jsonl: r2-form-largely-8": null,
  "cases-house-terms-heldout-r2.jsonl: r2-nat-size-2": null,
  // Local Values (named filters spec, 5.4, and section 9's "Filter Advisor to exactly “Avery Lane”"). Each request says
  // `"values": true`; their Previews were recorded before a value was read (2026-11-14), when each asked, or showed
  // rows the User didn't ask for. A value's filter shows it as the grid holds it, in its own letter case, and several
  // values of one column are one line, "to any of".
  // - a name was dropped beside another reading, which was shown alone ("show taxable accounts for Avery Lane"), or read
  //   as a sort's second column ("sort by market value for the Alder household");
  "cases-names.jsonl: lv-middle": ["Filter Advisor to exactly “Dana Whitfield”", "Filter Registration type to Taxable"],
  "cases-names.jsonl: lv-end": ["Filter Registration type to Taxable", "Filter Advisor to exactly “Emerson Hale”"],
  "cases-names.jsonl: lv-table-taxable-for": ["Filter Registration type to Taxable", "Filter Advisor to exactly “Avery Lane”"],
  "cases-names.jsonl: lv-table-sort-for": ["Filter Household to exactly “Alder Household”", "Sort by Market value, ascending"],
  "cases-names.jsonl: lv-table-group-for": ["Filter Advisor to exactly “Avery Lane”", "Group by Advisor"],
  "cases-names.jsonl: lv-ledger-cleared-yes": ["Show only rows where Cleared is Yes", "Filter Owner to exactly “Casey Ortiz”"],
  "cases-names.jsonl: lv-ledger-sorted": ["Filter Owner to exactly “Dana Whitfield”", "Sort by Amount, descending"],
  "cases-names.jsonl: lv-ledger-group": ["Filter Owner to exactly “Emerson Hale”", "Group by Category"],
  // - one word of a value was dropped beside another reading ("taxable accounts for Lane"); it now asks which was meant;
  "cases-names.jsonl: lv-one-word-taxable-for-lane": null,
  // - a scripted provider's sort, grouping, column change or value for the name's own words was shown; it is dropped;
  "cases-provider-picks.jsonl: pp-lv-sort-for-name": ["Filter Advisor to exactly “Avery Lane”"],
  "cases-provider-picks.jsonl: pp-lv-group-for-name": ["Filter Advisor to exactly “Blake Moreno”"],
  "cases-provider-picks.jsonl: pp-lv-value-for-household": ["Filter Household to exactly “Alder Household”"],
  "cases-provider-picks.jsonl: pp-lv-hide-for-name": ["Filter Advisor to exactly “Casey Ortiz”"],
  "cases-provider-picks.jsonl: pp-lv-show-for-name": ["Filter Advisor to exactly “Emerson Hale”"],
  "cases-provider-picks.jsonl: pp-lv-sort-for-name-with-group": ["Filter Advisor to exactly “Avery Lane”", "Group by Custodian"],
  "cases-provider-picks.jsonl: pp-lv-value-beside-name-taxable": [
    "Filter Registration type to Taxable",
    "Filter Advisor to exactly “Avery Lane”",
  ],
  "cases-provider-picks.jsonl: pp-lv-ledger-sort-for-owner": ["Filter Owner to exactly “Gale Ivers”"],
  "cases-provider-picks.jsonl: pp-lv-ledger-value-for-counterparty": ["Filter Counterparty to exactly “Cedar Works”"],
  "cases-provider-picks.jsonl: pp-lv-ledger-group-for-list": ["Filter Owner to any of “Avery Lane” and “Gale Ivers”"],
  // - and each of these asked before, and now reads the value.
  "cases-names.jsonl: lv-possessive": ["Filter Advisor to exactly “Avery Lane”"],
  "cases-names.jsonl: lv-for": ["Filter Advisor to exactly “Avery Lane”"],
  "cases-names.jsonl: lv-is": ["Filter Advisor to exactly “Avery Lane”"],
  "cases-names.jsonl: lv-household": ["Filter Household to exactly “Alder Household”"],
  "cases-names.jsonl: lv-household-show": ["Filter Household to exactly “Birch Household”"],
  "cases-names.jsonl: lv-household-of": ["Filter Household to exactly “Cedar Household”"],
  "cases-names.jsonl: lv-or": ["Filter Advisor to any of “Avery Lane” and “Blake Moreno”"],
  "cases-names.jsonl: lv-or-three-commas": ["Filter Advisor to any of “Avery Lane”, “Blake Moreno” and “Casey Ortiz”"],
  "cases-names.jsonl: lv-or-households": ["Filter Household to any of “Alder Household” and “Birch Household”"],
  "cases-names.jsonl: lv-and-list": ["Filter Advisor to any of “Avery Lane” and “Blake Moreno”"],
  "cases-names.jsonl: lv-start": ["Filter Advisor to exactly “Casey Ortiz”"],
  "cases-names.jsonl: lv-case-lower": ["Filter Advisor to exactly “Avery Lane”"],
  "cases-names.jsonl: lv-case-upper": ["Filter Advisor to exactly “Blake Moreno”"],
  "cases-names.jsonl: lv-trailing-period": ["Filter Advisor to exactly “Casey Ortiz”"],
  "cases-names.jsonl: lv-comma-before-filter": ["Filter Advisor to exactly “Dana Whitfield”", "Filter Registration type to Taxable"],
  "cases-names.jsonl: lv-beside-hide": ["Filter Advisor to exactly “Avery Lane”", "Hide Custodian"],
  "cases-names.jsonl: lv-beside-two-filters": [
    "Filter Advisor to exactly “Casey Ortiz”",
    "Filter Registration type to IRA",
    "Filter Concentration above 10%",
  ],
  "cases-names.jsonl: lv-quoted-beside": ["Filter Advisor to exactly “Avery Lane”", "Filter Household containing “alder”"],
  "cases-names.jsonl: lv-ledger-owner-is": ["Filter Owner to exactly “Avery Lane”"],
  "cases-names.jsonl: lv-ledger-for": ["Filter Owner to exactly “Gale Ivers”"],
  "cases-names.jsonl: lv-ledger-possessive": ["Filter Owner to exactly “Frankie Dunmore”"],
  "cases-names.jsonl: lv-ledger-ampersand": ["Filter Counterparty to exactly “Birch & Fenn Ltd”"],
  "cases-names.jsonl: lv-ledger-no-ampersand": ["Filter Counterparty to exactly “Birch & Fenn Ltd”"],
  "cases-names.jsonl: lv-ledger-show": ["Filter Counterparty to exactly “Alder Supply Co”"],
  "cases-names.jsonl: lv-ledger-longest-travel": ["Filter Counterparty to exactly “Hollis Travel Group”"],
  "cases-names.jsonl: lv-ledger-or-owners": ["Filter Owner to any of “Avery Lane” and “Gale Ivers”"],
  "cases-names.jsonl: lv-ledger-or-counterparties": ["Filter Counterparty to any of “Cedar Works” and “Ellery Partners”"],
  // The five wrong views of the Local Values held-out run, each narrowed to a question as a class, and the one ready
  // case that the same class now asks about (it accepts a question). Their Previews were recorded as the code gave them.
  // - a value beside another filter on its column that no row can match with it ("with no advisor", a starts-with form):
  //   filters on one text column that can't all hold ask, with values or without, also beside a filter the view keeps;
  // - two values of one column apart from each other, not one list: they ask;
  // - values of two columns listed with "and" or a comma: rows with both, or with either, so they ask;
  // - a word built on "group" that the part doesn't group by ("Travel Group entries"): it asks, with values or without.
  "cases-names-heldout-wealth.jsonl: lv1-conflict-no-advisor": null,
  "cases-names-heldout-wealth.jsonl: lv1-conflict-starts-with": null,
  "cases-names-heldout-wealth.jsonl: lv1-conflict-two-advisors": null,
  "cases-names-heldout-wealth.jsonl: lv1-mixed-columns-and": null,
  "cases-names-heldout-ledger.jsonl: lvl1-owner-and-cp": null,
  "cases-names-heldout-ledger.jsonl: lvl1-two-words-category-and-group": null,
  // Dates (named filters spec, 5.5, and section 9). A filter on a date or date-and-time column reads "after", "on or
  // after", "before", "on or before", "on" or "from … to …", with no quote marks. A relative form's words follow its
  // dates in brackets, and a day on a date-and-time column adds the note "Whole days, in America/New_York time". Their
  // Previews were recorded before a date form was read (2026-11-14), when each asked, or showed rows the User didn't ask
  // for. The date cases run at the fixed clock (evals/clock.ts).
  // - the old wording of a date filter, "above “2026-01-31”", "below …" and "to …", in seven Previews;
  "cases-dates.jsonl: dt-value-then-iso-after": ["Filter Category to Travel", "Filter Booked after 2026-01-31"],
  "cases-house-terms-heldout.jsonl: h1-mat-booked-after": ["Filter Amount above $10,000 (Material)", "Filter Booked after 2026-01-31"],
  "cases-named-fixes-heldout.jsonl: h1-date-ctl-gt": ["Filter Opened after 2026-01-31"],
  "cases-named-fixes-heldout.jsonl: h1-date-ctl-lt": ["Filter Close date before 2025-02-28"],
  "cases-named-fixes-heldout.jsonl: h1-date-ctl-leap": ["Filter Opened on 2024-02-29"],
  "cases-names-heldout-ledger.jsonl: lvl1-with-iso-date": ["Filter Owner to exactly “Casey Ortiz”", "Filter Booked after 2026-03-01"],
  "cases-text-forms.jsonl: tf-beside-date-after-form-ledger": [
    "Filter Booked after 2026-01-01",
    "Show only rows where Counterparty is empty",
  ],
  // - a time word dropped beside a value ("travel entries since january" showed Travel alone); it now asks;
  "cases-dates.jsonl: dt-ask-since-january": null,
  // - a scripted provider's sort, grouping or column change for a date form's own words was shown; it is dropped;
  "cases-provider-picks.jsonl: pp-dt-sort-for-quarter": ["Filter Booked from 2026-10-01 to 2026-12-31 (this quarter)"],
  "cases-provider-picks.jsonl: pp-dt-group-for-ytd": ["Filter Booked from 2026-01-01 to 2026-11-13 (YTD)"],
  "cases-provider-picks.jsonl: pp-dt-hide-for-last-quarter": ["Filter Booked from 2026-07-01 to 2026-09-30 (last quarter)"],
  "cases-provider-picks.jsonl: pp-dt-sort-for-today": ["Filter Booked on 2026-11-13 (today)"],
  "cases-provider-picks.jsonl: pp-dt-show-for-ytd": ["Filter Booked from 2026-01-01 to 2026-11-13 (year to date)"],
  // - and each of these asked before, and now reads the date.
  "cases-provider-picks.jsonl: pp-dt-value-for-90-days": ["Filter Booked from 2026-08-15 to 2026-11-13 (last 90 days)"],
  "cases-provider-picks.jsonl: pp-dt-other-value-for-travel": [
    "Filter Category to Travel",
    "Filter Booked from 2026-10-01 to 2026-10-31 (last month)",
  ],
  "cases-provider-picks.jsonl: pp-dt-other-date-column": {
    lines: ["Filter Posted at from 2026-11-01 to 2026-11-30 (this month)"],
    notes: [WHOLE_DAYS],
  },
  "cases-provider-picks.jsonl: pp-dt-sort-for-range": ["Filter Booked from 2026-01-01 to 2026-03-31"],
  "cases-provider-picks.jsonl: pp-dt-own-sort-kept": [
    "Filter Booked from 2026-10-14 to 2026-11-13 (last 30 days)",
    "Sort by Amount, descending",
  ],
  "cases-dates.jsonl: dt-today": ["Filter Booked on 2026-11-13 (today)"],
  "cases-dates.jsonl: dt-yesterday": ["Filter Booked on 2026-11-12 (yesterday)"],
  "cases-dates.jsonl: dt-last-90-days": ["Filter Booked from 2026-08-15 to 2026-11-13 (last 90 days)"],
  "cases-dates.jsonl: dt-past-30-days": ["Filter Booked from 2026-10-14 to 2026-11-13 (past 30 days)"],
  "cases-dates.jsonl: dt-during-last-7-days": ["Filter Booked from 2026-11-06 to 2026-11-13 (last 7 days)"],
  "cases-dates.jsonl: dt-within-2-weeks": ["Filter Booked from 2026-10-30 to 2026-11-13 (past 2 weeks)"],
  "cases-dates.jsonl: dt-for-the-6-months": ["Filter Booked from 2026-05-13 to 2026-11-13 (last 6 months)"],
  "cases-dates.jsonl: dt-over-the-3-months": ["Filter Booked from 2026-08-13 to 2026-11-13 (last 3 months)"],
  "cases-dates.jsonl: dt-past-2-years": ["Filter Booked from 2024-11-13 to 2026-11-13 (past 2 years)"],
  "cases-dates.jsonl: dt-last-12-weeks": ["Filter Booked from 2026-08-21 to 2026-11-13 (last 12 weeks)"],
  "cases-dates.jsonl: dt-this-month": ["Filter Booked from 2026-11-01 to 2026-11-30 (this month)"],
  "cases-dates.jsonl: dt-last-month": ["Filter Booked from 2026-10-01 to 2026-10-31 (last month)"],
  "cases-dates.jsonl: dt-noun-this-quarter": ["Filter Booked from 2026-10-01 to 2026-12-31 (this quarter)"],
  "cases-dates.jsonl: dt-last-quarter": ["Filter Booked from 2026-07-01 to 2026-09-30 (last quarter)"],
  "cases-dates.jsonl: dt-this-year": ["Filter Booked from 2026-01-01 to 2026-12-31 (this year)"],
  "cases-dates.jsonl: dt-last-year": ["Filter Booked from 2025-01-01 to 2025-12-31 (last year)"],
  "cases-dates.jsonl: dt-month-to-date": ["Filter Booked from 2026-11-01 to 2026-11-13 (month to date)"],
  "cases-dates.jsonl: dt-quarter-to-date": ["Filter Booked from 2026-10-01 to 2026-11-13 (quarter to date)"],
  "cases-dates.jsonl: dt-year-to-date": ["Filter Booked from 2026-01-01 to 2026-11-13 (year to date)"],
  "cases-dates.jsonl: dt-mtd": ["Filter Booked from 2026-11-01 to 2026-11-13 (MTD)"],
  "cases-dates.jsonl: dt-qtd": ["Filter Booked from 2026-10-01 to 2026-11-13 (QTD)"],
  "cases-dates.jsonl: dt-ytd": ["Filter Booked from 2026-01-01 to 2026-11-13 (YTD)"],
  "cases-dates.jsonl: dt-between-iso": ["Filter Booked from 2026-01-01 to 2026-03-31"],
  "cases-dates.jsonl: dt-between-iso-reversed": ["Filter Booked from 2026-01-01 to 2026-03-31"],
  "cases-dates.jsonl: dt-from-to-iso": ["Filter Booked from 2026-02-01 to 2026-02-28"],
  "cases-dates.jsonl: dt-from-through-iso-reversed": ["Filter Booked from 2026-02-01 to 2026-02-28"],
  "cases-dates.jsonl: dt-iso-after": ["Filter Booked after 2026-01-31"],
  "cases-dates.jsonl: dt-iso-before": ["Filter Booked before 2026-06-30"],
  "cases-dates.jsonl: dt-value-then-30-days": ["Filter Category to Travel", "Filter Booked from 2026-10-14 to 2026-11-13 (last 30 days)"],
  "cases-dates.jsonl: dt-value-then-quarter": ["Filter Category to Fees", "Filter Booked from 2026-10-01 to 2026-12-31 (this quarter)"],
  "cases-dates.jsonl: dt-beside-amount": ["Filter Amount above $1,000,000", "Filter Booked from 2026-10-01 to 2026-12-31 (this quarter)"],
  "cases-dates.jsonl: dt-posted-today": { lines: ["Filter Posted at on 2026-11-13 (today)"], notes: [WHOLE_DAYS] },
  "cases-dates.jsonl: dt-posted-30-days": { lines: ["Filter Posted at from 2026-10-14 to 2026-11-13 (last 30 days)"], notes: [WHOLE_DAYS] },
  "cases-dates.jsonl: dt-posted-this-quarter": {
    lines: ["Filter Posted at from 2026-10-01 to 2026-12-31 (this quarter)"],
    notes: [WHOLE_DAYS],
  },
  "cases-dates.jsonl: dt-posted-ytd": { lines: ["Filter Posted at from 2026-01-01 to 2026-11-13 (YTD)"], notes: [WHOLE_DAYS] },
  "cases-dates.jsonl: dt-posted-after": { lines: ["Filter Posted at after 2026-01-31"], notes: [WHOLE_DAYS] },
  "cases-dates.jsonl: dt-posted-value-last-month": {
    lines: ["Filter Category to Travel", "Filter Posted at from 2026-10-01 to 2026-10-31 (last month)"],
    notes: [WHOLE_DAYS],
  },
  "cases-dates.jsonl: dt-during-quarter": ["Filter Booked from 2026-10-01 to 2026-12-31 (this quarter)"],
  "cases-dates.jsonl: dt-in-last-quarter": ["Filter Booked from 2026-07-01 to 2026-09-30 (last quarter)"],
  // - a date on a date-and-time column asked, "Last contact holds times of day, so GridCue can't filter it by date
  //   yet.", until whole days gave it one meaning; it now reads. The "dated" schema sets no Calendar, so the note names
  //   the browser's time zone.
  "cases-named-fixes.jsonl: nf-dt-after": { lines: ["Filter Last contact after 2026-01-31"], notes: [WHOLE_DAYS_HERE] },
  "cases-named-fixes.jsonl: nf-dt-before": { lines: ["Filter Last contact before 2026-01-31"], notes: [WHOLE_DAYS_HERE] },
  "cases-named-fixes.jsonl: nf-dt-on": { lines: ["Filter Last contact on 2026-01-31"], notes: [WHOLE_DAYS_HERE] },
  "cases-named-fixes.jsonl: nf-dt-since": { lines: ["Filter Last contact on or after 2025-10-01"], notes: [WHOLE_DAYS_HERE] },
  "cases-named-fixes-heldout.jsonl: h1-dt-after": { lines: ["Filter Last contact after 2026-03-15"], notes: [WHOLE_DAYS_HERE] },
  "cases-named-fixes-heldout.jsonl: h1-dt-before": { lines: ["Filter Last contact before 2026-03-15"], notes: [WHOLE_DAYS_HERE] },
  "cases-named-fixes-heldout.jsonl: h1-dt-on": { lines: ["Filter Last contact on 2026-03-15"], notes: [WHOLE_DAYS_HERE] },
  "cases-named-fixes-heldout.jsonl: h1-dt-or-after": {
    lines: ["Filter Last contact on or after 2025-12-01"],
    notes: [WHOLE_DAYS_HERE],
  },
  "cases-named-fixes-heldout.jsonl: h1-dt-is": { lines: ["Filter Last contact on 2026-04-02"], notes: [WHOLE_DAYS_HERE] },
  // A pin list cut where the request splits before a column's name ("cleared" reads as the verb "clear") pinned the
  // first column alone and filtered the rows by the second; it now asks (operation set spec, 5.2).
  "cases-view-words-heldout.jsonl: hp1-ledger-pin-rate-cleared": null,
  // The wrong view of the totals held-out run: two totals forms in one request gave one `aggregation.set` each. The plan
  // now carries the whole list in one (operation set spec, 5.4), so its one line names both totals.
  "cases-totals-natural-heldout.jsonl: nat-two-totals": ["Show the total of Market value and the average of Concentration"],
};

/** A listed Preview as `previewOf` gives it. */
const asPreview = (now: Now) => (now === null ? null : Array.isArray(now) ? { lines: now, notes: [] } : now);

describe("the Preview of every labelled request", () => {
  const recorded = loadPreviews();
  for (const { file, id, case: c } of labelledRequests()) {
    const key = `${file}: ${id}`;
    it(key, async () => {
      const want = key in CHANGED ? asPreview(CHANGED[key] ?? null) : (recorded.get(key) ?? null);
      expect(await previewOf(c)).toEqual(want);
    });
  }

  it("lists only changes: each listed Preview differs from the record", () => {
    for (const [key, now] of Object.entries(CHANGED)) {
      expect(JSON.stringify(recorded.get(key) ?? null), key).not.toBe(JSON.stringify(asPreview(now)));
    }
  });
});
