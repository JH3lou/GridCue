import { generateAccounts, wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { createQueryAdapter, defineSchema, emptyViewState, type FilterPredicate, type ViewSchema, type ViewState } from "gridcue";
import { queryCheck } from "gridcue/testing";
import { describe, expect, it } from "vitest";
import { buildRowsQuery, DataQueryError, openRowsDatabase, readRows } from "./query";
import { POST } from "./route";

/**
 * Runs every case of the Query Check through the example's Data Query, on synthetic rows in an in-memory database. It
 * reads each case twice: in one page, and in pages of 7, so a count cut after paging fails too. Returns what failed.
 */
const runQueryCheck = (schema: ViewSchema, id: string) => {
  // A Query Adapter with countBeforePaging lists limit.set, so the check has its count cases.
  const operations = createQueryAdapter({ schema, countBeforePaging: true }).getCapabilities().operations;
  const check = queryCheck(schema, { id, operations });
  const db = openRowsDatabase(schema, check.rows);
  const failures: string[] = [];
  try {
    for (const c of check.cases) {
      const whole = readRows(db, schema, c.state, { offset: 0, size: check.rows.length });
      const result = c.compare(whole.rows.map((row) => row[id] as string | number));
      if (!result.ok) failures.push(result.message);
      if (whole.total !== whole.rows.length) failures.push(`${c.name}: total is ${whole.total}, ${whole.rows.length} rows came back`);

      const paged: Array<string | number> = [];
      for (let offset = 0; offset < whole.total + 7; offset += 7) {
        const page = readRows(db, schema, c.state, { offset, size: 7 });
        if (page.total !== whole.total) failures.push(`${c.name}: the total changed from page to page`);
        paged.push(...page.rows.map((row) => row[id] as string | number));
      }
      const byPage = c.compare(paged);
      if (!byPage.ok) failures.push(`in pages of 7, ${byPage.message}`);
    }
  } finally {
    db.close();
  }
  return { cases: check.cases, failures };
};

describe("the example's Data Query passes the Query Check", () => {
  it("on the wealth schema, every case keeps the rows applyView keeps", () => {
    const { cases, failures } = runQueryCheck(wealthSchema, "account_number");
    expect(cases.length).toBeGreaterThan(40);
    expect(cases.some((c) => c.state.limit !== undefined)).toBe(true);
    expect(failures).toEqual([]);
  });

  // The wealth schema has no date columns. This made-up schema has a column of every kind, so the date rules run too.
  const everyKind = (calendar?: { timeZone: string }) =>
    defineSchema(
      ["row_id", "name", "tier", "qty", "price", "share", "flag", "opened", "seen_at"].map((id) => ({ id, label: id })),
      {
        id: "every-kind",
        version: "1",
        ...(calendar ? { calendar } : {}),
        columns: {
          row_id: { kind: "number" },
          name: { kind: "string" },
          tier: {
            kind: "enum",
            enumValues: [
              { id: "gold", label: "Gold" },
              { id: "silver", label: "Silver" },
            ],
          },
          qty: { kind: "number" },
          price: { kind: "currency" },
          share: { kind: "percent" },
          flag: { kind: "boolean" },
          opened: { kind: "date" },
          seen_at: { kind: "datetime" },
        },
      },
    );

  it("on a schema with every kind of column, with a Calendar time zone and without", () => {
    for (const schema of [everyKind({ timeZone: "America/New_York" }), everyKind({ timeZone: "Asia/Kolkata" }), everyKind()]) {
      const { cases, failures } = runQueryCheck(schema, "row_id");
      expect(cases.some((c) => JSON.stringify(c.state.filters).includes("seen_at"))).toBe(true);
      expect(failures).toEqual([]);
    }
  });
});

const base = (): ViewState => emptyViewState(wealthSchema.columns.map((c) => c.id));
const page = { offset: 0, size: 50 };
const filtered = (predicate: Partial<FilterPredicate>): ViewState => ({
  ...base(),
  filters: {
    id: "root",
    type: "group",
    combinator: "and",
    children: [
      { id: "f1", type: "predicate", columnId: "advisor_name", operator: "eq", value: "Avery Lane", ...predicate } as FilterPredicate,
    ],
  },
});

describe("no value and no column name from a View State goes into query text", () => {
  it("a value is a bound parameter", () => {
    const hostile = "x' OR 1=1; DROP TABLE grid_rows; --";
    const query = buildRowsQuery(wealthSchema, filtered({ value: hostile }), page);
    expect(query.rows.sql).not.toContain("OR 1=1");
    expect(query.rows.sql).not.toContain("DROP");
    expect(query.rows.params).toContain(hostile.toLowerCase());
    expect(query.total.params).toContain(hostile.toLowerCase());
  });

  it("a column the schema doesn't hold is an error, in a filter or a sort", () => {
    const hostile = 'market_value" FROM grid_rows; --';
    expect(() => buildRowsQuery(wealthSchema, filtered({ columnId: hostile }), page)).toThrow(DataQueryError);
    expect(() => buildRowsQuery(wealthSchema, { ...base(), sorts: [{ columnId: hostile, direction: "asc" }] }, page)).toThrow(
      DataQueryError,
    );
  });

  it("a restricted column is an error, in a filter or a sort", () => {
    expect(() => buildRowsQuery(wealthSchema, filtered({ columnId: "tax_id", operator: "isEmpty", value: undefined }), page)).toThrow(
      DataQueryError,
    );
    expect(() => buildRowsQuery(wealthSchema, { ...base(), sorts: [{ columnId: "tax_id", direction: "asc" }] }, page)).toThrow(
      DataQueryError,
    );
  });

  it("an operator the column doesn't allow, a value of the wrong kind, a direction or a combinator it doesn't know are errors", () => {
    expect(() => buildRowsQuery(wealthSchema, filtered({ columnId: "market_value", operator: "contains", value: "1" }), page)).toThrow(
      DataQueryError,
    );
    expect(() => buildRowsQuery(wealthSchema, filtered({ columnId: "market_value", operator: "gt", value: "1" }), page)).toThrow(
      DataQueryError,
    );
    const sideways = { ...base(), sorts: [{ columnId: "market_value", direction: "sideways" }] } as unknown as ViewState;
    expect(() => buildRowsQuery(wealthSchema, sideways, page)).toThrow(DataQueryError);
    const xor = filtered({});
    (xor.filters as unknown as { combinator: string }).combinator = "xor";
    expect(() => buildRowsQuery(wealthSchema, xor, page)).toThrow(DataQueryError);
  });

  it("the page size and offset are whole numbers in range, and so is a count", () => {
    for (const bad of [
      { offset: 0, size: 0 },
      { offset: 0, size: 1.5 },
      { offset: -1, size: 10 },
      { offset: Number.NaN, size: 10 },
      { offset: 0, size: 100_000 },
      { offset: "0", size: 10 },
    ]) {
      expect(() => buildRowsQuery(wealthSchema, base(), bad as never)).toThrow(DataQueryError);
    }
    expect(() => buildRowsQuery(wealthSchema, { ...base(), limit: 2.5 }, page)).toThrow(DataQueryError);
  });
});

describe("the route", () => {
  const post = (body: unknown) =>
    POST(
      new Request("http://localhost/api/rows", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );

  it("returns the page's rows and the number of matching rows, and never the restricted column", async () => {
    const response = await post({ state: filtered({}), page: { offset: 0, size: 5 } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rows: Array<Record<string, unknown>>; total: number };
    const expected = generateAccounts().filter((row) => row.advisor_name === "Avery Lane");
    expect(body.total).toBe(expected.length);
    expect(body.rows.map((row) => row.account_number)).toEqual(expected.slice(0, 5).map((row) => row.account_number));
    expect(body.rows.every((row) => !("tax_id" in row))).toBe(true);
    expect(typeof body.rows[0]?.has_restricted_holding).toBe("boolean");
  });

  it("answers 400 for a body that is no View State, a column the schema doesn't hold, or a bad page", async () => {
    expect((await post({ state: { filters: "advisor_name = 'x'" }, page })).status).toBe(400);
    expect((await post({ state: filtered({ columnId: "nope" }), page })).status).toBe(400);
    expect((await post({ state: base(), page: { offset: 0, size: -3 } })).status).toBe(400);
    expect((await post("not an object")).status).toBe(400);
    const notJson = await POST(new Request("http://localhost/api/rows", { method: "POST", body: "{" }));
    expect(notJson.status).toBe(400);
  });

  // A View State has no limit on its depth or size, so these are View States. The route answers 400, never 500, and
  // never echoes what was sent.
  const predicate = (n: number, value: unknown = `Name ${n}`): FilterPredicate =>
    ({ id: `f${n}`, type: "predicate", columnId: "advisor_name", operator: "eq", value }) as FilterPredicate;
  const nested = (depth: number): ViewState["filters"] => {
    let group: NonNullable<ViewState["filters"]> = { id: "g0", type: "group", combinator: "and", children: [predicate(0)] };
    for (let n = 1; n < depth; n++) group = { id: `g${n}`, type: "group", combinator: n % 2 ? "or" : "and", children: [group] };
    return group;
  };
  const wide = (count: number): ViewState["filters"] => ({
    id: "root",
    type: "group",
    combinator: "and",
    children: Array.from({ length: count }, (_, n) => predicate(n)),
  });

  for (const [what, state] of [
    ["filters nested 1,200 deep", { ...base(), filters: nested(1200) }],
    ["filters nested 40 deep", { ...base(), filters: nested(40) }],
    ["an and group of 2,000 filters", { ...base(), filters: wide(2000) }],
    [
      "40 lists of 1,000 values each",
      {
        ...base(),
        filters: {
          id: "root",
          type: "group",
          combinator: "or",
          children: Array.from(
            { length: 40 },
            (_, k) =>
              ({ ...predicate(k), operator: "in", value: Array.from({ length: 1000 }, (_, n) => `Name ${k}-${n}`) }) as FilterPredicate,
          ),
        },
      },
    ],
    [
      "a list of 33,000 values",
      {
        ...base(),
        filters: {
          id: "root",
          type: "group",
          combinator: "and",
          children: [{ ...predicate(0), operator: "in", value: Array.from({ length: 33_000 }, (_, n) => `Name ${n}`) } as FilterPredicate],
        },
      },
    ],
  ] as Array<[string, ViewState]>) {
    it(`answers 400 for ${what}`, async () => {
      const response = await post({ state, page: { offset: 0, size: 5 } });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).not.toContain("Name ");
    });
  }

  it("still reads filters a View State GridCue builds holds: a few groups deep, and a list of a hundred values", async () => {
    const ok = await post({ state: { ...base(), filters: nested(4) }, page: { offset: 0, size: 5 } });
    expect(ok.status).toBe(200);
    const listed = await post({
      state: {
        ...base(),
        filters: {
          id: "root",
          type: "group",
          combinator: "and",
          children: [{ ...predicate(0), operator: "in", value: Array.from({ length: 100 }, (_, n) => `Name ${n}`) } as FilterPredicate],
        },
      },
      page: { offset: 0, size: 5 },
    });
    expect(listed.status).toBe(200);
  });
});
