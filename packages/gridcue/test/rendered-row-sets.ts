import type { ViewSchema } from "../src/core/protocol";
import { defineSchema } from "../src/core/schema";
import type { Row } from "./rendered-rows";
import { seededRandom } from "./view-generator";

// The two row sets the seeded rendered-rows tests draw views on (operation set spec, 5.4 and 5.5), and the seeds they
// draw them from. `rendered-rows-groups.test.ts` and `rendered-rows-counts.test.ts` share them.

/**
 * The seeds to draw views from: GRIDCUE_RENDERED_SEEDS as "first-last" or "a,b,c", or `undefined` when it is not set,
 * and the test then takes its own fixed seeds.
 */
export const seedsFrom = (given: string | undefined): number[] | undefined => {
  if (!given?.trim()) return undefined;
  const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(given);
  if (range) {
    const [first, last] = [Number(range[1]), Number(range[2])];
    if (last < first) throw new Error(`GRIDCUE_RENDERED_SEEDS: ${given} ends before it starts.`);
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }
  const list = given.split(",").map((s) => Number(s.trim()));
  if (list.some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new Error(`GRIDCUE_RENDERED_SEEDS: ${given} is not a range or a list of seeds.`);
  }
  return list;
};

// --- Two row sets -----------------------------------------------------------------------------------------------
// Number, currency and percent columns hold their empty cells as `null` or as missing cells, each column one kind.
// Text, category and date columns, whose cells are text, hold them as `blank`: missing for the bar. Text is in one
// letter case. The number columns that hold `null` hold no `0`, and the ones that hold `0` leave their empty cells
// missing. Each of these keeps out a difference between the adapters that is older than totals and that the
// bar is not about; the tests count each one apart: a `null` text cell in a sorted column, letter case, both kinds of
// empty cell in one grouped column, and a `null` beside a `0` in a sorted number column (`withZerosBesideNull`).
// TanStack's basic sort finds `null` smaller than `0` and `0` smaller than `null`, so with both in a sorted column it
// can draw the rows that have values out of order. A missing cell is `undefined`, which its `sortUndefined` places.

/** What a text or category column's empty cells hold: missing (`undefined`) for the bar, `null` for the count apart. */
export type Blank = null | undefined;

const pickFrom =
  (random: () => number) =>
  <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)] as T;

export const wealthSchema: ViewSchema = defineSchema(
  [
    { id: "key" },
    { id: "household" },
    { id: "advisor" },
    { id: "custodian", kind: "enum" },
    { id: "registration", kind: "enum" },
    { id: "market_value", kind: "currency" },
    { id: "unrealized_gain", kind: "currency" },
    { id: "concentration", kind: "percent" },
    { id: "restricted", kind: "boolean" },
    { id: "opened", kind: "date" },
    { id: "tax_id" },
  ],
  {
    restricted: ["tax_id"],
    columns: {
      custodian: { enumValues: ["northgate", "harborline", "summit"].map((id) => ({ id, label: id })) },
      registration: { enumValues: ["taxable", "ira", "roth", "trust"].map((id) => ({ id, label: id })) },
    },
  },
);

export const wealthRows = (blank: Blank = undefined): Row[] => {
  const random = seededRandom(8_675_309);
  const pick = pickFrom(random);
  const households = Array.from({ length: 24 }, (_, i) => `Household ${String.fromCharCode(65 + i)}`);
  const advisors = ["Avery Lane", "Blake Moreno", "Casey Ito", "Devon Park", "Emery Shaw", "Finley Ross"];
  // Cents that a plain loop adds with a drift (0.1 + 0.2), and amounts many rows share.
  const tied = [125_000.1, 250_000.2, 99_999.99, 0.1, 0.2, 0.3, 1_000_000];
  return Array.from({ length: 300 }, (_, i) => {
    const row: Row = {
      key: `w${String(i).padStart(3, "0")}`,
      household: random() < 0.06 ? blank : pick(households),
      advisor: random() < 0.08 ? blank : pick(advisors),
      custodian: random() < 0.07 ? blank : pick(["northgate", "harborline", "summit"]),
      registration: random() < 0.05 ? blank : pick(["taxable", "ira", "roth", "trust"]),
      market_value: random() < 0.1 ? null : random() < 0.3 ? pick(tied) : Math.round(random() * 500_000_000) / 100,
      concentration: random() < 0.12 ? null : random() < 0.3 ? pick([0.05, 0.1, 0.25]) : Math.round(random() * 10_000) / 10_000,
      restricted: random() < 0.2,
      tax_id: `T${i}`,
    };
    // Empty as a missing cell.
    if (random() >= 0.1) row.unrealized_gain = random() < 0.2 ? pick([0, -0.1, 0.1]) : Math.round((random() - 0.4) * 20_000_000) / 100;
    if (random() >= 0.05) {
      row.opened = `2026-${String(1 + Math.floor(random() * 6)).padStart(2, "0")}-${String(1 + Math.floor(random() * 4) * 7).padStart(2, "0")}`;
    }
    return row;
  });
};

export const ledgerSchema: ViewSchema = defineSchema(
  [
    { id: "key" },
    { id: "owner" },
    { id: "counterparty" },
    { id: "category", kind: "enum" },
    { id: "booked", kind: "date" },
    { id: "amount", kind: "currency" },
    { id: "quantity", kind: "number" },
    { id: "rate", kind: "percent" },
    { id: "cleared", kind: "boolean" },
  ],
  { columns: { category: { enumValues: ["travel", "fees", "supplies", "payroll"].map((id) => ({ id, label: id })) } } },
);

export const ledgerRows = (blank: Blank = undefined): Row[] => {
  const random = seededRandom(4_242_424);
  const pick = pickFrom(random);
  const counterparties = Array.from({ length: 12 }, (_, i) => `Vendor ${String.fromCharCode(65 + i)}`);
  return Array.from({ length: 300 }, (_, i) => {
    const row: Row = {
      key: `l${String(i).padStart(3, "0")}`,
      owner: random() < 0.06 ? blank : pick(["Owner A", "Owner B", "Owner C", "Owner D", "Owner E"]),
      counterparty: random() < 0.08 ? blank : pick(counterparties),
      category: random() < 0.1 ? blank : pick(["travel", "fees", "supplies", "payroll"]),
      quantity: random() < 0.1 ? null : random() < 0.4 ? pick([1, 2, 10, 0.5]) : Math.round(random() * 1000) / 10,
      cleared: random() < 0.5,
      booked: random() < 0.05 ? blank : `2026-0${1 + Math.floor(random() * 3)}-${String(1 + Math.floor(random() * 10)).padStart(2, "0")}`,
    };
    // Empty as a missing cell.
    if (random() >= 0.1)
      row.amount = random() < 0.3 ? pick([0.1, 0.2, 0.3, 19.99, -19.99, 1234.56]) : Math.round((random() - 0.3) * 2_000_000) / 100;
    if (random() >= 0.12) row.rate = random() < 0.3 ? pick([0.01, 0.015, 0.2]) : Math.round(random() * 1000) / 10_000;
    return row;
  });
};

export type RowSet = { name: string; schema: ViewSchema; rows: Row[] };

const NUMERIC = ["number", "currency", "percent"];

/** The number columns of `set` that hold both a `null` and a `0`. */
export const nullAndZeroColumns = (set: RowSet): Set<string> =>
  new Set(
    set.schema.columns
      .filter((c) => NUMERIC.includes(c.kind) && set.rows.some((r) => r[c.id] === null) && set.rows.some((r) => r[c.id] === 0))
      .map((c) => c.id),
  );

/**
 * `set` with a `0` in about one in eight cells that hold a number, in each number column that holds `null`, for the
 * difference counted apart. The other number columns are left as they are.
 */
export const withZerosBesideNull = (set: RowSet): RowSet => {
  const random = seededRandom(31_337);
  const columns = set.schema.columns.filter((c) => NUMERIC.includes(c.kind) && set.rows.some((r) => r[c.id] === null)).map((c) => c.id);
  const rows = set.rows.map((r) => {
    const row: Row = { ...r };
    for (const id of columns) if (typeof row[id] === "number" && random() < 0.125) row[id] = 0;
    return row;
  });
  return { ...set, name: `${set.name}, zeros beside null`, rows };
};
