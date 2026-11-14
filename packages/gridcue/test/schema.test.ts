import { describe, expect, it, vi } from "vitest";
import { GridCueError } from "../src/core/errors";
import type { HouseTerm } from "../src/core/protocol";
import { buildCandidates } from "../src/core/resolution";
import { defineSchema, describeProviderPayload, humanize, inferKind, operatorsFor, type SchemaOptions } from "../src/core/schema";
import { type HouseTerm as RootHouseTerm, defineSchema as rootDefineSchema } from "../src/index";

describe("defineSchema", () => {
  const schema = defineSchema([{ id: "market_value", kind: "currency" }, { id: "advisorName" }, { id: "tax_id" }, { id: "opened" }], {
    columns: { advisorName: { label: "Advisor", aliases: ["rep"] } },
    restricted: ["tax_id"],
    sampleRows: [{ opened: "2024-01-31", advisorName: "Ada" }],
  });

  it("fills labels and infers kinds from sample rows", () => {
    expect(schema.columns.map((c) => [c.id, c.label, c.kind])).toEqual([
      ["market_value", "Market value", "currency"],
      ["advisorName", "Advisor", "string"],
      ["tax_id", "Tax id", "string"],
      ["opened", "Opened", "date"],
    ]);
  });

  it("marks restricted columns unusable and unexposed", () => {
    const taxId = schema.columns.find((c) => c.id === "tax_id");
    expect(taxId).toMatchObject({ sensitivity: "restricted", exposeToProvider: false, capabilities: [] });
  });

  it("describes the provider payload without restricted columns or rows", () => {
    const payload = describeProviderPayload(schema);
    expect(payload.rows).toBe("never sent");
    expect(payload.columns.map((c) => c.id)).toEqual(["market_value", "advisorName", "opened"]);
    expect(JSON.stringify(payload)).not.toContain("Ada");
  });
});

describe("defineSchema validation", () => {
  const failsWith = (fn: () => unknown, match: string) => {
    let error: unknown;
    try {
      fn();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GridCueError);
    expect((error as GridCueError).code).toBe("INPUT_SCHEMA");
    expect((error as GridCueError).message).toContain(match);
  };

  it("rejects a restricted id that names no column", () => {
    failsWith(() => defineSchema([{ id: "tax_id" }], { restricted: ["ssn"] }), "ssn");
  });

  it("rejects a columns override id that names no column", () => {
    failsWith(() => defineSchema([{ id: "tax_id" }], { columns: { ssn: { label: "SSN" } } }), "ssn");
  });

  it("rejects duplicate column ids", () => {
    failsWith(() => defineSchema([{ id: "value" }, { id: "value" }]), "value");
  });

  it("rejects an empty column id", () => {
    failsWith(() => defineSchema([{ id: "" }]), "columns.0.id");
  });

  it("still accepts valid schemas", () => {
    expect(() =>
      defineSchema([{ id: "market_value", kind: "currency" }, { id: "tax_id" }], { restricted: ["tax_id"], columns: { tax_id: {} } }),
    ).not.toThrow();
  });
});

// House Terms (named filters spec, 5.3; ADR 0024). A Host-named list of fixed conditions. `defineSchema` checks each
// condition the way validation checks a plan's filter, and refuses a name already in use.
describe("House Terms", () => {
  const columns = [
    { id: "account_number", label: "Account number" },
    { id: "household_id", label: "Household ID" },
    { id: "advisor_name", label: "Advisor" },
    { id: "registration_type", label: "Registration type" },
    { id: "market_value", label: "Market value", kind: "currency" as const },
    { id: "concentration", label: "Concentration", kind: "percent" as const },
    { id: "units", label: "Units", kind: "number" as const },
    { id: "opened", label: "Opened", kind: "date" as const },
    { id: "has_restricted_holding", label: "Restricted holdings", kind: "boolean" as const },
    { id: "notes", label: "Notes" },
    { id: "tax_id", label: "Tax ID" },
  ];
  const options: SchemaOptions = {
    rowNoun: "account",
    restricted: ["tax_id"],
    columns: {
      account_number: { aliases: ["acct"] },
      household_id: { entity: "family" },
      advisor_name: { aliases: ["rep"] },
      registration_type: {
        enumValues: [
          { id: "taxable", label: "Taxable", aliases: ["brokerage"] },
          { id: "ira", label: "IRA" },
          { id: "roth_ira", label: "Roth IRA", aliases: ["roth"] },
        ],
        valueGroups: [{ label: "Retirement", aliases: ["retirement account"], values: ["ira", "roth_ira"] }],
      },
      market_value: { aliases: ["value", "aum"] },
      units: { allowedOperators: ["eq"] },
      notes: { capabilities: ["show", "hide"] },
      tax_id: { aliases: ["ssn"] },
    },
  };
  const large: HouseTerm = { label: "Large", aliases: ["big"], where: [{ columnId: "market_value", operator: "gt", value: 1_000_000 }] };
  const needsAttention: HouseTerm = {
    label: "Needs attention",
    aliases: ["need attention", "needing attention"],
    where: [
      { columnId: "concentration", operator: "gt", value: 0.1 },
      { columnId: "has_restricted_holding", operator: "eq", value: true },
    ],
  };
  const unassigned: HouseTerm = { label: "Unassigned", aliases: ["orphaned"], where: [{ columnId: "advisor_name", operator: "isEmpty" }] };
  const withTerms = (...houseTerms: HouseTerm[]) => defineSchema(columns, { ...options, houseTerms });
  const refuses = (term: HouseTerm, ...reason: string[]) => {
    let error: unknown;
    try {
      withTerms(term);
    } catch (e) {
      error = e;
    }
    expect(error, `${term.label} was accepted`).toBeInstanceOf(GridCueError);
    expect((error as GridCueError).code).toBe("INPUT_SCHEMA");
    for (const words of reason) expect((error as GridCueError).message).toContain(words);
  };
  const term = (where: HouseTerm["where"], label = "Flagged"): HouseTerm => ({ label, where });

  it("keeps the declared terms on the View Schema", () => {
    const schema = withTerms(large, needsAttention, unassigned);
    expect(schema.houseTerms).toEqual([large, needsAttention, unassigned]);
  });

  it("adds nothing to a schema that declares none", () => {
    expect("houseTerms" in defineSchema(columns, options)).toBe(false);
    expect("houseTerms" in withTerms()).toBe(false);
    expect(withTerms()).toEqual(defineSchema(columns, options));
  });

  it("accepts every operator and value a plan's filter may use", () => {
    expect(() =>
      withTerms(
        term([{ columnId: "market_value", operator: "between", value: { min: 1, max: 2 } }], "Mid"),
        term([{ columnId: "registration_type", operator: "in", value: ["ira", "roth_ira"] }], "Sheltered"),
        term([{ columnId: "opened", operator: "lt", value: "2020-01-01" }], "Legacy"),
        term([{ columnId: "advisor_name", operator: "isNotEmpty" }], "Covered"),
        term([{ columnId: "units", operator: "eq", value: 0 }], "Flat"),
      ),
    ).not.toThrow();
  });

  describe("refuses a condition a plan's filter could not use", () => {
    it("on a column that does not exist", () => refuses(term([{ columnId: "aum", operator: "gt", value: 1 }]), '"Flagged"', '"aum"'));

    it("on a restricted column", () => refuses(term([{ columnId: "tax_id", operator: "isNotEmpty" }]), '"Flagged"', "restricted"));

    it("on a column that may not be filtered", () => refuses(term([{ columnId: "notes", operator: "isEmpty" }]), '"Flagged"', "filter"));

    it("with an operator the column's kind does not allow", () =>
      refuses(term([{ columnId: "market_value", operator: "contains", value: "1" }]), '"Flagged"', "contains"));

    it("with an operator the Host's allow-list leaves out", () =>
      refuses(term([{ columnId: "units", operator: "gt", value: 1 }]), '"Flagged"', "Units", "gt"));

    it("with a value that does not fit the column's kind", () => {
      refuses(term([{ columnId: "market_value", operator: "gt", value: "1m" }]), '"Flagged"', "wrong type");
      refuses(term([{ columnId: "has_restricted_holding", operator: "eq", value: "yes" }]), '"Flagged"', "wrong type");
      refuses(term([{ columnId: "opened", operator: "gt", value: "2026-02" }]), '"Flagged"', "wrong type");
      refuses(term([{ columnId: "registration_type", operator: "eq", value: "annuity" }]), '"Flagged"', "wrong type");
      refuses(term([{ columnId: "market_value", operator: "between", value: 5 }]), '"Flagged"', "range");
      refuses(term([{ columnId: "registration_type", operator: "in", value: [] }]), '"Flagged"', "list");
    });

    it("with no value where the operator needs one, or a value where it takes none", () => {
      refuses(term([{ columnId: "market_value", operator: "gt" }]), '"Flagged"', "wrong type");
      refuses(term([{ columnId: "advisor_name", operator: "isEmpty", value: "" }]), '"Flagged"', "takes no value");
    });

    it("names which of several conditions is wrong", () =>
      refuses(
        term([
          { columnId: "market_value", operator: "gt", value: 1 },
          { columnId: "concentration", operator: "gt", value: "10%" },
        ]),
        '"Flagged"',
        "Concentration",
      ));
  });

  it("refuses a term with no conditions", () => refuses(term([]), '"Flagged"', "no conditions"));

  it("refuses an empty label or alias", () => {
    refuses(term([{ columnId: "market_value", operator: "gt", value: 1 }], ""), "House Term 1", "label");
    refuses(term([{ columnId: "market_value", operator: "gt", value: 1 }], "  "), "House Term 1", "label");
    refuses(term([{ columnId: "market_value", operator: "gt", value: 1 }], "--"), "House Term 1", "label");
    refuses({ ...large, aliases: ["big", " "] }, '"Large"', "alias");
  });

  describe("refuses a name already in use", () => {
    const named = (name: string): HouseTerm => ({ ...large, label: name, aliases: [] });
    const aliased = (alias: string): HouseTerm => ({ ...large, aliases: [alias] });

    it("by a column's label or alias", () => {
      refuses(named("Market value"), '"Market value"', "Market value");
      refuses(aliased("aum"), '"Large"', '"aum"', "Market value");
      // The matcher reads names across case, punctuation and plurals, so a check that only compared text would miss these.
      refuses(named("MARKET-VALUE"), "Market value");
      refuses(aliased("values"), '"values"', "Market value");
    });

    it("by a restricted column's name", () => refuses(aliased("ssn"), '"ssn"', "Tax ID"));

    it("by a value's label or alias", () => {
      refuses(named("Taxable"), "Taxable");
      refuses(aliased("brokerage"), '"brokerage"', "Taxable");
    });

    it("by a Value Group's label or alias", () => {
      refuses(named("Retirement"), "Retirement");
      refuses(aliased("retirement accounts"), '"retirement accounts"', "Retirement");
    });

    it("by the Row Noun", () => {
      refuses(named("Account"), "Row Noun");
      refuses(aliased("accounts"), "Row Noun");
    });

    it("by an entity word", () => {
      refuses(named("Family"), "Household ID");
      refuses(aliased("families"), "Household ID");
    });

    it("by another term's label or alias", () => {
      expect(() => withTerms(large, { ...needsAttention, label: "Large" })).toThrow(/"Large".*House Term "Large"/);
      expect(() => withTerms(large, { ...needsAttention, aliases: ["big"] })).toThrow(/"big".*House Term "Large"/);
      expect(() => withTerms(large, { ...needsAttention, label: "Big" })).toThrow(GridCueError);
    });

    it("by one of GridCue's own words", () => {
      for (const word of [
        "top",
        "largest",
        "Biggest",
        "smallest",
        "descending",
        "empty",
        "blank",
        "missing",
        "show",
        "only",
        "sorted",
        "group",
        "hide",
        "the",
        "and",
        "rows",
        "please",
        "show me",
        "pin",
        "not",
        "except",
        "excluding",
        "over",
        "at least",
        "or more",
        "containing",
      ]) {
        refuses(named(word), "GridCue's own words");
      }
    });

    it("but not a word that only looks like one: Large is not largest, big is not bigger", () => {
      expect(() => withTerms(large, needsAttention, unassigned)).not.toThrow();
      expect(() => withTerms(named("Whale"), { ...needsAttention, label: "Dormant", aliases: ["off-policy"] })).not.toThrow();
    });

    it("holding one of GridCue's own words, or an amount, a count or an order", () => {
      // Each word of the name is read on its own too: "top tier accounts" also sorted by the default measure, "top 10
      // accounts" also kept the first 10 rows, and "accounts over 1m" dropped the amount.
      for (const [name, word] of [
        ["Top tier", "“top”"],
        ["Top clients", "“top”"],
        ["Largest clients", "“largest”"],
        ["Most valuable", "“most”"],
        ["High value", "“high”"],
        ["Newest clients", "“newest”"],
        ["First call", "“first”"],
        ["Reset pending", "“reset”"],
        ["Compact list", "“compact”"],
        ["Due today", "“today”"],
        ["Out of policy", "“of”"],
        ["Tier 1", "an amount"],
        ["1m", "an amount"],
      ]) {
        refuses(named(name ?? ""), word ?? "");
      }
      for (const word of [
        "Today",
        "Highest",
        "Lowest",
        "Oldest",
        "Bottom",
        "Least",
        "High",
        "Low",
        "first",
        "between",
        "reset",
        "compact",
        "Top 10",
      ]) {
        refuses(named(word), "GridCue's own words");
      }
    });

    it("made only of the words a comparison is written with, which a comparison could hold", () => {
      // Each was found inside a comparison: "gain more than $50k", "gain of 50k or more" and "gain up to 50k" also kept
      // the term's rows. "Plus" is a joining word, and "gain 50k plus" read the amount as exactly $50,000.
      for (const word of ["More", "Less", "Greater", "Higher", "Lower", "Fewer", "Than", "Equal", "Up", "To", "Down", "More than"]) {
        refuses(named(word), "GridCue's own words");
        refuses(aliased(word.toLowerCase()), "GridCue's own words");
      }
      for (const word of ["Plus", "Then", "Also"]) refuses(named(word), "GridCue's own words");
      // "Valued" and "worth" lead a comparison: "accounts valued over $1m" also kept the rows of a term named "Valued".
      for (const word of ["Valued", "Worth", "Exceeding", "Worth more than"]) {
        refuses(named(word), "GridCue's own words");
        refuses(aliased(word.toLowerCase()), "GridCue's own words");
      }
      // A name with a word of its own is found only whole, never inside a comparison.
      expect(() => withTerms(named("Higher touch"), needsAttention)).not.toThrow();
    });
  });

  it("refuses a name that holds a name the schema already uses, which could never be found", () => {
    const named = (name: string): HouseTerm => ({ ...large, label: name, aliases: [] });
    refuses(named("Big value"), '"Big value"', "“value”", "never be found");
    refuses(named("Brokerage large"), "“brokerage”");
    refuses(named("Larger accounts"), "“accounts”");
    refuses(named("Family wealth"), "“family”");
    refuses(named("Big IRAs"), "“iras”");
  });

  it("refuses a range that keeps no row", () =>
    refuses(term([{ columnId: "market_value", operator: "between", value: { min: 5, max: 2 } }], "Mid"), '"Mid"', "keeps no row"));

  it("loads with any core module first: no import cycle reaches the schema", async () => {
    vi.resetModules();
    const placed = await import("../src/core/placed");
    const schema = await import("../src/core/schema");
    expect(placed.unplacedWords).toBeTypeOf("function");
    expect(() => schema.defineSchema(columns, { ...options, houseTerms: [large] })).not.toThrow();
  });

  it("never reaches the provider: the candidates and the payload are the same with terms as without", () => {
    const caps = {
      operations: ["filter.add", "filter.clear", "sort.set", "group.set", "columns.show", "columns.hide", "columns.order", "view.reset"],
      supportsAtomicApply: true,
      supportsSnapshotRestore: true,
      observesChanges: true,
    };
    const plain = defineSchema(columns, options);
    const declared = withTerms(large, needsAttention, unassigned);
    expect(buildCandidates(declared, caps)).toEqual(buildCandidates(plain, caps));
    expect(describeProviderPayload(declared)).toEqual(describeProviderPayload(plain));
    const sent = JSON.stringify([buildCandidates(declared, caps), describeProviderPayload(declared)]).toLowerCase();
    for (const word of ["large", "big", "needs attention", "unassigned", "orphaned", "1000000"]) expect(sent).not.toContain(word);
  });

  it("is exported from the root entry", () => {
    const fromRoot: RootHouseTerm = large;
    expect(rootDefineSchema(columns, { ...options, houseTerms: [fromRoot] }).houseTerms).toEqual([large]);
  });
});

describe("helpers", () => {
  it("humanizes ids", () => {
    expect(humanize("unrealized_gain")).toBe("Unrealized gain");
    expect(humanize("marketValue")).toBe("Market value");
  });

  it("infers kinds conservatively", () => {
    expect(inferKind([1, 2.5])).toBe("number");
    expect(inferKind([true, false])).toBe("boolean");
    expect(inferKind(["2024-01-01T10:00:00Z"])).toBe("datetime");
    expect(inferKind([1, "x"])).toBe("string");
  });

  it("narrows operators by the host allow-list", () => {
    const [col] = defineSchema([{ id: "v", kind: "number" }], { columns: { v: { allowedOperators: ["gt", "contains"] } } }).columns;
    expect(col && operatorsFor(col)).toEqual(["gt"]);
  });
});
