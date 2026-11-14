import { describe, expect, it } from "vitest";
import { type CodeReadFilter, readCodeFilters } from "../src/core/code-read";
import { createGridCue } from "../src/core/controller";
import { matchMentions } from "../src/core/mentions";
import { normalize, withoutNamedSizes } from "../src/core/normalize";
import { renderPreview } from "../src/core/preview";
import type { ViewOperation, ViewSchema } from "../src/core/protocol";
import { buildResolutionRequest, type ClauseResolution, type IntentProvider } from "../src/core/resolution";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema, isExposed } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

// Text forms (named filters spec, 5.2; ADR 0023): "starts with", "exactly", empty and not empty. Each form is the words
// shown and nothing else. Code reads each one, and the compiler writes its filter only where the column takes it.
const wealth = defineSchema(
  [
    { id: "account_number", label: "Account number" },
    { id: "household", label: "Household" },
    { id: "advisor_name", label: "Advisor" },
    { id: "registration_type", label: "Registration type" },
    { id: "market_value", label: "Market value" },
    { id: "unrealized_gain", label: "Unrealized gain" },
    { id: "concentration", label: "Concentration" },
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
          { id: "trust", label: "Trust" },
        ],
      },
      market_value: { kind: "currency", aliases: ["value"] },
      unrealized_gain: { kind: "currency", aliases: ["gain"] },
      concentration: { kind: "percent" },
      has_restricted_holding: { kind: "boolean", aliases: ["restricted"] },
    },
  },
);
// A ledger, with a column of every kind. "Entry" is the Row Noun and an alias of Entry number.
const ledger = defineSchema(
  [
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
  ],
  {
    rowNoun: "entry",
    columns: {
      entry_number: { aliases: ["entry"] },
      booked: { kind: "date" },
      posted_at: { kind: "datetime" },
      units: { kind: "number" },
      amount: { kind: "currency" },
      rate: { kind: "percent" },
      category: {
        kind: "enum",
        enumValues: [
          { id: "fees", label: "Fees" },
          { id: "services", label: "Services" },
        ],
      },
      cleared: { kind: "boolean" },
    },
  },
);

const mock = createMockProvider({ defaultColumnForKind: { currency: "market_value", percent: "concentration" } });
const ledgerMock = createMockProvider({ defaultColumnForKind: { currency: "amount", percent: "rate" } });
const propose = async (text: string, schema: ViewSchema = wealth, provider?: IntentProvider) => {
  const cue = createGridCue({
    adapter: createRowsAdapter({ schema }),
    provider: provider ?? (schema === ledger ? ledgerMock : mock),
  });
  await cue.propose(text);
  return cue.getState();
};
const filters = (ops: readonly ViewOperation[] | undefined) =>
  (ops ?? []).flatMap((op) =>
    op.type === "filter.add"
      ? [[op.predicate.columnId, op.predicate.operator, ...(op.predicate.value === undefined ? [] : [op.predicate.value])]]
      : [],
  );
/** Ready, with these filters and nothing else, and these Preview lines if given. */
const reads = async (text: string, want: ReadonlyArray<readonly unknown[]>, lines?: string[], schema: ViewSchema = wealth) => {
  const state = await propose(text, schema);
  expect(state.status, `${text}: ${state.message}`).toBe("ready");
  expect(filters(state.plan?.operations), text).toEqual(want);
  expect(state.plan?.operations.length, text).toBe(want.length);
  if (lines) expect(state.preview?.lines, text).toEqual(lines);
};
const asks = async (text: string, prompt?: string, schema: ViewSchema = wealth) => {
  const state = await propose(text, schema);
  expect(state.status, `${text}: ${JSON.stringify(state.plan?.operations)}`).toBe("needs_clarification");
  if (prompt) expect(state.message, text).toBe(prompt);
};
const notReady = async (text: string, schema: ViewSchema = wealth) => {
  const state = await propose(text, schema);
  expect(state.status, `${text}: ${JSON.stringify(state.plan?.operations)}`).not.toBe("ready");
};
const codeRead = (text: string, schema: ViewSchema = wealth) => {
  const normalized = normalize(text);
  const mentions = matchMentions(normalized.clauses, schema.columns.filter(isExposed), { rowNoun: schema.rowNoun });
  const input = withoutNamedSizes(normalized, mentions);
  return { input, mentions, found: readCodeFilters(input, mentions, schema) };
};
/** What the reader found, as "words: column operator value". */
const found = (text: string, schema: ViewSchema = wealth) => {
  const { input, found: all } = codeRead(text, schema);
  return all.map((f: CodeReadFilter) => {
    const words = input.clauses[f.clauseIndex]?.text.slice(f.start, f.end);
    const { columnId, operator, value } = f.predicate;
    return `${words}: ${columnId} ${operator}${value === undefined ? "" : ` ${value}`}`;
  });
};

const match = (text: string) => `I'm not sure how to match “${text}”. Try “containing”.`;
const placed = (words: string) => `I'm not sure what to do with ${words}. Try rephrasing that part.`;

describe("Literal.match", () => {
  const matchOf = (text: string) => normalize(text).clauses[0]?.literals.find((l) => l.kind === "text")?.match;

  it("reads “starts with” and its other words", () => {
    for (const words of ["starts with", "starting with", "begins with", "beginning with"])
      expect(matchOf(`advisor ${words} "Av"`), words).toBe("startsWith");
  });

  it("reads “exactly” and its other words", () => {
    for (const words of ["is exactly", "exactly", "=", "equals", "equal to"]) expect(matchOf(`advisor ${words} "Av"`), words).toBe("exact");
    expect(matchOf('advisor="Av"')).toBe("exact");
  });

  it("is not set for “containing”, “ends with”, “==”, or a negation before the words", () => {
    for (const text of [
      'advisor is "Lane"',
      'advisor containing "Lane"',
      'advisor ends with "Lane"',
      'advisor == "Lane"',
      'advisor != "Lane"',
      'advisor not starting with "Av"',
      'advisor isn\'t exactly "Avery Lane"',
      'advisor is not exactly "Avery Lane"',
    ])
      expect(matchOf(text), text).toBeUndefined();
  });

  it("is never sent to the provider: the request is the same with it and without it", () => {
    const { input, mentions } = codeRead('advisor starts with "Av" and household is exactly "Hale"');
    expect(input.clauses[0]?.literals.map((l) => l.match)).toEqual(["startsWith", "exact"]);
    const capabilities = createRowsAdapter({ schema: wealth }).getCapabilities();
    const state = createRowsAdapter({ schema: wealth }).getState().state;
    const sent = buildResolutionRequest(input, wealth, capabilities, state, mentions);
    const without = {
      ...input,
      clauses: input.clauses.map((c) => ({ ...c, literals: c.literals.map(({ match: _match, ...lit }) => lit) })),
    };
    expect(JSON.stringify(sent)).toBe(JSON.stringify(buildResolutionRequest(without, wealth, capabilities, state, mentions)));
    expect(JSON.stringify(sent)).not.toContain('"match"');
  });
});

// Spec 5.2, the first table: each form, and what it reads as.
describe("readCodeFilters, each form", () => {
  it("reads C starts with, starting with, begins with and beginning with “x”", () => {
    for (const words of ["starts with", "starting with", "begins with", "beginning with"])
      expect(found(`advisor ${words} "Av"`), words).toEqual([`advisor ${words} "av": advisor_name startsWith av`]);
  });

  it("reads C is exactly, exactly, =, equals and equal to “x”", () => {
    for (const words of ["is exactly", "exactly", "=", "equals", "equal to"])
      expect(found(`household ${words} "Hale"`), words).toEqual([`household ${words} "hale": household eq hale`]);
  });

  it("reads C is empty, is blank and is missing", () => {
    for (const words of ["is empty", "is blank", "is missing"])
      expect(found(`advisor ${words}`), words).toEqual([`advisor ${words}: advisor_name isEmpty`]);
  });

  it("reads no C, with no C, without C, without a C, without an C and without any C, each with “assigned” or “set”", () => {
    for (const lead of ["no", "without", "without a", "without an", "without any"])
      for (const tail of ["", " assigned", " set"])
        expect(found(`accounts with ${lead} advisor${tail}`), lead + tail).toEqual([`${lead} advisor${tail}: advisor_name isEmpty`]);
  });

  it("reads C is not empty, is not blank and isn't empty", () => {
    for (const words of ["is not empty", "is not blank", "isn't empty"])
      expect(found(`advisor ${words}`), words).toEqual([`advisor ${words}: advisor_name isNotEmpty`]);
  });

  it("reads has a C, have an C and having a C, each with “assigned” or “set”", () => {
    // "Has" and "have" describe the rows asked for after "that" (see "a form said as a statement").
    for (const lead of ["has a", "has an", "have a", "have an", "having a", "having an"])
      for (const tail of ["", " assigned", " set"])
        expect(found(`accounts ${lead.startsWith("having") ? "" : "that "}${lead} advisor${tail}`), lead + tail).toEqual([
          `${lead} advisor${tail}: advisor_name isNotEmpty`,
        ]);
  });

  it("reads a column the Mentions drop before an amount, so the form asks rather than drop its words", () => {
    // The Mentions read "advisor" before "over $1m" as the rows; the form's words still name the column.
    expect(found("accounts with no advisor over $1m")).toEqual(["no advisor: advisor_name isEmpty"]);
  });

  it("reads the forms after a yes/no column, so the compiler can ask about them", () => {
    expect(found("cleared is empty", ledger)).toEqual(["cleared is empty: cleared isEmpty"]);
    expect(found("cleared isn't empty", ledger)).toEqual(["cleared isn't empty: cleared isNotEmpty"]);
    expect(found("restricted holdings is missing")).toEqual(["restricted holdings is missing: has_restricted_holding isEmpty"]);
  });

  it("never reads the Row Noun, a yes/no column before it, an amount column before an amount, or quoted text after the column", () => {
    for (const text of [
      "no accounts over $1m",
      "no account",
      "accounts with no accounts",
      "no restricted holdings",
      "accounts without restricted holdings",
      "accounts with no gain over $50k",
      "accounts with no value at least $1m",
      'accounts without advisor "Lane"',
      'advisor is "Lane"',
      'advisor containing "Lane"',
      'advisor ends with "Lane"',
      'starts with "Av"',
    ])
      expect(found(text), text).toEqual([]);
    expect(found("entries with no entry", ledger)).toEqual([]);
    expect(found("entries with no cleared", ledger)).toEqual([]);
  });
});

// Spec 5.2, the second table: one test per row.
describe("the forms through the Controller, with the Mock Provider", () => {
  it('advisor starts with "Av": Filter Advisor starting with “av”', async () => {
    await reads('advisor starts with "Av"', [["advisor_name", "startsWith", "av"]], ["Filter Advisor starting with “av”"]);
  });

  it('advisor is exactly "Avery Lane": Filter Advisor to exactly “avery lane”', async () => {
    await reads('advisor is exactly "Avery Lane"', [["advisor_name", "eq", "avery lane"]], ["Filter Advisor to exactly “avery lane”"]);
  });

  it('advisor ends with "Lane": asks, as after PR 1', async () => {
    await asks('advisor ends with "Lane"', match("lane"));
  });

  it("accounts with no advisor assigned, advisor is blank: Show only rows where Advisor is empty", async () => {
    for (const text of ["accounts with no advisor assigned", "advisor is blank"])
      await reads(text, [["advisor_name", "isEmpty"]], ["Show only rows where Advisor is empty"]);
  });

  it("accounts that have an advisor: Show only rows where Advisor is not empty", async () => {
    await reads("accounts that have an advisor", [["advisor_name", "isNotEmpty"]], ["Show only rows where Advisor is not empty"]);
  });

  it("taxable accounts with no advisor: Filter Registration type to Taxable; show only rows where Advisor is empty", async () => {
    await reads(
      "taxable accounts with no advisor",
      [
        ["registration_type", "eq", "taxable"],
        ["advisor_name", "isEmpty"],
      ],
      ["Filter Registration type to Taxable", "Show only rows where Advisor is empty"],
    );
  });

  it("accounts with no advisor over $1m: asks", async () => {
    await asks(
      "accounts with no advisor over $1m",
      "I'm not sure what the amount after “no advisor” applies to. Name its column, or split it into separate parts.",
    );
  });

  it("no gain: asks, since an amount column could be empty or zero", async () => {
    await asks("no gain", "GridCue can't tell whether “no gain” means Unrealized gain is empty or zero. Ask for an amount instead.");
  });

  it("no restricted holdings: unchanged", async () => {
    await reads("no restricted holdings", [["has_restricted_holding", "eq", false]]);
  });

  it("no accounts over $1m, accounts with no gain over $50k: unchanged", async () => {
    await reads("no accounts over $1m", [["market_value", "lte", 1_000_000]]);
    await reads("accounts with no gain over $50k", [["unrealized_gain", "lte", 50_000]]);
  });

  it("there is no advisor I trust: asks about “there” and “I”", async () => {
    await asks("there is no advisor I trust", placed("“there” and “i”"));
  });
});

describe("where an empty form is read", () => {
  it("reads text, category, date and date-and-time columns", async () => {
    await reads("entries without a counterparty", [["counterparty", "isEmpty"]], undefined, ledger);
    await reads("entries with no category", [["category", "isEmpty"]], undefined, ledger);
    await reads("booked is missing", [["booked", "isEmpty"]], undefined, ledger);
    await reads("posted at is not blank", [["posted_at", "isNotEmpty"]], undefined, ledger);
    await reads("custodian is empty", [["custodian", "isEmpty"]]);
  });

  it("asks on a number, currency or percent column", async () => {
    for (const text of ["units is empty", "entries with no amount", "rate is missing", "entries that have a rate"])
      await asks(text, undefined, ledger);
    await asks("market value is empty");
  });

  it("keeps today's reading on a yes/no column", async () => {
    await reads("accounts without restricted holdings", [["has_restricted_holding", "eq", false]]);
  });

  it("never reads the Row Noun as its column", async () => {
    await notReady("no account");
    await notReady("entries with no entry", ledger);
  });

  it("asks when an amount or a comparison follows", async () => {
    await asks("accounts with no advisor at least $1m");
    await asks("entries with no counterparty over $10k", undefined, ledger);
    await asks("entries with no booked before 2026-01-01", undefined, ledger);
  });

  it("reads an amount with its own column or before the form", async () => {
    for (const text of ["accounts with no advisor and market value over $1m", "accounts over $1m with no advisor"])
      await reads(text, [
        ["market_value", "gt", 1_000_000],
        ["advisor_name", "isEmpty"],
      ]);
  });

  it("asks when an amount follows with no name of its own, past “and”, a comma or the end of the part", async () => {
    // The amount names no column, so it could be the form's: "Advisor is empty and [Advisor is] over 5%".
    const amountQuestion = (words: string) =>
      `I'm not sure what the amount after “${words}” applies to. Name its column, or split it into separate parts.`;
    await asks("Advisor is empty and over 5%", amountQuestion("advisor is empty"));
    await asks("Advisor is blank, over 5%", amountQuestion("advisor is blank"));
    await asks("no advisor and above 20%", amountQuestion("no advisor"));
    await asks("accounts with no advisor and over $1m", amountQuestion("no advisor"));
    await asks("no advisor and also over $1m", amountQuestion("no advisor"));
    await asks("Advisor is not empty and over 5%", amountQuestion("advisor is not empty"));
    await asks("accounts that have an advisor and over 5%", amountQuestion("have an advisor"));
    await asks("no advisor; over 5%", amountQuestion("no advisor"));
    await asks("Counterparty is empty and over $500", amountQuestion("counterparty is empty"), ledger);
    await asks("Counterparty is empty and after 2026-01-01", amountQuestion("counterparty is empty"), ledger);
  });

  it("reads a change after the form that holds no amount", async () => {
    await reads("Advisor is empty and taxable", [
      ["registration_type", "eq", "taxable"],
      ["advisor_name", "isEmpty"],
    ]);
  });
});

describe("an empty form on a yes/no column", () => {
  // Spec 5.2 keeps today's reading on a yes/no column. "No restricted holdings" reads No, as today. Today "Cleared is
  // empty" drops "empty" and reads Cleared is Yes, which the User didn't ask for: it asks.
  const yesNo = (label: string, words: string) =>
    `GridCue reads ${label} as Yes or No, so it can't tell what “${words}” means. Ask for Yes or No instead.`;

  it("asks when the form follows the column", async () => {
    for (const words of ["is empty", "is blank", "is missing", "is not empty", "is not blank", "isn't empty"])
      await asks(`Cleared ${words}`, yesNo("Cleared", `cleared ${words}`), ledger);
    await asks("restricted holdings is empty", yesNo("Restricted holdings", "restricted holdings is empty"));
    await asks("restricted holdings is missing", yesNo("Restricted holdings", "restricted holdings is missing"));
  });

  it("keeps today's reading when the form comes before the column", async () => {
    await reads("no restricted holdings", [["has_restricted_holding", "eq", false]]);
    await reads("accounts without restricted holdings", [["has_restricted_holding", "eq", false]]);
    await reads("no cleared", [["cleared", "eq", false]], undefined, ledger);
  });
});

// A word nothing reads, in a part with no code-read filter (order plan, D4): each is narrowed to a question. No reading
// is added, and the same parts without the word read as before.
describe("a part with no code-read filter that holds a word nothing reads", () => {
  it("asks about a word for empty values: where they go in a sort is not something GridCue reads", async () => {
    await asks("sort by counterparty with the blanks last", placed("“blanks”"), ledger);
    await asks("sort by advisor with empty ones first", placed("“empty”"));
    await asks("sort by market value, nulls last", placed("“nulls”"));
    await asks("sort by advisor, blanks first", placed("“blanks”"));
    await asks("sort by advisor descending, empties at the bottom", placed("“empties”"));
    await asks("group by advisor with blanks last", placed("“blanks”"));
  });

  it("reads the same sort without the word, and an empty form beside a sort", async () => {
    const sorted = async (text: string, schema: ViewSchema = wealth) => {
      const state = await propose(text, schema);
      expect(state.status, text).toBe("ready");
      return state.preview?.lines;
    };
    expect(await sorted("sort by counterparty", ledger)).toEqual(["Sort by Counterparty, ascending"]);
    expect(await sorted("sort by market value")).toEqual(["Sort by Market value, ascending"]);
    expect(await sorted("sort by market value for accounts with no advisor")).toEqual([
      "Show only rows where Advisor is empty",
      "Sort by Market value, ascending",
    ]);
  });

  it("asks when a change to show only some columns would leave words out", async () => {
    await asks("just the accounts where the advisor is exactly Blake Moreno", placed("“accounts where” and “is exactly blake moreno”"));
    await asks("just the accounts where the advisor is Blake Moreno", placed("“accounts where” and “is blake moreno”"));
    await asks("just the advisor Blake Moreno", placed("“blake moreno”"));
    await asks("just the accounts with advisor Blake Moreno", placed("“accounts with” and “blake moreno”"));
    // "In" a place that is not the grid is still another word.
    await asks("show only the advisor column in the report", placed("“in” and “report”"));
  });

  it("reads a change to show only some columns that names only its columns", async () => {
    const only = async (text: string, shown: string[]) => {
      const state = await propose(text);
      expect(state.status, `${text}: ${state.message}`).toBe("ready");
      expect(
        state.plan?.operations.find((op) => op.type === "columns.show"),
        text,
      ).toMatchObject({ columnIds: shown });
    };
    await only("just the advisor", ["advisor_name"]);
    await only("show just the advisor column", ["advisor_name"]);
    await only("just the advisor column please", ["advisor_name"]);
    await only("show only advisor", ["advisor_name"]);
    await only("just the advisor and market value columns", ["advisor_name", "market_value"]);
    await only("just the advisor & household", ["advisor_name", "household"]);
    await only("keep only the advisor column visible", ["advisor_name"]);
    await only("just the advisor column for now", ["advisor_name"]);
    // Thanks, "again", and where the change is made say nothing about which columns show (review finding).
    await only("show only household and advisor, thank you", ["household", "advisor_name"]);
    await only("show only household and advisor thanks", ["household", "advisor_name"]);
    await only("show only the advisor column again", ["advisor_name"]);
    await only("show only household and advisor columns in the grid", ["household", "advisor_name"]);
    await only("show only the advisor column in the table", ["advisor_name"]);
    await only("show only the advisor column on the grid", ["advisor_name"]);
    await only("Keep only these columns: household, restricted holdings, gain.", [
      "household",
      "has_restricted_holding",
      "unrealized_gain",
    ]);
    await reads("just the accounts where the custodian is Northgate", [["custodian", "eq", "northgate"]]);
  });

  it("reads as before when the provider picks a column no Mention names", async () => {
    // "Balance" is no name of Market value here; a provider that knows the synonym picks it, as before.
    const synonym: IntentProvider = {
      resolve: async () => ({
        clauses: [
          {
            clauseIndex: 0,
            families: [{ id: "columns.only", confidence: 0.95 }],
            columns: [{ id: "market_value", confidence: 0.95 }],
            values: [],
            unmatchedTerms: [],
          },
        ],
      }),
    };
    const state = await propose("just the balance column", wealth, synonym);
    expect(state.status, `${state.message}`).toBe("ready");
    expect(state.plan?.operations[0]).toEqual({ type: "columns.show", columnIds: ["market_value"] });
  });
});

describe("where a text form is read", () => {
  it("asks on a column that holds no text", async () => {
    await asks('custodian starts with "North"', "GridCue can match text only in a text column, and Custodian isn't one.");
    await asks('market value is exactly "1"');
  });

  it('keeps advisor is "Lane" as containing', async () => {
    await reads('advisor is "Lane"', [["advisor_name", "contains", "lane"]], ["Filter Advisor containing “lane”"]);
  });

  it("reads beside another filter", async () => {
    await reads('trust accounts where the advisor is exactly "Casey Ortiz"', [
      ["registration_type", "eq", "trust"],
      ["advisor_name", "eq", "casey ortiz"],
    ]);
    await reads('advisor starts with "Mo" at Northgate', [
      ["custodian", "eq", "northgate"],
      ["advisor_name", "startsWith", "mo"],
    ]);
  });
});

describe("the Host's allowedOperators", () => {
  const locked = defineSchema(
    [
      { id: "advisor_name", label: "Advisor" },
      { id: "household", label: "Household" },
    ],
    { columns: { advisor_name: { aliases: ["advisor"], allowedOperators: ["contains", "eq"] } } },
  );

  it("turns a form off, and the request asks", async () => {
    await asks('advisor starts with "Av"', "GridCue can't filter Advisor by how it starts here.", locked);
    await asks("advisor is empty", "GridCue can't filter Advisor to rows where it is empty here.", locked);
    await asks("advisor is not empty", "GridCue can't filter Advisor to rows where it is not empty here.", locked);
  });

  it("leaves a form it allows", async () => {
    await reads('advisor is exactly "Avery Lane"', [["advisor_name", "eq", "avery lane"]], undefined, locked);
    await reads('household starts with "Ha"', [["household", "startsWith", "ha"]], undefined, locked);
  });
});

describe("each form with one extra word", () => {
  it("asks", async () => {
    for (const text of [
      'advisor really starts with "Av"',
      'advisor starts really with "Av"',
      'advisor starts with "Av" today',
      'advisor exactly equals "Avery Lane"',
      'advisor is exactly "Avery Lane" right',
      'advisor is equal to "Avery Lane"',
      "advisor is really empty",
      "advisor is empty today",
      "advisor is not quite empty",
      "accounts with no real advisor",
      "accounts with really no advisor",
      "no advisor yet",
      "accounts without the advisor",
      "accounts that really have an advisor",
      "accounts having one advisor",
      "accounts with no advisor assigned to Casey",
    ])
      await notReady(text);
  });
});

// A form's filter uses its own words and nothing else (review finding). The same column named again outside them asks
// for a change of its own: "show advisor" shows a column, and dropping it would leave Advisor hidden.
describe("the form's column named again outside it", () => {
  it("asks, as the same words without the form do", async () => {
    for (const text of [
      'show advisor where advisor starts with "Av"',
      'show advisor for advisor is exactly "Avery Lane"',
      "show only advisor for accounts with no advisor",
      "just the advisor for accounts with no advisor",
      "keep only advisor for accounts with no advisor",
      "accounts with no advisor with an advisor",
      "no advisor, advisor",
      "advisor is missing from advisor",
      'advisor starts with "Av" with advisor',
      "show advisor for taxable accounts",
    ])
      await asks(text, placed("“advisor”"));
    for (const text of ['show household where household starts with "Al"', "show only household for accounts with no household"])
      await asks(text, placed("“household”"));
  });

  it("is used when another change names the column", async () => {
    const state = await propose("accounts with no advisor sorted by advisor");
    expect(state.status, `${state.message}`).toBe("ready");
    expect(state.preview?.lines).toEqual(["Show only rows where Advisor is empty", "Sort by Advisor, ascending"]);
  });
});

// A form read as a statement about the User's own things, or about every row, is not a view request (review finding).
// "My advisor is missing" says something about the User's advisor; "every account has an advisor" says something about
// all the rows. Neither is read, and the part asks as it did before.
describe("a form said as a statement", () => {
  it("is not read after “my” or “our” on its column", () => {
    for (const text of [
      "my advisor is missing",
      "our advisor is empty",
      "hey, my advisor is missing",
      "my rep is missing",
      'my advisor starts with "Av"',
      'our household is exactly "Hale"',
    ])
      expect(found(text), text).toEqual([]);
    expect(found("my counterparty is missing", ledger)).toEqual([]);
  });

  it("is not read after “has” or “have” with no “that”, “which” or “who” before it", () => {
    for (const text of [
      "every account has an advisor",
      "all my accounts have an advisor",
      "my accounts have no advisor",
      "accounts have no advisor",
      "the accounts have no rep",
    ])
      expect(found(text), text).toEqual([]);
  });

  it("is still read with “my” before the rows, or “has” after “that”, “which” or “who”", () => {
    expect(found("my accounts with no advisor")).toEqual(["no advisor: advisor_name isEmpty"]);
    expect(found("which accounts have no advisor")).toEqual(["no advisor: advisor_name isEmpty"]);
    expect(found("accounts that have an advisor")).toEqual(["have an advisor: advisor_name isNotEmpty"]);
    expect(found("accounts which have no advisor")).toEqual(["no advisor: advisor_name isEmpty"]);
    expect(found("entries that aren't cleared and have no category", ledger)).toEqual(["no category: category isEmpty"]);
  });

  it("asks through the Controller, and the requests beside it still read", async () => {
    for (const text of [
      "my advisor is missing",
      "our advisor is missing",
      "every account has an advisor",
      "all my accounts have an advisor",
    ])
      await notReady(text);
    await notReady("my counterparty is missing", ledger);
    await reads("the advisor is missing", [["advisor_name", "isEmpty"]]);
    await reads("which accounts have no advisor", [["advisor_name", "isEmpty"]]);
    await reads("my accounts with no advisor", [["advisor_name", "isEmpty"]]);
  });
});

// The Mentions read a name right after another as the rows ("Northgate accounts"). After a form's column, that name is
// a column: "no vendor booked after …" names Booked, as "booked after … with no vendor" does (review finding).
describe("a column named right after a form", () => {
  it("is a column, in either order", async () => {
    const both = [
      ["booked", "gt", "2026-01-01"],
      ["counterparty", "isEmpty"],
    ];
    await reads("entries with no counterparty booked after 2026-01-01", both, undefined, ledger);
    await reads("entries booked after 2026-01-01 with no counterparty", both, undefined, ledger);
  });

  it("reads another name after the form as it reads that name alone", async () => {
    await reads("accounts with no advisor market value over $1m", [
      ["market_value", "gt", 1_000_000],
      ["advisor_name", "isEmpty"],
    ]);
    await reads("accounts with no advisor taxable", [
      ["registration_type", "eq", "taxable"],
      ["advisor_name", "isEmpty"],
    ]);
  });

  it("is never the Row Noun, and an entity word right after it asks", async () => {
    await reads("households with no advisor", [["advisor_name", "isEmpty"]]);
    await reads("no advisor accounts", [["advisor_name", "isEmpty"]]);
    // "No household advisor" may mean no advisor for the household: it must not read as Household is empty.
    await notReady("accounts with no household advisor");
    await notReady("accounts with no advisor household");
  });
});

describe("a form is never read where rows are left out, or beside “or”", () => {
  it("asks", async () => {
    for (const text of [
      "hide accounts with no advisor",
      "exclude accounts with no advisor",
      "don't show accounts with no advisor",
      "not accounts with no advisor",
      "accounts with no advisor except trusts",
      "accounts with no advisor not at northgate",
      "advisor is empty or taxable",
      "advisor is empty or advisor is not empty",
      'advisor is exactly "Avery Lane" or advisor is exactly "Casey Ortiz"',
      "accounts with no advisor or no household",
      "clear filters except accounts with no advisor",
    ])
      await notReady(text);
  });
});

describe("beside other changes", () => {
  it("reads the change's own words, from the provider as today", async () => {
    const state = await propose("accounts with no advisor grouped by custodian");
    expect(state.status).toBe("ready");
    expect(state.preview?.lines).toEqual(["Show only rows where Advisor is empty", "Group by Custodian"]);
  });

  it("drops a provider's pick for the form's words, and records the drop", async () => {
    const answer = (a: Partial<ClauseResolution>): IntentProvider => ({
      resolve: async () => ({ clauses: [{ clauseIndex: 0, families: [], columns: [], values: [], unmatchedTerms: [], ...a }] }),
    });
    const state = await propose(
      "advisor is empty",
      wealth,
      answer({
        families: [
          { id: "filter", confidence: 0.95 },
          { id: "sort", confidence: 0.9 },
        ],
        columns: [
          { id: "advisor_name", confidence: 0.95 },
          { id: "market_value", confidence: 0.9 },
        ],
        values: [{ columnId: "custodian", valueId: "northgate", confidence: 0.9 }],
        direction: { id: "desc", confidence: 0.9 },
      }),
    );
    expect(state.status).toBe("ready");
    expect(filters(state.plan?.operations)).toEqual([["advisor_name", "isEmpty"]]);
    expect(state.plan?.operations).toHaveLength(1);
    const dropped = state.plan?.evidence.filter((e) => e.key.startsWith("dropped:")).map((e) => `${e.key}=${e.selectedId}`);
    expect(dropped).toEqual(["dropped:c0.unnamed=market_value", "dropped:c0.unnamed=custodian=northgate", "dropped:c0.unasked=sort"]);
    // The filter is code's, with deterministic evidence.
    expect(state.plan?.evidence).toContainEqual({
      key: "c0.codeRead0",
      selectedId: "advisor_name.isEmpty",
      confidence: 1,
      source: "deterministic",
    });
  });

  it("is in the plan when the provider proposes nothing", async () => {
    const nothing: IntentProvider = { resolve: async () => ({ clauses: [] }) };
    const state = await propose('advisor starts with "Av"', wealth, nothing);
    expect(state.status).toBe("ready");
    expect(filters(state.plan?.operations)).toEqual([["advisor_name", "startsWith", "av"]]);
  });
});

describe("the Preview", () => {
  const op = (operator: "eq" | "isEmpty" | "isNotEmpty" | "contains", columnId = "advisor_name", value?: string): ViewOperation => ({
    type: "filter.add",
    combineWith: "and",
    predicate: { id: "f", type: "predicate", columnId, operator, ...(value === undefined ? {} : { value }) },
  });

  it("says exact text, empty and not empty in the words of spec section 9", () => {
    const lines = renderPreview(
      { operations: [op("eq", "advisor_name", "avery lane"), op("isEmpty"), op("isNotEmpty", "household")] },
      wealth,
    ).lines;
    expect(lines).toEqual([
      "Filter Advisor to exactly “avery lane”",
      "Show only rows where Advisor is empty",
      "Show only rows where Household is not empty",
    ]);
  });

  it("keeps the wording of every other filter", () => {
    const lines = renderPreview(
      {
        operations: [op("contains", "advisor_name", "lane"), op("eq", "custodian", "northgate"), op("eq", "market_value", undefined)].map(
          (o) =>
            o.type === "filter.add" && o.predicate.columnId === "market_value"
              ? { ...o, predicate: { ...o.predicate, value: 1_000_000 } }
              : o,
        ),
      },
      wealth,
    ).lines;
    expect(lines).toEqual(["Filter Advisor containing “lane”", "Filter Custodian to Northgate", "Filter Market value to $1,000,000"]);
  });

  it("names an empty filter it removes as a sentence", () => {
    const current = {
      filters: {
        id: "g",
        type: "group" as const,
        combinator: "and" as const,
        children: [{ id: "f", type: "predicate" as const, columnId: "advisor_name", operator: "isEmpty" as const }],
      },
    };
    expect(renderPreview({ operations: [{ type: "filter.clear" }] }, wealth, current).lines).toEqual([
      "Remove the filter Advisor is empty",
    ]);
  });
});
