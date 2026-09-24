import { describe, expect, it } from "vitest";
import { normalize } from "../src/core/normalize";

const clauses = (s: string) => normalize(s).clauses.map((c) => c.text);

describe("normalize: clauses", () => {
  it("splits on verbs after commas and 'and', and on 'then'", () => {
    expect(clauses("Group by advisor and sort market value largest first.")).toEqual([
      "group by advisor",
      "sort market value largest first",
    ]);
    expect(clauses("Show restricted holdings, then place the trades.")).toEqual(["show restricted holdings", "place the trades"]);
    expect(clauses("Only Roth accounts, grouped by rep")).toEqual(["only roth accounts", "grouped by rep"]);
    expect(clauses("Show taxable accounts over 10%, group by advisor, sort largest concentration first")).toEqual([
      "show taxable accounts over 10%",
      "group by advisor",
      "sort largest concentration first",
    ]);
  });

  it("gives an elliptical 'then by' part the verb of the part before it", () => {
    expect(clauses("Group by account type, then by advisor.")).toEqual(["group by account type", "group by advisor"]);
    expect(clauses("Sort by advisor, then by market value, then by gain")).toEqual([
      "sort by advisor",
      "sort by market value",
      "sort by gain",
    ]);
    expect(clauses("Grouped by rep, then by custodian")).toEqual(["grouped by rep", "grouped by custodian"]);
    expect(clauses("Show trusts, then by advisor")).toEqual(["show trusts", "by advisor"]);
  });

  it("keeps lists of columns together", () => {
    expect(clauses("Hide custodian and account number.")).toEqual(["hide custodian and account number"]);
    expect(clauses("Clear the filters and sorting")).toEqual(["clear the filters and sorting"]);
  });
});

describe("normalize: literals", () => {
  const lits = (s: string) => normalize(s).clauses.flatMap((c) => c.literals.map(({ at, ...l }) => l));

  it("parses currency with scale words and comparators", () => {
    expect(lits("Show accounts over $1 million")).toEqual([{ kind: "currency", value: 1_000_000, comparator: "gt" }]);
    expect(lits("at least $250k")).toEqual([{ kind: "currency", value: 250_000, comparator: "gte" }]);
  });

  it("parses percentages as fractions", () => {
    expect(lits("concentration above 10%")).toEqual([{ kind: "percent", value: 0.1, comparator: "gt" }]);
  });

  it("merges between ranges", () => {
    expect(lits("value between $1m and $5m")).toEqual([{ kind: "currency", value: 1_000_000, upper: 5_000_000, comparator: "between" }]);
  });

  it("parses ISO dates and quoted text", () => {
    expect(lits('opened before 2024-01-31 named "smith trust"')).toEqual([
      { kind: "date", value: "2024-01-31", comparator: "lt" },
      { kind: "text", value: "smith trust" },
    ]);
  });

  it("treats curly quotes like straight quotes", () => {
    expect(lits("named “smith trust”")).toEqual([{ kind: "text", value: "smith trust" }]);
  });
});

describe("normalize: review focus", () => {
  it("marks locale-ambiguous numbers unreadable instead of guessing", () => {
    const kinds = (s: string) => normalize(s).clauses.flatMap((c) => c.literals.map((l) => [l.kind, l.value]));
    expect(kinds("over 1.000.000")).toEqual([["unreadable", "1.000.000"]]);
    expect(kinds("concentration above 10,5%")).toEqual([["unreadable", "10,5%"]]);
    expect(kinds("over 1,000,000")).toEqual([["number", 1_000_000]]);
    expect(kinds("over $1.5 million")).toEqual([["currency", 1_500_000]]);
  });

  it("turns spoken punctuation into clause breaks", () => {
    expect(clauses("group by advisor comma sort market value largest first period")).toEqual([
      "group by advisor",
      "sort market value largest first",
    ]);
  });
});

describe("normalize: direction", () => {
  it("reads sort direction phrases", () => {
    expect(normalize("sort market value largest first").clauses[0]?.direction).toBe("desc");
    expect(normalize("sort by household a to z").clauses[0]?.direction).toBe("asc");
    expect(normalize("group by advisor").clauses[0]?.direction).toBeUndefined();
  });
});
