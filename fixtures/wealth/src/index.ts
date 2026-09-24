import { type ColumnInput, defineSchema, emptyViewState, type SchemaOptions } from "gridcue";

/** One synthetic advisory account. Every value is generated; none is real client data. */
export interface AccountRow {
  account_number: string;
  household: string;
  advisor_name: string;
  registration_type: "taxable" | "ira" | "roth_ira" | "trust";
  custodian: "northgate" | "harborline" | "summit_trust";
  market_value: number;
  concentration: number;
  unrealized_gain: number;
  has_restricted_holding: boolean;
  tax_id: string;
}

/** The table's columns as the app already defines them: IDs and header labels. */
export const wealthColumns: ColumnInput[] = [
  { id: "account_number", label: "Account number" },
  { id: "household", label: "Household" },
  { id: "advisor_name", label: "Advisor" },
  { id: "registration_type", label: "Registration type" },
  { id: "custodian", label: "Custodian" },
  { id: "market_value", label: "Market value" },
  { id: "concentration", label: "Concentration" },
  { id: "unrealized_gain", label: "Unrealized gain" },
  { id: "has_restricted_holding", label: "Restricted holdings" },
  { id: "tax_id", label: "Tax ID" },
];

/**
 * What the app adds for GridCue: kinds that can't be inferred, aliases, approved enum values,
 * and the restricted column. Works with `defineSchema` and `schemaFromTanStack` alike.
 */
export const wealthSchemaOptions: SchemaOptions = {
  id: "wealth-accounts",
  version: "1",
  restricted: ["tax_id"],
  // The domain in three declarations (ADR 0015): what a row is, which columns name other records, and the Host's categories.
  rowNoun: "account",
  columns: {
    account_number: { aliases: ["account", "account #", "acct"] },
    household: { entity: "household" },
    advisor_name: { aliases: ["advisor", "rep", "financial advisor"], entity: "advisor" },
    registration_type: {
      aliases: ["registration", "account type", "tax status"],
      enumValues: [
        { id: "taxable", label: "Taxable", aliases: ["brokerage", "non-qualified"] },
        { id: "ira", label: "IRA", aliases: ["traditional ira"] },
        { id: "roth_ira", label: "Roth IRA", aliases: ["roth"] },
        { id: "trust", label: "Trust" },
      ],
      valueGroups: [{ label: "Retirement", aliases: ["retirement account"], values: ["ira", "roth_ira"] }],
    },
    custodian: {
      enumValues: [
        { id: "northgate", label: "Northgate" },
        { id: "harborline", label: "Harborline" },
        { id: "summit_trust", label: "Summit Trust" },
      ],
    },
    market_value: {
      kind: "currency",
      aliases: ["value", "balance", "aum", "assets"],
      description: "The account's total value. 'Accounts over $X' refers to this column.",
    },
    concentration: {
      kind: "percent",
      aliases: ["largest position", "single position", "position concentration"],
      description: "Share of the account held in its largest single position, as a fraction.",
    },
    unrealized_gain: { kind: "currency", aliases: ["gain", "gains", "unrealized gains"] },
    has_restricted_holding: { kind: "boolean", aliases: ["restricted holding", "restricted"] },
    tax_id: { aliases: ["ssn", "social security number", "tin"] },
  },
};

export const wealthSchema = defineSchema(wealthColumns, wealthSchemaOptions);

/** The demo's starting view: every column except the restricted Tax ID. */
export const wealthInitialState = {
  ...emptyViewState(wealthColumns.map((c) => c.id)),
  visibleColumnIds: wealthColumns.map((c) => c.id).filter((id) => id !== "tax_id"),
};

/** Mock Provider settings: which column a bare amount or percentage refers to in this app. */
export const wealthMockOptions = {
  defaultColumnForKind: { currency: "market_value", percent: "concentration" },
} as const;

/** Small, deterministic pseudo-random generator so every run produces the same rows. */
const mulberry32 = (seed: number) => {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const SURNAMES = ["Alder", "Birch", "Cedar", "Dunmore", "Ellery", "Fairholm", "Greaves", "Hollis", "Ivers", "Jessup", "Kestrel", "Lomax"];
const ADVISORS = ["Avery Lane", "Blake Moreno", "Casey Ortiz", "Dana Whitfield", "Emerson Hale"];
const REGISTRATIONS = ["taxable", "ira", "roth_ira", "trust"] as const;
const CUSTODIANS = ["northgate", "harborline", "summit_trust"] as const;

export const generateAccounts = (count = 500, seed = 42): AccountRow[] => {
  const rand = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
  return Array.from({ length: count }, (_, i) => {
    const value = Math.round(50_000 + rand() ** 2 * 4_950_000);
    return {
      account_number: `AC-${String(100000 + i)}`,
      household: `${pick(SURNAMES)} Household`,
      advisor_name: pick(ADVISORS),
      registration_type: pick(REGISTRATIONS),
      custodian: pick(CUSTODIANS),
      market_value: value,
      concentration: Math.round(rand() * 0.45 * 1000) / 1000,
      unrealized_gain: Math.round((rand() - 0.35) * value * 0.4),
      has_restricted_holding: rand() < 0.12,
      tax_id: `XXX-XX-${String(1000 + i).slice(-4)}`,
    };
  });
};
