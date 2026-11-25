import { type ColumnInput, defineSchema, emptyViewState, type SchemaOptions } from "gridcue";

/**
 * One synthetic ledger entry. Every value is generated; the people and firms are invented.
 * `counterparty`, `category` and `booked` are sometimes empty, so the empty forms have rows to find.
 */
export interface LedgerRow {
  entry_number: string;
  owner: string;
  counterparty: string | null;
  booked: string | null;
  posted_at: string;
  units: number;
  amount: number;
  rate: number;
  category: "fees" | "travel" | "supplies" | "services" | "software" | null;
  cleared: boolean;
}

/** The table's columns as the app already defines them: IDs and header labels. */
export const ledgerColumns: ColumnInput[] = [
  { id: "entry_number", label: "Entry number" },
  { id: "owner", label: "Owner" },
  { id: "counterparty", label: "Counterparty" },
  { id: "booked", label: "Booked" },
  { id: "posted_at", label: "Posted at" },
  { id: "units", label: "Units" },
  { id: "amount", label: "Amount" },
  { id: "rate", label: "Rate" },
  { id: "category", label: "Category" },
  { id: "cleared", label: "Cleared" },
];

/** What the app adds for GridCue: kinds that can't be inferred, aliases, approved category values. */
export const ledgerSchemaOptions: SchemaOptions = {
  id: "ledger-entries",
  version: "1",
  rowNoun: "entry",
  columns: {
    entry_number: { aliases: ["entry", "entry #", "reference"] },
    owner: { aliases: ["account holder", "holder", "person"] },
    counterparty: { aliases: ["vendor", "payee", "firm", "company"] },
    booked: { kind: "date", aliases: ["booking date", "book date"] },
    posted_at: { kind: "datetime", aliases: ["posted", "posting time", "timestamp"] },
    units: { kind: "number", aliases: ["quantity", "qty", "count of units"] },
    amount: { kind: "currency", aliases: ["value", "total", "sum"] },
    rate: { kind: "percent", aliases: ["interest rate", "margin"] },
    category: {
      kind: "enum",
      aliases: ["type", "expense type"],
      enumValues: [
        { id: "fees", label: "Fees", aliases: ["fee"] },
        { id: "travel", label: "Travel" },
        { id: "supplies", label: "Supplies", aliases: ["office supplies"] },
        { id: "services", label: "Services", aliases: ["consulting"] },
        { id: "software", label: "Software", aliases: ["subscriptions"] },
      ],
    },
    cleared: { kind: "boolean", aliases: ["settled", "reconciled"] },
  },
};

export const ledgerSchema = defineSchema(ledgerColumns, ledgerSchemaOptions);

/** The starting view: every column, no filters. */
export const ledgerInitialState = emptyViewState(ledgerColumns.map((c) => c.id));

/** Mock Provider settings: which column a bare amount or percentage refers to in this app. */
export const ledgerMockOptions = {
  defaultColumnForKind: { currency: "amount", percent: "rate" },
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

const OWNERS = ["Avery Lane", "Blake Moreno", "Casey Ortiz", "Dana Whitfield", "Emerson Hale", "Frankie Dunmore", "Gale Ivers"];
const COUNTERPARTIES = [
  "Alder Supply Co",
  "Birch & Fenn Ltd",
  "Cedar Works",
  "Dunmore Freight",
  "Ellery Partners",
  "Fairholm Software",
  "Greaves Consulting",
  "Hollis Travel Group",
];
const CATEGORIES = ["fees", "travel", "supplies", "services", "software"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

export const generateLedger = (count = 400, seed = 7): LedgerRow[] => {
  const rand = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
  return Array.from({ length: count }, (_, i) => {
    // Days since 2025-01-01, kept inside 2025 and 2026 with 28-day months so every date is real.
    const day = Math.floor(rand() * 24 * 28);
    const year = 2025 + Math.floor(day / (12 * 28));
    const month = Math.floor((day % (12 * 28)) / 28) + 1;
    const dayOfMonth = (day % 28) + 1;
    const date = `${year}-${pad(month)}-${pad(dayOfMonth)}`;
    const hour = Math.floor(rand() * 24);
    const minute = Math.floor(rand() * 60);
    return {
      entry_number: `EN-${String(100000 + i)}`,
      owner: pick(OWNERS),
      counterparty: rand() < 0.12 ? null : pick(COUNTERPARTIES),
      booked: rand() < 0.1 ? null : date,
      posted_at: `${date}T${pad(hour)}:${pad(minute)}:00Z`,
      units: Math.floor(rand() * 40) + 1,
      amount: Math.round(rand() ** 2 * 250_000 * 100) / 100,
      rate: Math.round(rand() * 0.25 * 1000) / 1000,
      category: rand() < 0.15 ? null : pick(CATEGORIES),
      cleared: rand() < 0.7,
    };
  });
};
