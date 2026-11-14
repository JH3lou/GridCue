import { describe, expect, it } from "vitest";
import { createGridCue } from "../src/core/controller";
import type { ViewOperation } from "../src/core/protocol";
import type { IntentProvider } from "../src/core/resolution";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

// Fixes for quoted text and dates that showed a ready Preview for rows the User didn't ask for (named filters spec,
// 5.1). Each fix asks. None adds a reading.
const wealth = defineSchema(
  [
    { id: "account_number", label: "Account number" },
    { id: "household", label: "Household" },
    { id: "advisor_name", label: "Advisor" },
    { id: "registration_type", label: "Registration type" },
    { id: "market_value", label: "Market value" },
    { id: "unrealized_gain", label: "Unrealized gain" },
    { id: "has_restricted_holding", label: "Restricted holdings" },
    { id: "custodian", label: "Custodian" },
  ],
  {
    rowNoun: "account",
    columns: {
      custodian: {
        enumValues: [
          { id: "northgate", label: "Northgate" },
          { id: "harbor", label: "Harbor" },
        ],
      },
      account_number: { aliases: ["account", "account #"] },
      household: { entity: "household" },
      advisor_name: { aliases: ["advisor", "rep"], entity: "advisor" },
      registration_type: {
        enumValues: [
          { id: "taxable", label: "Taxable" },
          { id: "ira", label: "IRA" },
          { id: "roth_ira", label: "Roth IRA", aliases: ["roth"] },
          { id: "trust", label: "Trust" },
        ],
        valueGroups: [{ label: "Retirement", values: ["ira", "roth_ira"] }],
      },
      market_value: { kind: "currency", aliases: ["value"] },
      unrealized_gain: { kind: "currency", aliases: ["gain"] },
      has_restricted_holding: { kind: "boolean", aliases: ["restricted"] },
    },
  },
);
// The dates schema of reading-fixes.test.ts, plus one date-and-time column.
const dated = defineSchema(
  [
    { id: "name", label: "Name" },
    { id: "opened", label: "Opened" },
    { id: "closed", label: "Close date" },
    { id: "last_contact", label: "Last contact" },
    { id: "value", label: "Value" },
  ],
  {
    rowNoun: "account",
    columns: {
      opened: { kind: "date", aliases: ["open date"] },
      closed: { kind: "date", aliases: ["closed"] },
      last_contact: { kind: "datetime" },
      value: { kind: "currency" },
    },
  },
);
const mock = createMockProvider({ defaultColumnForKind: { currency: "market_value" } });
const propose = async (text: string, schema = wealth, provider: IntentProvider = mock) => {
  const cue = createGridCue({ adapter: createRowsAdapter({ schema }), provider });
  await cue.propose(text);
  return cue.getState();
};
const filters = (ops: readonly ViewOperation[] | undefined) =>
  (ops ?? []).flatMap((op) => (op.type === "filter.add" ? [[op.predicate.columnId, op.predicate.operator, op.predicate.value]] : []));
const asks = async (text: string, prompt?: string, schema = wealth, provider: IntentProvider = mock) => {
  const state = await propose(text, schema, provider);
  expect(state.status, text).toBe("needs_clarification");
  if (prompt) expect(state.message, text).toBe(prompt);
};
const reads = async (text: string, want: ReadonlyArray<readonly unknown[]>, schema = wealth) => {
  const state = await propose(text, schema);
  expect(state.status, `${text}: ${state.message}`).toBe("ready");
  expect(filters(state.plan?.operations), text).toEqual(want);
};

const NOT_THERE = "GridCue can't filter for text that isn't there. Ask for the text to look for instead.";
const match = (text: string) => `I'm not sure how to match “${text}”. Try “containing”.`;
const whichColumn = (text: string) => `Which column should contain “${text}”?`;

describe("a negation beside quoted text", () => {
  it("asks for “not”, “isn't”, “!=”, “other than” and “except”", async () => {
    for (const text of [
      'advisor is not "Avery Lane"',
      'advisor isn\'t "Avery Lane"',
      "advisor isn’t “Avery Lane”",
      'advisor != "Avery Lane"',
      'advisor other than "Avery Lane"',
      'advisor except "Avery Lane"',
      'household is not "Hale"',
      'advisors aren\'t "Lane"',
      'Show accounts where the advisor is not "Hale" and market value over $1m',
    ])
      await asks(text, NOT_THERE);
  });

  it("asks for a negation before the column or after the text", async () => {
    await asks('not advisor "Lane"', NOT_THERE);
    await asks('accounts with no advisor "Lane"', NOT_THERE);
    await asks('advisor "Lane" excluded', NOT_THERE);
    await asks('advisor containing "Lane" but not "Avery"', NOT_THERE);
    await asks('advisor ≠ "Lane"', NOT_THERE);
  });
});

describe("“without” beside quoted text", () => {
  it("asks the same", async () => {
    await asks('accounts without advisor "Lane"', NOT_THERE);
    await asks('accounts without "Lane"', NOT_THERE);
  });
});

describe("a word GridCue doesn't read between a column and quoted text", () => {
  it("asks for “starts with”, “ends with”, “is exactly” and “=”", async () => {
    await asks('advisor starts with "Av"', match("av"));
    await asks('advisor ends with "Lane"', match("lane"));
    await asks('advisor is exactly "Avery Lane"', match("avery lane"));
    await asks('advisor = "Avery Lane"', match("avery lane"));
    await asks('advisor == "Avery Lane"', match("avery lane"));
    await asks('account number starts with "AC-1"', match("ac-1"));
    await asks('Accounts where advisor starts with "Av" and market value over $1m', match("av"));
  });

  it("asks for any other word, since this is a rule and not a list of bad words", async () => {
    for (const text of [
      'advisor named "Lane"',
      'advisor near "Lane"',
      'advisor similar to "Lane"',
      'advisor sounds like "Lane"',
      'advisor kind of "Lane"',
      'advisor is like "Lane"',
      'advisor for "Lane"',
      'household about "Hale"',
      'households ending with "Trust"',
      'advisor Northgate "Lane"',
      'Accounts with advisor named "Lane" over $1m',
    ])
      await asks(text, match(/"([^"]+)"/.exec(text)?.[1]?.toLowerCase() ?? ""));
  });
});

describe("the words GridCue reads before quoted text (controls)", () => {
  it("still reads “containing” after nothing, “:”, “is”, “are”, or a containing word", async () => {
    for (const [text, column, value] of [
      ['advisor containing "Lane"', "advisor_name", "lane"],
      ['advisor contains "Lane"', "advisor_name", "lane"],
      ['advisor is "Lane"', "advisor_name", "lane"],
      ['advisors are "Lane"', "advisor_name", "lane"],
      ['advisor: "Lane"', "advisor_name", "lane"],
      ['advisor:"Lane"', "advisor_name", "lane"],
      ['advisor like "Lane"', "advisor_name", "lane"],
      ['advisor matching "Lane"', "advisor_name", "lane"],
      ['advisor "Lane"', "advisor_name", "lane"],
      ['household has "Hale"', "household", "hale"],
      ['household includes "Hale"', "household", "hale"],
      ['Households containing "Alder; Birch"', "household", "alder; birch"],
      ['Accounts with account number containing "AC-100"', "account_number", "ac-100"],
    ] as const)
      await reads(text, [[column, "contains", value]]);
  });

  it("reads “column” after a column, and “name” after one that names another record, as part of the column", async () => {
    await reads('advisor name containing "concentration"', [["advisor_name", "contains", "concentration"]]);
    await reads('household names containing "Hale"', [["household", "contains", "hale"]]);
    await reads('advisor column containing "Lane"', [["advisor_name", "contains", "lane"]]);
    // Account number names no other record, so “account name” is not it.
    await asks('account name containing "Lane"', match("lane"));
    await asks('advisor name starts with "Av"', match("av"));
  });

  it("still reads a negation that belongs to a named value", async () => {
    await reads('Non-retirement accounts with advisor containing "Lane"', [
      ["registration_type", "in", ["taxable", "trust"]],
      ["advisor_name", "contains", "lane"],
    ]);
  });

  it("still reads quoted text beside an amount", async () => {
    await reads('Accounts where advisor contains "Hale!" and market value over $1m', [
      ["advisor_name", "contains", "hale!"],
      ["market_value", "gt", 1_000_000],
    ]);
  });
});

describe("a word GridCue doesn't read before the column or after quoted text", () => {
  const unread = (words: string) => `I'm not sure what to do with “${words}”. Try rephrasing that part.`;

  it("asks for an unread word between the Row Noun and the column", async () => {
    for (const [text, words] of [
      ['accounts sans advisor "Lane"', "accounts sans"],
      ['accounts lacking advisor "Lane"', "accounts lacking"],
      ['accounts w/o advisor "Lane"', "accounts w/o"],
      ['accounts minus advisor "Lane"', "accounts minus"],
      ['accounts barring advisor "Lane"', "accounts barring"],
      ['accounts save advisor "Lane"', "accounts save"],
      ['accounts outside advisor "Lane"', "accounts outside"],
      ['accounts formerly with advisor "Lane"', "accounts formerly with"],
      ['accounts leaving advisor "Lane"', "accounts leaving"],
      ['accounts transferring away from advisor "Lane"', "accounts transferring away from"],
      ['accounts versus advisor "Lane"', "accounts versus"],
      ['accounts sans household "Hale"', "accounts sans"],
      ['accounts for advisor "Lane"', "accounts for"],
      ['accounts for advisor containing "Lane"', "accounts for"],
      ['accounts of advisor "Lane"', "accounts of"],
      ['accounts xyz advisor "Lane"', "accounts xyz"],
      ['accounts whose former advisor is "Lane"', "accounts whose former"],
      ['accounts with former advisor "Lane"', "accounts with former"],
      ['accounts not taxable with advisor "Lane"', "accounts not taxable with"],
    ] as const)
      await asks(text, unread(words));
  });

  it("asks for an unread word before the column", async () => {
    for (const [text, words] of [
      ['the opposite of advisor "Lane"', "the opposite of"],
      ['show accounts minus advisor "Lane"', "show accounts minus"],
      ['show sans advisor "Lane"', "show sans"],
      ['taxable sans advisor "Lane"', "sans"],
      ['-advisor "Lane"', "-"],
    ] as const)
      await asks(text, unread(words));
  });

  it("asks for an unread word after quoted text, such as a negation or “exactly”", async () => {
    for (const [text, words] of [
      ['advisor "Lane" excepted', "excepted"],
      ['advisor "Lane" removed', "removed"],
      ['advisor "Lane" hidden', "hidden"],
      ['advisor "Lane" negated', "negated"],
      ['advisor "Lane" reversed', "reversed"],
      ['advisor is "Lane" exactly', "exactly"],
      ['advisor "Lane" exactly', "exactly"],
      ['advisor "Lane" exact match', "exact match"],
      ['advisor "Lane" as prefix', "as prefix"],
      ['advisor "Lane" at the start', "at the start"],
      ['advisor "Lane" only at the end', "only at the end"],
      ['accounts whose advisor is "Lane" exactly', "exactly"],
      ['advisor is "Avery Lane" exactly', "exactly"],
      ['advisor "Lane" but restricted', "but"],
    ] as const)
      await asks(text, unread(words));
  });

  it("asks for a negation before a yes/no name that GridCue doesn't read as “not”", async () => {
    for (const text of ['advisor "Lane" except restricted', 'advisor "Lane" other than restricted', 'advisor "Lane" besides restricted'])
      await asks(text, NOT_THERE);
  });

  it("still reads the words it knows on both sides (controls)", async () => {
    for (const text of [
      'accounts with advisor "Lane"',
      'accounts where advisor is "Lane"',
      'accounts whose advisor is "Lane"',
      'show accounts with advisor "Lane"',
      'show me accounts where the advisor is "Lane"',
    ])
      await reads(text, [["advisor_name", "contains", "lane"]]);
    await reads('taxable accounts with advisor "Lane"', [
      ["registration_type", "eq", "taxable"],
      ["advisor_name", "contains", "lane"],
    ]);
    await reads('taxable accounts, household like "Hale"', [
      ["registration_type", "eq", "taxable"],
      ["household", "contains", "hale"],
    ]);
    await reads('advisor "Lane" not restricted', [
      ["has_restricted_holding", "eq", false],
      ["advisor_name", "contains", "lane"],
    ]);
    await reads('accounts over $1m with advisor "Lane"', [
      ["market_value", "gt", 1_000_000],
      ["advisor_name", "contains", "lane"],
    ]);
    await reads('accounts over $1m, advisor "Lane"', [
      ["market_value", "gt", 1_000_000],
      ["advisor_name", "contains", "lane"],
    ]);
    await reads('advisor containing "Lane" and household containing "Hale"', [
      ["advisor_name", "contains", "lane"],
      ["household", "contains", "hale"],
    ]);
  });

  it("reads “but” as a joining word, not a negation, before “only” or a sort", async () => {
    await reads('advisor containing "Lane", but only taxable', [
      ["registration_type", "eq", "taxable"],
      ["advisor_name", "contains", "lane"],
    ]);
    await reads('taxable accounts but only advisor "Lane"', [
      ["registration_type", "eq", "taxable"],
      ["advisor_name", "contains", "lane"],
    ]);
    for (const text of ['advisor "Lane" sorted by value', 'advisor "Lane" but sorted by value', 'advisor "Lane", sorted by value']) {
      const state = await propose(text);
      expect(state.status, `${text}: ${state.message}`).toBe("ready");
      expect(filters(state.plan?.operations), text).toEqual([["advisor_name", "contains", "lane"]]);
      expect(state.plan?.operations, text).toContainEqual({ type: "sort.set", sorts: [{ columnId: "market_value", direction: "asc" }] });
    }
  });
});

// The words GridCue already reads elsewhere are read after quoted text too, as they were before the fixes. Nothing here
// is a new reading: each request read the same before the fixes.
describe("the words GridCue reads after quoted text", () => {
  const unread = (words: string) => `I'm not sure what to do with “${words}”. Try rephrasing that part.`;
  const lane = ["advisor_name", "contains", "lane"];
  const SORT_COLUMN = "Which column should be sorted by?";

  it("reads a preposition before a named value or Value Group, as a value is read anywhere", async () => {
    for (const [text, value] of [
      ['advisor "Lane" at Northgate', ["custodian", "eq", "northgate"]],
      ['advisor "Lane", at Northgate', ["custodian", "eq", "northgate"]],
      ['advisor "Lane" and at Northgate', ["custodian", "eq", "northgate"]],
      ['advisor "Lane" from Northgate', ["custodian", "eq", "northgate"]],
      ['advisor "Lane" within Northgate', ["custodian", "eq", "northgate"]],
      ['advisor "Lane" in taxable accounts', ["registration_type", "eq", "taxable"]],
      ['advisor "Lane" in the taxable accounts', ["registration_type", "eq", "taxable"]],
      ['advisor "Lane" in all taxable accounts', ["registration_type", "eq", "taxable"]],
      ['advisor "Lane" in just taxable accounts', ["registration_type", "eq", "taxable"]],
      ['advisor "Lane" for trusts', ["registration_type", "eq", "trust"]],
      ['advisor "Lane" among trusts', ["registration_type", "eq", "trust"]],
      ['advisor "Lane" just trusts', ["registration_type", "eq", "trust"]],
      ['advisor "Lane" with only trusts', ["registration_type", "eq", "trust"]],
      ['advisor "Lane" in retirement accounts', ["registration_type", "in", ["ira", "roth_ira"]]],
      ['household containing "Hale" at Northgate', ["custodian", "eq", "northgate"]],
    ] as const)
      await reads(text, [value, text.startsWith("household") ? ["household", "contains", "hale"] : lane]);
    await reads('advisor "Lane" at Northgate or Harbor', [["custodian", "in", ["northgate", "harbor"]], lane]);
  });

  it("reads a value as left out only where the Mentions read it so", async () => {
    const notTrusts = ["registration_type", "in", ["taxable", "ira", "roth_ira"]];
    for (const text of [
      'advisor "Lane" but trusts',
      'advisor "Lane" but not trusts',
      'advisor "Lane" not including trusts',
      'advisor "Lane" excluding the trusts',
      'advisor "Lane" exclude trusts',
      'advisor "Lane" remove trusts',
      'advisor "Lane" don\'t show trusts',
      'advisor "Lane" no longer show trusts',
    ])
      await reads(text, [notTrusts, lane]);
    for (const text of ['advisor "Lane" not at Northgate', 'advisor "Lane" except at Northgate', 'advisor "Lane" but not at Northgate'])
      await reads(text, [["custodian", "eq", "harbor"], lane]);
    await reads('advisor "Lane" in non-taxable accounts', [["registration_type", "in", ["ira", "roth_ira", "trust"]], lane]);
    // "Except for" leaves nothing out in the Mentions, and "but" before a yes/no name reads as nothing: both still ask.
    await asks('advisor "Lane" except for trusts', NOT_THERE);
    await asks('advisor "Lane" but restricted', unread("but"));
  });

  it("asks which column to sort by after a direction, as before the fixes", async () => {
    for (const text of [
      'accounts with advisor "Lane", largest first',
      'accounts with advisor "Lane" largest first',
      'advisor "Lane", smallest first',
      'advisor "Lane", descending',
      'advisor "Lane", in descending order',
      'advisor "Lane" high to low',
      'advisor "Lane", largest to smallest',
      'advisor "Lane", a to z',
      'advisor "Lane", top 10',
      'advisor "Lane" sorted descending',
      'advisor "Lane" accounts largest first',
      'largest first, advisor "Lane"',
      'top 10 accounts with advisor "Lane"',
    ])
      await asks(text, SORT_COLUMN);
  });

  it("reads a sort with its direction after quoted text, as before the fixes", async () => {
    for (const [text, sort] of [
      ['advisor "Lane", largest value first', { columnId: "market_value", direction: "desc" }],
      ['advisor "Lane", highest gain first', { columnId: "unrealized_gain", direction: "desc" }],
      ['advisor "Lane" by value descending', { columnId: "market_value", direction: "desc" }],
      ['advisor "Lane" largest by value', { columnId: "market_value", direction: "desc" }],
      ['advisor "Lane", top 10 by value', { columnId: "market_value", direction: "desc" }],
    ] as const) {
      const state = await propose(text);
      expect(state.status, `${text}: ${state.message}`).toBe("ready");
      expect(filters(state.plan?.operations), text).toEqual([lane]);
      expect(state.plan?.operations, text).toContainEqual({ type: "sort.set", sorts: [sort] });
    }
  });

  it("reads “where” and “whose” before an amount's column, as before the column", async () => {
    for (const text of ['advisor "Lane" whose value is over $1m', 'advisor "Lane" where value over $1m'])
      await reads(text, [lane, ["market_value", "gt", 1_000_000]]);
  });

  it("still asks for words in a direction that GridCue doesn't read", async () => {
    await asks('advisor "Lane" largest exact first', unread("largest exact first"));
    await asks('advisor "Lane" first', unread("first"));
    await asks('advisor "Lane" last name', unread("last name"));
  });

  it("reads a verb that chooses rows, and “only” after it, before the column", async () => {
    for (const text of [
      'keep advisor "Lane"',
      'keep only advisor "Lane"',
      'keep accounts with advisor "Lane"',
      'include advisor "Lane"',
      'show only accounts with advisor "Lane"',
      'show just accounts with advisor "Lane"',
      'list only accounts with advisor "Lane"',
    ])
      await reads(text, [lane]);
  });

  // "At every custodian other than Northgate": the negation belongs to a named value, so it is read as before the fixes.
  it("reads a quantifier before a column whose own value it leaves out, as before the fixes", async () => {
    const alder = ["household", "contains", "alder"];
    for (const text of [
      'household containing "Alder" at every custodian other than Northgate',
      'household containing "Alder" in all custodians except Northgate',
      'household containing "Alder" at each custodian other than Northgate',
      'household containing "Alder" and every custodian other than Northgate',
    ])
      await reads(text, [["custodian", "eq", "harbor"], alder]);
  });

  it("still asks for a quantifier before any other column", async () => {
    for (const [text, words] of [
      ['household containing "Alder" at every custodian', "at every"],
      ['household containing "Alder" every restricted', "every"],
      ['household containing "Alder" at every advisor', "at every"],
      ['household containing "Alder" sorted by every custodian other than Northgate', "sorted by every"],
      ['household containing "Alder" at every custodian or other than Northgate', "at every"],
    ] as const)
      await asks(text, unread(words));
  });

  it("reads “thanks” or “thank you” at the end of a part, as before the fixes", async () => {
    for (const text of [
      'Please show advisor containing "Lane", thanks.',
      'advisor "Lane", thank you',
      'advisor "Lane" thanks!',
      'advisor "Lane" too, thanks',
    ])
      await reads(text, [lane]);
  });

  it("reads “thanks” or “thank you” and a comma at the start of a request, as before the fixes", async () => {
    const state = await propose('Thanks, advisor matching "Whitfield" grouped by custodian.');
    expect(state.status, state.message ?? undefined).toBe("ready");
    expect(filters(state.plan?.operations)).toEqual([["advisor_name", "contains", "whitfield"]]);
    expect(state.plan?.operations).toContainEqual({ type: "group.set", columnIds: ["custodian"] });
    await reads('Thanks, please show advisor containing "Lane"', [lane]);
  });

  it("still asks for “thanks” anywhere else beside quoted text", async () => {
    for (const [text, words] of [
      ['advisor "Lane" thanks to Northgate', "thanks to"],
      ['advisor "Lane" thanks exactly', "thanks exactly"],
      ['advisor "Lane" thank you so much', "thank you so much"],
      ['advisor "Lane" thanks please', "thanks please"],
      ['Thanks, advisor "Lane" exactly', "exactly"],
      ['Thanks, the opposite of advisor "Lane"', "the opposite of"],
      ['Thanks for showing advisor "Lane"', "thanks for showing"],
      ['show accounts, thanks, with advisor "Lane"', "show accounts, thanks, with"],
    ] as const)
      await asks(text, unread(words));
  });
});

describe("the Row Noun after quoted text", () => {
  const unread = (words: string) => `I'm not sure what to do with “${words}”. Try rephrasing that part.`;
  const lane = ["advisor_name", "contains", "lane"];

  it("doesn't end the check: an unread word after it still asks", async () => {
    for (const [text, words] of [
      ['advisor "Lane" accounts exactly', "accounts exactly"],
      ['advisor "Lane" account exactly', "account exactly"],
      ['advisor "Lane" accounts, exactly', "accounts, exactly"],
      ['advisor "Lane" accounts precisely', "accounts precisely"],
      ['advisor "Lane" accounts removed', "accounts removed"],
      ['advisor "Lane" accounts hidden', "accounts hidden"],
      ['advisor "Lane" accounts dropped', "accounts dropped"],
      ['advisor "Lane" accounts as prefix', "accounts as prefix"],
    ] as const)
      await asks(text, unread(words));
  });

  it("is read like the words after it (controls)", async () => {
    await reads('advisor "Lane" accounts', [lane]);
    await reads('advisor "Lane" accounts only', [lane]);
    await reads('advisor "Lane" accounts please', [lane]);
    await reads('advisor "Lane" accounts at Northgate', [["custodian", "eq", "northgate"], lane]);
    await reads('advisor "Lane" accounts not trusts', [["registration_type", "in", ["taxable", "ira", "roth_ira"]], lane]);
    await reads('advisor "Lane" accounts, not trusts', [["registration_type", "in", ["taxable", "ira", "roth_ira"]], lane]);
    await reads('advisor "Lane" accounts with value over $1m', [lane, ["market_value", "gt", 1_000_000]]);
  });
});

describe("the Row Noun before “for”", () => {
  it("is the rows, so GridCue asks which column holds the text", async () => {
    await asks('accounts for "Avery Lane"', whichColumn("avery lane"));
    await asks('account for "Hale"', whichColumn("hale"));
    await asks('Show accounts for "Hale"', whichColumn("hale"));
  });

  it("changes no other name: “gain for trusts” still names Unrealized gain", async () => {
    const state = await propose("sort by gain for trusts");
    expect(state.status, state.message ?? "").toBe("ready");
    expect(state.plan?.operations).toContainEqual({ type: "sort.set", sorts: [{ columnId: "unrealized_gain", direction: "asc" }] });
    expect(filters(state.plan?.operations)).toEqual([["registration_type", "eq", "trust"]]);
  });
});

describe("quoted text with no column", () => {
  it("asks which column should contain it", async () => {
    await asks('"Avery Lane"', whichColumn("avery lane"));
    await asks('"Hale"', whichColumn("hale"));
  });

  it("asks even when a provider picks a column for it", async () => {
    // A provider can't see which column holds a name, so its pick is offered first, never applied.
    const picks: IntentProvider = {
      resolve: async (request) => ({
        clauses: request.clauses.map((c) => ({
          clauseIndex: c.index,
          families: [{ id: "filter", confidence: 0.95 }],
          columns: [{ id: "advisor_name", confidence: 0.95 }],
          values: [],
          unmatchedTerms: [],
          literalColumns: [{ literalIndex: 0, columnId: "advisor_name", confidence: 0.95 }],
        })),
      }),
    };
    for (const text of ['"Avery Lane"', 'accounts for "Avery Lane"', 'show "Avery Lane"']) {
      const state = await propose(text, wealth, picks);
      expect(state.status, text).toBe("needs_clarification");
      expect(state.message, text).toBe(whichColumn("avery lane"));
      expect(state.plan?.clarifications[0]?.options?.[0]?.id, text).toBe("advisor_name");
    }
  });

  it("asks when a provider picks another column than the one named before the text", async () => {
    const picks: IntentProvider = {
      resolve: async (request) => ({
        clauses: request.clauses.map((c) => ({
          clauseIndex: c.index,
          families: [{ id: "filter", confidence: 0.95 }],
          columns: [],
          values: [],
          unmatchedTerms: [],
          literalColumns: [{ literalIndex: 0, columnId: "household", confidence: 0.95 }],
        })),
      }),
    };
    await asks('advisor containing "Lane"', whichColumn("lane"), wealth, picks);
  });
});

describe("a date against a date-and-time column", () => {
  const prompt = "Last contact holds times of day, so GridCue can't filter it by date yet.";

  it("asks for every comparison", async () => {
    for (const text of [
      "last contact after 2026-01-31",
      "last contact before 2026-01-31",
      "accounts with last contact on 2026-01-31",
      "last contact since 2025-10-01",
      "last contact 2026-01-31",
    ])
      await asks(text, prompt, dated);
  });

  it("asks for a column of Date objects, which schema inference calls date-and-time", async () => {
    const inferred = defineSchema([{ id: "contacted", label: "Contacted" }], {
      sampleRows: [{ contacted: new Date("2026-01-31T09:00:00Z") }],
    });
    expect(inferred.columns[0]?.kind).toBe("datetime");
    await asks("contacted after 2026-01-31", "Contacted holds times of day, so GridCue can't filter it by date yet.", inferred);
  });

  it("offers no date-and-time column when it asks which column a date is for", async () => {
    // A provider that reads a filter and picks Last contact for the date, at a middling score.
    const picks: IntentProvider = {
      resolve: async (request) => ({
        clauses: request.clauses.map((c) => ({
          clauseIndex: c.index,
          families: [{ id: "filter", confidence: 0.95 }],
          columns: [],
          values: [],
          unmatchedTerms: [],
          literalColumns: [{ literalIndex: 0, columnId: "last_contact", confidence: 0.7 }],
        })),
      }),
    };
    const state = await propose("after 2026-01-31", dated, picks);
    expect(state.message).toBe("Which column should be above 2026-01-31?");
    expect(state.plan?.clarifications[0]?.options?.map((o) => o.id)).toEqual(["opened", "closed"]);
  });

  it("still reads a date against a date column (control)", async () => {
    await reads("opened after 2026-01-31", [["opened", "gt", "2026-01-31"]], dated);
    await reads("close date on 2024-03-01", [["closed", "eq", "2024-03-01"]], dated);
  });
});

describe("a date that is not a real day", () => {
  it("asks", async () => {
    await asks("opened after 2026-02-31", "2026-02-31 isn't a date.", dated);
    await asks("close date before 2026-11-31", "2026-11-31 isn't a date.", dated);
    await asks("accounts opened on 2027-02-29", "2027-02-29 isn't a date.", dated);
    await asks("opened before 2026-00-15", "2026-00-15 isn't a date.", dated);
    await asks("opened after 2026-13-01", "2026-13-01 isn't a date.", dated);
    await asks("opened after 2026-04-00", "2026-04-00 isn't a date.", dated);
  });

  it("still reads a leap day and a month end (control)", async () => {
    await reads("opened on 2024-02-29", [["opened", "eq", "2024-02-29"]], dated);
    await reads("opened before 2026-04-30", [["opened", "lt", "2026-04-30"]], dated);
  });
});

// Round-3 review. The Row Noun before "for" is the rows only beside quoted text: anywhere else it reads as before the
// fixes, so a sort or grouping that names it keeps it.
describe("the Row Noun before “for” in a sort or grouping", () => {
  const trusts = ["registration_type", "eq", "trust"];
  const byAccount = { type: "sort.set", sorts: [{ columnId: "account_number", direction: "asc" }] };
  it("is still the column the sort or grouping names, as before the fixes", async () => {
    for (const [text, value, op] of [
      ["sort by account for trusts", trusts, byAccount],
      ["sort by account for Northgate", ["custodian", "eq", "northgate"], byAccount],
      ["sort accounts by account for trusts", trusts, byAccount],
      ["sort by the account for trusts", trusts, byAccount],
      ["group by account for Northgate", ["custodian", "eq", "northgate"], { type: "group.set", columnIds: ["account_number"] }],
      ["group by account for taxable", ["registration_type", "eq", "taxable"], { type: "group.set", columnIds: ["account_number"] }],
      [
        "sort by value then account for taxable",
        ["registration_type", "eq", "taxable"],
        {
          type: "sort.set",
          sorts: [
            { columnId: "market_value", direction: "asc" },
            { columnId: "account_number", direction: "asc" },
          ],
        },
      ],
    ] as const) {
      const state = await propose(text);
      expect(state.status, `${text}: ${state.message}`).toBe("ready");
      expect(filters(state.plan?.operations), text).toEqual([value]);
      expect(state.plan?.operations, text).toContainEqual(op);
    }
  });
});

// A "!" right before a name, or at the start of a request, says "not". It used to split the part, so the name after it
// was read as wanted: `!advisor "Lane"` and `advisor "Lane" !trusts` showed the very rows the User asked to leave out.
describe("a “!” before a name", () => {
  const BANG = "GridCue can't tell what “!” leaves out. Say which rows to show.";
  it("asks, with quoted text or without it", async () => {
    for (const text of [
      '!advisor "Whitfield"',
      '! advisor "Whitfield"',
      'taxable accounts !advisor "Whitfield"',
      'value over $1m !advisor "Whitfield"',
      'trusts at Northgate !household "Hale"',
      'advisor "Whitfield" !trusts',
      'advisor "Whitfield" !Northgate',
      'advisor "Whitfield" !restricted',
      'advisor "Whitfield", !trusts',
      '!trusts with advisor "Whitfield"',
      'advisor !"Lane"',
      "!trusts",
      "!restricted",
      "!! trusts",
      "sort by value !trusts",
      'advisor "Whitfield" ! trusts',
      'advisor "Whitfield"!trusts',
    ])
      await asks(text, BANG);
  });

  it("still ends a part right after a word, where a space or the end follows it (controls)", async () => {
    await reads("show trusts!", [["registration_type", "eq", "trust"]]);
    await reads("show trusts!!", [["registration_type", "eq", "trust"]]);
    await reads('trusts! advisor "Whitfield"', [
      ["registration_type", "eq", "trust"],
      ["advisor_name", "contains", "whitfield"],
    ]);
    await reads('Accounts where advisor contains "Hale!" and market value over $1m', [
      ["advisor_name", "contains", "hale!"],
      ["market_value", "gt", 1_000_000],
    ]);
    await asks('advisor != "Avery Lane"', NOT_THERE);
  });
});

// Words GridCue read correctly before the fixes, beside quoted text. Each reads as it did then; none is a new reading.
describe("more words GridCue reads beside quoted text, as before the fixes", () => {
  const whitfield = ["advisor_name", "contains", "whitfield"];
  const hale = ["household", "contains", "hale"];
  const over = ["market_value", "gt", 1_000_000];

  it("reads “for” before the column after a value, an amount, a sort or the Row Noun", async () => {
    await reads('value over $1m for advisor "Whitfield"', [over, whitfield]);
    await reads('trusts for advisor "Whitfield"', [["registration_type", "eq", "trust"], whitfield]);
    await reads('taxable accounts for advisor "Whitfield"', [["registration_type", "eq", "taxable"], whitfield]);
    await reads('accounts over $1m for advisor "Whitfield"', [over, whitfield]);
    for (const text of ['top 5 by value for advisor "Whitfield"', 'largest accounts by value for advisor "Whitfield"']) {
      const state = await propose(text);
      expect(state.status, `${text}: ${state.message}`).toBe("ready");
      expect(filters(state.plan?.operations), text).toEqual([whitfield]);
      expect(state.plan?.operations, text).toContainEqual({ type: "sort.set", sorts: [{ columnId: "market_value", direction: "desc" }] });
    }
  });

  it("reads a filter verb before the column", async () => {
    for (const text of [
      'filter by advisor "Whitfield"',
      'filter by advisor containing "Whitfield"',
      'filter on advisor "Whitfield"',
      'filter for advisor "Whitfield"',
      'filter accounts by advisor "Whitfield"',
      'filter rows with advisor "Whitfield"',
      'filter the grid to advisor "Whitfield"',
      'view advisor "Whitfield"',
      'look at advisor "Whitfield"',
      'show all of advisor "Whitfield"\'s accounts',
      'show all of the accounts with advisor "Whitfield"',
      'advisor\'s "Whitfield"',
    ])
      await reads(text, [whitfield]);
    for (const text of ['filter by household "Hale"', 'filter on household "Hale"']) await reads(text, [hale]);
  });

  // The Row Noun left as a name before the column still asks. Before the fixes these read only where the Mock
  // Provider happened to pick the column for the text; `list accounts for advisor "Whitfield"` asked. A provider's pick
  // for quoted text is never applied now, so reading them would be a new reading.
  it("still asks where the Row Noun is left as a name before the column", async () => {
    const unread = (words: string) => `I'm not sure what to do with “${words}”. Try rephrasing that part.`;
    await asks('show accounts for household "Hale"', unread("accounts for"));
    await asks('show accounts for advisor "Whitfield"', unread("accounts for"));
    await asks('list accounts for advisor "Whitfield"', unread("accounts for"));
    await asks('accounts handled by advisor "Whitfield"', unread("accounts handled by"));
  });

  // "To" between the column and the text may mean "equal to" (cases-named-fixes-heldout-r2.jsonl, r2-ok-36).
  it("still asks for “to” between the column and the text", async () => {
    await asks('filter advisor to "Whitfield"', match("whitfield"));
    await asks('Can you filter household to "Alder" please?', match("alder"));
  });

  it("reads ordinary words after the text, before a value, an amount or a sort", async () => {
    for (const [text, value] of [
      ['advisor "Whitfield" and also trusts', ["registration_type", "eq", "trust"]],
      ['advisor "Whitfield" that are taxable', ["registration_type", "eq", "taxable"]],
      ['advisor "Whitfield" accounts that are taxable', ["registration_type", "eq", "taxable"]],
      ['advisor "Whitfield" which are trusts', ["registration_type", "eq", "trust"]],
      ['advisor "Whitfield" who are at Northgate', ["custodian", "eq", "northgate"]],
      ['advisor "Whitfield" holding restricted', ["has_restricted_holding", "eq", true]],
      ['advisor "Whitfield" but not restricted', ["has_restricted_holding", "eq", false]],
    ] as const)
      await reads(text, [value, whitfield]);
    for (const text of ['advisor "Whitfield" valued over $1m', 'advisor "Whitfield" worth over $1m']) await reads(text, [whitfield, over]);
    for (const [text, direction] of [
      ['advisor "Whitfield" from largest to smallest value', "desc"],
      ['advisor "Whitfield" in order of value', "asc"],
    ] as const) {
      const state = await propose(text);
      expect(state.status, `${text}: ${state.message}`).toBe("ready");
      expect(filters(state.plan?.operations), text).toEqual([whitfield]);
      expect(state.plan?.operations, text).toContainEqual({ type: "sort.set", sorts: [{ columnId: "market_value", direction }] });
    }
    for (const text of ['advisor "Whitfield" only please', 'advisor "Whitfield" as well please', 'advisor "Whitfield" also thanks'])
      await reads(text, [whitfield]);
  });

  it("still asks where “but” could leave the name after it out, as “but trusts” does", async () => {
    const unread = (words: string) => `I'm not sure what to do with “${words}”. Try rephrasing that part.`;
    await asks('advisor "Whitfield" but restricted', unread("but"));
    await asks('advisor "Whitfield" but over $1m', unread("but over"));
  });

  it("still asks for a reset beside quoted text, which kept the old filters before the fixes", async () => {
    await asks('reset and advisor "Whitfield"');
    await asks('reset, advisor "Whitfield"');
  });
});
