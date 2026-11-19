import { describe, expect, it } from "vitest";
import { readCodeFilters, timeWordsOutside } from "../src/core/code-read";
import { createGridCue, type GridCueOptions } from "../src/core/controller";
import { isGridCueError } from "../src/core/errors";
import { matchMentions } from "../src/core/mentions";
import { normalize, withoutNamedSizes } from "../src/core/normalize";
import { renderPreview } from "../src/core/preview";
import type { ViewOperation, ViewSchema } from "../src/core/protocol";
import type { ClauseResolution, IntentProvider, ResolutionRequest } from "../src/core/resolution";
import { applyView, createRowsAdapter } from "../src/core/rows-adapter";
import { type ColumnInput, defineSchema, isExposed, type SchemaOptions } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

// Dates (named filters spec, 5.5; ADR 0026). A relative date form ("last 90 days") and a range of two ISO dates are
// code-read filters: their days are worked out once, from the Controller's clock and the schema's Calendar, and the view
// keeps two fixed days with today's operators. Every other time word asks and is never dropped. Nothing here reads the
// machine's own time zone: each schema names one.

// The spec's own grid: accounts with an opening date and a last contact, at the spec's own day, 2026-11-13.
const columns: ColumnInput[] = [
  { id: "account_number", label: "Account number" },
  { id: "advisor_name", label: "Advisor" },
  { id: "registration_type", label: "Registration type" },
  { id: "opened", label: "Opened date" },
  { id: "last_contact", label: "Last contact" },
  { id: "market_value", label: "Market value" },
];
const options: SchemaOptions = {
  rowNoun: "account",
  columns: {
    account_number: { aliases: ["account"] },
    advisor_name: { aliases: ["advisor"] },
    registration_type: {
      enumValues: [
        { id: "taxable", label: "Taxable" },
        { id: "trust", label: "Trust" },
      ],
    },
    opened: { kind: "date", aliases: ["opened"] },
    last_contact: { kind: "datetime", aliases: ["contacted"] },
    market_value: { kind: "currency", aliases: ["value"] },
  },
};
const NEW_YORK = { timeZone: "America/New_York", fiscalYearStart: 1 };
const accounts = defineSchema(columns, { ...options, calendar: NEW_YORK });
/** 10:00 in New York on 2026-11-13. */
const NOW = "2026-11-13T15:00:00.000Z";
const mock = createMockProvider({ defaultColumnForKind: { currency: "market_value" } });

const make = (schema: ViewSchema = accounts, extra: Partial<GridCueOptions> = {}) => {
  const adapter = createRowsAdapter({ schema });
  const cue = createGridCue({ adapter, provider: mock, now: () => new Date(NOW), ...extra });
  return { adapter, cue };
};
const propose = async (text: string, schema: ViewSchema = accounts, extra: Partial<GridCueOptions> = {}) => {
  const { cue } = make(schema, extra);
  await cue.propose(text);
  return cue.getState();
};
const filters = (ops: readonly ViewOperation[] | undefined) =>
  (ops ?? []).flatMap((op) =>
    op.type === "filter.add"
      ? [[op.predicate.columnId, op.predicate.operator, ...(op.predicate.value === undefined ? [] : [op.predicate.value])]]
      : [],
  );
/** Ready, with these filters and nothing else, and these Preview lines and notes if given. */
const reads = async (
  text: string,
  want: ReadonlyArray<readonly unknown[]>,
  lines?: string[],
  notes: string[] = [],
  schema: ViewSchema = accounts,
  extra: Partial<GridCueOptions> = {},
) => {
  const state = await propose(text, schema, extra);
  expect(state.status, `${text}: ${state.message}`).toBe("ready");
  expect(filters(state.plan?.operations), text).toEqual(want);
  if (lines) {
    expect(state.preview?.lines, text).toEqual(lines);
    expect(state.preview?.notes, text).toEqual(notes);
  }
  return state;
};
/** Not ready; with `prompt`, asking exactly that first. */
const asks = async (text: string, prompt?: string, schema: ViewSchema = accounts, extra: Partial<GridCueOptions> = {}) => {
  const state = await propose(text, schema, extra);
  expect(state.status, `${text}: ${JSON.stringify(state.plan?.operations)}`).not.toBe("ready");
  if (prompt) expect(state.plan?.clarifications[0]?.prompt, text).toBe(prompt);
  return state;
};
const dates = (words: string) => `I'm not sure which dates “${words}” means. Use dates like 2026-01-31, or “last 90 days”.`;
const between = (min: string, max: string) => ({ min, max });

/** A provider that answers every part with the same proposal, and records each request it is sent. */
const scripted = (answer: Omit<ClauseResolution, "clauseIndex">) => {
  const requests: ResolutionRequest[] = [];
  const provider: IntentProvider = {
    resolve: async (request) => {
      requests.push(structuredClone(request));
      return { clauses: request.clauses.map((c) => ({ clauseIndex: c.index, ...structuredClone(answer) })) };
    },
  };
  return { provider, requests };
};

describe("the forms (spec 5.5, the first table), on 2026-11-13 with the year starting in January", () => {
  it("today, yesterday: that day", async () => {
    await reads("accounts opened today", [["opened", "eq", "2026-11-13"]], ["Filter Opened date on 2026-11-13 (today)"]);
    await reads("opened yesterday", [["opened", "eq", "2026-11-12"]], ["Filter Opened date on 2026-11-12 (yesterday)"]);
  });

  it("last N days, past N days, and weeks, months and years: from N units before today through today", async () => {
    await reads("opened in the last 90 days", [["opened", "between", between("2026-08-15", "2026-11-13")]]);
    await reads("opened in the past 30 days", [["opened", "between", between("2026-10-14", "2026-11-13")]]);
    // A week is 7 days.
    await reads("opened in the last 2 weeks", [["opened", "between", between("2026-10-30", "2026-11-13")]]);
    await reads("opened in the last 1 week", [["opened", "between", between("2026-11-06", "2026-11-13")]]);
    await reads("opened in the last 3 months", [["opened", "between", between("2026-08-13", "2026-11-13")]]);
    await reads("opened in the past 2 years", [["opened", "between", between("2024-11-13", "2026-11-13")]]);
    // A month day that doesn't exist is that month's last day: 2026-05-31 less 3 months is 2026-02-28.
    const may = { now: () => new Date("2026-05-31T15:00:00.000Z") };
    await reads("opened in the last 3 months", [["opened", "between", between("2026-02-28", "2026-05-31")]], undefined, [], accounts, may);
    // N is a whole number from 1 to 999, in digits; anything else is no form, and asks.
    await reads("opened in the last 999 days", [["opened", "between", between("2024-02-18", "2026-11-13")]]);
    await asks("opened in the last 0 days", dates("last 0 days"));
    await asks("opened in the last 1000 days", dates("last 1000 days"));
    await asks("opened in the last ninety days");
    await asks("opened in the last 2 day", dates("last 2 day"));
  });

  it("this month, this quarter, this year: the whole period that holds today", async () => {
    await reads("opened this month", [["opened", "between", between("2026-11-01", "2026-11-30")]]);
    await reads("opened this quarter", [["opened", "between", between("2026-10-01", "2026-12-31")]]);
    await reads("opened this year", [["opened", "between", between("2026-01-01", "2026-12-31")]]);
  });

  it("last month, last quarter, last year: the whole period before it", async () => {
    await reads("opened last month", [["opened", "between", between("2026-10-01", "2026-10-31")]]);
    await reads(
      "opened last quarter",
      [["opened", "between", between("2026-07-01", "2026-09-30")]],
      ["Filter Opened date from 2026-07-01 to 2026-09-30 (last quarter)"],
    );
    await reads("opened last year", [["opened", "between", between("2025-01-01", "2025-12-31")]]);
  });

  it("month, quarter and year to date, MTD, QTD and YTD: from the period's first day through today", async () => {
    await reads("opened month to date", [["opened", "between", between("2026-11-01", "2026-11-13")]]);
    await reads("opened quarter to date", [["opened", "between", between("2026-10-01", "2026-11-13")]]);
    await reads("opened year to date", [["opened", "between", between("2026-01-01", "2026-11-13")]]);
    await reads(
      "opened MTD",
      [["opened", "between", between("2026-11-01", "2026-11-13")]],
      ["Filter Opened date from 2026-11-01 to 2026-11-13 (MTD)"],
    );
    await reads(
      "opened qtd",
      [["opened", "between", between("2026-10-01", "2026-11-13")]],
      ["Filter Opened date from 2026-10-01 to 2026-11-13 (QTD)"],
    );
  });

  it("between A and B, from A to B, from A through B: both ends included, swapped when written high to low", async () => {
    const q1 = [["opened", "between", between("2026-01-01", "2026-03-31")]];
    await reads("opened between 2026-01-01 and 2026-03-31", q1, ["Filter Opened date from 2026-01-01 to 2026-03-31"]);
    await reads("opened from 2026-01-01 to 2026-03-31", q1);
    await reads("opened from 2026-01-01 through 2026-03-31", q1);
    await reads("opened between 2026-03-31 and 2026-01-01", q1);
    // Both ends must be real days; one that isn't asks as it did.
    await asks("opened between 2026-02-30 and 2026-03-31", "2026-02-30 isn't a date.");
  });

  it("one ISO date with a comparison: as today", async () => {
    await reads("opened after 2026-01-31", [["opened", "gt", "2026-01-31"]], ["Filter Opened date after 2026-01-31"]);
    await reads("opened on or after 2026-01-31", [["opened", "gte", "2026-01-31"]], ["Filter Opened date on or after 2026-01-31"]);
    await reads("opened before 2026-01-31", [["opened", "lt", "2026-01-31"]], ["Filter Opened date before 2026-01-31"]);
    await reads("opened on or before 2026-01-31", [["opened", "lte", "2026-01-31"]], ["Filter Opened date on or before 2026-01-31"]);
    await reads("opened on 2026-01-31", [["opened", "eq", "2026-01-31"]], ["Filter Opened date on 2026-01-31"]);
  });

  it("follows the lead-ins the spec lists: in, in the, over the, during, during the, within the, for the", async () => {
    const quarter = [["opened", "between", between("2026-10-01", "2026-12-31")]];
    for (const lead of ["in", "during", "during the"]) await reads(`opened ${lead} this quarter`, quarter);
    const days = [["opened", "between", between("2026-08-15", "2026-11-13")]];
    for (const lead of ["in the", "over the", "within the", "for the"]) await reads(`opened ${lead} last 90 days`, days);
  });

  it("asks for a comparison word before a relative form", async () => {
    await asks("opened before this quarter", dates("before this quarter"));
    await asks("opened since last month", dates("since last month"));
    await asks("opened after last month", dates("after last month"));
    await asks("opened over last year", dates("over last year"));
  });

  it("places quarters and years by the Calendar's first month", async () => {
    const april = defineSchema(columns, { ...options, calendar: { timeZone: "America/New_York", fiscalYearStart: 4 } });
    await reads("opened this quarter", [["opened", "between", between("2026-10-01", "2026-12-31")]], undefined, [], april);
    await reads("opened this year", [["opened", "between", between("2026-04-01", "2027-03-31")]], undefined, [], april);
    await reads("opened last year", [["opened", "between", between("2025-04-01", "2026-03-31")]], undefined, [], april);
    await reads("opened YTD", [["opened", "between", between("2026-04-01", "2026-11-13")]], undefined, [], april);
    // Months are calendar months.
    await reads("opened this month", [["opened", "between", between("2026-11-01", "2026-11-30")]], undefined, [], april);
  });

  it("takes today in the Calendar's time zone, either side of midnight", async () => {
    // 03:00 UTC on 2026-11-14 is still 2026-11-13 in New York, and already 2026-11-14 in Auckland.
    const late = { now: () => new Date("2026-11-14T03:00:00.000Z") };
    await reads("opened today", [["opened", "eq", "2026-11-13"]], undefined, [], accounts, late);
    const auckland = defineSchema(columns, { ...options, calendar: { timeZone: "Pacific/Auckland" } });
    await reads("opened today", [["opened", "eq", "2026-11-14"]], undefined, [], auckland, late);
  });
});

describe("the requests (spec 5.5, the second table)", () => {
  it("“accounts opened in the last 90 days”", async () => {
    await reads(
      "accounts opened in the last 90 days",
      [["opened", "between", between("2026-08-15", "2026-11-13")]],
      ["Filter Opened date from 2026-08-15 to 2026-11-13 (last 90 days)"],
    );
  });

  it("“taxable accounts opened this quarter”", async () => {
    await reads(
      "taxable accounts opened this quarter",
      [
        ["registration_type", "eq", "taxable"],
        ["opened", "between", between("2026-10-01", "2026-12-31")],
      ],
      ["Filter Registration type to Taxable", "Filter Opened date from 2026-10-01 to 2026-12-31 (this quarter)"],
    );
  });

  it("“opened YTD”", async () => {
    await reads(
      "opened YTD",
      [["opened", "between", between("2026-01-01", "2026-11-13")]],
      ["Filter Opened date from 2026-01-01 to 2026-11-13 (YTD)"],
    );
  });

  it("“opened between 2026-01-01 and 2026-03-31”", async () => {
    await reads(
      "opened between 2026-01-01 and 2026-03-31",
      [["opened", "between", between("2026-01-01", "2026-03-31")]],
      ["Filter Opened date from 2026-01-01 to 2026-03-31"],
    );
  });

  it("“accounts opened after 2026-01-31”", async () => {
    await reads("accounts opened after 2026-01-31", [["opened", "gt", "2026-01-31"]], ["Filter Opened date after 2026-01-31"]);
  });

  it("“accounts contacted this week”, “contacted last week”", async () => {
    await asks("accounts contacted this week", dates("this week"));
    await asks("contacted last week", dates("last week"));
  });

  // PR 1 asked here ("Last contact holds times of day …"). With whole-day filtering the question is removed.
  it("“last contact after 2026-01-31”, a date-and-time column: Filter Last contact after 2026-01-31, with the note", async () => {
    await reads(
      "last contact after 2026-01-31",
      [["last_contact", "gt", "2026-01-31"]],
      ["Filter Last contact after 2026-01-31"],
      ["Whole days, in America/New_York time"],
    );
    // The rows are whole days in New York: 23:30 there on the 31st is not after it, 00:30 on the 1st is.
    const { adapter, cue } = make();
    await cue.propose("last contact after 2026-01-31");
    await cue.apply();
    const rows = [
      { account_number: "A1", last_contact: "2026-02-01T04:30:00.000Z" },
      { account_number: "A2", last_contact: "2026-02-01T05:30:00.000Z" },
      { account_number: "A3", last_contact: new Date("2026-01-31T14:00:00.000Z") },
    ];
    expect(applyView(rows, adapter.getState().state, accounts).rows.map((r) => r.account_number)).toEqual(["A2"]);
  });
  it("a date form on a date-and-time column reads, with the whole-days note", async () => {
    await reads(
      "accounts contacted in the last 90 days",
      [["last_contact", "between", between("2026-08-15", "2026-11-13")]],
      ["Filter Last contact from 2026-08-15 to 2026-11-13 (last 90 days)"],
      ["Whole days, in America/New_York time"],
    );
    await reads(
      "accounts contacted after 2026-01-31",
      [["last_contact", "gt", "2026-01-31"]],
      ["Filter Last contact after 2026-01-31"],
      ["Whole days, in America/New_York time"],
    );
  });

  it("“opened before this quarter”, “opened 90 days ago”, “opened in 2024”, “opened after Jan 31, 2026”", async () => {
    await asks("opened before this quarter", dates("before this quarter"));
    await asks("opened 90 days ago", dates("90 days ago"));
    await asks("opened in 2024", dates("2024"));
    await asks("opened after Jan 31, 2026", dates("after jan 31, 2026"));
  });

  it("“taxable accounts since january”", async () => {
    await asks("taxable accounts since january", dates("since january"));
  });

  it("“accounts over $1m in the last 90 days”: the amount as today, and the date the provider's pick or a question", async () => {
    const state = await asks("accounts over $1m in the last 90 days", "Which date column should “last 90 days” filter?");
    expect(state.plan?.clarifications[0]?.options?.map((o) => o.id)).toEqual(["opened", "last_contact"]);
    // With the provider's confident pick of a date column, the date takes it.
    const { provider } = scripted({
      families: [{ id: "filter", confidence: 0.95 }],
      columns: [
        { id: "market_value", confidence: 0.95 },
        { id: "opened", confidence: 0.9 },
      ],
      values: [],
      literalColumns: [{ literalIndex: 0, columnId: "market_value", confidence: 0.95 }],
      unmatchedTerms: [],
    });
    await reads(
      "accounts over $1m in the last 90 days",
      [
        ["market_value", "gt", 1_000_000],
        ["opened", "between", between("2026-08-15", "2026-11-13")],
      ],
      undefined,
      [],
      accounts,
      { provider },
    );
  });
});

describe("which column a date goes to", () => {
  it("is the one named right before it, also after the Row Noun or a value", async () => {
    await reads("accounts opened this quarter", [["opened", "between", between("2026-10-01", "2026-12-31")]]);
    await reads("trust accounts opened after 2026-01-31", [
      ["registration_type", "eq", "trust"],
      ["opened", "gt", "2026-01-31"],
    ]);
    await reads("opened is today", [["opened", "eq", "2026-11-13"]]);
  });

  it("asks which date column when none is named, and takes the User's answer", async () => {
    const { cue } = make();
    await cue.propose("accounts in the last 90 days");
    const state = cue.getState();
    const question = state.plan?.clarifications[0];
    expect(question?.prompt).toBe("Which date column should “last 90 days” filter?");
    cue.answer(question?.id ?? "", "last_contact");
    expect(cue.getState().status).toBe("ready");
    expect(filters(cue.getState().plan?.operations)).toEqual([["last_contact", "between", between("2026-08-15", "2026-11-13")]]);
  });

  it("never takes a column the part names for another change", async () => {
    const { provider } = scripted({
      families: [
        { id: "filter", confidence: 0.95 },
        { id: "sort", confidence: 0.95 },
      ],
      columns: [{ id: "opened", confidence: 0.95 }],
      values: [],
      unmatchedTerms: [],
    });
    await asks("accounts this quarter sorted by opened", "Which date column should “this quarter” filter?", accounts, { provider });
  });

  it("asks when the Host's operators leave out the filter a date needs", async () => {
    const narrow = defineSchema(columns, {
      ...options,
      calendar: NEW_YORK,
      columns: { ...options.columns, opened: { kind: "date", aliases: ["opened"], allowedOperators: ["eq", "gt", "lt"] } },
    });
    await asks("opened this quarter", "GridCue can't filter Opened date by “this quarter” here. Try a different filter.", narrow);
    await reads("opened today", [["opened", "eq", "2026-11-13"]], undefined, [], narrow);
    // With no column named, a date column whose operators leave it out is never offered.
    const state = await asks("accounts this quarter", undefined, narrow);
    expect(state.plan?.clarifications[0]?.options?.map((o) => o.id)).toEqual(["last_contact"]);
  });

  it("asks when the column named right before it holds no dates", async () => {
    await asks("value last month", "Market value can't be compared with “last month”. Name a column that holds dates.");
  });

  it("asks on a grid with no date column", async () => {
    const { opened: _opened, last_contact: _contact, ...undated } = options.columns ?? {};
    const plain = defineSchema(
      columns.filter((c) => c.id !== "opened" && c.id !== "last_contact"),
      { ...options, columns: undated },
    );
    await asks("accounts year to date", "This grid has no date column for “year to date”.", plain);
  });

  it("asks where a column goes: “sort by last month”, “the this quarter column”", async () => {
    await asks("sort by last month", "“last month” stands for rows, not a column. Name a column instead.");
    await asks("group by opened this quarter");
  });
});

describe("every other time word asks and is never dropped", () => {
  it("asks for each kind the spec lists, with the words around it", async () => {
    await asks("accounts opened this week", dates("this week"));
    await asks("accounts opened last week", dates("last week"));
    await asks("trust accounts opened in the next 30 days", dates("next 30 days"));
    await asks("recent trust accounts", dates("recent"));
    await asks("trust accounts opened in march", dates("march"));
    await asks("trust accounts opened may 3", dates("may 3"));
    await asks("trust accounts opened after 1/31/2026", dates("after 1/31/2026"));
    await asks("trust accounts opened in q1", dates("q1"));
    await asks("trust accounts opened on monday", dates("monday"));
    await asks("trust accounts over $1m opened 2 years ago", dates("2 years ago"));
  });

  it("asks in a part with no date form or code-read filter, which was ready before", async () => {
    // Before, the date was dropped and the Preview showed every trust account.
    await asks("trust accounts since january", dates("since january"));
    await asks("trust accounts this week", dates("this week"));
  });

  it("reads none in a declared name or quoted text, and none in “next to” or “may” before a word", async () => {
    const yearly = defineSchema([...columns, { id: "fiscal_year", label: "Fiscal year" }, { id: "term", label: "Term" }], {
      ...options,
      columns: {
        ...options.columns,
        term: {
          kind: "enum",
          enumValues: [
            { id: "monthly", label: "Monthly" },
            { id: "annual", label: "Annual" },
          ],
        },
      },
    });
    await reads("annual accounts", [["term", "eq", "annual"]], undefined, [], yearly);
    await reads('fiscal year containing "2024"', [["fiscal_year", "contains", "2024"]], undefined, [], yearly);
    await reads('advisor containing "week"', [["advisor_name", "contains", "week"]]);
    const said = (text: string) => {
      const [clause] = normalize(text).clauses;
      return clause ? timeWordsOutside(clause, [], [], accounts)?.text : undefined;
    };
    expect(said("put advisor next to value")).toBeUndefined();
    expect(said("trust accounts that may be large")).toBeUndefined();
    expect(said("trust accounts next week")).toBe("next week");
    expect(said("trust accounts in may 2026")).toBe("may 2026");
  });

  it("asks without a clock: with no today, a relative form is no form", () => {
    const input = normalize("opened in the last 90 days", { calendar: NEW_YORK });
    expect(input.clauses[0]?.literals).toEqual([{ kind: "number", value: 90, at: 19 }]);
    expect(readCodeFilters(input, [], accounts)).toEqual([]);
  });
});

describe("a date form is a code-read filter (spec 4.1, 4.2)", () => {
  it("drops a provider's sort, group, column or value for the form's own words", async () => {
    const { provider } = scripted({
      families: [
        { id: "filter", confidence: 0.95 },
        { id: "sort", confidence: 0.9 },
        { id: "group", confidence: 0.9 },
      ],
      columns: [
        { id: "opened", confidence: 0.95 },
        { id: "market_value", confidence: 0.9 },
      ],
      values: [{ columnId: "registration_type", valueId: "trust", confidence: 0.9 }],
      direction: { id: "desc", confidence: 0.9 },
      unmatchedTerms: [],
    });
    const state = await reads(
      "accounts opened this quarter",
      [["opened", "between", between("2026-10-01", "2026-12-31")]],
      undefined,
      [],
      accounts,
      {
        provider,
      },
    );
    expect(state.plan?.operations.map((op) => op.type)).toEqual(["filter.add"]);
    const dropped = state.plan?.evidence.filter((e) => e.key.startsWith("dropped:")).map((e) => e.selectedId);
    expect(dropped).toEqual(expect.arrayContaining(["market_value", "registration_type=trust", "sort", "group"]));
  });

  it("keeps a change the part asks for in its own words", async () => {
    const { provider } = scripted({
      families: [
        { id: "filter", confidence: 0.95 },
        { id: "sort", confidence: 0.95 },
      ],
      columns: [{ id: "market_value", confidence: 0.95 }],
      values: [],
      direction: { id: "desc", confidence: 0.95 },
      unmatchedTerms: [],
    });
    const state = await reads(
      "accounts opened this quarter sorted by value",
      [["opened", "between", between("2026-10-01", "2026-12-31")]],
      undefined,
      [],
      accounts,
      {
        provider,
      },
    );
    expect(state.plan?.operations.at(-1)).toEqual({ type: "sort.set", sorts: [{ columnId: "market_value", direction: "desc" }] });
  });

  it("asks about a word it can't place", async () => {
    await asks("accounts we opened this quarter", "I'm not sure what to do with “we”. Try rephrasing that part.");
    // "Within" leads a form only with "the"; "opened" is no column of the form then, and nothing else reads it.
    await asks("accounts opened within last 30 days", "I'm not sure what to do with “opened within”. Try rephrasing that part.");
  });

  it("asks for a statement", async () => {
    await asks("accounts were opened last quarter", "I'm not sure what to do with “were”. Try rephrasing that part.");
    await asks("the accounts are in the last 90 days", "I'm not sure what to do with “are”. Try rephrasing that part.");
    await asks("every opened is today", "I'm not sure what to do with “every”. Try rephrasing that part.");
  });

  it("asks where rows are left out, and for “or”", async () => {
    await asks("hide accounts opened last month");
    await asks("accounts not opened last month");
    await asks("accounts opened this month or last month");
  });

  it("asks when its days and another filter on its column keep no row", async () => {
    const { cue } = make();
    await cue.propose("accounts opened this month and last month");
    const question = cue.getState().plan?.clarifications[0];
    cue.answer(question?.id ?? "", "opened");
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().plan?.clarifications[0]?.prompt).toBe(
      "No row matches every Opened date filter, so the view would be empty. Ask for the rows to keep.",
    );
  });

  it("asks when a column asked for beside it is not in the plan", async () => {
    const { provider } = scripted({ families: [{ id: "filter", confidence: 0.95 }], columns: [], values: [], unmatchedTerms: [] });
    await asks("show only advisor for accounts opened this quarter", undefined, accounts, { provider });
  });
});

describe("the Calendar and the clock", () => {
  it("holds a time zone and the year's first month, and nothing else", () => {
    const code = (calendar: unknown) => {
      try {
        defineSchema(columns, { ...options, calendar } as SchemaOptions);
        return "ok";
      } catch (error) {
        return isGridCueError(error) ? error.code : "other";
      }
    };
    expect(code({ timeZone: "America/New_York", fiscalYearStart: 4 })).toBe("ok");
    expect(code({})).toBe("ok");
    expect(code({ timeZone: "Mars/Olympus" })).toBe("INPUT_SCHEMA");
    expect(code({ timeZone: "" })).toBe("INPUT_SCHEMA");
    expect(code({ fiscalYearStart: 0 })).toBe("INPUT_SCHEMA");
    expect(code({ fiscalYearStart: 13 })).toBe("INPUT_SCHEMA");
    expect(code({ fiscalYearStart: 1.5 })).toBe("INPUT_SCHEMA");
    expect(code({ timeZone: "UTC", locale: "en-US" })).toBe("INPUT_SCHEMA");
    expect(code("America/New_York")).toBe("INPUT_SCHEMA");
    expect(defineSchema(columns, { ...options, calendar: { fiscalYearStart: 4 } }).calendar).toEqual({ fiscalYearStart: 4 });
  });

  it("stops the request with INPUT_CLOCK when the clock throws or gives no valid time, and changes nothing", async () => {
    for (const now of [
      () => {
        throw new Error("No clock.");
      },
      () => new Date(Number.NaN),
      () => "2026-11-13" as unknown as Date,
    ]) {
      const { adapter, cue } = make(accounts, { now });
      const before = adapter.getState();
      expect(await cue.propose("accounts opened last month")).toBeNull();
      const state = cue.getState();
      expect(state.status).toBe("error");
      expect(state.issues.map((i) => i.code)).toEqual(["INPUT_CLOCK"]);
      expect(state.message).toBe("Couldn't read today's date. The view hasn't changed.");
      expect(adapter.getState()).toEqual(before);
    }
  });

  it("leaves a request the clock cancelled idle, and never calls the provider for it", async () => {
    for (const fails of [true, false]) {
      const { provider, requests } = scripted({ families: [], columns: [], values: [], unmatchedTerms: [] });
      const adapter = createRowsAdapter({ schema: accounts });
      const cue = createGridCue({
        adapter,
        provider,
        now: () => {
          cue.cancel();
          if (fails) throw new Error("No clock.");
          return new Date(NOW);
        },
      });
      expect(await cue.propose("accounts opened last month")).toBeNull();
      expect(cue.getState().status, `fails: ${fails}`).toBe("idle");
      expect(cue.getState().issues).toEqual([]);
      expect(requests, `fails: ${fails}`).toHaveLength(0);
    }
  });

  it("reads the clock only for a relative form", async () => {
    let calls = 0;
    const now = () => {
      calls++;
      return new Date(NOW);
    };
    await reads(
      "opened between 2026-01-01 and 2026-03-31",
      [["opened", "between", between("2026-01-01", "2026-03-31")]],
      undefined,
      [],
      accounts,
      { now },
    );
    await reads("trust accounts", [["registration_type", "eq", "trust"]], undefined, [], accounts, { now });
    expect(calls).toBe(0);
    await reads("opened last month", [["opened", "between", between("2026-10-01", "2026-10-31")]], undefined, [], accounts, { now });
    expect(calls).toBe(1);
  });

  it("refuses a `now` that is not a function", () => {
    expect(() => make(accounts, { now: "today" as unknown as () => Date })).toThrow(expect.objectContaining({ code: "INPUT_CONFIG" }));
  });

  it("sends the provider the same request with any clock and any Calendar (spec 4.3)", async () => {
    const plain = defineSchema(columns, options);
    const sent: string[] = [];
    for (const [schema, now] of [
      [accounts, NOW],
      [plain, NOW],
      [accounts, "2030-02-01T12:00:00.000Z"],
    ] as const) {
      const { provider, requests } = scripted({ families: [], columns: [], values: [], unmatchedTerms: [] });
      await propose("taxable accounts opened in the last 90 days, between 2026-01-01 and 2026-03-31", schema, {
        provider,
        now: () => new Date(now),
      });
      sent.push(JSON.stringify(requests));
    }
    expect(new Set(sent).size).toBe(1);
    // The days and the words are core's: the request holds the number it held before.
    expect(sent[0]).toContain('"kind":"number","value":90');
    expect(sent[0]).not.toContain("2026-08-15");
  });
});

describe("normalize with a day and a Calendar", () => {
  it("reads a relative form as its fixed days, with its words", () => {
    const [clause] = normalize("opened in the last 90 days", { today: "2026-11-13", calendar: NEW_YORK }).clauses;
    expect(clause?.literals).toEqual([
      { kind: "date", value: "2026-08-15", upper: "2026-11-13", comparator: "between", at: 14, words: "last 90 days" },
    ]);
    const [today] = normalize("opened today", { today: "2026-11-13" }).clauses;
    expect(today?.literals).toEqual([{ kind: "date", value: "2026-11-13", at: 7, words: "today" }]);
  });

  it("reads two ISO dates as one range, with no today needed", () => {
    const [clause] = normalize("opened between 2026-03-31 and 2026-01-01", {}).clauses;
    expect(clause?.literals).toEqual([{ kind: "date", value: "2026-01-01", upper: "2026-03-31", comparator: "between", at: 15 }]);
    // Without options, the literals are the ones the provider is sent, as before.
    expect(normalize("opened between 2026-03-31 and 2026-01-01").clauses[0]?.literals).toHaveLength(2);
  });

  it("places quarters by the Calendar's first month, and refuses a today that is not a day", () => {
    const [clause] = normalize("opened this quarter", { today: "2026-11-13", calendar: { fiscalYearStart: 2 } }).clauses;
    expect(clause?.literals[0]).toMatchObject({ value: "2026-11-01", upper: "2027-01-31" });
    expect(() => normalize("opened today", { today: "2026-02-30" })).toThrow(expect.objectContaining({ code: "INPUT_CLOCK" }));
  });

  it("previews a compiled literal with its words", async () => {
    const plan = {
      operations: [
        {
          type: "filter.add" as const,
          combineWith: "and" as const,
          predicate: {
            id: "f1",
            type: "predicate" as const,
            columnId: "last_contact",
            operator: "between" as const,
            value: between("2026-08-15", "2026-11-13"),
          },
        },
      ],
      evidence: [{ key: "c0.dateWords.f1", selectedId: "last 90 days", confidence: 1, source: "deterministic" as const }],
    };
    expect(renderPreview(plan, accounts)).toMatchObject({
      lines: ["Filter Last contact from 2026-08-15 to 2026-11-13 (last 90 days)"],
      notes: ["Whole days, in America/New_York time"],
    });
  });
});

describe("a date form's words inside a name", () => {
  // Names that hold a date form's words: two percent columns, and advisors the grid holds.
  const returns = defineSchema(
    [...columns, { id: "last_month_return", label: "Last month return" }, { id: "ytd_return", label: "YTD return" }],
    {
      ...options,
      calendar: NEW_YORK,
      columns: { ...options.columns, last_month_return: { kind: "percent" }, ytd_return: { kind: "percent" } },
    },
  );
  const localValues = { advisor_name: () => ["Last Year Capital", "Today Partners", "This Month Media"] };
  const quarter = ["opened", "between", between("2026-10-01", "2026-12-31")] as const;

  it("are the name's: a column's label is never read as a date", async () => {
    await reads("sort by last month return", [], undefined, [], returns);
    await reads("hide YTD return", [], undefined, [], returns);
    await reads("accounts with YTD return over 5%", [["ytd_return", "gt", 0.05]], undefined, [], returns);
    await reads("last month return over 5%", [["last_month_return", "gt", 0.05]], undefined, [], returns);
    // The date form outside the name is read; the name's words are not a second one.
    for (const text of [
      "accounts with last month return over 5% opened this quarter",
      "accounts with YTD return over 5% opened this quarter",
    ]) {
      const state = await propose(text, returns);
      const opened = filters(state.plan?.operations).filter((f) => f[0] === "opened");
      expect(opened.length <= 1 && opened.every((f) => JSON.stringify(f) === JSON.stringify(quarter)), text).toBe(true);
    }
  });

  it("are the name's: a Local Value is never read as a date", async () => {
    await reads("Last Year Capital", [["advisor_name", "eq", "Last Year Capital"]], undefined, [], accounts, { localValues });
    await reads("accounts for Today Partners", [["advisor_name", "eq", "Today Partners"]], undefined, [], accounts, { localValues });
    await reads("This Month Media accounts", [["advisor_name", "eq", "This Month Media"]], undefined, [], accounts, { localValues });
    await reads(
      "accounts for Last Year Capital opened this quarter",
      [["advisor_name", "eq", "Last Year Capital"], quarter],
      undefined,
      [],
      accounts,
      {
        localValues,
      },
    );
  });

  it("are the form's when the name is shorter and inside it", async () => {
    const yearly = defineSchema([...columns, { id: "fiscal_year", label: "Fiscal year" }], {
      ...options,
      calendar: NEW_YORK,
      columns: { ...options.columns, fiscal_year: { aliases: ["year"] } },
    });
    await reads("accounts opened this year", [["opened", "between", between("2026-01-01", "2026-12-31")]], undefined, [], yearly);
  });
});

describe("a date with no column named", () => {
  it("never takes a date column the part names for another date", async () => {
    const { provider } = scripted({
      families: [{ id: "filter", confidence: 0.95 }],
      columns: [{ id: "opened", confidence: 0.95 }],
      values: [],
      unmatchedTerms: [],
    });
    await asks("accounts in the last 90 days opened this quarter", "Which date column should “last 90 days” filter?", accounts, {
      provider,
    });
    await asks("accounts in the last 90 days opened this quarter", "Which date column should “last 90 days” filter?");
    await asks("accounts in the last 7 days with contacted yesterday", "Which date column should “last 7 days” filter?");
  });

  it("gives the provider's date column to the date only, never to a sort or a grouping", async () => {
    for (const family of ["group", "sort"]) {
      const { provider } = scripted({
        families: [
          { id: "filter", confidence: 0.95 },
          { id: family, confidence: 0.95 },
        ],
        columns: [{ id: "last_contact", confidence: 0.95 }],
        values: [],
        direction: { id: "desc", confidence: 0.95 },
        unmatchedTerms: [],
      });
      const state = await asks(`${family} accounts in the last 90 days`, undefined, accounts, { provider });
      expect(state.plan?.operations.some((op) => op.type === "sort.set" || op.type === "group.set")).toBe(false);
    }
  });
});

describe("time words the forms don't hold", () => {
  it("ask, as abbreviations, a quarter or half by number, a weekday, a time of day, a season or a holiday", async () => {
    for (const [text, words] of [
      ["trust accounts last qtr", "last qtr"],
      ["trust accounts this qtr", "this qtr"],
      ["trust accounts in 3Q", "3q"],
      ["trust accounts in h1", "h1"],
      ["trust accounts in the 1st half", "1st half"],
      ["trust accounts since mon", "since mon"],
      ["trust accounts on fri", "fri"],
      ["trust accounts yday", "yday"],
      ["trust accounts tmrw", "tmrw"],
      ["trust accounts last mnth", "last mnth"],
      ["trust accounts since last mo", "since last mo"],
      ["trust accounts in 2wk", "2wk"],
      ["trust accounts in the last 90d", "last 90d"],
      ["trust accounts this morning", "this morning"],
      ["trust accounts at noon", "noon"],
      ["trust accounts 9am", "9am"],
      ["trust accounts at 9:30", "9:30"],
      ["trust accounts over xmas", "over xmas"],
      ["trust accounts in summer", "summer"],
      ["trust accounts eod", "eod"],
    ]) {
      await asks(text as string, dates(words as string));
    }
  });

  it("ask as a period: this, last, prior, previous, past, since or until before a word GridCue doesn't read", async () => {
    // The word after it names a period GridCue has no form for, or a time word written wrong: never dropped.
    for (const [text, words] of [
      ["trust accounts this fy", "this fy"],
      ["trust accounts last fiscal", "last fiscal"],
      // "Period" after a word that makes a span of time of it is a time word, not a dictated full stop.
      ["trust accounts prior period", "prior period"],
      ["trust accounts last period", "last period"],
      ["trust accounts this period", "this period"],
      ["trust accounts current period", "current period"],
      ["trust accounts for the period", "period"],
      ["trust accounts last cycle", "last cycle"],
      ["trust accounts this season", "this season"],
      ["trust accounts previous stretch", "previous stretch"],
      ["trust accounts last quater", "last quater"],
      ["trust accounts last nite", "last nite"],
      ["trust accounts since inception", "since inception"],
      ["trust accounts until further notice", "until further"],
      ["trust accounts til now", "til now"],
      // Right after a date column, or after "in", "for", "during" and the like.
      ["trust accounts opened last cycle", "last cycle"],
      ["trust accounts for this season", "this season"],
      ["trust accounts since the last review", "last review"],
      ["trust accounts since the start", "since the start"],
      ["trust accounts until the close", "until the close"],
    ]) {
      await asks(text as string, dates(words as string));
    }
  });

  it("ask as a period written short, a day of the month, a decade, a half, a unit with a prefix, or up to now", async () => {
    for (const [text, words] of [
      ["trust accounts ttm", "ttm"],
      ["trust accounts ntm", "ntm"],
      ["trust accounts in fy", "fy"],
      ["trust accounts in COB", "cob"],
      ["trust accounts eob", "eob"],
      ["trust accounts close of business", "close of business"],
      ["trust accounts on the 15th", "15th"],
      ["trust accounts on the 2nd", "2nd"],
      ["trust accounts in the 90s", "90s"],
      ["trust accounts in the 1980s", "1980s"],
      ["trust accounts in the back half", "back half"],
      ["trust accounts semiannual", "semiannual"],
      ["trust accounts biweekly", "biweekly"],
      ["trust accounts to date", "to date"],
      ["trust accounts so far", "so far"],
      ["trust accounts thus far", "thus far"],
      ["trust accounts as of now", "as of now"],
      ["trust accounts in the past", "the past"],
      // Written with a hyphen, with dots, or as one word.
      ["trust accounts back-half", "back-half"],
      ["trust accounts to-date", "to-date"],
      ["trust accounts so-far", "so-far"],
      ["trust accounts t.t.m.", "t.t.m"],
      ["trust accounts fytd", "fytd"],
      ["trust accounts midyear", "midyear"],
      ["trust accounts yearend", "yearend"],
      ["trust accounts monthend", "monthend"],
      // A day of the month and a decade in words.
      ["trust accounts on the fifteenth", "fifteenth"],
      ["trust accounts on the twenty-first", "twenty-first"],
      ["trust accounts in the nineties", "nineties"],
    ]) {
      await asks(text as string, dates(words as string));
    }
  });

  it("leave a place in the grid, a share and a dictated full stop as they were", async () => {
    const said = (text: string) => {
      const [clause] = normalize(text).clauses;
      return clause ? timeWordsOutside(clause, [], [], accounts)?.text : undefined;
    };
    // "Last" with nothing after it is a place; before this it asked which dates "last" means.
    expect(said("put advisor last")).toBeUndefined();
    expect(said("accounts last")).toBeUndefined();
    expect(said("households past")).toBeUndefined();
    // An ordinal or "next" before a column or a row is a place in the grid.
    expect(said("put the 2nd column first")).toBeUndefined();
    expect(said("move the 3rd column to the end")).toBeUndefined();
    expect(said("the next column after household should be advisor")).toBeUndefined();
    expect(said("show trust accounts and the next one over")).toBeUndefined();
    expect(said("accounts on the third row")).toBeUndefined();
    expect(said("trust accounts on the 3rd")).toBe("3rd");
    expect(said("trust accounts next quarter")).toBe("next quarter");
    // "A quarter" is a share.
    expect(said("a quarter of the accounts with the highest value")).toBeUndefined();
    expect(said("concentration above a quarter")).toBeUndefined();
    expect(said("trust accounts for the quarter")).toBe("quarter");
    // A dictated "period" still ends a sentence, and the next part is read on its own.
    expect(normalize("show trust accounts period sort by value").clauses.map((c) => c.text)).toEqual([
      "show trust accounts",
      "sort by value",
    ]);
    expect(normalize("trust accounts this period").clauses.map((c) => c.text)).toEqual(["trust accounts this period"]);
  });

  it("never read a range of two dates with a comparison after it, or a form with “or so” after it", async () => {
    // "Or later" changes the range again, and "or so" says the days are only about right: neither is dropped.
    for (const text of [
      "accounts opened from 2026-01-01 to 2026-03-01 or later",
      "accounts opened between 2026-01-01 and 2026-03-01 or earlier",
      "accounts opened between 2026-01-01 and 2026-03-01 at the latest",
    ]) {
      const state = await propose(text);
      expect(state.status, text).toBe("needs_clarification");
    }
    await asks("accounts opened last month or so", "I'm not sure what to do with “or so”. Try rephrasing that part.");
    await asks("accounts opened in the last 90 days or so", "I'm not sure what to do with “or so”. Try rephrasing that part.");
    // One date with "or later" is on or after it, as before.
    await reads("accounts opened 2026-03-01 or later", [["opened", "gte", "2026-03-01"]]);
  });

  it("leave a word GridCue reads after this or last, and a name, as they were", async () => {
    // "Last contact" is a column's name; "this column", "this view" and a lone "last" are the view's own words.
    await reads("trust accounts sorted by last contact", [["registration_type", "eq", "trust"]]);
    const said = (text: string) => {
      const [clause] = normalize(text).clauses;
      return clause ? timeWordsOutside(clause, [], [], accounts)?.text : undefined;
    };
    expect(said("reset this view")).toBeUndefined();
    expect(said("hide this column")).toBeUndefined();
    expect(said("show trust accounts now")).toBeUndefined();
    expect(said("put advisor last, value first")).toBeUndefined();
    // Before the rows, or with no rows named, "this" is no period.
    expect(said("break this down by advisor")).toBeUndefined();
    expect(said("this one accounts")).toBeUndefined();
    expect(said("accounts this fy")).toBe("this fy");
  });

  it("are a name's words inside a Local Value, and only GridCue's own time words keep a value from being read", async () => {
    const localValues = { advisor_name: () => ["Summer Weekly", "Q3", "Sun", "Today", "Next Month"] };
    await reads("accounts for Summer Weekly", [["advisor_name", "eq", "Summer Weekly"]], undefined, [], accounts, { localValues });
    await reads("accounts for Q3", [["advisor_name", "eq", "Q3"]], undefined, [], accounts, { localValues });
    await reads("Sun's accounts", [["advisor_name", "eq", "Sun"]], undefined, [], accounts, { localValues });
    // "Today" and "next month" are GridCue's own words: never read from the grid.
    await asks("accounts for today", "Which date column should “today” filter?", accounts, { localValues });
    await asks("accounts for next month", dates("next month"), accounts, { localValues });
  });
});

describe("a House Term's name and “may”", () => {
  const term = (label: string) => () =>
    defineSchema(columns, { ...options, houseTerms: [{ label, where: [{ columnId: "market_value", operator: "gt", value: 1000 }] }] });
  it("is refused only where a number may follow “may”", () => {
    expect(term("May items")).not.toThrow();
    expect(term("Items may")).toThrow(expect.objectContaining({ code: "INPUT_SCHEMA" }));
    expect(term("May")).toThrow(expect.objectContaining({ code: "INPUT_SCHEMA" }));
    expect(term("May 2026 items")).toThrow(expect.objectContaining({ code: "INPUT_SCHEMA" }));
  });
});

describe("a clock at the ends of the years a date can be written in", () => {
  it("asks about a form whose days fall outside them, and never fails the request", async () => {
    const utc = defineSchema(columns, { ...options, calendar: { timeZone: "UTC", fiscalYearStart: 2 } });
    for (const [at, text, words] of [
      ["9999-12-15T00:00:00.000Z", "accounts opened this quarter", "this quarter"],
      ["9999-12-15T00:00:00.000Z", "accounts opened this year", "this year"],
      ["0005-06-01T00:00:00.000Z", "accounts opened in the last 999 years", "last 999 years"],
      ["0001-03-01T00:00:00.000Z", "accounts opened last year", "last year"],
    ] as const) {
      const state = await asks(text, dates(words), utc, { now: () => new Date(at) });
      expect(state.status, text).toBe("needs_clarification");
    }
  });
});

describe("reading dates stays fast", () => {
  const units = [
    "accounts opened in the last 90 days and ",
    "opened between 2026-01-01 and 2026-03-31 ",
    "this week last week since january q1 1/31/2026 ",
    "opened after 2026-01-31 ",
    "ytd mtd qtd today yesterday ",
    "9am 9:30 mon last qtr 2wk 90d summer eod 1st half ",
    "contacted is today opened this quarter ",
    "accounts this view accounts for the since the in the this ",
    "trust accounts this fy prior ttm to date 15th 90s back half ",
  ];
  it("finds the date forms and time words in 2,000 characters in under 50 ms", async () => {
    for (const unit of units) {
      const text = unit.repeat(Math.ceil(2000 / unit.length)).slice(0, 2000);
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        const normalized = normalize(text);
        const mentions = matchMentions(normalized.clauses, accounts.columns.filter(isExposed), { rowNoun: accounts.rowNoun });
        readCodeFilters(withoutNamedSizes(normalized, mentions), mentions, accounts, { today: "2026-11-13" });
        best = Math.min(best, performance.now() - started);
      }
      expect(best, unit).toBeLessThan(50);
    }
  });

  it("reads and compiles 2,000 characters of dates in under 50 ms", async () => {
    const empty: IntentProvider = { resolve: async () => ({ clauses: [] }) };
    for (const unit of units) {
      const text = unit.repeat(Math.ceil(2000 / unit.length)).slice(0, 2000);
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const cue = createGridCue({
          adapter: createRowsAdapter({ schema: accounts }),
          provider: empty,
          maxUtteranceLength: 2000,
          now: () => new Date(NOW),
        });
        const started = performance.now();
        await cue.propose(text);
        best = Math.min(best, performance.now() - started);
      }
      expect(best, unit).toBeLessThan(50);
    }
  });
});
