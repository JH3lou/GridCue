import { generateLedger } from "@gridcue-internal/ledger-fixtures";
import { generateAccounts } from "@gridcue-internal/wealth-fixtures";

/**
 * The Local Values the eval schemas read (named filters spec, 5.4), set by the lead before any case was labelled. A
 * case with `"values": true` runs on its schema with these. Each column's values are the ones its fixture's rows hold:
 * `generateAccounts()` and `generateLedger()`, with their default count and seed. They live here, not in the fixtures,
 * so no other case reads them.
 *
 * The shape is the `localValues` option's: one function for each column, returning that column's values. Each function
 * returns the same array every time, as a Host's should when its rows haven't changed, so GridCue can keep its index.
 * The values are row data: they are never sent to an Intent Provider (spec 4.3).
 */
export type EvalLocalValues = Record<string, () => ReadonlyArray<string | null>>;

/** One column's values, read once from the rows and then returned as the same array. */
const column = <Row>(rows: () => readonly Row[], read: (row: Row) => string | null) => {
  let values: ReadonlyArray<string | null> | undefined;
  return () => {
    values ??= rows().map(read);
    return values;
  };
};

let accounts: ReturnType<typeof generateAccounts> | undefined;
const accountRows = () => {
  accounts ??= generateAccounts();
  return accounts;
};
let entries: ReturnType<typeof generateLedger> | undefined;
const ledgerRows = () => {
  entries ??= generateLedger();
  return entries;
};

/** The wealth fixture's name columns: Advisor and Household. */
export const wealthLocalValues: EvalLocalValues = {
  advisor_name: column(accountRows, (row) => row.advisor_name),
  household: column(accountRows, (row) => row.household),
};

/** The ledger fixture's name columns: Owner and Counterparty. Counterparty is sometimes empty. */
export const ledgerLocalValues: EvalLocalValues = {
  owner: column(ledgerRows, (row) => row.owner),
  counterparty: column(ledgerRows, (row) => row.counterparty),
};
