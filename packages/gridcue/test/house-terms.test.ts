import { describe, expect, it } from "vitest";
import { namesAfterCodeRead, readCodeFilters } from "../src/core/code-read";
import { createGridCue } from "../src/core/controller";
import { matchMentions } from "../src/core/mentions";
import { normalize, withoutNamedSizes } from "../src/core/normalize";
import type { HouseTerm, ViewOperation, ViewSchema } from "../src/core/protocol";
import { buildResolutionRequest, type ClauseResolution, type IntentProvider, type ResolutionRequest } from "../src/core/resolution";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema, isExposed, type SchemaOptions } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

// House Terms (named filters spec, 5.3; ADR 0024). A term is a code-read filter: found as a whole word by its label or
// an alias, it adds each of its conditions as a filter, and the Preview names it. A term left out, where a column goes,
// or said as a statement asks. It is never sent to a provider.
const columns = [
  { id: "account_number", label: "Account number" },
  { id: "household", label: "Household" },
  { id: "advisor_name", label: "Advisor" },
  { id: "registration_type", label: "Registration type" },
  { id: "custodian", label: "Custodian" },
  { id: "market_value", label: "Market value" },
  { id: "concentration", label: "Concentration" },
  { id: "unrealized_gain", label: "Unrealized gain" },
  { id: "has_restricted_holding", label: "Restricted holdings" },
];
const options: SchemaOptions = {
  rowNoun: "account",
  columns: {
    account_number: { aliases: ["account"] },
    household: { entity: "household" },
    advisor_name: { aliases: ["advisor"], entity: "advisor" },
    registration_type: {
      enumValues: [
        { id: "taxable", label: "Taxable" },
        { id: "trust", label: "Trust" },
      ],
    },
    custodian: {
      enumValues: [
        { id: "northgate", label: "Northgate" },
        { id: "big_sky", label: "Big Sky" },
      ],
    },
    market_value: { kind: "currency", aliases: ["value"] },
    concentration: { kind: "percent" },
    unrealized_gain: { kind: "currency", aliases: ["gain"] },
    has_restricted_holding: { kind: "boolean", aliases: ["restricted"] },
  },
};
// The spec's two terms, and one more of each kind the lead declared: an empty condition, and a longer name that holds
// a shorter one ("large cap" holds "large").
const TERMS: HouseTerm[] = [
  { label: "Large", aliases: ["big"], where: [{ columnId: "market_value", operator: "gt", value: 1_000_000 }] },
  {
    label: "Needs attention",
    aliases: ["need attention", "needing attention"],
    where: [
      { columnId: "concentration", operator: "gt", value: 0.1 },
      { columnId: "has_restricted_holding", operator: "eq", value: true },
    ],
  },
  { label: "Unassigned", aliases: ["orphaned"], where: [{ columnId: "advisor_name", operator: "isEmpty" }] },
  { label: "Large cap", where: [{ columnId: "market_value", operator: "gte", value: 10_000_000 }] },
];
const withTerms = defineSchema(columns, { ...options, houseTerms: TERMS });
const withoutTerms = defineSchema(columns, options);

const mock = createMockProvider({ defaultColumnForKind: { currency: "market_value", percent: "concentration" } });
const propose = async (text: string, schema: ViewSchema = withTerms, provider: IntentProvider = mock) => {
  const cue = createGridCue({ adapter: createRowsAdapter({ schema }), provider });
  await cue.propose(text);
  return cue.getState();
};
/** A provider that answers every part with `answer`, and keeps each request it is sent. */
const scripted = (answer: Partial<ClauseResolution> = {}) => {
  const requests: ResolutionRequest[] = [];
  const provider: IntentProvider = {
    resolve: async (request) => {
      requests.push(structuredClone(request));
      return {
        clauses: request.clauses.map((c) => ({
          clauseIndex: c.index,
          families: [],
          columns: [],
          values: [],
          unmatchedTerms: [],
          ...answer,
        })),
      };
    },
  };
  return { provider, requests };
};
const pick = (id: string, confidence = 0.95) => ({ id, confidence });
const filters = (ops: readonly ViewOperation[] | undefined) =>
  (ops ?? []).map((op) =>
    op.type === "filter.add"
      ? [op.predicate.columnId, op.predicate.operator, ...(op.predicate.value === undefined ? [] : [op.predicate.value])]
      : [op.type],
  );
/** Ready, with these operations and these Preview lines. */
const reads = async (text: string, want: ReadonlyArray<readonly unknown[]>, lines: string[], provider?: IntentProvider) => {
  const state = await propose(text, withTerms, provider);
  expect(state.status, `${text}: ${state.message}`).toBe("ready");
  expect(filters(state.plan?.operations), text).toEqual(want);
  expect(state.preview?.lines, text).toEqual(lines);
};
const asks = async (text: string, prompt?: string, provider?: IntentProvider) => {
  const state = await propose(text, withTerms, provider);
  expect(state.status, `${text}: ${JSON.stringify(state.plan?.operations)}`).toBe("needs_clarification");
  if (prompt) expect(state.message, text).toBe(prompt);
};

const LARGE = ["market_value", "gt", 1_000_000];
const LARGE_LINE = "Filter Market value above $1,000,000 (Large)";
const ATTENTION = [
  ["concentration", "gt", 0.1],
  ["has_restricted_holding", "eq", true],
];
const ATTENTION_LINES = [
  "Filter Concentration above 10% (Needs attention)",
  "Show only rows where Restricted holdings is Yes (Needs attention)",
];
const LEAVE_OUT_LARGE = "GridCue can't leave out “large” yet. Ask for the rows to keep, such as “market value at or below $1,000,000”.";

describe("spec 5.3, row by row", () => {
  it("“large accounts” and “show the big accounts” filter by the term, and the Preview names it", async () => {
    await reads("large accounts", [LARGE], [LARGE_LINE]);
    await reads("show the big accounts", [LARGE], [LARGE_LINE]);
  });

  it("“show large taxable accounts” keeps both filters: “large” is no longer dropped", async () => {
    await reads(
      "show large taxable accounts",
      [LARGE, ["registration_type", "eq", "taxable"]],
      [LARGE_LINE, "Filter Registration type to Taxable"],
    );
    // Before the terms, "large" was dropped and the Taxable filter was ready alone.
    const before = await propose("show large taxable accounts", withoutTerms);
    expect(filters(before.plan?.operations)).toEqual([["registration_type", "eq", "taxable"]]);
  });

  it("“accounts that need attention” adds each condition, in the term's order, each line naming the term", async () => {
    await reads("accounts that need attention", ATTENTION, ATTENTION_LINES);
  });

  it("“large accounts over $5m” adds the term's filter and the amount's, the term's first", async () => {
    // The amount's column comes from the provider's pick, as today (spec 4.2).
    const { provider } = scripted({
      families: [pick("filter")],
      literalColumns: [{ literalIndex: 0, columnId: "market_value", confidence: 0.9 }],
    });
    await reads(
      "large accounts over $5m",
      [LARGE, ["market_value", "gt", 5_000_000]],
      [LARGE_LINE, "Filter Market value above $5,000,000"],
      provider,
    );
    // The Mock Provider reads a part that starts with a word it doesn't know as acting on something, and picks no
    // column for the amount. The term is read, and the amount's column is asked for: never guessed.
    await asks("large accounts over $5m", "Which column should be above $5,000,000?");
  });

  it("a term left out asks: “accounts that aren't large”, “hide large accounts”, “not large”, “everyone except …”", async () => {
    for (const text of [
      "accounts that aren't large",
      "hide large accounts",
      "not large",
      "everyone except the large ones",
      "no large accounts",
    ])
      await asks(text, LEAVE_OUT_LARGE);
    await asks("accounts that are not big", LEAVE_OUT_LARGE.replace("“large”", "“big”"));
    // A term with more than one condition has no single opposite.
    await asks("accounts that don't need attention", "GridCue can't leave out “need attention” yet. Ask for the rows to keep.");
    await asks(
      "hide orphaned accounts",
      "GridCue can't leave out “orphaned” yet. Ask for the rows to keep, such as “advisor is not empty”.",
    );
  });

  it("a term where a column goes asks: “sort by large”, “the large column”, “group by big”", async () => {
    const prompt = (words: string) => `“${words}” stands for rows, not a column. Name a column instead, such as Market value.`;
    await asks("sort by large", prompt("large"));
    await asks("the large column", prompt("large"));
    await asks("group by big", prompt("big"));
    // Also when a provider picks the term's column for the sort.
    const { provider } = scripted({ families: [pick("sort")], columns: [pick("market_value")], direction: pick("desc", 0.9) });
    await asks("sort by large", prompt("large"), provider);
  });

  it("“large or taxable accounts” asks either-or, as today", async () => {
    await asks(
      "large or taxable accounts",
      "GridCue can only show rows that match every condition, not either one. Ask for one at a time.",
    );
  });

  it("“largest accounts” is unchanged: a size word, not the term (ADR 0018)", async () => {
    const now = await propose("largest accounts");
    const before = await propose("largest accounts", withoutTerms);
    expect(now.status).toBe("needs_clarification");
    expect(now.message).toBe(before.message);
    expect(now.message).toBe("Which column should be sorted by?");
  });
});

describe("finding a term", () => {
  const found = (text: string, schema: ViewSchema = withTerms) => {
    const normalized = normalize(text);
    const mentions = matchMentions(normalized.clauses, schema.columns.filter(isExposed), { rowNoun: schema.rowNoun });
    const input = withoutNamedSizes(normalized, mentions);
    return readCodeFilters(input, mentions, schema).map((f) => {
      const words = input.clauses[f.clauseIndex]?.text.slice(f.start, f.end);
      return `${words}: ${f.term} ${f.predicate.columnId} ${f.predicate.operator}`;
    });
  };

  it("as a whole word, by its label or an alias, ignoring letter case", () => {
    expect(found("Large accounts")).toEqual(["large: Large market_value gt"]);
    expect(found("BIG accounts")).toEqual(["big: Large market_value gt"]);
    expect(found("accounts Needing Attention")).toEqual([
      "needing attention: Needs attention concentration gt",
      "needing attention: Needs attention has_restricted_holding eq",
    ]);
  });

  it("with no plural form, and never inside a longer word", () => {
    for (const text of ["largest accounts", "enlarge accounts", "larger accounts", "bigger accounts", "larges"])
      expect(found(text), text).toEqual([]);
  });

  it("the longest name first", () => {
    expect(found("large cap accounts")).toEqual(["large cap: Large cap market_value gte"]);
  });

  it("never inside quoted text or a declared name of a column or value", () => {
    expect(found('advisor containing "large"')).toEqual([]);
    expect(found("accounts at big sky")).toEqual([]);
  });

  it("only where the schema declares terms", () => {
    expect(found("large accounts", withoutTerms)).toEqual([]);
  });
});

describe("a term's filters", () => {
  it("carry `host` evidence with the term's label, which the Preview names, also when the User typed an alias", async () => {
    const state = await propose("show orphaned accounts");
    expect(state.status).toBe("ready");
    expect(state.preview?.lines).toEqual(["Show only rows where Advisor is empty (Unassigned)"]);
    const id = state.plan?.operations[0]?.type === "filter.add" ? state.plan.operations[0].predicate.id : "";
    expect(state.plan?.evidence).toContainEqual({ key: `c0.term.${id}`, selectedId: "Unassigned", confidence: 1, source: "host" });
  });

  it("are plain filters in the view: the label is in the plan's evidence only", async () => {
    const state = await propose("large accounts");
    const op = state.plan?.operations[0];
    expect(op?.type === "filter.add" ? Object.keys(op.predicate).sort() : []).toEqual(["columnId", "id", "operator", "type", "value"]);
  });

  it("join other terms and filters with “and”", async () => {
    await reads("large accounts that need attention", [LARGE, ...ATTENTION], [LARGE_LINE, ...ATTENTION_LINES]);
    await reads("large trusts", [LARGE, ["registration_type", "eq", "trust"]], [LARGE_LINE, "Filter Registration type to Trust"]);
    await reads(
      "large accounts with no advisor",
      [LARGE, ["advisor_name", "isEmpty"]],
      [LARGE_LINE, "Show only rows where Advisor is empty"],
    );
  });
});

describe("a term is read as any code-read filter is (ADR 0023)", () => {
  it("asks about a word GridCue didn't place", async () => {
    await asks("large accounts called about", "I'm not sure what to do with “called about”. Try rephrasing that part.");
    await asks("that was a large mistake", "I'm not sure what to do with “mistake”. Try rephrasing that part.");
  });

  it("asks when said as a statement, and reads a relative word or “which” that asks for the rows", async () => {
    await asks("accounts are large", "I'm not sure what to do with “are”. Try rephrasing that part.");
    await asks("the account is big", "I'm not sure what to do with “is”. Try rephrasing that part.");
    await asks("the account needs attention", "I'm not sure what to do with “account needs attention”. Try rephrasing that part.");
    await reads("accounts that are large", [LARGE], [LARGE_LINE]);
    await reads("which accounts are large", [LARGE], [LARGE_LINE]);
  });

  it("asks when the rows in the plural come right before a term that is no “-ing” or “-ed” word", async () => {
    // "Accounts need attention" says something of the accounts. Said with "all", "my" or "these" before it, it was ready
    // with the term's filters, where the same sentences with an empty form ("my accounts have no advisor") ask.
    for (const text of [
      "accounts need attention",
      "all accounts need attention",
      "my accounts need attention",
      "these accounts need attention",
    ]) {
      await asks(text, "I'm not sure what to do with “accounts need attention”. Try rephrasing that part.");
    }
    await reads("accounts needing attention", ATTENTION, ATTENTION_LINES);
    await reads("show accounts that need attention", ATTENTION, ATTENTION_LINES);
    await reads("which accounts need attention", ATTENTION, ATTENTION_LINES);
    await reads(
      "show large accounts unassigned",
      [LARGE, ["advisor_name", "isEmpty"]],
      [LARGE_LINE, "Show only rows where Advisor is empty (Unassigned)"],
    );
  });

  it("asks when the rows come before a term with other words between, as it does when they come right before", async () => {
    // Each was ready with the term's filters, where "these accounts need attention" asked.
    for (const [text, words] of [
      ["these accounts at Northgate need attention", "accounts at northgate need attention"],
      ["all accounts at Northgate need attention", "accounts at northgate need attention"],
      // Right after an amount, the question names the amount and the term.
      ["accounts over $1m need attention", "$1m need attention"],
      ["accounts in trust need attention", "accounts in trust need attention"],
      ["the account at Northgate needs attention", "account at northgate needs attention"],
      ["trusts need attention", "trusts need attention"],
      ["trusts at Northgate need attention", "trusts at northgate need attention"],
    ]) {
      await asks(text ?? "", `I'm not sure what to do with “${words}”. Try rephrasing that part.`);
    }
    const NORTHGATE: [string, string, string] = ["custodian", "eq", "northgate"];
    const NORTHGATE_LINE = "Filter Custodian to Northgate";
    await reads("accounts at Northgate needing attention", [NORTHGATE, ...ATTENTION], [NORTHGATE_LINE, ...ATTENTION_LINES]);
    await reads("accounts at Northgate that need attention", [NORTHGATE, ...ATTENTION], [NORTHGATE_LINE, ...ATTENTION_LINES]);
    await reads("which accounts at Northgate need attention", [NORTHGATE, ...ATTENTION], [NORTHGATE_LINE, ...ATTENTION_LINES]);
    // A term before the noun it describes, or listed after a comma or a joining word, says nothing of the rows named
    // before it.
    await reads("accounts at Northgate: large accounts", [NORTHGATE, LARGE], [NORTHGATE_LINE, LARGE_LINE]);
    await reads("accounts at Northgate and large", [NORTHGATE, LARGE], [NORTHGATE_LINE, LARGE_LINE]);
    await reads("show accounts, need attention", ATTENTION, ATTENTION_LINES);
    await reads("show accounts, large only", [LARGE], [LARGE_LINE]);
    // Said as a verb, "need attention" or "needs attention" says something of the rows. A word that describes them,
    // after other words, is read as it was: "accounts at Northgate large".
    await reads("accounts at Northgate large", [NORTHGATE, LARGE], [NORTHGATE_LINE, LARGE_LINE]);
    await reads("Northgate large", [NORTHGATE, LARGE], [NORTHGATE_LINE, LARGE_LINE]);
  });

  it("asks about a statement whose term is a verb as it stands, whatever other names the Host declared", async () => {
    // The Host declared "Needs attention" with no "need attention" beside it. "Northgate needs attention" was ready
    // with the term's filter, where the same words asked once both forms were declared.
    const oneForm = defineSchema(columns, {
      ...options,
      houseTerms: [
        { label: "Needs attention", where: [{ columnId: "concentration", operator: "gt", value: 0.1 }] },
        { label: "Breaches limit", where: [{ columnId: "has_restricted_holding", operator: "eq", value: true }] },
        { label: "Cross border", where: [{ columnId: "market_value", operator: "gt", value: 5_000_000 }] },
      ],
    });
    for (const [text, words] of [
      ["Northgate needs attention", "northgate needs attention"],
      ["the trust needs attention", "trust needs attention"],
      ["accounts at Northgate needs attention", "accounts at northgate needs attention"],
      ["Northgate breaches limit", "northgate breaches limit"],
      ["accounts at Northgate breaches limit", "accounts at northgate breaches limit"],
    ]) {
      const state = await propose(text ?? "", oneForm);
      expect(state.status, `${text}: ${JSON.stringify(state.plan?.operations)}`).toBe("needs_clarification");
      expect(state.message, text).toBe(`I'm not sure what to do with “${words}”. Try rephrasing that part.`);
    }
    // Asked for with a relative word, listed, or before the noun it describes, the term is read. So is a name whose
    // first word only ends in "ss".
    for (const [text, want] of [
      [
        "accounts at Northgate that breaches limit",
        [
          ["custodian", "eq", "northgate"],
          ["has_restricted_holding", "eq", true],
        ],
      ],
      [
        "Northgate accounts, needs attention",
        [
          ["custodian", "eq", "northgate"],
          ["concentration", "gt", 0.1],
        ],
      ],
      [
        "needs attention accounts at Northgate",
        [
          ["concentration", "gt", 0.1],
          ["custodian", "eq", "northgate"],
        ],
      ],
      [
        "Northgate cross border",
        [
          ["custodian", "eq", "northgate"],
          ["market_value", "gt", 5_000_000],
        ],
      ],
    ] as const) {
      const state = await propose(text, oneForm);
      expect(state.status, `${text}: ${state.message}`).toBe("ready");
      expect(filters(state.plan?.operations), text).toEqual(want);
    }
  });

  it("asks when a term comes right after an amount, where a unit or what the amount counts goes", async () => {
    // "gain 50k large" read the amount as exactly $50,000 beside the term, where "gain 50k" alone asks how to compare.
    await asks("gain 50k large", "I'm not sure what to do with “50k large”. Try rephrasing that part.");
    await asks("accounts over $1m big", "I'm not sure what to do with “$1m big”. Try rephrasing that part.");
    // A term named as a unit GridCue doesn't read: "value over 1 mil" was ready as above $1 beside the term.
    const unit = defineSchema(columns, {
      ...options,
      houseTerms: [{ label: "Mil", where: [{ columnId: "has_restricted_holding", operator: "eq", value: true }] }],
    });
    const state = await propose("value over 1 mil", unit);
    expect(state.status).toBe("needs_clarification");
    expect(state.message).toBe("I'm not sure what to do with “1 mil”. Try rephrasing that part.");
    // Listed after the amount, or before it, the term is read. So is a term made with "-ing" or "-ed", which
    // describes the rows.
    await reads(
      "accounts over $1m unassigned",
      [
        ["market_value", "gt", 1_000_000],
        ["advisor_name", "isEmpty"],
      ],
      ["Filter Market value above $1,000,000", "Show only rows where Advisor is empty (Unassigned)"],
    );
    const OVER = ["market_value", "gt", 5_000_000];
    const OVER_LINE = "Filter Market value above $5,000,000";
    await reads("accounts over $5m, large", [OVER, LARGE], [OVER_LINE, LARGE_LINE]);
    await reads("accounts over $5m and large", [OVER, LARGE], [OVER_LINE, LARGE_LINE]);
    await reads("large accounts with value over $5m", [LARGE, OVER], [LARGE_LINE, OVER_LINE]);
  });

  it("asks where an amount would go: after a comparison word, or a preposition with nothing after the term", async () => {
    // "Under" is a small word GridCue places, and the part kept the term's own filter: the rows above the threshold,
    // the opposite of what was asked.
    for (const [text, words] of [
      ["accounts under large", "under large"],
      ["show accounts under big", "under big"],
      ["accounts that are under large", "under large"],
      ["under large", "under large"],
      ["accounts over large", "over large"],
      ["accounts larger than big", "larger than big"],
      ["accounts at large", "at large"],
      ["show accounts in large", "in large"],
    ]) {
      await asks(text ?? "", `I'm not sure what to do with “${words}”. Try rephrasing that part.`);
    }
    await reads("show accounts for large ones", [LARGE], [LARGE_LINE]);
    await reads("large accounts at Northgate", [LARGE, ["custodian", "eq", "northgate"]], [LARGE_LINE, "Filter Custodian to Northgate"]);
  });

  it("asks when the noun a term describes owns the rows: “large households' accounts”", async () => {
    await asks("large households' accounts", "I'm not sure what to do with “large households'”. Try rephrasing that part.");
    await asks("show large household's accounts", "I'm not sure what to do with “large household's”. Try rephrasing that part.");
    await asks("the big advisor's accounts", "I'm not sure what to do with “big advisor's”. Try rephrasing that part.");
    await asks(
      "unassigned taxable households' accounts",
      "I'm not sure what to do with “unassigned taxable households'”. Try rephrasing that part.",
    );
    await reads(
      "large taxable accounts",
      [LARGE, ["registration_type", "eq", "taxable"]],
      [LARGE_LINE, "Filter Registration type to Taxable"],
    );
  });

  it("places “my” before the rows a term describes", async () => {
    await reads("my large accounts", [LARGE], [LARGE_LINE]);
    await asks("my large", "I'm not sure what to do with “my”. Try rephrasing that part.");
  });

  it("asks when a column asked for beside it would end up in no change", async () => {
    await asks("show household for large accounts", "I'm not sure what to do with “household”. Try rephrasing that part.");
  });

  it("reads the Row Noun beside it as the rows, never as a column of another change", async () => {
    // Before the terms this showed Account number too, and dropped "large".
    await reads("show the advisor column for large accounts", [LARGE, ["columns.show"]], [LARGE_LINE, "Show Advisor"]);
  });

  it("keeps another change the words ask for", async () => {
    const { provider } = scripted({
      families: [pick("filter"), pick("sort")],
      columns: [pick("unrealized_gain")],
      direction: pick("desc", 0.9),
    });
    const state = await propose("large accounts sorted by unrealized gain", withTerms, provider);
    expect(state.status).toBe("ready");
    expect(state.preview?.lines).toEqual([LARGE_LINE, "Sort by Unrealized gain, descending"]);
  });
});

describe("a provider's picks for the term's own word are dropped (spec 4.2)", () => {
  // A provider's picks dropped by the limit. "Accounts" is also dropped as a name, as the rows (`dropped:c0.mention`).
  const dropped = (state: Awaited<ReturnType<typeof propose>>) =>
    (state.plan?.evidence ?? []).filter((e) => /^dropped:c\d+\.un/.test(e.key)).map((e) => `${e.key}=${e.selectedId}`);

  it("a sort", async () => {
    const { provider } = scripted({ families: [pick("sort")], columns: [pick("market_value")], direction: pick("desc", 0.9) });
    const state = await propose("large accounts", withTerms, provider);
    expect(state.status).toBe("ready");
    expect(filters(state.plan?.operations)).toEqual([LARGE]);
    expect(dropped(state)).toEqual(["dropped:c0.unnamed=market_value", "dropped:c0.unasked=sort"]);
  });

  it("a column", async () => {
    const { provider } = scripted({ families: [pick("columns.show")], columns: [pick("advisor_name")] });
    const state = await propose("show large accounts", withTerms, provider);
    expect(filters(state.plan?.operations)).toEqual([LARGE]);
    expect(dropped(state)).toEqual(["dropped:c0.unnamed=advisor_name", "dropped:c0.unasked=columns.show"]);
  });

  it("a value", async () => {
    const { provider } = scripted({
      families: [pick("filter")],
      values: [{ columnId: "registration_type", valueId: "taxable", confidence: 0.9 }],
    });
    const state = await propose("unassigned accounts", withTerms, provider);
    expect(filters(state.plan?.operations)).toEqual([["advisor_name", "isEmpty"]]);
    expect(dropped(state)).toEqual(["dropped:c0.unnamed=registration_type=taxable"]);
  });

  it("a yes/no column's No, where the words name only the column", async () => {
    const answer = (valueId: string) =>
      scripted({
        families: [pick("filter")],
        columns: [pick("has_restricted_holding")],
        values: [{ columnId: "has_restricted_holding", valueId, confidence: 0.95 }],
      }).provider;
    // "Restricted" says Yes. A provider's No was kept, and the plan showed the rows without restricted holdings.
    for (const text of ["large restricted accounts", "large accounts that are restricted"]) {
      const state = await propose(text, withTerms, answer("false"));
      expect(state.status, text).toBe("needs_clarification");
      expect(dropped(state), text).toContain("dropped:c0.unnamed=has_restricted_holding=false");
      await reads(
        text,
        [LARGE, ["has_restricted_holding", "eq", true]],
        [LARGE_LINE, "Show only rows where Restricted holdings is Yes"],
        answer("true"),
      );
    }
  });
});

describe("a term is never sent to a provider (spec 4.3)", () => {
  const TEXTS = [
    "large accounts",
    "show large taxable accounts",
    "accounts that need attention over $5m",
    "sort by big",
    "hide large accounts",
  ];

  it("the request is built the same with the terms declared and without them", () => {
    for (const text of TEXTS) {
      const request = (schema: ViewSchema) => {
        const normalized = normalize(text);
        const mentions = matchMentions(normalized.clauses, schema.columns.filter(isExposed), { rowNoun: schema.rowNoun });
        const input = withoutNamedSizes(normalized, mentions);
        const adapter = createRowsAdapter({ schema });
        return buildResolutionRequest(input, schema, adapter.getCapabilities(), adapter.getState().state, mentions);
      };
      expect(JSON.stringify(request(withTerms)), text).toBe(JSON.stringify(request(withoutTerms)));
      expect(JSON.stringify(request(withTerms)), text).not.toMatch(/houseTerms|needs attention|1000000|unassigned|orphaned/i);
    }
  });

  it("the provider is called once, as today, whether or not a term matched", async () => {
    for (const text of TEXTS) {
      const on = scripted();
      const off = scripted();
      await propose(text, withTerms, on.provider);
      await propose(text, withoutTerms, off.provider);
      expect(on.requests, text).toEqual(off.requests);
      expect(on.requests.length, text).toBe(1);
    }
  });
});

describe("reading terms stays fast", () => {
  const units = [
    "large ",
    "big accounts that need attention ",
    "not large ",
    "accounts are large ",
    "the account needs attention ",
    '"large" ',
  ];
  it("finds the terms in 2,000 characters, and the names right after them, in under 50 ms", () => {
    for (const unit of units) {
      const text = unit.repeat(Math.ceil(2000 / unit.length)).slice(0, 2000);
      // The best of three: backtracking is slow every time, while a busy test runner is slow once.
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        const normalized = normalize(text);
        const mentions = matchMentions(normalized.clauses, withTerms.columns.filter(isExposed), { rowNoun: withTerms.rowNoun });
        const input = withoutNamedSizes(normalized, mentions);
        namesAfterCodeRead(input, mentions, readCodeFilters(input, mentions, withTerms), withTerms);
        best = Math.min(best, performance.now() - started);
      }
      expect(best, unit).toBeLessThan(50);
    }
  });
});

// A word made from a term's name ("largely", "larger", "needed attention") is not the term, which is found only as a
// whole word. In a part with no code-read filter nothing reads it, and the part would be ready without it ("accounts
// largely in taxable" filtered Taxable alone, as before any term). The part asks about it (order plan, D4).
describe("a word made from a term's name, in a part with no code-read filter", () => {
  const largely = "I'm not sure what to do with “largely”. Try rephrasing that part.";
  it("asks about the word", async () => {
    await asks("accounts largely in taxable", largely);
    await asks("taxable accounts largely", largely);
    await asks("show accounts largely at Northgate", largely);
    await asks("show larger taxable accounts", "I'm not sure what to do with “larger”. Try rephrasing that part.");
    await asks("show bigger taxable accounts", "I'm not sure what to do with “bigger”. Try rephrasing that part.");
    await asks("taxable accounts that needed attention", "I'm not sure what to do with “needed attention”. Try rephrasing that part.");
    await asks("show orphan accounts at Northgate", "I'm not sure what to do with “orphan”. Try rephrasing that part.");
  });

  it("reads the words GridCue reads: a size word, and a comparison", async () => {
    await reads(
      "taxable accounts sorted by market value, largest first",
      [["registration_type", "eq", "taxable"], ["sort.set"]],
      ["Filter Registration type to Taxable", "Sort by Market value, descending"],
    );
    await reads("accounts bigger than $2m", [["market_value", "gt", 2_000_000]], ["Filter Market value above $2,000,000"]);
  });

  it("never looks inside a declared name or quoted text", async () => {
    await reads("accounts at Big Sky", [["custodian", "eq", "big_sky"]], ["Filter Custodian to Big Sky"]);
  });

  it("asks about a comparison word with no amount after it: “accounts larger than taxable”", async () => {
    // "Larger than" was left alone wherever "than" followed, and the part filtered Taxable alone.
    await asks("accounts larger than taxable", "I'm not sure what to do with “larger”. Try rephrasing that part.");
    await asks("accounts bigger than Northgate", "I'm not sure what to do with “bigger”. Try rephrasing that part.");
    await asks("taxable accounts larger than trust", "I'm not sure what to do with “larger”. Try rephrasing that part.");
  });

  it("reads as before with no terms declared", async () => {
    for (const text of ["show larger taxable accounts", "accounts larger than taxable"]) {
      const state = await propose(text, withoutTerms);
      expect(state.status, text).toBe("ready");
      expect(filters(state.plan?.operations), text).toEqual([["registration_type", "eq", "taxable"]]);
    }
  });
});

// An adverb beside what a part keeps ("largely", "mostly", "roughly") says how a row meets it, and a filter can't hold
// that. Nothing reads it, so the part was ready without it: "accounts largely in taxable" filtered Taxable alone, with or
// without terms. The part asks about the word, whatever the terms are named (order plan, D4). An adverb GridCue reads
// ("only", "exactly", "alphabetically") is read, and one right before a verb speaks of the asking: "kindly show …".
describe("an adverb nothing reads, in a part that keeps rows", () => {
  const about = (word: string) => `I'm not sure what to do with “${word}”. Try rephrasing that part.`;
  const asksBoth = async (text: string, word: string) => {
    for (const schema of [withTerms, withoutTerms]) {
      const state = await propose(text, schema);
      expect(state.status, `${text}: ${JSON.stringify(state.plan?.operations)}`).toBe("needs_clarification");
      expect(state.message, text).toBe(about(word));
    }
  };
  const readsBoth = async (text: string, want: ReadonlyArray<readonly unknown[]>) => {
    for (const schema of [withTerms, withoutTerms]) {
      const state = await propose(text, schema);
      expect(state.status, `${text}: ${state.message}`).toBe("ready");
      expect(filters(state.plan?.operations), text).toEqual(want);
    }
  };

  it("asks about the word, with or without terms", async () => {
    await asksBoth("accounts largely in taxable", "largely");
    await asksBoth("accounts that are mostly taxable", "mostly");
    await asksBoth("accounts mainly at Northgate", "mainly");
    await asksBoth("taxable accounts, primarily", "primarily");
    await asksBoth("accounts roughly over $1m", "roughly");
    await asksBoth("restricted accounts, generally", "generally");
  });

  it("asks about a made-up word too: no term is needed", async () => {
    const state = await propose("bigly taxable accounts", withoutTerms);
    expect(state.status).toBe("needs_clarification");
    expect(state.message).toBe(about("bigly"));
  });

  it("reads the adverbs GridCue reads, and one before a verb", async () => {
    await readsBoth("only taxable accounts", [["registration_type", "eq", "taxable"]]);
    await readsBoth("show taxable accounts only", [["registration_type", "eq", "taxable"]]);
    await readsBoth("kindly show taxable accounts", [["registration_type", "eq", "taxable"]]);
    await readsBoth("taxable accounts sorted by advisor alphabetically", [["registration_type", "eq", "taxable"], ["sort.set"]]);
  });

  it("reads an adverb that says what “only”, “all” or “now” says, as before", async () => {
    // Each was ready before the adverb rule, and the rule made it ask.
    await readsBoth("accounts currently at Northgate", [["custodian", "eq", "northgate"]]);
    await readsBoth("accounts solely at Northgate", [["custodian", "eq", "northgate"]]);
    await readsBoth("accounts that are fully taxable", [["registration_type", "eq", "taxable"]]);
    await readsBoth("show taxable accounts quickly", [["registration_type", "eq", "taxable"]]);
    // Any other adverb still asks: "held indirectly" may mean through a trust, which no filter here holds.
    await asksBoth("taxable accounts held indirectly", "indirectly");
  });
});

describe("with no terms declared", () => {
  it("a term's words read exactly as before", async () => {
    for (const text of [
      "large accounts",
      "show the big accounts",
      "accounts that need attention",
      "hide large accounts",
      "sort by large",
    ]) {
      const state = await propose(text, withoutTerms);
      expect(state.status, text).toBe("needs_clarification");
      expect(state.message, text).not.toMatch(/stands for rows|leave out “/);
    }
  });
});
