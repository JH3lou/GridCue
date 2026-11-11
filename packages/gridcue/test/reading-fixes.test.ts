import { describe, expect, it } from "vitest";
import { compile } from "../src/core/compile";
import { createGridCue } from "../src/core/controller";
import { matchMentions } from "../src/core/mentions";
import { type Literal, literalText, normalize } from "../src/core/normalize";
import { emptyViewState, type ViewOperation } from "../src/core/protocol";
import { applyView, createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { unusedReadings } from "../src/core/unused";
import { createMockProvider } from "../src/mock";

// Reading fixes for wrong views found in 0.2.0, and ADR 0019's check that a ready plan uses everything it read.
const schema = defineSchema(
  [
    { id: "account", label: "Account", kind: "string" },
    { id: "owner", label: "Advisor", kind: "string" },
    { id: "custodian", label: "Custodian", kind: "enum" },
    { id: "value", label: "Market value", kind: "currency" },
    { id: "gain", label: "Gain", kind: "currency" },
    { id: "weight", label: "Concentration", kind: "percent" },
    { id: "flagged", label: "Restricted holdings", kind: "boolean" },
  ],
  {
    rowNoun: "account",
    columns: {
      value: { aliases: ["value", "balance"] },
      flagged: { aliases: ["restricted"] },
      custodian: {
        enumValues: [
          { id: "northgate", label: "Northgate" },
          { id: "harborline", label: "Harborline" },
        ],
      },
    },
  },
);
const provider = createMockProvider({ defaultColumnForKind: { currency: "value", percent: "weight" } });
const propose = async (text: string) => {
  const cue = createGridCue({ adapter: createRowsAdapter({ schema }), provider });
  await cue.propose(text);
  return cue.getState();
};
const filters = (ops: readonly ViewOperation[] | undefined) =>
  (ops ?? []).flatMap((op) => (op.type === "filter.add" ? [[op.predicate.columnId, op.predicate.operator, op.predicate.value]] : []));
const literal = (text: string): Literal | undefined => normalize(text).clauses[0]?.literals[0];

describe("comparison symbols and phrases", () => {
  it("reads symbols with or without spaces", () => {
    for (const [text, comparator] of [
      ["value > $1m", "gt"],
      ["value>$1m", "gt"],
      ["value < $1m", "lt"],
      ["value >= $1m", "gte"],
      ["value>=$1m", "gte"],
      ["value ≥ $1m", "gte"],
      ["value => $1m", "gte"],
      ["value <= $1m", "lte"],
      ["value≤$1m", "lte"],
      ["value = $1m", "eq"],
      ["value=$1m", "eq"],
    ] as const) {
      expect(literal(text), text).toMatchObject({ value: 1_000_000, comparator });
    }
  });

  it("reads two-part phrases before the one-word phrase inside them", () => {
    expect(literal("accounts at or above $1m")?.comparator).toBe("gte");
    expect(literal("accounts at or below $1m")?.comparator).toBe("lte");
    expect(literal("gain greater than or equal to $20k")?.comparator).toBe("gte");
    expect(literal("weight less than or equal to 15%")?.comparator).toBe("lte");
  });

  it("reads a comparison after the amount", () => {
    expect(literal("value $1m or more")?.comparator).toBe("gte");
    expect(literal("value $1m+")?.comparator).toBe("gte");
    expect(literal("value $1m or less")?.comparator).toBe("lte");
  });

  it("never reads a negated comparison as the comparison", () => {
    expect(literal("value not over $1m")?.comparator).toBeUndefined();
    expect(literal("value not more than $1m")?.comparator).toBe("lte");
  });

  it("filters by the comparison the User wrote", async () => {
    const state = await propose("Show accounts with market value > $1m");
    expect(state.status).toBe("ready");
    expect(filters(state.plan?.operations)).toEqual([["value", "gt", 1_000_000]]);
  });

  it("asks about an amount whose comparison it can't read, instead of reading it as equal to", async () => {
    for (const text of ["market value ~ $1m", "market value around $1m", "market value != $1m", "market value $1m or so", "accounts $1m"]) {
      const state = await propose(text);
      expect(state.status, text).toBe("needs_clarification");
      expect(state.message, text).toBe("I'm not sure how to compare with “$1m”. Try “over”, “under”, “at least”, or “exactly”.");
    }
  });

  it("reads an amount right after its column as equal to", async () => {
    expect(filters((await propose("market value $750k")).plan?.operations)).toEqual([["value", "eq", 750_000]]);
    expect(filters((await propose("market value is $750k")).plan?.operations)).toEqual([["value", "eq", 750_000]]);
    expect(filters((await propose("market value at $1m")).plan?.operations)).toEqual([["value", "eq", 1_000_000]]);
    expect(filters((await propose("market value $1m, grouped by custodian")).plan?.operations)).toEqual([["value", "eq", 1_000_000]]);
  });

  it("reads “no greater than” as at most and “no lower than” as at least, never the reverse", () => {
    expect(literal("value no greater than $1m")?.comparator).toBe("lte");
    expect(literal("value no larger than $1m")?.comparator).toBe("lte");
    expect(literal("value no higher than $1m")?.comparator).toBe("lte");
    expect(literal("gain no lower than $1m")?.comparator).toBe("gte");
    expect(literal("gain no smaller than $1m")?.comparator).toBe("gte");
    expect(literal("gain not less than $1m")?.comparator).toBe("gte");
    expect(literal("value not above $1m")?.comparator).toBeUndefined();
  });

  it("reads “at most”, “max” and “minimum” after the amount", () => {
    expect(literal("value $1m at most")?.comparator).toBe("lte");
    expect(literal("value $1m max")?.comparator).toBe("lte");
    expect(literal("value $1m tops")?.comparator).toBe("lte");
    expect(literal("gain $10k minimum")?.comparator).toBe("gte");
    expect(literal("value $1m or more or less")?.comparator).toBeUndefined();
  });

  it("asks when anything after the amount qualifies it", async () => {
    for (const after of [
      "give or take",
      "approximately",
      "roughly",
      "(approx)",
      "more or less",
      "and change",
      "exclusive",
      "or more or less",
    ]) {
      const state = await propose(`market value $1m ${after}`);
      expect(state.status, after).toBe("needs_clarification");
    }
  });
});

describe("dates and plain numbers (a second schema)", () => {
  const ledger = defineSchema(
    [
      { id: "name", label: "Name" },
      { id: "opened", label: "Opened" },
      { id: "closed", label: "Close date" },
      { id: "positions", label: "Positions" },
      { id: "value", label: "Value" },
    ],
    {
      id: "ledger",
      version: "1",
      rowNoun: "account",
      columns: {
        opened: { kind: "date", aliases: ["open date"] },
        closed: { kind: "date", aliases: ["closed"] },
        positions: { kind: "number", aliases: ["holdings count"] },
        value: { kind: "currency" },
      },
    },
  );
  const mock = createMockProvider({ defaultColumnForKind: { date: "opened", number: "positions", currency: "value" } });
  const plan = async (text: string) => {
    const cue = createGridCue({ adapter: createRowsAdapter({ schema: ledger }), provider: mock });
    await cue.propose(text);
    const state = cue.getState();
    return state.status === "ready" ? filters(state.plan?.operations) : state.status;
  };

  it("reads the comparison a date or a plain number was written with", async () => {
    expect(await plan("accounts opened on 2024-01-01")).toEqual([["opened", "eq", "2024-01-01"]]);
    expect(await plan("close date on 2024-03-01")).toEqual([["closed", "eq", "2024-03-01"]]);
    expect(await plan("accounts opened 2024-01-01")).toEqual([["opened", "eq", "2024-01-01"]]);
    expect(await plan("accounts with 5 positions")).toEqual([["positions", "eq", 5]]);
    expect(await plan("opened after 2024-01-01")).toEqual([["opened", "gt", "2024-01-01"]]);
    expect(await plan("closed before 2023-06-30")).toEqual([["closed", "lt", "2023-06-30"]]);
    expect(await plan("positions over 5")).toEqual([["positions", "gt", 5]]);
    expect(await plan("positions at least 3")).toEqual([["positions", "gte", 3]]);
    expect(await plan("value over $1m")).toEqual([["value", "gt", 1_000_000]]);
    expect(await plan("accounts over $1m")).toEqual([["value", "gt", 1_000_000]]);
  });

  it("includes the boundary for “since”, “on or before” and “on or after”", async () => {
    expect(await plan("opened since 2022-01-01")).toEqual([["opened", "gte", "2022-01-01"]]);
    expect(await plan("opened on or before 2022-01-01")).toEqual([["opened", "lte", "2022-01-01"]]);
    expect(await plan("opened on or after 2022-01-01")).toEqual([["opened", "gte", "2022-01-01"]]);
  });

  // Labelled before the fixes and first run after them (2026-11-10), like evals/cases-reading-heldout.jsonl.
  it("reads the held-out date and number requests", async () => {
    expect(await plan("closed on 2023-11-15")).toEqual([["closed", "eq", "2023-11-15"]]);
    expect(await plan("open date on 2021-07-15")).toEqual([["opened", "eq", "2021-07-15"]]);
    expect(await plan("show accounts that have 3 positions")).toEqual([["positions", "eq", 3]]);
    expect(await plan("accounts opened before 2020-05-01")).toEqual([["opened", "lt", "2020-05-01"]]);
    expect(await plan("accounts whose close date is after 2023-12-31")).toEqual([["closed", "gt", "2023-12-31"]]);
    expect(await plan("holdings count over 20")).toEqual([["positions", "gt", 20]]);
    expect(await plan("positions fewer than 4")).toEqual([["positions", "lt", 4]]);
    expect(await plan("positions at most 8")).toEqual([["positions", "lte", 8]]);
    expect(await plan("opened on 2024-01-01 with more than 5 positions")).toEqual([
      ["opened", "eq", "2024-01-01"],
      ["positions", "gt", 5],
    ]);
    expect(await plan("value under $50k")).toEqual([["value", "lt", 50_000]]);
  });

  it("still asks about an approximate date or count", async () => {
    expect(await plan("opened around 2024-01-01")).toBe("needs_clarification");
    expect(await plan("accounts with about 5 positions")).toBe("needs_clarification");
  });

  // Round three's ledger dev cases (scratchpad round3-dev/cases-ledger-3.jsonl).
  it("reads “or later”, “or earlier” and “at the most” after a date or number, and asks about a hedge", async () => {
    expect(await plan("opened on 2024-01-01 or later")).toEqual([["opened", "gte", "2024-01-01"]]);
    expect(await plan("opened 2022-06-30 or earlier")).toEqual([["opened", "lte", "2022-06-30"]]);
    expect(await plan("positions 5 at the most")).toEqual([["positions", "lte", 5]]);
    expect(await plan("accounts with 5 positions, roughly")).toBe("needs_clarification");
    expect(await plan("closed before 2023-06-30")).toEqual([["closed", "lt", "2023-06-30"]]);
    expect(await plan("closed on 2024-03-01")).toEqual([["closed", "eq", "2024-03-01"]]);
    expect(await plan("positions at least 3")).toEqual([["positions", "gte", 3]]);
    expect(await plan("value over $1m")).toEqual([["value", "gt", 1_000_000]]);
  });

  // Round three's held-out ledger cases: labelled before the fixes, first run after them (2026-11-10).
  it("reads the held-out “or later” and “at the least” requests, and asks about a hedge", async () => {
    expect(await plan("closed 2023-12-31 or earlier")).toEqual([["closed", "lte", "2023-12-31"]]);
    expect(await plan("closed on 2022-05-01 or later")).toEqual([["closed", "gte", "2022-05-01"]]);
    expect(await plan("positions 8 at the least")).toEqual([["positions", "gte", 8]]);
    expect(await plan("value $50k, approximately")).toBe("needs_clarification");
    expect(await plan("accounts with 3 holdings count, give or take")).toBe("needs_clarification");
    expect(await plan("closed after 2021-03-15")).toEqual([["closed", "gt", "2021-03-15"]]);
    expect(await plan("accounts closed before 2019-01-01")).toEqual([["closed", "lt", "2019-01-01"]]);
    expect(await plan("positions over 20")).toEqual([["positions", "gt", 20]]);
  });
});

describe("a schema with no row noun", () => {
  // Round three's dev cases (scratchpad round3-dev/cases-norow.jsonl), on the wealth columns with `rowNoun` removed.
  const norow = defineSchema(
    [
      { id: "account_number", label: "Account number" },
      { id: "custodian", label: "Custodian" },
      { id: "market_value", label: "Market value" },
      { id: "concentration", label: "Concentration" },
      { id: "unrealized_gain", label: "Unrealized gain" },
    ],
    {
      columns: {
        account_number: { aliases: ["account", "account #", "acct"] },
        custodian: { enumValues: [{ id: "northgate", label: "Northgate" }] },
        market_value: { kind: "currency", aliases: ["value", "balance"] },
        concentration: { kind: "percent" },
        unrealized_gain: { kind: "currency", aliases: ["gain", "gains"] },
      },
    },
  );
  const mock = createMockProvider({ defaultColumnForKind: { currency: "market_value", percent: "concentration" } });
  const plan = async (text: string) => {
    const cue = createGridCue({ adapter: createRowsAdapter({ schema: norow }), provider: mock });
    await cue.propose(text);
    const state = cue.getState();
    return state.status === "ready" ? state.plan?.operations : state.status;
  };

  it("asks when a column that holds one kind of amount is compared with another", async () => {
    expect(await plan("gain over 10%")).toBe("needs_clarification");
    expect(await plan("market value over 5%")).toBe("needs_clarification");
    expect(await plan("concentration over $1m")).toBe("needs_clarification");
    expect(await plan("unrealized gain below 2% grouped by custodian")).toBe("needs_clarification");
  });

  it("still reads a text column before an amount as the rows", async () => {
    expect(filters((await plan("accounts over $1 million")) as ViewOperation[])).toEqual([["market_value", "gt", 1_000_000]]);
    expect(filters((await plan("market value over $1m")) as ViewOperation[])).toEqual([["market_value", "gt", 1_000_000]]);
    expect(filters((await plan("concentration over 10%")) as ViewOperation[])).toEqual([["concentration", "gt", 0.1]]);
    expect(await plan("gain over $50k sorted by market value")).toMatchObject([
      { type: "filter.add", predicate: { columnId: "unrealized_gain", operator: "gt", value: 50_000 } },
      { type: "sort.set", sorts: [{ columnId: "market_value", direction: "asc" }] },
    ]);
  });
});

describe("round three: ask where the reading isn't certain", () => {
  const status = async (text: string) => (await propose(text)).status;

  it("reads a column named before “from … to …” as that column's range", async () => {
    expect(filters((await propose("gain from $10k to $50k")).plan?.operations)).toEqual([
      ["gain", "between", { min: 10_000, max: 50_000 }],
    ]);
    expect(filters((await propose("gain from -$50k to $50k")).plan?.operations)).toEqual([
      ["gain", "between", { min: -50_000, max: 50_000 }],
    ]);
    expect(filters((await propose("accounts from Northgate over $1m")).plan?.operations)).toEqual([
      ["custodian", "eq", "northgate"],
      ["value", "gt", 1_000_000],
    ]);
  });

  it("asks about a hedge or an unknown word after an amount, even after a comma", async () => {
    for (const text of [
      "market value $1m, approximately",
      "gain $50k, roughly",
      "accounts over $1m or so",
      "value $1m with a margin",
      "gain over $1m or more",
    ])
      expect(await status(text), text).toBe("needs_clarification");
    expect(filters((await propose("gain $50k at the most")).plan?.operations)).toEqual([["gain", "lte", 50_000]]);
    expect(filters((await propose("market value $2m at the least")).plan?.operations)).toEqual([["value", "gte", 2_000_000]]);
    expect(filters((await propose("market value $1m exactly")).plan?.operations)).toEqual([["value", "eq", 1_000_000]]);
  });

  it("reads “over or equal to” and asks about “=/=”", async () => {
    expect(filters((await propose("accounts over or equal to $1m")).plan?.operations)).toEqual([["value", "gte", 1_000_000]]);
    expect(filters((await propose("gain under or equal to $5k")).plan?.operations)).toEqual([["gain", "lte", 5_000]]);
    expect(await status("market value =/= $1m")).toBe("needs_clarification");
  });

  it("asks when a part starts with “or”", async () => {
    expect(await status("accounts over $1m. or northgate accounts")).toBe("needs_clarification");
    expect(await status("accounts over $1m; or at northgate")).toBe("needs_clarification");
  });

  it("keeps the complement of one simple condition a part leaves out, and asks about more", async () => {
    expect(filters((await propose("hide northgate accounts")).plan?.operations)).toEqual([["custodian", "eq", "harborline"]]);
    expect(filters((await propose("exclude accounts over $1m")).plan?.operations)).toEqual([["value", "lte", 1_000_000]]);
    expect(filters((await propose("remove accounts with value over $1m")).plan?.operations)).toEqual([["value", "lte", 1_000_000]]);
    expect(filters((await propose("not accounts over $1m")).plan?.operations)).toEqual([["value", "lte", 1_000_000]]);
    expect(filters((await propose("accounts with no gain over $50k")).plan?.operations)).toEqual([["gain", "lte", 50_000]]);
    for (const text of [
      "remove northgate accounts except trusts",
      "hide restricted accounts at northgate",
      "hide restricted and northgate accounts",
      "hide restricted households",
      "hide non-restricted accounts",
      "exclude accounts between $1m and $2m",
    ])
      expect(await status(text), text).toBe("needs_clarification");
    expect((await propose("hide the custodian column")).plan?.operations).toEqual([{ type: "columns.hide", columnIds: ["custodian"] }]);
  });

  it("reads no filter from a part that acts on rows instead of asking for a view", async () => {
    for (const text of [
      "close all trust accounts",
      "mark the northgate accounts as reviewed",
      "set custodian to Northgate for the Alder household",
      "create a new northgate account",
      "assign Avery Lane to the northgate accounts",
    ])
      expect(await status(text), text).not.toBe("ready");
    expect(filters((await propose("show northgate accounts")).plan?.operations)).toEqual([["custodian", "eq", "northgate"]]);
  });

  it("reads a verb known only for columns as a view request only when its object is columns", async () => {
    for (const text of [
      "add a northgate account for the Alder household",
      "add the northgate accounts to the Birch household",
      "put the northgate accounts under Avery Lane",
      "pin the northgate accounts to my watchlist",
      "move the northgate accounts to Harborline",
      "shift the northgate accounts to Harborline",
      "bring the northgate accounts over to Harborline",
    ])
      expect(await status(text), text).not.toBe("ready");
    expect((await propose("add the custodian column")).plan?.operations).toEqual([{ type: "columns.show", columnIds: ["custodian"] }]);
    expect((await propose("add the gain and advisor columns")).plan?.operations).toEqual([
      { type: "columns.show", columnIds: ["gain", "owner"] },
    ]);
  });

  it("formats an amount in a question the way the preview does", async () => {
    expect((await propose("accounts over 1000000")).message).toBe("Which column should be above 1,000,000?");
  });
});

describe("round four: ask where the reading isn't certain", () => {
  const status = async (text: string) => (await propose(text)).status;
  const base = emptyViewState(schema.columns.map((c) => c.id));
  const from = async (text: string, state: Partial<typeof base>) => {
    const cue = createGridCue({ adapter: createRowsAdapter({ schema, initialState: { ...base, ...state } }), provider });
    await cue.propose(text);
    return cue.getState();
  };
  const pred = (id: string, columnId: string, operator: "eq" | "in" | "gt", value: unknown) =>
    ({ id, type: "predicate", columnId, operator, value }) as never;

  it("asks when a name read as the rows sits next to what a part leaves out", async () => {
    expect(await status("hide northgate restricted accounts")).toBe("needs_clarification");
    expect(filters((await propose("hide northgate accounts")).plan?.operations)).toEqual([["custodian", "eq", "harborline"]]);
  });

  it("keeps only the filter a kept name means: never a negated one, never part of a list", async () => {
    const restricted = {
      filters: { id: "g", type: "group" as const, combinator: "and" as const, children: [pred("p1", "flagged", "eq", true)] },
    };
    expect((await from("clear filters except non-restricted", restricted)).status).toBe("needs_clarification");
    expect((await from("clear filters except restricted", restricted)).plan?.operations).toMatchObject([
      { type: "filter.clear" },
      { type: "filter.add", predicate: { columnId: "flagged", value: true } },
    ]);
    const two = {
      filters: {
        id: "g",
        type: "group" as const,
        combinator: "and" as const,
        children: [pred("p1", "custodian", "in", ["northgate", "harborline"])],
      },
    };
    expect((await from("clear filters except northgate", two)).message).toBe(
      "The current filter holds more than “northgate”, so GridCue can't keep only that part. Clear the filters, then ask for it.",
    );
    expect((await from("clear filters except custodian", two)).status).toBe("ready");
  });

  it("says why it can't keep a filter, and keeps a grouping or sort through a reset", async () => {
    const either = {
      filters: {
        id: "g",
        type: "group" as const,
        combinator: "or" as const,
        children: [pred("p1", "custodian", "eq", "northgate"), pred("p2", "value", "gt", 1_000_000)],
      },
    };
    expect((await from("clear filters except northgate", either)).message).toBe(
      "The current filters match rows by any one of them, so GridCue can't keep just one. Clear the filters, then ask for the ones you want.",
    );
    expect((await from("reset everything but keep the grouping", { groupBy: ["custodian"] })).plan?.operations).toEqual([
      { type: "view.reset" },
      { type: "group.set", columnIds: ["custodian"] },
    ]);
    const sorted = { groupBy: ["custodian"], sorts: [{ columnId: "value", direction: "desc" as const }] };
    expect((await from("remove the sort but keep the grouping", sorted)).plan?.operations).toEqual([{ type: "sort.set", sorts: [] }]);
    expect((await from("reset everything but keep the grouping", {})).message).toBe("There's no grouping in the view to keep.");
  });

  it("reads time words after a date only", async () => {
    for (const text of [
      "market value $1m or later",
      "gain $10k and earlier",
      "weight 10% at the earliest",
      "market value $1m at the latest",
    ])
      expect(await status(text), text).toBe("needs_clarification");
    expect(filters((await propose("market value $1m or more")).plan?.operations)).toEqual([["value", "gte", 1_000_000]]);
  });

  it("borrows a scale only in the compact form, from the second bound", () => {
    for (const text of ["value between $1m and 2", "value from 1m-2", "gain between 5 and 50k"])
      expect(literal(text)?.kind, text).toBe("unreadable");
    expect(literal("value between $1-2m")).toMatchObject({ value: 1_000_000, upper: 2_000_000 });
    expect(literal("weight between 10 and 20%")).toMatchObject({ value: 0.1, upper: 0.2 });
  });

  it("reads a negation before “show” like “hide”", async () => {
    for (const text of [
      "don't show northgate accounts",
      "do not show northgate accounts",
      "never show northgate accounts",
      "please don't include northgate accounts",
    ])
      expect(filters((await propose(text)).plan?.operations), text).toEqual([["custodian", "eq", "harborline"]]);
    expect(filters((await propose("don't show accounts over $1m")).plan?.operations)).toEqual([["value", "lte", 1_000_000]]);
    expect(filters((await propose("no accounts over $1m")).plan?.operations)).toEqual([["value", "lte", 1_000_000]]);
    expect(await status("don't show the custodian column")).toBe("needs_clarification");
  });

  it("asks when a part stops mid-sentence or names a column with nothing said about it", async () => {
    expect((await propose("accounts over $1m but")).message).toBe(
      "“accounts over $1m but” stops after “but”. Finish that part, or leave the last word out.",
    );
    expect(await status("market value $1m or")).toBe("needs_clarification");
    expect(await status("market value over $1m and the advisor")).toBe("needs_clarification");
  });

  it("leaves out the rows “where” describes, and never hides the row noun's column", async () => {
    expect((await propose("hide accounts where gain is below $0")).plan?.operations).toMatchObject([
      { type: "filter.add", predicate: { columnId: "gain", operator: "gte", value: 0 } },
    ]);
    expect(await status("hide unrestricted accounts")).toBe("needs_clarification");
  });
});

describe("round five: narrowing", () => {
  const status = async (text: string) => (await propose(text)).status;
  const base = emptyViewState(schema.columns.map((c) => c.id));
  const from = async (text: string, state: Partial<typeof base>) => {
    const cue = createGridCue({ adapter: createRowsAdapter({ schema, initialState: { ...base, ...state } }), provider });
    await cue.propose(text);
    return cue.getState();
  };

  it("reads “no more than” at the start as a comparison, not a leave-out lead", async () => {
    expect(filters((await propose("no more than $1m")).plan?.operations)).toEqual([["value", "lte", 1_000_000]]);
    expect(filters((await propose("no less than $1m")).plan?.operations)).toEqual([["value", "gte", 1_000_000]]);
  });

  it("reads “no” at the start of a declared name as the name", async () => {
    const positions = defineSchema([{ id: "name" }, { id: "count", label: "No. of Positions", kind: "number" }], { rowNoun: "account" });
    const cue = createGridCue({ adapter: createRowsAdapter({ schema: positions }), provider: createMockProvider() });
    await cue.propose("no of positions over 5");
    expect(filters(cue.getState().plan?.operations)).toEqual([["count", "gt", 5]]);
  });

  it("asks about a negation before any view verb other than “show”, and about two negations", async () => {
    for (const text of [
      "don't hide northgate accounts",
      "never hide northgate accounts",
      "don't sort by gain",
      "don't group by custodian",
      "don't hide the advisor column",
      "never show never show northgate accounts",
    ])
      expect(await status(text), text).toBe("needs_clarification");
    expect(filters((await propose("don't show northgate accounts")).plan?.operations)).toEqual([["custodian", "eq", "harborline"]]);
  });

  it("asks about “nothing” and a plain “including”", async () => {
    expect(await status("show nothing over $1m")).toBe("needs_clarification");
    expect(await status("show accounts including northgate")).toBe("needs_clarification");
    expect(filters((await propose("show accounts not including northgate")).plan?.operations)).toEqual([["custodian", "eq", "harborline"]]);
  });

  it("reads a range written in full next to a scaled bound", () => {
    expect(literal("value between $500,000 and $1m")).toMatchObject({ value: 500_000, upper: 1_000_000 });
    expect(literal("gain between $5,000 and $50k")).toMatchObject({ value: 5_000, upper: 50_000 });
    expect(literal("value between $1m and 2")?.kind).toBe("unreadable");
  });

  it("reads an entity right before the rows, or before a sort, as describing the rows", async () => {
    const entities = defineSchema(
      [
        { id: "account", label: "Account" },
        { id: "owner", label: "Advisor" },
        { id: "household", label: "Household" },
        { id: "value", label: "Market value", kind: "currency" },
      ],
      { rowNoun: "account", columns: { owner: { entity: "advisor" }, household: { entity: "household" } } },
    );
    const run = async (text: string) => {
      const cue = createGridCue({
        adapter: createRowsAdapter({ schema: entities }),
        provider: createMockProvider({ defaultColumnForKind: { currency: "value" } }),
      });
      await cue.propose(text);
      return cue.getState();
    };
    expect(filters((await run("the advisor's accounts over $1m")).plan?.operations)).toEqual([["value", "gt", 1_000_000]]);
    expect((await run("households sorted by market value")).plan?.operations).toEqual([
      { type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] },
    ]);
    expect((await run("market value over $1m and the advisor")).status).toBe("needs_clarification");
  });

  it("clears only the grouping on “ungroup”, keeping the sort", async () => {
    const view = { groupBy: ["custodian"], sorts: [{ columnId: "value", direction: "desc" as const }] };
    expect((await from("ungroup", view)).plan?.operations).toEqual([{ type: "group.set", columnIds: [] }]);
    expect((await from("ungroup but keep the sort", view)).plan?.operations).toEqual([{ type: "group.set", columnIds: [] }]);
  });

  it("keeps the sort and the grouping through a reset without calling them filters, and words a nested refusal truly", async () => {
    const view = { groupBy: ["custodian"], sorts: [{ columnId: "value", direction: "desc" as const }] };
    expect((await from("reset the view but keep the sort and the grouping", view)).plan?.operations).toEqual([
      { type: "view.reset" },
      { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
      { type: "group.set", columnIds: ["custodian"] },
    ]);
    const nested = {
      filters: {
        id: "g",
        type: "group" as const,
        combinator: "and" as const,
        children: [
          { id: "p1", type: "predicate" as const, columnId: "value", operator: "gt" as const, value: 1_000_000 },
          {
            id: "g2",
            type: "group" as const,
            combinator: "or" as const,
            children: [{ id: "p2", type: "predicate" as const, columnId: "custodian", operator: "eq" as const, value: "northgate" }],
          },
        ],
      },
    };
    expect((await from("clear filters except northgate", nested)).message).toBe(
      "The current filters are nested, so GridCue can't keep just one. Clear the filters, then ask for the ones you want.",
    );
  });

  it("keeps asking about time words after a number that isn't a date", async () => {
    expect(await status("weight 2020 or later")).toBe("needs_clarification");
  });

  it("reads a name ending in a symbol without it, unless two names would collide", async () => {
    const yields = defineSchema(
      [{ id: "name" }, { id: "yield", label: "Yield %", kind: "percent" }, { id: "weight", label: "Weight", kind: "percent" }],
      { rowNoun: "account" },
    );
    const mock = createMockProvider({ defaultColumnForKind: { percent: "weight" } });
    const ops = async (text: string) => {
      const cue = createGridCue({ adapter: createRowsAdapter({ schema: yields }), provider: mock });
      await cue.propose(text);
      return cue.getState().plan?.operations;
    };
    expect(filters(await ops("yield over 5%"))).toEqual([["yield", "gt", 0.05]]);
    expect(await ops("sort by yield")).toEqual([{ type: "sort.set", sorts: [{ columnId: "yield", direction: "asc" }] }]);
    expect(await ops("hide yield")).toEqual([{ type: "columns.hide", columnIds: ["yield"] }]);
  });
});

describe("round 5b: a clear applies only to what its verb governs", () => {
  const base = emptyViewState(schema.columns.map((c) => c.id));
  const view = {
    groupBy: ["custodian"],
    sorts: [{ columnId: "value", direction: "desc" as const }],
    filters: {
      id: "g",
      type: "group" as const,
      combinator: "and" as const,
      children: [{ id: "p1", type: "predicate" as const, columnId: "custodian", operator: "eq" as const, value: "northgate" }],
    },
  };
  const ops = async (text: string) => {
    const cue = createGridCue({ adapter: createRowsAdapter({ schema, initialState: { ...base, ...view } }), provider });
    await cue.propose(text);
    const state = cue.getState();
    return state.status === "ready" ? state.plan?.operations : state.status;
  };

  it("clears only the governed thing, leaving what is named to stay", async () => {
    expect(await ops("ungroup, don't touch the sort")).toEqual([{ type: "group.set", columnIds: [] }]);
    expect(await ops("clear the sort, the grouping stays")).toEqual([{ type: "sort.set", sorts: [] }]);
    expect(await ops("ungroup, not the filter")).toEqual([{ type: "group.set", columnIds: [] }]);
    expect(await ops("clear the filters, leave the grouping as is")).toEqual([{ type: "filter.clear" }]);
    expect(await ops("clear the sort and the grouping")).toEqual([
      { type: "sort.set", sorts: [] },
      { type: "group.set", columnIds: [] },
    ]);
  });

  it("asks when a provider proposes clearing something no clear verb governs", () => {
    const text = "ungroup, don't touch the sort";
    const plan = compile({
      input: normalize(text),
      mentions: [],
      resolution: {
        clauses: [
          {
            clauseIndex: 0,
            families: [
              { id: "group.clear", confidence: 0.95 },
              { id: "sort.clear", confidence: 0.95 },
            ],
            columns: [],
            values: [],
            unmatchedTerms: [],
          },
        ],
      },
      schema,
      state: { ...base, ...view },
      baseRevision: "r1",
      channel: "typed",
      newId: (p) => p,
    });
    expect(plan.status).toBe("needs_clarification");
  });
});

describe("round six: narrowing", () => {
  const base = emptyViewState(schema.columns.map((c) => c.id));
  const view = {
    groupBy: ["custodian"],
    sorts: [{ columnId: "value", direction: "desc" as const }],
    filters: {
      id: "g",
      type: "group" as const,
      combinator: "and" as const,
      children: [{ id: "p1", type: "predicate" as const, columnId: "custodian", operator: "eq" as const, value: "northgate" }],
    },
  };
  const run = async (text: string, state: Partial<typeof base> = view) => {
    const cue = createGridCue({ adapter: createRowsAdapter({ schema, initialState: { ...base, ...state } }), provider });
    await cue.propose(text);
    const st = cue.getState();
    return st.status === "ready" ? st.plan?.operations : st.status;
  };

  it("governs a comma list of layout words right after the clear verb, and nothing trailing", async () => {
    expect(await run("remove sorting, grouping")).toEqual([
      { type: "sort.set", sorts: [] },
      { type: "group.set", columnIds: [] },
    ]);
    expect(await run("clear the sort, the grouping stays")).toEqual([{ type: "sort.set", sorts: [] }]);
    expect(await run("ungroup the rows, sorting")).toEqual([{ type: "group.set", columnIds: [] }]);
  });

  it("keeps what “but” spares in “clear everything but …”", async () => {
    expect(await run("clear everything but the sort")).toEqual([
      { type: "view.reset" },
      { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
    ]);
    expect(await run("clear everything but the filter")).toMatchObject([
      { type: "view.reset" },
      { type: "filter.add", predicate: { columnId: "custodian", value: "northgate" } },
    ]);
  });

  it("lets a negation that belongs to one value stand beside another", async () => {
    expect(filters((await run("accounts not at northgate with no restricted holdings", {})) as ViewOperation[])).toEqual(
      expect.arrayContaining([
        ["custodian", "eq", "harborline"],
        ["flagged", "eq", false],
      ]),
    );
    expect(await run("don't show accounts not at northgate", {})).toBe("needs_clarification");
  });

  it("reads two bounds that each carry their own “$” as written", () => {
    expect(literal("value between $999 and $2k")).toMatchObject({ value: 999, upper: 2_000 });
    expect(literal("value between 100 and 200k")?.kind).toBe("unreadable");
  });

  it("asks about a negated column in a column change, “not containing”, and “no grouping”", async () => {
    for (const text of [
      "sort by gain, not value",
      "group by custodian, not advisor",
      "hide custodian, not advisor",
      'advisor not containing "smith"',
      'advisor doesn\'t contain "smith"',
      "sort by gain descending, no grouping",
    ])
      expect(await run(text, {}), text).toBe("needs_clarification");
  });
});

describe("a Host's own names (real-Host test)", () => {
  const host = defineSchema(
    [
      { id: "name", label: "Household" },
      { id: "cash", label: "Available Cash $", kind: "currency" },
      { id: "cashpct", label: "Available Cash %", kind: "percent" },
      { id: "status", label: "Status", kind: "enum" },
      { id: "top", label: "Top 10 Holding" },
    ],
    {
      rowNoun: "household",
      columns: {
        status: {
          allowedOperators: ["eq"],
          enumValues: [
            { id: "open", label: "Open" },
            { id: "closed", label: "Closed" },
            { id: "pending", label: "Pending" },
          ],
        },
      },
    },
  );
  const mock = createMockProvider({ defaultColumnForKind: { currency: "cash", percent: "cashpct" } });
  const state = async (text: string) => {
    const cue = createGridCue({ adapter: createRowsAdapter({ schema: host }), provider: mock });
    await cue.propose(text);
    return cue.getState();
  };

  it("reads a trailing “$” or “%” that completes a declared name as part of it", async () => {
    expect((await state("sort by available cash $ descending")).plan?.operations).toEqual([
      { type: "sort.set", sorts: [{ columnId: "cash", direction: "desc" }] },
    ]);
    expect(filters((await state("available cash $ < 0")).plan?.operations)).toEqual([["cash", "lt", 0]]);
  });

  it("says plainly when a column that shows one value at a time can't leave a value out", async () => {
    const asked = await state("hide closed households");
    expect(asked.message).toBe(
      "This grid can show only one Status at a time, so GridCue can't leave out Closed. Ask for the Status to show.",
    );
    expect(asked.plan?.clarifications[0]?.options).toBeUndefined();
  });

  it("keeps the specific question", async () => {
    expect((await state("available cash < 0")).message).toBe("Which column should be below 0?");
    expect((await state("households sorted by banana")).message).toBe(
      "There's no column called “banana”. Which column should be sorted by?",
    );
  });

  it("reads a size word and count inside a declared name as the name", async () => {
    expect((await state('top 10 holding containing "apple"')).plan?.operations).toEqual([
      {
        type: "filter.add",
        combineWith: "and",
        predicate: { id: expect.any(String), type: "predicate", columnId: "top", operator: "contains", value: "apple" },
      },
    ]);
    expect((await state("sort by top 10 holding")).plan?.operations).toEqual([
      { type: "sort.set", sorts: [{ columnId: "top", direction: "asc" }] },
    ]);
  });
});

describe("names with symbols or instruction words", () => {
  it("reads a name written with its symbol, so none of it is dropped", async () => {
    const withSymbol = defineSchema([{ id: "household" }, { id: "account", label: "Account number" }, { id: "custodian" }], {
      rowNoun: "account",
      columns: { account: { aliases: ["account", "account #"] } },
    });
    const cue = createGridCue({ adapter: createRowsAdapter({ schema: withSymbol }), provider });
    await cue.propose("hide household account # and custodian");
    expect(cue.getState().plan?.operations).toEqual([{ type: "columns.hide", columnIds: ["household", "account", "custodian"] }]);
  });

  it("never reads a word inside a declared name as an instruction", async () => {
    const host = defineSchema([
      { id: "name" },
      { id: "agroup", label: "Advisor Group" },
      { id: "review", label: "Next review", kind: "date" },
    ]);
    for (const [text, ids] of [
      ["hide advisor group and next review", ["agroup", "review"]],
      ["hide advisor group", ["agroup"]],
    ] as const) {
      const cue = createGridCue({ adapter: createRowsAdapter({ schema: host }), provider: createMockProvider() });
      await cue.propose(text);
      expect(cue.getState().plan?.operations, text).toEqual([{ type: "columns.hide", columnIds: ids }]);
    }
  });
});

describe("ranges", () => {
  it("give a bound with no unit the other bound's unit and scale", () => {
    expect(literal("weight between 10-20%")).toMatchObject({ value: 0.1, upper: 0.2 });
    expect(literal("weight between 10 and 20%")).toMatchObject({ value: 0.1, upper: 0.2 });
    expect(literal("weight between 5% and 10")?.kind).toBe("unreadable");
    expect(literal("value between $1-2m")).toMatchObject({ value: 1_000_000, upper: 2_000_000 });
    expect(literal("gain between $50-100k")).toMatchObject({ value: 50_000, upper: 100_000 });
  });

  // Found by the round-two held-out set: these two asked how to compare. Fixed after that run, so not held-out evidence.
  it("read “from … to …” and “from …-…” as a range", () => {
    expect(literal("weight from 5-15%")).toMatchObject({ value: 0.05, upper: 0.15, comparator: "between" });
    expect(literal("value from $2-4m")).toMatchObject({ value: 2_000_000, upper: 4_000_000, comparator: "between" });
    expect(literal("gain from $10k to $100k")).toMatchObject({ value: 10_000, upper: 100_000, comparator: "between" });
  });

  it("are unreadable, so asked about, when sharing a unit isn't certain", () => {
    expect(literal("value between $500 and 2m")?.kind).toBe("unreadable");
    expect(literal("value between $1 and 2m")?.kind).toBe("unreadable");
    expect(literal("weight between 50% and 5")?.kind).toBe("unreadable");
  });

  it("read a negative bound's sign, and put the lower bound first", () => {
    expect(literal("weight between -10 and -5%")).toMatchObject({ value: -0.1, upper: -0.05 });
    expect(literal("value from $5m to $1m")).toMatchObject({ value: 1_000_000, upper: 5_000_000, comparator: "between" });
    expect(literal("gain between $100k and $20k")).toMatchObject({ value: 20_000, upper: 100_000 });
    expect(literal("value between 1 and 2 million")?.kind).toBe("unreadable");
  });
});

describe("negative amounts", () => {
  it("reads a minus sign or a word before an amount as its sign", () => {
    expect(literal("gain below -$50k")).toMatchObject({ value: -50_000, comparator: "lt" });
    expect(literal("gain below $-50k")).toMatchObject({ value: -50_000, comparator: "lt" });
    expect(literal("gain below -50k")).toMatchObject({ value: -50_000, comparator: "lt" });
    expect(literal("gain>-$20k")).toMatchObject({ value: -20_000, comparator: "gt" });
    expect(literal("gain below negative $50k")).toMatchObject({ value: -50_000, comparator: "lt" });
    expect(literal("weight above minus 5%")).toMatchObject({ value: -0.05, comparator: "gt" });
    expect(literal("gain between -$50k and $50k")).toMatchObject({ value: -50_000, upper: 50_000, comparator: "between" });
  });

  it("keeps a hyphen between two amounts or two words as a hyphen", () => {
    expect(literal("gain between $50k-$100k")).toMatchObject({ value: 50_000, upper: 100_000, comparator: "between" });
    expect(literal("gain between $50k - $100k")).toMatchObject({ value: 50_000, upper: 100_000, comparator: "between" });
    expect(normalize("value 2020-2024").clauses[0]?.literals.map((l) => l.value)).toEqual([2020, 2024]);
  });

  it("names the amount as written in a question", () => {
    const text = "gain below -$50k or so";
    const lit = normalize(text).clauses[0]?.literals[0];
    expect(lit && literalText(text, lit)).toBe("-$50k");
  });

  it("previews and filters with the sign", async () => {
    const state = await propose("accounts with gain below -$50k");
    expect(filters(state.plan?.operations)).toEqual([["gain", "lt", -50_000]]);
    expect(state.preview?.lines).toEqual(["Filter Gain below -$50,000"]);
  });

  it("applies through the Rows Adapter", () => {
    const view = { ...emptyViewState(schema.columns.map((c) => c.id)) };
    const rows = [{ gain: -60_000 }, { gain: -40_000 }, { gain: 10_000 }];
    const filtered = applyView(
      rows,
      {
        ...view,
        filters: {
          id: "root",
          type: "group",
          combinator: "and",
          children: [{ id: "f", type: "predicate", columnId: "gain", operator: "lt", value: -50_000 }],
        },
      },
      schema,
    );
    expect(filtered.rows).toEqual([{ gain: -60_000 }]);
  });
});

describe("“at least” and “at most” after a column name", () => {
  const names = (text: string) => matchMentions(normalize(text).clauses, schema.columns, { rowNoun: "account" }).map((m) => m.columnId);

  it("read as a comparison on that column", async () => {
    expect(names("show gain at least $100k")).toEqual(["gain"]);
    expect(filters((await propose("Show gain at least $100k")).plan?.operations)).toEqual([["gain", "gte", 100_000]]);
    expect(filters((await propose("Gain at most $20k")).plan?.operations)).toEqual([["gain", "lte", 20_000]]);
  });

  it("leave “at” on its own a qualifier", async () => {
    expect(names("accounts at northgate")).toEqual(["custodian"]);
    expect(filters((await propose("accounts at Northgate")).plan?.operations)).toEqual([["custodian", "eq", "northgate"]]);
  });
});

describe("two changes in one part", () => {
  it("filters by an amount named before another change's verb", async () => {
    const state = await propose("Accounts over $1M grouped by custodian.");
    expect(state.status).toBe("ready");
    expect(state.plan?.operations).toMatchObject([
      { type: "filter.add", predicate: { columnId: "value", operator: "gt", value: 1_000_000 } },
      { type: "group.set", columnIds: ["custodian"] },
    ]);
  });

  it("filters the default column, not the column another change names", async () => {
    const state = await propose("Accounts over $1M sorted by gain");
    expect(filters(state.plan?.operations)).toEqual([["value", "gt", 1_000_000]]);
  });
});

describe("a yes/no column in a column list (Mock Provider)", () => {
  it("is a column, not a filter", async () => {
    const only = await propose("Show only the advisor and restricted holdings columns.");
    expect(only.plan?.operations[0]).toEqual({ type: "columns.show", columnIds: ["owner", "flagged"] });
    expect(filters(only.plan?.operations)).toEqual([]);
    expect((await propose("Hide the restricted holdings column.")).plan?.operations).toEqual([
      { type: "columns.hide", columnIds: ["flagged"] },
    ]);
  });

  it("is still a value where it describes the rows", async () => {
    expect(filters((await propose("Accounts with restricted holdings")).plan?.operations)).toEqual([["flagged", "eq", true]]);
  });

  it("hides rows, not the column, when a row word follows it", async () => {
    for (const text of ["hide restricted accounts", "hide restricted rows", "hide the restricted ones"]) {
      const state = await propose(text);
      expect(state.plan?.operations, text).toMatchObject([{ type: "filter.add", predicate: { columnId: "flagged", value: false } }]);
    }
    expect((await propose("unhide restricted accounts")).status).toBe("needs_clarification");
    expect((await propose("hide restricted holdings")).plan?.operations).toEqual([{ type: "columns.hide", columnIds: ["flagged"] }]);
  });
});

describe("“or” between conditions", () => {
  const either = "GridCue can only show rows that match every condition, not either one. Ask for one at a time.";

  it("asks when the conditions are on different columns", async () => {
    for (const text of [
      "market value over $1m or gain over $50k",
      "accounts over $2m or at Northgate",
      "accounts at Harborline or over $3m",
    ]) {
      const state = await propose(text);
      expect(state.status, text).toBe("needs_clarification");
      expect(state.message, text).toBe(either);
    }
  });

  it("filters to any of the values of one column, and reads “or more” as a comparison", async () => {
    expect(filters((await propose("accounts at Northgate or Harborline")).plan?.operations)).toEqual([
      ["custodian", "in", ["northgate", "harborline"]],
    ]);
    expect(filters((await propose("market value $1m or more")).plan?.operations)).toEqual([["value", "gte", 1_000_000]]);
  });
});

describe("a part that clears", () => {
  const filtered = {
    id: "g",
    type: "group" as const,
    combinator: "and" as const,
    children: [
      { id: "p1", type: "predicate" as const, columnId: "custodian", operator: "eq" as const, value: "northgate" },
      { id: "p2", type: "predicate" as const, columnId: "value", operator: "gt" as const, value: 1_000_000 },
    ],
  };
  const either = { ...filtered, combinator: "or" as const };
  const fromFiltered = async (text: string, filters: typeof filtered | typeof either = filtered) => {
    const adapter = createRowsAdapter({ schema, initialState: { ...emptyViewState(schema.columns.map((c) => c.id)), filters } });
    const cue = createGridCue({ adapter, provider });
    await cue.propose(text);
    return cue.getState();
  };

  it("keeps what follows “except” or “but keep” as a filter after the clear", async () => {
    expect((await fromFiltered("clear filters except accounts over $1m")).plan?.operations).toMatchObject([
      { type: "filter.clear" },
      { type: "filter.add", predicate: { columnId: "value", operator: "gt", value: 1_000_000 } },
    ]);
    expect((await fromFiltered("reset the view but keep accounts over $1m")).plan?.operations).toMatchObject([
      { type: "view.reset" },
      { type: "filter.add", predicate: { columnId: "value", operator: "gt", value: 1_000_000 } },
    ]);
  });

  it("clears only the column it names, keeping the other filters", async () => {
    expect((await fromFiltered("clear the market value filter")).plan?.operations).toMatchObject([
      { type: "filter.clear" },
      { type: "filter.add", predicate: { columnId: "custodian", operator: "eq", value: "northgate" } },
    ]);
    expect((await fromFiltered("clear the gain filter")).status).toBe("needs_clarification");
  });

  it("asks when the current filters match either condition, so the rest can't be kept as they are", async () => {
    expect((await fromFiltered("clear the market value filter", either)).status).toBe("needs_clarification");
  });

  it("asks when what it says to keep isn't a current filter, or the clear isn't of the view", async () => {
    expect((await fromFiltered("clear filters except accounts over $5m")).status).toBe("needs_clarification");
    expect((await fromFiltered("clear the filters except the Harborline one")).status).toBe("needs_clarification");
    expect((await fromFiltered("clear the filters except the Northgate one")).plan?.operations).toMatchObject([
      { type: "filter.clear" },
      { type: "filter.add", predicate: { columnId: "custodian", value: "northgate" } },
    ]);
    expect(normalize("remove northgate accounts except trusts").clauses).toHaveLength(1);
  });

  it("stays a plain clear or reset when it names nothing", async () => {
    expect((await fromFiltered("clear the filters")).plan?.operations).toEqual([{ type: "filter.clear" }]);
    expect((await fromFiltered("reset the view")).plan?.operations).toEqual([{ type: "view.reset" }]);
  });
});

describe("a named column that can't hold the amount", () => {
  it("is asked about, never swapped for a column that can", async () => {
    const state = await propose("gain over 10%");
    expect(state.status).toBe("needs_clarification");
    expect(state.message).toBe("Gain can't be compared with “10%”. Name a column that holds percentages.");
  });

  it("leaves the grid's row noun the rows", async () => {
    expect(filters((await propose("accounts over 10%")).plan?.operations)).toEqual([["weight", "gt", 0.1]]);
  });
});

describe("quoted text", () => {
  it("is never split by punctuation inside it", () => {
    for (const mark of [".", ";", "!", "?"]) {
      const text = `accounts with advisor containing "smith${mark} jones", group by custodian`;
      expect(normalize(text).clauses.map((c) => c.text)).toEqual([
        `accounts with advisor containing "smith${mark} jones"`,
        "group by custodian",
      ]);
    }
    expect(normalize('advisor containing "smith jones"').clauses).toHaveLength(1);
  });

  it("is never read as an instruction or as one of the Host's values", async () => {
    expect(filters((await propose('advisor containing "Smith. Jones"')).plan?.operations)).toEqual([["owner", "contains", "smith. jones"]]);
    const verb = await propose('accounts with advisor containing "group by custodian"');
    expect(verb.plan?.operations).toMatchObject([{ type: "filter.add", predicate: { columnId: "owner", value: "group by custodian" } }]);
    expect(filters((await propose('advisor containing "Northgate"')).plan?.operations)).toEqual([["owner", "contains", "northgate"]]);
  });

  it("is a column name only in a column slot", async () => {
    expect(filters((await propose('advisor containing "custodian"')).plan?.operations)).toEqual([["owner", "contains", "custodian"]]);
    expect((await propose('Accounts with advisor containing "gain" grouped by custodian')).plan?.operations).toMatchObject([
      { type: "filter.add", predicate: { columnId: "owner", value: "gain" } },
      { type: "group.set", columnIds: ["custodian"] },
    ]);
    expect((await propose('hide "market value"')).plan?.operations).toEqual([{ type: "columns.hide", columnIds: ["value"] }]);
  });
});

describe("reading stays fast", () => {
  // Quoted text and dates become runs of spaces while reading; no pattern may scan them from every start.
  const tokens = [
    "clear filters except ",
    "from $1 to $2 ",
    "between 1 and 2% ",
    "can you ",
    "account # ",
    "ungroup, don't touch the sort ",
    "clear the sort and the grouping, ",
    "hide accounts where ",
    "don't show ",
    "clear filters but keep the grouping ",
    "and the ",
    "available cash $ ",
    "or later ",
    "at the most ",
    " - ",
    "a",
    " ",
    "1",
    "-",
    "$",
    "-$5 ",
    "(-5",
    "2024-01-01 ",
    '"x" ',
    '"',
    "or ",
    "and ",
    "clear ",
    "except ",
    "over ",
    "between ",
    "1-2 ",
    "5% ",
    ",",
    ".",
    "largest ",
    "no ",
    ">",
    "=",
    "1,",
    "$1m ",
    "or more ",
    "gain ",
    "then ",
  ];
  const inputs = [
    `1"${"a".repeat(1980)}"(-5`,
    `1"${"a".repeat(1900)}"${"(-5".repeat(30)}`,
    `1 ${"2024-01-01 ".repeat(150)}(-5`,
    ...tokens.map((t) => t.repeat(Math.ceil(2000 / t.length)).slice(0, 2000)),
    ...tokens.map((t) => `1"${t.repeat(Math.ceil(1990 / t.length)).slice(0, 1990)}"(-5`),
  ];

  it("normalizes 2,000 characters of any repeated token in under 50 ms", () => {
    normalize(inputs[0] ?? "");
    for (const text of inputs) {
      // The best of three: backtracking is slow every time, while a busy test runner is slow once.
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        const input = normalize(text);
        matchMentions(input.clauses, schema.columns, { rowNoun: "account" });
        best = Math.min(best, performance.now() - started);
      }
      expect(best, JSON.stringify(text.slice(0, 24))).toBeLessThan(50);
    }
  });
});

describe("a ready plan uses everything it read (ADR 0019)", () => {
  const read = (text: string) => {
    const input = normalize(text);
    return { input, mentions: matchMentions(input.clauses, schema.columns, { rowNoun: "account" }) };
  };
  const gt = (columnId: string, value: number): ViewOperation => ({
    type: "filter.add",
    combineWith: "and",
    predicate: { id: "f", type: "predicate", columnId, operator: "gt", value },
  });

  it("names an amount no operation uses", () => {
    const { input, mentions } = read("accounts over $1m grouped by custodian");
    expect(unusedReadings(input, mentions, [{ type: "group.set", columnIds: ["custodian"] }])).toEqual([{ clauseIndex: 0, text: "$1m" }]);
    expect(unusedReadings(input, mentions, [gt("value", 1_000_000), { type: "group.set", columnIds: ["custodian"] }])).toEqual([]);
  });

  it("names a column, a value, and a count no operation uses", () => {
    const one = read("sort by gain and hide custodian");
    expect(unusedReadings(one.input, one.mentions, [{ type: "sort.set", sorts: [{ columnId: "gain", direction: "asc" }] }])).toEqual([
      { clauseIndex: 1, text: "custodian" },
    ]);
    const two = read("northgate accounts sorted by gain");
    expect(unusedReadings(two.input, two.mentions, [{ type: "sort.set", sorts: [{ columnId: "gain", direction: "asc" }] }])).toEqual([
      { clauseIndex: 0, text: "northgate" },
    ]);
    const three = read("top 10 accounts by value");
    expect(unusedReadings(three.input, three.mentions, [{ type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }])).toEqual([
      { clauseIndex: 0, text: "top 10" },
    ]);
  });

  it("counts an excluded value as used when a filter leaves it out", () => {
    const { input, mentions } = read("accounts not at northgate");
    const leaves = (value: unknown, operator: "eq" | "neq" | "in"): ViewOperation => ({
      type: "filter.add",
      combineWith: "and",
      predicate: { id: "f", type: "predicate", columnId: "custodian", operator, value: value as string },
    });
    expect(unusedReadings(input, mentions, [leaves("harborline", "eq")], [], "account")).toEqual([]);
    expect(unusedReadings(input, mentions, [leaves("northgate", "neq")], [], "account")).toEqual([]);
    expect(unusedReadings(input, mentions, [leaves("northgate", "eq")], [], "account")).toEqual([{ clauseIndex: 0, text: "northgate" }]);
  });

  it("doesn't count a dropped name, a cleared part, or a count the grid can't apply", () => {
    const dropped = read("sort by gain and hide custodian");
    const sort: ViewOperation = { type: "sort.set", sorts: [{ columnId: "gain", direction: "asc" }] };
    expect(
      unusedReadings(dropped.input, dropped.mentions, [sort], [{ key: "dropped:c1.mention", selectedId: "custodian", source: "provider" }]),
    ).toEqual([]);
    const cleared = read("clear sorting by value");
    expect(cleared.mentions.map((m) => m.columnId)).toEqual(["value"]);
    expect(
      unusedReadings(
        cleared.input,
        cleared.mentions,
        [{ type: "sort.set", sorts: [] }],
        [{ key: "c0.family", selectedId: "sort.clear", source: "provider" }],
      ),
    ).toEqual([]);
    const count = read("top 10 accounts by value");
    expect(
      unusedReadings(
        count.input,
        count.mentions,
        [{ type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }],
        [{ key: "dropped:c0.limit", selectedId: "10", source: "host" }],
      ),
    ).toEqual([]);
  });

  it("turns a ready plan into a question that names what was left over, never the reverse", () => {
    const text = "group by custodian over $1m";
    const plan = compile({
      input: normalize(text),
      mentions: matchMentions(normalize(text).clauses, schema.columns, { rowNoun: "account" }),
      resolution: {
        clauses: [{ clauseIndex: 0, families: [{ id: "group", confidence: 0.95 }], columns: [], values: [], unmatchedTerms: [] }],
      },
      schema,
      state: emptyViewState(schema.columns.map((c) => c.id)),
      baseRevision: "r1",
      channel: "typed",
      newId: (p) => p,
    });
    expect(plan.status).toBe("needs_clarification");
    expect(plan.operations).toEqual([]);
    expect(plan.clarifications).toEqual([
      { id: "c0.unused", prompt: "I'm not sure what to do with “$1m”. Try rephrasing that part.", required: true },
    ]);
  });
});

// Found by the targeted re-check after round six, and fixed by the lead after it (so not held-out evidence).
describe("after the sixth round's re-check", () => {
  it("asks about a range written high to low with a scale on only one bound", () => {
    expect(literal("value between $1m and $2")).toMatchObject({ kind: "unreadable" });
    expect(literal("value between $2k and $5")).toMatchObject({ kind: "unreadable" });
    // Bounds at like scales are still swapped into order, and rising ranges read as written.
    expect(literal("value between $5m and $1m")).toMatchObject({ value: 1_000_000, upper: 5_000_000 });
    expect(literal("value between $2m and $500k")).toMatchObject({ value: 500_000, upper: 2_000_000 });
    expect(literal("value between $999 and $2k")).toMatchObject({ value: 999, upper: 2_000 });
    expect(literal("weight between 30% and 10%")).toMatchObject({ value: 0.1, upper: 0.3 });
  });

  it("states an amount in the Preview exactly, cents and decimals included", async () => {
    expect((await propose("market value over $1.50")).preview?.lines).toEqual(["Filter Market value above $1.50"]);
    expect((await propose("gain over $0.5")).preview?.lines).toEqual(["Filter Gain above $0.50"]);
    expect((await propose("market value over $1m")).preview?.lines).toEqual(["Filter Market value above $1,000,000"]);
    expect((await propose("concentration over 29.25%")).preview?.lines).toEqual(["Filter Concentration above 29.25%"]);
    expect((await propose("concentration over 10%")).preview?.lines).toEqual(["Filter Concentration above 10%"]);
  });
});
