import { describe, expect, it } from "vitest";
import { compile } from "../src/core/compile";
import { COLUMN_VERB, LEAD_IN } from "../src/core/lead";
import { matchMentions } from "../src/core/mentions";
import { comparisonSpans, normalize, withoutNamedSizes } from "../src/core/normalize";
import { type CodeReadSpan, limitPicks, unplacedQuestion, unplacedWords } from "../src/core/placed";
import type { DecisionEvidence, FilterGroup, ViewOperation, ViewSchema } from "../src/core/protocol";
import type { ClauseResolution } from "../src/core/resolution";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema, isExposed } from "../src/core/schema";

// Beside a code-read filter, every word is placed (named filters spec, 4.2; ADR 0023). The forms that make a code-read
// filter are read elsewhere. Here a stand-in marks where one sits: "flagged", a word the schema doesn't declare, as a
// House Term would be, or the words of an empty form around its column ("with no advisor").
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
    { id: "opened", label: "Opened" },
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
      concentration: { kind: "percent" },
      has_restricted_holding: { kind: "boolean", aliases: ["restricted"] },
      opened: { kind: "date" },
    },
  },
);
// A grid whose Row Noun ends in "y": "entry", "entries".
const ledger = defineSchema(
  [
    { id: "entry_number", label: "Entry number" },
    { id: "counterparty", label: "Counterparty" },
    { id: "amount", label: "Amount" },
  ],
  { rowNoun: "entry", columns: { entry_number: { aliases: ["entry"] }, amount: { kind: "currency" } } },
);

/** The first part of a request, with a code-read filter wherever one of `filters` is written. */
const partOf = (text: string, filters: readonly string[] = ["flagged"], schema: ViewSchema = wealth) => {
  const normalized = normalize(text);
  const mentions = matchMentions(normalized.clauses, schema.columns.filter(isExposed), { rowNoun: schema.rowNoun });
  const [clause] = withoutNamedSizes(normalized, mentions).clauses;
  if (!clause) throw new Error("No part.");
  const codeRead = filters.flatMap((words) => {
    const start = clause.text.indexOf(words);
    return start < 0 ? [] : [{ start, end: start + words.length }];
  });
  return { clause, mentions: mentions.filter((m) => m.clauseIndex === clause.index), codeRead, schema };
};
type Options = { operations?: readonly ViewOperation[]; filters?: readonly string[]; schema?: ViewSchema };
/** The unplaced words of a request's first part, as written. */
const unplaced = (text: string, { operations, filters, schema }: Options = {}) =>
  unplacedWords({ ...partOf(text, filters, schema), ...(operations ? { operations } : {}) }).map((w) => w.text);

const sort: ViewOperation = { type: "sort.set", sorts: [{ columnId: "market_value", direction: "desc" }] };
const group: ViewOperation = { type: "group.set", columnIds: ["custodian"] };
const hide: ViewOperation = { type: "columns.hide", columnIds: ["custodian"] };
const show: ViewOperation = { type: "columns.show", columnIds: ["custodian"] };
const pin: ViewOperation = { type: "columns.pin", columnIds: ["advisor_name"], position: "start" };
const filter: ViewOperation = {
  type: "filter.add",
  predicate: { id: "f1", type: "predicate", columnId: "registration_type", operator: "eq", value: "trust" },
  combineWith: "and",
};

describe("a placed word: a name", () => {
  it("places a Mention of a column and of a value", () => {
    expect(unplaced("flagged trust accounts with advisor")).toEqual([]);
    expect(unplaced("flagged roth ira accounts at northgate")).toEqual([]);
  });

  it("places the Row Noun, however many", () => {
    expect(unplaced("flagged accounts")).toEqual([]);
    expect(unplaced("every flagged account")).toEqual([]);
    expect(unplaced("flagged entries", { schema: ledger })).toEqual([]);
    expect(unplaced("each flagged entry", { schema: ledger })).toEqual([]);
  });

  it("places an entity word the Mentions read as the rows", () => {
    expect(unplaced("flagged households with trust accounts")).toEqual([]);
    expect(unplaced("advisors with flagged accounts")).toEqual([]);
  });

  it("places a code-read filter's own words, whatever they are", () => {
    expect(unplaced("accounts without any advisor assigned", { filters: ["without any advisor assigned"] })).toEqual([]);
    expect(unplaced('advisor = "avery lane"', { filters: ['advisor = "avery lane"'] })).toEqual([]);
  });

  it("does not place a name the schema doesn't declare", () => {
    expect(unplaced("flagged portfolios")).toEqual(["portfolios"]);
    expect(unplaced("flagged accounts for sam")).toEqual(["sam"]);
  });

  it("does not place a column's name the Mentions read as the rows, unless it is the Row Noun or an entity word", () => {
    // "Gain with …" reads "gain" as the rows, so no Mention holds it, and nothing would use it.
    expect(unplaced("gain with flagged accounts")).toEqual(["gain"]);
    expect(unplaced("flagged accounts opened after 2026-01-31")).toEqual(["opened"]);
  });
});

describe("a placed word: an amount, a date or quoted text, with its comparison", () => {
  it("places an amount and the comparison read before it", () => {
    for (const text of [
      "flagged accounts over $1m",
      "flagged accounts with market value above $1m",
      "flagged accounts with gain at least $50k",
      "flagged accounts with value less than or equal to $1m",
      "flagged accounts with concentration > 10%",
      "flagged accounts with market value no more than $1m",
    ])
      expect(unplaced(text), text).toEqual([]);
  });

  it("places the comparison read after an amount, and a range", () => {
    expect(unplaced("flagged accounts with market value $1m or more")).toEqual([]);
    expect(unplaced("flagged accounts with gain $50k at most")).toEqual([]);
    expect(unplaced("flagged accounts with market value between $1m and $5m")).toEqual([]);
    expect(unplaced("flagged accounts with value from $1m to $5m")).toEqual([]);
  });

  it("places a date with its comparison", () => {
    expect(unplaced("flagged and opened after 2026-01-31")).toEqual([]);
    expect(unplaced("flagged and opened on 2026-01-31")).toEqual([]);
    expect(unplaced("flagged and opened 2026-01-31 or later")).toEqual([]);
    expect(unplaced("flagged and opened on or before 2026-01-31")).toEqual([]);
  });

  it("skips quoted text, and places a containing word right before it", () => {
    expect(unplaced('flagged accounts with advisor "who knows what"')).toEqual([]);
    for (const word of ["containing", "contains", "includes", "has", "like", "matching"])
      expect(unplaced(`flagged accounts with household ${word} "alder"`), word).toEqual([]);
    expect(unplaced('flagged accounts with advisor: "lane"')).toEqual([]);
  });

  it("does not place a comparison word with nothing to compare, or one GridCue doesn't read", () => {
    expect(unplaced("flagged accounts over")).toEqual(["over"]);
    expect(unplaced("flagged accounts containing trusts")).toEqual(["containing"]);
    expect(unplaced("flagged accounts with value around $1m")).toEqual(["around"]);
    expect(unplaced("flagged accounts with value not over $1m")).toEqual(["not", "over"]);
  });
});

describe("where a comparison's words sit", () => {
  const words = (text: string) => {
    const [clause] = normalize(text).clauses;
    return (clause?.literals ?? []).map((lit) => comparisonSpans(clause?.text ?? "", lit).map((s) => clause?.text.slice(s.start, s.end)));
  };

  it("finds the words read before and after an amount, and nothing for a bare one", () => {
    expect(words("value over $1m")).toEqual([["over "]]);
    expect(words("value at least $1m and gain < $5k")).toEqual([["at least "], ["< "]]);
    expect(words("value $1m or more")).toEqual([[" or more"]]);
    expect(words("value between $1m and $5m")).toEqual([["between "]]);
    expect(words("value $750k")).toEqual([[]]);
    expect(words("opened on or after 2026-01-31")).toEqual([["on or after "]]);
  });

  it("finds none where the comparison was not read, or for quoted text", () => {
    expect(words("value not over $1m")).toEqual([[]]);
    expect(words('advisor containing "over $1m"')).toEqual([[]]);
  });
});

describe("a placed word: a lead-in", () => {
  it("places the lead-ins of core/lead.ts, wherever they sit", () => {
    for (const text of [
      "please show me flagged accounts",
      "can you list the flagged accounts",
      "could you show flagged accounts",
      "i want to see flagged accounts",
      "i'd like to see the flagged accounts",
      "i need flagged accounts",
      "let me see flagged accounts",
      "let's see flagged accounts",
      "give me flagged accounts",
      "ok now just flagged accounts",
      "flagged accounts please",
      "flagged accounts only, please",
    ])
      expect(unplaced(text), text).toEqual([]);
  });

  it("does not place part of a lead-in on its own", () => {
    expect(unplaced("flagged accounts i trust")).toEqual(["i"]);
    expect(unplaced("can flagged accounts")).toEqual(["can"]);
    expect(unplaced("you see flagged accounts")).toEqual(["you"]);
  });

  it("keeps the lead-in list as it was", () => {
    expect(LEAD_IN.source).toBe(
      String.raw`^(?:(?:please|pls|now|then|also|and|so|ok|okay|hey|can you|could you|would you|will you|i want(?: to see)?|i'd like(?: to see)?|i need(?: to see)?|i only want|let me see|let's see|show me|give me|get me|find me|just|only)\b ?)*`,
    );
    expect(COLUMN_VERB.source).toBe(String.raw`^(?:add|put|move|pin|arrange|bring|place|shift)\b`);
  });
});

describe("a placed word: a row verb", () => {
  it("places each row verb", () => {
    for (const verb of ["show", "display", "list", "see", "view", "find", "get", "give", "filter", "keep", "only", "just", "include"])
      expect(unplaced(`${verb} flagged accounts`), verb).toEqual([]);
  });

  it("does not place another form of one, or a verb that isn't on the list", () => {
    expect(unplaced("showing flagged accounts")).toEqual(["showing"]);
    expect(unplaced("including flagged accounts")).toEqual(["including"]);
    expect(unplaced("pull flagged accounts")).toEqual(["pull"]);
    expect(unplaced("exclude flagged accounts")).toEqual(["exclude"]);
  });
});

describe("a placed word: a small word", () => {
  it("places each small word", () => {
    // "My", "our", "me" and "us" are placed only where the words make them part of a request: see "a first-person word".
    const small =
      "the a an all any every each those these that which whose where with for of at in from under is are was were has have having held owned and or also too";
    for (const word of small.split(" ")) expect(unplaced(`flagged accounts ${word} trust`), word).toEqual([]);
    expect(unplaced("flagged accounts as well")).toEqual([]);
    expect(unplaced("the advisor's flagged accounts")).toEqual([]);
    for (const rows of ["rows", "records", "ones"]) expect(unplaced(`the flagged ${rows}`), rows).toEqual([]);
  });

  it("places “as well” only as one phrase", () => {
    expect(unplaced("flagged accounts as trusts")).toEqual(["as"]);
    expect(unplaced("flagged accounts well")).toEqual(["well"]);
  });
});

// A statement is not a request (review finding): "advisor is missing from my account" is made only of words the
// spec's list places. A first-person word is placed only where it belongs to a request.
describe("a placed word: a first-person word", () => {
  const empty = { filters: ["no advisor", "advisor is missing", "advisor is empty", "have an advisor"] };

  it("places “my” and “our” right before the noun for the rows, when the noun comes before the code-read filter", () => {
    expect(unplaced("my accounts with no advisor", empty)).toEqual([]);
    expect(unplaced("show our accounts that have an advisor", empty)).toEqual([]);
    expect(unplaced("my households with no advisor", empty)).toEqual([]);
    expect(unplaced("my rows with no advisor", empty)).toEqual([]);
    expect(unplaced("our records with no advisor", empty)).toEqual([]);
    expect(unplaced("my entries with no counterparty", { filters: ["no counterparty"], schema: ledger })).toEqual([]);
  });

  it("places them before named values that describe the rows, or stand for them", () => {
    expect(unplaced("my trust accounts with no advisor", empty)).toEqual([]);
    expect(unplaced("our roth ira accounts at northgate with no advisor", empty)).toEqual([]);
    expect(unplaced("my trusts with no advisor", empty)).toEqual([]);
  });

  it("places them before a yes/no column named for the rows, which can't stand for them alone", () => {
    expect(unplaced("my restricted accounts with no advisor", empty)).toEqual([]);
    expect(unplaced("our restricted trust accounts where advisor is empty", empty)).toEqual([]);
    expect(unplaced("my restricted with no advisor", empty)).toContain("my");
  });

  it("does not place them before an entity word in the singular: “my household” is one household of the User's", () => {
    expect(unplaced("my household with no advisor", empty)).toEqual(["my"]);
    expect(unplaced("our advisor with no household", { filters: ["no household"] })).toEqual(["our"]);
    expect(unplaced("my households with no advisor", empty)).toEqual([]);
    expect(unplaced("my account with no advisor", empty)).toEqual([]);
  });

  it("places them before the direction and count words a sort reads, and before a noun the Mentions left undecided", () => {
    expect(unplaced("my top 10 accounts with no advisor by market value", empty)).toEqual([]);
    expect(unplaced("our largest accounts with no advisor", empty)).toEqual([]);
    // With no sort in the plan, "top 10" is not placed, and nothing joins "my" to the rows.
    expect(unplaced("my top 10 accounts with no advisor", { ...empty, operations: [filter] })).toEqual(["my", "top", "10"]);
    // "Accounts," is a Mention the Mentions left undecided: the Row Noun, or Account number.
    expect(unplaced("my accounts, with no advisor", empty)).toEqual([]);
  });

  it("does not place them before a possessive: “my advisor's accounts” are not rows GridCue can find", () => {
    expect(unplaced("my advisor's accounts with no household", { filters: ["no household"] })).toEqual(["my"]);
    expect(unplaced("our household's accounts with no advisor", empty)).toEqual(["our"]);
  });

  it("does not place them before a noun that follows another one for the rows", () => {
    // The rows are the accounts. "Our household" is one household, which GridCue can't know.
    expect(unplaced("the accounts of our household with no advisor", empty)).toEqual(["our"]);
    expect(unplaced("accounts in my households with no advisor", empty)).toEqual(["my"]);
    expect(unplaced("all of our accounts with no advisor", empty)).toEqual([]);
  });

  it("does not place them anywhere else", () => {
    expect(unplaced("advisor is missing from my account", empty)).toEqual(["my"]);
    expect(unplaced("the advisor is missing for my accounts", empty)).toEqual(["my"]);
    expect(unplaced("advisor is empty in our household", empty)).toEqual(["our"]);
    expect(unplaced("accounts with no advisor in my trusts", empty)).toEqual(["my"]);
    expect(unplaced("my custodian accounts with no advisor", empty)).toEqual(["my"]);
    expect(unplaced("my flagged accounts")).toEqual(["my"]);
    expect(unplaced("flagged accounts my trust")).toEqual(["my"]);
    expect(unplaced("flagged accounts our trust")).toEqual(["our"]);
  });

  it("places “me” and “us” in a lead-in, or right after a verb that chooses rows", () => {
    for (const text of [
      "show me flagged accounts",
      "give me flagged accounts",
      "let me see flagged accounts",
      "show us flagged accounts",
      "give us flagged accounts",
      "list me flagged accounts",
      "find us flagged accounts",
    ])
      expect(unplaced(text), text).toEqual([]);
  });

  it("does not place “me” or “us” with a preposition right after it, in a lead-in or not", () => {
    expect(unplaced("include me in flagged accounts")).toEqual(["me"]);
    expect(unplaced("keep us with flagged accounts")).toEqual(["us"]);
    expect(unplaced("show me in flagged accounts")).toEqual(["me"]);
    expect(unplaced("find me for flagged accounts")).toEqual(["me"]);
    expect(unplaced("give us of flagged accounts")).toEqual(["us"]);
    // A preposition after the rows' noun changes nothing.
    expect(unplaced("show me accounts with no advisor", { filters: ["no advisor"] })).toEqual([]);
  });

  it("does not place “me” or “us” anywhere else, or “I”, “mine” or “ours” outside a lead-in", () => {
    expect(unplaced("flagged accounts for me")).toEqual(["me"]);
    expect(unplaced("flagged accounts for us")).toEqual(["us"]);
    expect(unplaced("advisor is missing for me", empty)).toEqual(["me"]);
    expect(unplaced("only me flagged accounts")).toEqual(["me"]);
    expect(unplaced("flagged accounts i trust")).toEqual(["i"]);
    expect(unplaced("flagged accounts of mine")).toEqual(["mine"]);
    expect(unplaced("flagged accounts of ours")).toEqual(["ours"]);
  });
});

// A column asked for beside a code-read filter is never dropped (review finding). In the singular, right after a word
// that chooses columns, a column's name stands where a column would: the plan holds a change for it, or it is unplaced.
describe("a column asked for beside a code-read filter", () => {
  const empty = { filters: ["no advisor", "advisor is empty"] };
  const showHousehold: ViewOperation = { type: "columns.show", columnIds: ["household"] };

  it("does not place an entity word in the singular right after a word that chooses columns", () => {
    // Any verb that chooses rows, and "give": a column with no entity word asks after each of them too (review finding).
    for (const word of ["show", "display", "see", "list", "only", "just", "keep", "hide", "view", "find", "get", "filter", "include"])
      expect(unplaced(`${word} household with no advisor`, empty), word).toEqual(["household"]);
    for (const lead of [
      "show the",
      "show only",
      "show just the",
      "keep only the",
      "just the",
      "show me",
      "show me the",
      "give me",
      "give us the",
      "show a",
      "find me an",
      "show that",
    ])
      expect(unplaced(`${lead} household where advisor is empty`, empty), lead).toEqual(["household"]);
    // "My" or "our" between them is not placed either: the name it would own is no noun for the rows.
    for (const lead of ["show my", "show only our"])
      expect(unplaced(`${lead} household where advisor is empty`, empty), lead).toEqual([lead.split(" ").at(-1), "household"]);
    expect(unplaced("add household with no advisor", empty)).toEqual(["add", "household"]);
    expect(unplaced("show advisor with flagged accounts")).toEqual(["advisor"]);
  });

  it("places it in the plural, after “every”, “each” or “all”, with another word before it, with none, or as a possessive", () => {
    for (const text of [
      "show households with no advisor",
      "show only households where advisor is empty",
      "household with no advisor",
      "the household with no advisor",
      "show every household with no advisor",
      "list each household with no advisor",
      "show all households with no advisor",
      "show trust household with no advisor",
      "show the household's accounts with no advisor",
    ])
      expect(unplaced(text, empty), text).toEqual([]);
  });

  it("places the Row Noun, in the singular too", () => {
    expect(unplaced("show account with no advisor", empty)).toEqual([]);
    expect(unplaced("show only the account where advisor is empty", empty)).toEqual([]);
    expect(unplaced("show entry with no counterparty", { filters: ["no counterparty"], schema: ledger })).toEqual([]);
  });

  it("waits for the plan when the Mentions hold the name, then needs a change that names its column", () => {
    // "Household for …" is a Mention: the plan may yet hold a change for it.
    expect(unplaced("show household for accounts with no advisor", empty)).toEqual([]);
    expect(unplaced("show household for accounts with no advisor", { ...empty, operations: [] })).toEqual(["household"]);
    expect(unplaced("show household for accounts with no advisor", { ...empty, operations: [filter, sort] })).toEqual(["household"]);
    expect(unplaced("show household for accounts with no advisor", { ...empty, operations: [showHousehold] })).toEqual([]);
    expect(unplaced("show only market value for accounts with no advisor", { ...empty, operations: [filter] })).toEqual(["market value"]);
    expect(unplaced("show only market value for accounts with no advisor", { ...empty, operations: [sort] })).toEqual([]);
    // In the plural the name may be the rows, so the plan need not hold it.
    expect(unplaced("show households for accounts with no advisor", { ...empty, operations: [] })).toEqual([]);
  });

  it("does not count the code-read filter's own filter as a change for the column", () => {
    const part = partOf("show advisor for accounts with no advisor", ["no advisor"]);
    const codeRead = part.codeRead.map((r) => ({ ...r, predicate: { columnId: "advisor_name", operator: "isEmpty" } }));
    const own: ViewOperation = {
      type: "filter.add",
      predicate: { id: "f2", type: "predicate", columnId: "advisor_name", operator: "isEmpty" },
      combineWith: "and",
    };
    const words = (operations: readonly ViewOperation[]) => unplacedWords({ ...part, codeRead, operations }).map((w) => w.text);
    expect(words([own])).toEqual(["advisor"]);
    expect(words([own, { type: "columns.show", columnIds: ["advisor_name"] }])).toEqual([]);
  });
});

describe("a word the spec names as off the list", () => {
  it("does not place “to”, “about”, “who” or “what”", () => {
    expect(unplaced("assign flagged to the taxable accounts")).toEqual(["assign", "to"]);
    expect(unplaced("flagged called about the trust accounts")).toEqual(["called", "about"]);
    expect(unplaced("who is flagged")).toEqual(["who"]);
    expect(unplaced("what is flagged")).toEqual(["what"]);
  });

  it("does not place a negation, a pronoun or a symbol", () => {
    expect(unplaced("accounts that are not flagged")).toEqual(["not"]);
    expect(unplaced("accounts that aren't flagged")).toEqual(["aren't"]);
    expect(unplaced("no flagged accounts")).toEqual(["no"]);
    expect(unplaced("everyone except flagged")).toEqual(["everyone", "except"]);
    expect(unplaced("there is no advisor i trust", { filters: ["no advisor"] })).toEqual(["there", "i"]);
    expect(unplaced("flagged accounts & trusts")).toEqual(["&"]);
    expect(unplaced("custodian != northgate flagged")).toEqual(["!", "="]);
    expect(unplaced("flagged w/o trusts")).toEqual(["w", "/", "o"]);
    expect(unplaced("flagged non-retirement accounts")).toEqual(["non"]);
  });

  it("does not place a hyphen that stands free, which may mean “minus”", () => {
    expect(unplaced("flagged trust accounts - northgate")).toEqual(["-"]);
    expect(unplaced("flagged trust accounts -northgate")).toEqual(["-"]);
    expect(unplaced("flagged roth-ira accounts")).toEqual([]);
    expect(unplaced("flagged trust accounts, northgate (taxable)")).toEqual([]);
    expect(unplaced("flagged accounts with gain between $1m - $5m")).toEqual([]);
    expect(unplaced("flagged accounts with gain over -$5k")).toEqual([]);
  });

  it("names the words in the question, in ADR 0019's wording", () => {
    const ask = (text: string, filters?: readonly string[]) => {
      const part = partOf(text, filters);
      return unplacedQuestion(part.clause, unplacedWords(part));
    };
    expect(ask("flagged called about the trust accounts")).toEqual({
      id: "c0.placed",
      prompt: "I'm not sure what to do with “called about”. Try rephrasing that part.",
      required: true,
    });
    expect(ask("there is no advisor i trust", ["no advisor"]).prompt).toBe(
      "I'm not sure what to do with “there” and “i”. Try rephrasing that part.",
    );
    expect(ask("assign flagged to whoever wants the taxable accounts").prompt).toBe(
      "I'm not sure what to do with “assign” and “to whoever wants”. Try rephrasing that part.",
    );
    expect(ask("who told flagged accounts about sam to wait").prompt).toBe(
      "I'm not sure what to do with “who told” and “about sam to wait”. Try rephrasing that part.",
    );
    expect(ask("who flagged what for whom").prompt).toBe(
      "I'm not sure what to do with “who”, “what” and “whom”. Try rephrasing that part.",
    );
  });
});

describe("a placed word: another change's own words, when the plan holds that change", () => {
  it("places a sort's words only beside a sort", () => {
    const text = "flagged accounts sorted by market value";
    expect(unplaced(text, { operations: [filter, sort] })).toEqual([]);
    expect(unplaced(text, { operations: [filter] })).toEqual(["sorted", "by"]);
    expect(unplaced("flagged accounts ordered by value", { operations: [sort] })).toEqual([]);
    // "By" belongs to a grouping too.
    expect(unplaced("sort flagged accounts by value", { operations: [group] })).toEqual(["sort"]);
    expect(unplaced("order flagged accounts by value", { operations: [] })).toEqual(["order", "by"]);
  });

  it("places a grouping's words only beside a grouping", () => {
    const text = "flagged accounts grouped by custodian";
    expect(unplaced(text, { operations: [group] })).toEqual([]);
    expect(unplaced(text, { operations: [filter] })).toEqual(["grouped", "by"]);
    expect(unplaced("group flagged accounts by custodian", { operations: [sort] })).toEqual(["group"]);
  });

  it("places “hide” only beside a hide, and “column” only beside a change to columns, a sort or a grouping", () => {
    const text = "hide the custodian column for flagged accounts";
    expect(unplaced(text, { operations: [filter, hide] })).toEqual([]);
    // With no hide in the plan, the column it asks for is in no change either.
    expect(unplaced(text, { operations: [filter] })).toEqual(["hide", "custodian", "column"]);
    expect(unplaced("flagged accounts sorted by the value column", { operations: [sort] })).toEqual([]);
    expect(unplaced("flagged accounts with the custodian columns", { operations: [show] })).toEqual([]);
  });

  it("places the direction and the count read today only beside a sort", () => {
    for (const text of [
      "flagged accounts, largest first",
      "flagged accounts sorted by value descending",
      "flagged accounts by value in descending order",
      "flagged accounts by value from largest to smallest",
      "flagged accounts by value high to low",
      "top 10 flagged accounts",
      "largest flagged accounts first",
    ]) {
      expect(unplaced(text, { operations: [filter, sort] }), text).toEqual([]);
      expect(unplaced(text, { operations: [filter] }).length, text).toBeGreaterThan(0);
    }
    expect(unplaced("flagged accounts, largest first", { operations: [filter] })).toEqual(["largest", "first"]);
    expect(unplaced("top 10 flagged accounts", { operations: [filter] })).toEqual(["top", "10"]);
  });

  it("does not place a direction with a word GridCue didn't read inside it, or “first” on its own", () => {
    expect(unplaced("largest exact flagged accounts first", { operations: [sort] })).toEqual(["largest", "exact", "first"]);
    expect(unplaced("advisor first for flagged accounts", { operations: [sort] })).toEqual(["first"]);
  });

  it("takes those words as placed before the plan is built, so the first check asks only about the rest", () => {
    expect(unplaced("flagged accounts sorted by size, largest first")).toEqual(["size"]);
    expect(unplaced("hide the custodian column for flagged accounts grouped by rep")).toEqual([]);
  });

  it("never places a clear's words", () => {
    expect(unplaced("clear the sort for flagged accounts", { operations: [{ type: "sort.set", sorts: [] }] })).toEqual(["clear", "sort"]);
    expect(unplaced("reset flagged accounts", { operations: [{ type: "view.reset" }] })).toEqual(["reset"]);
  });
});

describe("a verb read only for columns", () => {
  it("is placed when its object is a column and the plan holds that change for the column", () => {
    expect(unplaced("add custodian for flagged accounts", { operations: [filter, show] })).toEqual([]);
    expect(unplaced("add the custodian column for flagged accounts", { operations: [filter, show] })).toEqual([]);
    expect(unplaced("pin advisor for flagged accounts", { operations: [filter, pin] })).toEqual([]);
    expect(
      unplaced("move custodian for flagged accounts", { operations: [{ type: "columns.order", columnIds: ["custodian", "household"] }] }),
    ).toEqual([]);
  });

  it("asks when the plan holds no column change for the verb", () => {
    // The Advisor filter uses the name, so ADR 0019's check alone would pass this with the pin dropped.
    expect(unplaced("pin advisor for flagged accounts", { operations: [filter] })).toEqual(["pin"]);
    expect(unplaced("pin advisor for flagged accounts", { operations: [filter, show] })).toEqual(["pin"]);
    // "Add custodian" asks for the Custodian column: with no change that names it, the name is unplaced too.
    expect(unplaced("add custodian for flagged accounts", { operations: [filter] })).toEqual(["add", "custodian"]);
    expect(unplaced("add custodian for flagged accounts", { operations: [filter, hide] })).toEqual(["add"]);
    expect(unplaced("move custodian for flagged accounts", { operations: [filter, show] })).toEqual(["move"]);
    // The change is for another column.
    expect(unplaced("add custodian for flagged accounts", { operations: [{ type: "columns.show", columnIds: ["household"] }] })).toEqual([
      "add",
      "custodian",
    ]);
  });

  it("asks when its object is not a column, whatever the plan holds", () => {
    expect(unplaced("add flagged accounts")).toEqual(["add"]);
    expect(unplaced("add flagged accounts", { operations: [show] })).toEqual(["add"]);
    expect(unplaced("add the trust accounts flagged", { operations: [show] })).toEqual(["add"]);
    expect(unplaced("put flagged accounts first", { operations: [sort] })).toEqual(["put", "first"]);
    // The column is the code-read filter's own: it names no column to change.
    expect(unplaced("pin advisor is empty", { filters: ["advisor is empty"], operations: [pin] })).toEqual(["pin"]);
  });

  it("waits for the plan when its object is a column", () => {
    expect(unplaced("pin advisor for flagged accounts")).toEqual([]);
    expect(unplaced("add custodian for flagged accounts")).toEqual([]);
  });
});

describe("a part read whole as view words", () => {
  it("has every word placed, for the report on ready plans", () => {
    expect(unplaced("show only the first 5 rows", { operations: [{ type: "limit.set", count: 5 }] })).toEqual([]);
    expect(unplaced("remove the count", { operations: [{ type: "limit.set", count: null }] })).toEqual([]);
    expect(unplaced("no count", { operations: [{ type: "limit.set", count: null }] })).toEqual([]);
  });
});

// The limit on a provider's picks (spec 4.2): in a part that passed, what a provider proposes is kept only where the
// part's words name it. Each case replays a fake provider's answer.
const answer = (a: Partial<ClauseResolution>): ClauseResolution => ({
  clauseIndex: 0,
  families: [],
  columns: [],
  values: [],
  unmatchedTerms: [],
  ...a,
});
const limited = (text: string, a: Partial<ClauseResolution>, filters?: readonly string[]) => {
  const dropped: DecisionEvidence[] = [];
  const res = limitPicks(answer(a), partOf(text, filters), (e) => dropped.push(e));
  return {
    families: res.families.map((f) => f.id),
    columns: res.columns.map((p) => p.id),
    values: res.values.map((v) => `${v.columnId}=${v.valueId}`),
    roles: (res.roles ?? []).map((r) => `${r.columnId}:${r.family}`),
    kind: res.kind?.id,
    dropped: dropped.map((e) => `${e.key}=${e.selectedId}`),
    evidence: dropped,
  };
};
const f = (id: string, confidence = 0.95) => ({ id, confidence });

describe("the limit on a provider's picks: columns and values", () => {
  it("drops a column no Mention names, and records it", () => {
    const got = limited("flagged trust accounts with advisor", {
      families: [f("filter")],
      columns: [f("advisor_name"), f("household", 0.9)],
    });
    expect(got.columns).toEqual(["advisor_name"]);
    expect(got.evidence).toEqual([{ key: "dropped:c0.unnamed", selectedId: "household", confidence: 0.9, source: "deterministic" }]);
  });

  it("drops a value no Mention names, and records it", () => {
    const got = limited("flagged trust accounts", {
      families: [f("filter")],
      values: [
        { columnId: "registration_type", valueId: "trust", confidence: 0.95 },
        { columnId: "custodian", valueId: "northgate", confidence: 0.9 },
        { columnId: "has_restricted_holding", valueId: "true", confidence: 0.9 },
      ],
    });
    expect(got.values).toEqual(["registration_type=trust"]);
    expect(got.dropped).toEqual(["dropped:c0.unnamed=custodian=northgate", "dropped:c0.unnamed=has_restricted_holding=true"]);
  });

  it("drops a value of a column that is named only as a column", () => {
    const got = limited("flagged accounts by custodian", {
      families: [f("filter")],
      columns: [f("custodian")],
      values: [{ columnId: "custodian", valueId: "northgate", confidence: 0.9 }],
    });
    expect(got.columns).toEqual(["custodian"]);
    expect(got.values).toEqual([]);
  });

  it("keeps the yes or no of a named yes/no column, as today", () => {
    const got = limited("flagged restricted accounts", {
      families: [f("filter")],
      columns: [f("has_restricted_holding")],
      values: [{ columnId: "has_restricted_holding", valueId: "true", confidence: 0.9 }],
    });
    expect(got.values).toEqual(["has_restricted_holding=true"]);
    expect(got.dropped).toEqual([]);
  });

  it("takes a name inside the code-read filter as the filter's own: it names no column for another change", () => {
    const got = limited(
      "accounts with no advisor sorted",
      {
        families: [f("filter"), f("sort")],
        columns: [f("advisor_name")],
        roles: [{ columnId: "advisor_name", family: "sort", confidence: 0.9 }],
      },
      ["with no advisor"],
    );
    expect(got.families).toEqual(["filter", "sort"]);
    expect(got.columns).toEqual([]);
    expect(got.roles).toEqual([]);
    // The words name the filter's own column, so nothing is recorded as dropped for it.
    expect(got.dropped).toEqual([]);
  });

  it("keeps the column for a bare amount: the provider's pick, or the kind rule", () => {
    const picked = limited("flagged accounts over $1m", {
      families: [f("filter")],
      columns: [f("market_value", 0.9), f("household", 0.9)],
      literalColumns: [{ literalIndex: 0, columnId: "market_value", confidence: 0.9 }],
    });
    expect(picked.columns).toEqual(["market_value"]);
    expect(picked.dropped).toEqual(["dropped:c0.unnamed=household"]);
    // With no pick for the amount, a column of a kind that can hold it stays for the kind rule. No other does.
    const byKind = limited("flagged accounts over $1m", {
      families: [f("filter")],
      columns: [f("market_value", 0.9), f("concentration", 0.9)],
    });
    expect(byKind.columns).toEqual(["market_value"]);
    // A pick for the amount settles it: another column that could hold it is dropped.
    const other = limited("flagged accounts over $1m", {
      families: [f("filter")],
      columns: [f("market_value", 0.9), f("unrealized_gain", 0.9)],
      literalColumns: [{ literalIndex: 0, columnId: "market_value", confidence: 0.9 }],
    });
    expect(other.columns).toEqual(["market_value"]);
  });

  it("keeps no column for quoted text, which belongs to the column named before it", () => {
    const got = limited('flagged accounts with household "alder"', {
      families: [f("filter")],
      columns: [f("household"), f("advisor_name", 0.9)],
    });
    expect(got.columns).toEqual(["household"]);
  });
});

describe("the limit on a provider's picks: other changes", () => {
  const both = { columns: [f("market_value", 0.9)], direction: f("desc", 0.9) };

  it("drops a sort the part has no words for, and records it", () => {
    const got = limited("flagged trust accounts", { families: [f("filter"), f("sort", 0.9)], ...both });
    expect(got.families).toEqual(["filter"]);
    expect(got.evidence).toContainEqual({ key: "dropped:c0.unasked", selectedId: "sort", confidence: 0.9, source: "deterministic" });
  });

  it("keeps a sort the part's words ask for", () => {
    expect(limited("flagged accounts sorted by value", { families: [f("filter"), f("sort")] }).families).toEqual(["filter", "sort"]);
    expect(limited("flagged accounts in order of value", { families: [f("sort")] }).families).toEqual(["sort"]);
    expect(limited("flagged accounts, largest first", { families: [f("filter"), f("sort")] }).families).toEqual(["filter", "sort"]);
  });

  it("keeps a group, a hide, a show or an only-these-columns change only with its own words", () => {
    expect(limited("flagged trust accounts", { families: [f("filter"), f("group", 0.9)] }).families).toEqual(["filter"]);
    expect(limited("flagged accounts grouped by custodian", { families: [f("filter"), f("group")] }).families).toEqual(["filter", "group"]);
    expect(limited("flagged trust accounts", { families: [f("filter"), f("columns.hide", 0.9)] }).families).toEqual(["filter"]);
    expect(limited("hide custodian for flagged accounts", { families: [f("filter"), f("columns.hide")] }).families).toEqual([
      "filter",
      "columns.hide",
    ]);
    expect(limited("show custodian for flagged accounts", { families: [f("filter"), f("columns.show")] }).families).toEqual(["filter"]);
    expect(limited("show the custodian column for flagged accounts", { families: [f("filter"), f("columns.show")] }).families).toEqual([
      "filter",
      "columns.show",
    ]);
    expect(limited("add custodian for flagged accounts", { families: [f("filter"), f("columns.show")] }).families).toEqual([
      "filter",
      "columns.show",
    ]);
    expect(limited("only flagged accounts", { families: [f("filter"), f("columns.only", 0.9)] }).families).toEqual(["filter"]);
    expect(limited("only the custodian column for flagged accounts", { families: [f("filter"), f("columns.only")] }).families).toEqual([
      "filter",
      "columns.only",
    ]);
  });

  it("drops a clear or a reset: a part that passed holds no clear's words", () => {
    const got = limited("flagged trust accounts", {
      families: [f("filter"), f("filter.clear", 0.9), f("sort.clear", 0.9), f("group.clear", 0.9), f("view.reset", 0.9)],
    });
    expect(got.families).toEqual(["filter"]);
    expect(got.dropped).toEqual([
      "dropped:c0.unasked=filter.clear",
      "dropped:c0.unasked=sort.clear",
      "dropped:c0.unasked=group.clear",
      "dropped:c0.unasked=view.reset",
    ]);
  });

  it("keeps a refusal", () => {
    expect(limited("flagged trust accounts", { families: [f("unsupported.export")] }).families).toEqual(["unsupported.export"]);
  });

  it("drops what the provider said about a change or a column it dropped", () => {
    const got = limited("flagged trust accounts by custodian", {
      families: [f("filter"), f("sort", 0.9)],
      columns: [f("custodian"), f("market_value", 0.9)],
      roles: [
        { columnId: "market_value", family: "sort", confidence: 0.9 },
        { columnId: "custodian", family: "sort", confidence: 0.9 },
        { columnId: "custodian", family: "filter", confidence: 0.9 },
      ],
      kind: f("sort", 0.9),
    });
    expect(got.roles).toEqual(["custodian:filter"]);
    expect(got.kind).toBeUndefined();
  });
});

// Through the compiler, with a fake provider. `filters` are the stand-in code-read filters; with none, the request is
// compiled as before.
const provider = (...clauses: Array<Partial<ClauseResolution>>) => ({
  resolve: async () => ({ clauses: clauses.map((a, clauseIndex) => ({ ...answer(a), clauseIndex })) }),
});
const planFor = async (
  text: string,
  fake: ReturnType<typeof provider>,
  { filters = ["flagged"], state }: { filters?: readonly string[]; state?: { filters: FilterGroup } } = {},
) => {
  const adapter = createRowsAdapter({ schema: wealth });
  if (state) adapter.setState((view) => ({ ...view, ...state }));
  const normalized = normalize(text);
  const mentions = matchMentions(normalized.clauses, wealth.columns.filter(isExposed), { rowNoun: wealth.rowNoun });
  const input = withoutNamedSizes(normalized, mentions);
  const base = adapter.getState();
  const codeRead: CodeReadSpan[] = input.clauses.flatMap((clause) =>
    filters.flatMap((words) => {
      const start = clause.text.indexOf(words);
      return start < 0 ? [] : [{ clauseIndex: clause.index, start, end: start + words.length }];
    }),
  );
  let ids = 0;
  return compile({
    input,
    resolution: await fake.resolve(),
    schema: wealth,
    state: base.state,
    baseRevision: base.revision,
    channel: "typed",
    mentions,
    ...(codeRead.length > 0 ? { codeRead } : {}),
    operations: adapter.getCapabilities().operations,
    defaultState: adapter.getDefaultState(),
    newId: (prefix) => `${prefix}_${++ids}`,
  });
};
const short = (ops: readonly ViewOperation[]) =>
  ops.map((op) =>
    op.type === "filter.add"
      ? `filter ${op.predicate.columnId} ${op.predicate.operator} ${JSON.stringify(op.predicate.value)}`
      : op.type === "sort.set"
        ? `sort ${op.sorts.map((s) => `${s.columnId} ${s.direction}`).join(", ")}`
        : "columnIds" in op
          ? `${op.type} ${op.columnIds.join(", ")}`
          : op.type,
  );
const droppedIn = (plan: { evidence: readonly DecisionEvidence[] }) =>
  plan.evidence.filter((e) => e.key.startsWith("dropped:")).map((e) => `${e.key}=${e.selectedId}`);
const TRUST = 'filter registration_type eq "trust"';
const notSure = (words: string) => `I'm not sure what to do with ${words}. Try rephrasing that part.`;

describe("the compiler, beside a code-read filter", () => {
  it("drops a sort, a column and a value the words don't name, and the plan is the words' own", async () => {
    const fake = provider({
      families: [f("filter"), f("sort", 0.9)],
      columns: [f("market_value", 0.9), f("household", 0.9)],
      values: [{ columnId: "custodian", valueId: "northgate", confidence: 0.9 }],
      direction: f("desc", 0.9),
    });
    const plan = await planFor("flagged trust accounts", fake);
    expect(plan.status).toBe("ready");
    expect(short(plan.operations)).toEqual([TRUST]);
    expect(droppedIn(plan)).toEqual([
      "dropped:c0.unnamed=market_value",
      "dropped:c0.unnamed=household",
      "dropped:c0.unnamed=custodian=northgate",
      "dropped:c0.unasked=sort",
    ]);
    // With no code-read filter the same answer is used as before: the provider is trusted with what code can't read.
    const before = await planFor("flagged trust accounts", fake, { filters: [] });
    expect(before.status).toBe("ready");
    expect(short(before.operations)).toEqual([TRUST, 'filter custodian eq "northgate"', "sort market_value desc, household desc"]);
    expect(droppedIn(before)).toEqual([]);
  });

  it("drops a group, a hide and a reset the words don't ask for", async () => {
    for (const family of ["group", "columns.hide", "columns.only", "view.reset", "filter.clear"]) {
      const plan = await planFor(
        "flagged trust accounts",
        provider({ families: [f("filter"), f(family, 0.9)], columns: [f("custodian", 0.9)] }),
      );
      expect(plan.status, family).toBe("ready");
      expect(short(plan.operations), family).toEqual([TRUST]);
      expect(droppedIn(plan), family).toContain(`dropped:c0.unasked=${family}`);
    }
  });

  it("still takes the column for a bare amount from the provider's pick", async () => {
    const fake = provider({
      families: [f("filter")],
      columns: [f("market_value", 0.9)],
      literalColumns: [{ literalIndex: 0, columnId: "market_value", confidence: 0.9 }],
    });
    const plan = await planFor("flagged trust accounts over $1m", fake);
    expect(plan.status).toBe("ready");
    expect(short(plan.operations)).toEqual([TRUST, "filter market_value gt 1000000"]);
    expect(droppedIn(plan)).toEqual([]);
  });

  it("keeps another change the words ask for, from the provider as today", async () => {
    const fake = provider({ families: [f("filter"), f("sort")], columns: [f("market_value")], direction: f("desc", 0.9) });
    const plan = await planFor("flagged trust accounts sorted by market value", fake);
    expect(plan.status).toBe("ready");
    expect(short(plan.operations)).toEqual([TRUST, "sort market_value desc"]);
  });

  it("asks about a word it didn't place, before anything the provider proposes", async () => {
    const fake = provider({ families: [f("filter"), f("sort")], columns: [f("market_value", 0.9)], direction: f("desc", 0.9) });
    const plan = await planFor("flagged trust accounts sorted by size", fake);
    expect(plan.status).toBe("needs_clarification");
    expect(plan.operations).toEqual([]);
    expect(plan.clarifications).toEqual([{ id: "c0.placed", prompt: notSure("“size”"), required: true }]);
    const called = await planFor("flagged called about the trust accounts", provider({ families: [f("filter")] }));
    expect(called.clarifications.map((q) => q.prompt)).toEqual([notSure("“called about”")]);
  });

  it("asks about a sort's words when the plan holds no sort", async () => {
    // The provider proposes only the filter: "sorted" would be dropped without a word.
    const plan = await planFor("flagged trust accounts sorted", provider({ families: [f("filter")] }));
    expect(plan.status).toBe("needs_clarification");
    expect(plan.clarifications.map((q) => q.prompt)).toEqual([notSure("“sorted”")]);
  });

  it("asks about “pin” beside a filter, though the column it names is used", async () => {
    const fake = provider({ families: [f("filter", 0.9), f("columns.show")], columns: [f("advisor_name")] });
    const plan = await planFor("pin advisor for flagged trust accounts", fake);
    expect(plan.status).toBe("needs_clarification");
    expect(plan.operations).toEqual([]);
    expect(plan.clarifications.map((q) => q.prompt)).toContain(notSure("“pin”"));
  });

  it("reads “add” with a column as its object when the plan shows that column", async () => {
    const fake = provider({ families: [f("filter"), f("columns.show")], columns: [f("custodian")] });
    const plan = await planFor("add custodian for flagged trust accounts", fake);
    expect(plan.status).toBe("ready");
    expect(short(plan.operations)).toEqual([TRUST, "columns.show custodian"]);
    // With the show left out, "add" is placed nowhere.
    const dropped = await planFor(
      "add custodian for flagged trust accounts",
      provider({ families: [f("filter")], columns: [f("custodian")] }),
    );
    expect(dropped.status).toBe("needs_clarification");
  });

  it("never uses the code-read filter's own column for another change", async () => {
    const fake = provider({ families: [f("sort")], columns: [f("advisor_name")] });
    const plan = await planFor("accounts with no advisor sorted", fake, { filters: ["with no advisor"] });
    expect(plan.status).toBe("needs_clarification");
    expect(plan.operations).toEqual([]);
    // Without the code-read filter, the same answer sorts by Advisor, as before.
    const before = await planFor("accounts with no advisor sorted", fake, { filters: [] });
    expect(short(before.operations)).toEqual(["sort advisor_name asc"]);
  });

  it("keeps a refusal a refusal", async () => {
    const plan = await planFor("email the flagged trust accounts", provider({ families: [f("unsupported.workflow_action")] }));
    expect(plan.status).toBe("unsupported");
    expect(plan.clarifications).toEqual([]);
  });

  it("checks only the part that holds the code-read filter", async () => {
    const fake = provider({ families: [f("filter")] }, { families: [f("sort")], columns: [f("market_value")], direction: f("desc", 0.9) });
    const plan = await planFor("flagged trust accounts, sort by market value please", fake);
    expect(plan.status).toBe("ready");
    expect(short(plan.operations)).toEqual([TRUST, "sort market_value desc"]);
    // The second part holds no code-read filter, so the provider's pick for a word nothing declares stands, as before.
    const synonym = await planFor("flagged trust accounts, sort by size", fake);
    expect(synonym.status).toBe("ready");
    expect(short(synonym.operations)).toEqual([TRUST, "sort market_value desc"]);
  });

  it("checks what a clear says to keep", async () => {
    const state = {
      filters: {
        id: "g0",
        type: "group" as const,
        combinator: "and" as const,
        children: [{ id: "f0", type: "predicate" as const, columnId: "registration_type", operator: "eq" as const, value: "trust" }],
      },
    };
    const fake = provider({ families: [f("filter.clear")] }, { families: [f("filter")] });
    const kept = await planFor("clear the filters except flagged trust accounts", fake, { state });
    expect(kept.status).toBe("ready");
    expect(short(kept.operations)).toEqual(["filter.clear", TRUST]);
    const extra = await planFor("clear the filters except flagged trust accounts whatever", fake, { state });
    expect(extra.clarifications.map((q) => q.prompt)).toEqual([notSure("“whatever”")]);
    const sorted = await planFor("clear the filters except flagged trust accounts sorted", fake, { state });
    expect(sorted.status).toBe("needs_clarification");
    expect(sorted.clarifications.map((q) => q.prompt)).toEqual([notSure("“sorted”")]);
  });
});
