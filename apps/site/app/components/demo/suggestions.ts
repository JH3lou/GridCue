import type { Suggestion } from "@/components/demo/ask-bar";

// Each is checked against the Mock Provider (Site spec §5.2) by `test/suggestions.test.ts`: filter, sort, group, show
// and hide, several changes in one part, nesting, a House Term, an exclusion, a value group, a question back, and a
// refusal.
export const SUGGESTIONS: Suggestion[] = [
  { label: "Taxable accounts over $1M, sort by concentration, highest first" },
  { label: "Roth IRAs grouped by rep" },
  { label: "Group by custodian, then by advisor" },
  { label: "Retirement accounts grouped by advisor" },
  { label: "Large taxable accounts" },
  { label: "Show IRAs at Northgate" },
  { label: "Excluding trusts" },
  { label: "Accounts with restricted holdings" },
  { label: "Hide custodian and account number" },
  { label: "Largest households first" },
  { label: "Sell anything over 10%", refusal: true },
];
