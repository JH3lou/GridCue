import { describe, expect, it } from "vitest";
import { readCodeFilters } from "../src/core/code-read";
import { indexLocalValues, type LocalValuesRead, MAX_LOCAL_VALUE_CHOICES, readLocalValues } from "../src/core/local-values";
import { matchMentions } from "../src/core/mentions";
import { normalize, withoutNamedSizes } from "../src/core/normalize";
import type { ViewSchema } from "../src/core/protocol";
import { defineSchema, isExposed, type SchemaOptions } from "../src/core/schema";

// Local Values (named filters spec, 5.4; ADR 0025): the value index and what counts as naming a value. Every name
// here is made up. Nothing in this file calls a provider: the index and the reader never do.
const columns = [
  { id: "account_number", label: "Account number" },
  { id: "household", label: "Household" },
  { id: "advisor_name", label: "Advisor" },
  { id: "registration_type", label: "Registration type" },
  { id: "custodian", label: "Custodian" },
  { id: "market_value", label: "Market value" },
  { id: "concentration", label: "Concentration" },
  { id: "counterparty", label: "Counterparty" },
  { id: "has_restricted_holding", label: "Restricted holdings" },
  { id: "tax_id", label: "Tax ID" },
];
const options: SchemaOptions = {
  rowNoun: "account",
  restricted: ["tax_id"],
  columns: {
    account_number: { aliases: ["account"] },
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
    custodian: {
      enumValues: [
        { id: "northgate", label: "Northgate" },
        { id: "summit_trust", label: "Summit Trust" },
      ],
    },
    market_value: { kind: "currency", aliases: ["value", "balance"] },
    concentration: { kind: "percent" },
    counterparty: { aliases: ["vendor"], entity: "firm" },
    has_restricted_holding: { kind: "boolean", aliases: ["restricted"] },
  },
  houseTerms: [{ label: "Large", aliases: ["big"], where: [{ columnId: "market_value", operator: "gt", value: 1_000_000 }] }],
};
const schema = defineSchema(columns, options);

const ADVISORS = ["Avery Lane", "Blake Moreno", "Casey Ortiz", "Dana Whitfield", "Emerson Hale"];
const HOUSEHOLDS = ["Alder Household", "Birch Household", "Cedar Household", "Dunmore Household"];
const names = { advisor_name: ADVISORS, household: HOUSEHOLDS };

/** Reads each part of a request as the Controller would hand it over: after the Mentions and the other code-read filters. */
const readAll = (text: string, values: Record<string, readonly unknown[]>, s: ViewSchema = schema) => {
  const normalized = normalize(text);
  const mentions = matchMentions(normalized.clauses, s.columns.filter(isExposed), { rowNoun: s.rowNoun });
  const input = withoutNamedSizes(normalized, mentions);
  const codeRead = readCodeFilters(input, mentions, s);
  const indexes = Object.entries(values).map(([columnId, list]) => ({ columnId, index: indexLocalValues(list) }));
  return input.clauses.map((clause) => {
    const read = readLocalValues(
      {
        clause,
        mentions: mentions.filter((m) => m.clauseIndex === clause.index),
        codeRead: codeRead.filter((r) => r.clauseIndex === clause.index),
        schema: s,
      },
      indexes,
    );
    return { clause, read };
  });
};
/** What one part reads, with each span shown as the words it covers. */
const said = (text: string, values: Record<string, readonly unknown[]> = names, s: ViewSchema = schema) => {
  const parts = readAll(text, values, s);
  const words = (clauseText: string, span: { start: number; end: number }) => clauseText.slice(span.start, span.end);
  return {
    values: parts.flatMap(({ clause, read }) => read.values.map((v) => `${v.columnId}=${v.value} @${words(clause.text, v)}`)),
    ties: parts.flatMap(({ clause, read }) =>
      read.ties.map((t) => ({
        at: words(clause.text, t),
        values: t.values.map((v) => `${v.columnId}=${v.value}`),
        names: t.names.map((n) => `${n.kind}:${n.label}`),
      })),
    ),
    words: parts.flatMap(({ clause, read }) =>
      read.words.map((w) => ({
        at: words(clause.text, w),
        count: w.count,
        columns: w.columns.map((c) => `${c.columnId}:${c.count}`),
        choices: w.choices.map((c) => `${c.columnId}=${c.value}`),
      })),
    ),
  };
};
const nothing = { values: [], ties: [], words: [] };

describe("the value index", () => {
  it("keeps each value once, as the grid holds it, in the order first seen", () => {
    const index = indexLocalValues(["Avery Lane", "Blake Moreno", "Avery Lane", "Casey Ortiz", "Blake Moreno"]);
    expect(index.values).toEqual(["Avery Lane", "Blake Moreno", "Casey Ortiz"]);
  });
  it("keeps a value that differs from an earlier one only in letter case once, in its first spelling", () => {
    // An exact filter on a text column ignores letter case, so both spellings keep the same rows.
    const index = indexLocalValues(["Avery Lane", "AVERY LANE", "avery lane", "Avery-Lane"]);
    expect(index.values).toEqual(["Avery Lane", "Avery-Lane"]);
    expect(said("Avery Lane's accounts", { advisor_name: ["Avery Lane", "AVERY LANE"] }).values).toEqual([
      "advisor_name=Avery Lane @avery lane",
    ]);
    expect(said("Lane's accounts", { advisor_name: ["AVERY LANE", "Avery Lane"] }).words).toEqual([
      { at: "lane", count: 1, columns: ["advisor_name:1"], choices: ["advisor_name=AVERY LANE"] },
    ]);
  });
  it("drops empty values, values with no letter or digit, and values that are not text", () => {
    const index = indexLocalValues(["", "   ", null, undefined, "—", "...", 7, true, { name: "Avery Lane" }, ["Avery Lane"], "Avery Lane"]);
    expect(index.values).toEqual(["Avery Lane"]);
  });
  it("builds nothing for no values", () => {
    expect(indexLocalValues([]).values).toEqual([]);
    expect(said("avery lane's accounts", { advisor_name: [] })).toEqual(nothing);
    expect(said("avery lane's accounts", {})).toEqual(nothing);
  });
  it("is not changed by reading", () => {
    const list = Object.freeze([...ADVISORS]);
    const index = indexLocalValues(list);
    const seen = () =>
      JSON.stringify([
        index.values,
        [...index.words],
        index.holders,
        index.firstTerm,
        index.firstNext,
        [...index.branches].map(([k, v]) => [k, [...v]]),
        [...index.ends],
        [...index.marks].map(([k, v]) => [k, [...v]]),
      ]);
    const before = seen();
    said("avery lane's accounts and lane or moreno", { advisor_name: list });
    readLocalValues({ clause: { index: 0, text: "avery lane or hale", literals: [] }, mentions: [], codeRead: [], schema }, [
      { columnId: "advisor_name", index },
    ]);
    expect(seen()).toBe(before);
  });
});

describe("a whole value", () => {
  it("is read in the grid's own letter case, with its span in the part", () => {
    expect(said("Avery Lane's accounts").values).toEqual(["advisor_name=Avery Lane @avery lane"]);
    expect(said("accounts for avery lane").values).toEqual(["advisor_name=Avery Lane @avery lane"]);
    expect(said("ACCOUNTS FOR BLAKE MORENO").values).toEqual(["advisor_name=Blake Moreno @blake moreno"]);
    expect(said("advisor is Avery Lane").values).toEqual(["advisor_name=Avery Lane @avery lane"]);
    expect(said("Accounts for Casey Ortiz.").values).toEqual(["advisor_name=Casey Ortiz @casey ortiz"]);
    expect(said("accounts for avery lane", { advisor_name: ["AVERY LANE"] }).values).toEqual(["advisor_name=AVERY LANE @avery lane"]);
  });
  it("gives the exact span, in the part's own offsets", () => {
    const [part] = readAll("show taxable accounts for Avery Lane", names);
    expect(part?.read.values).toEqual([{ columnId: "advisor_name", value: "Avery Lane", start: 26, end: 36 }]);
    expect(part?.clause.text.slice(26, 36)).toBe("avery lane");
  });
  it("is read with the punctuation between its words left out, changed for a joiner, or as the value holds it", () => {
    const firms = { counterparty: ["Birch & Fenn Ltd", "Lane, Avery", "Hollis-Greaves Partners", "Cedar (Europe) Ltd", "D'Alder Freight"] };
    expect(said("entries for Birch & Fenn Ltd", firms).values).toEqual(["counterparty=Birch & Fenn Ltd @birch & fenn ltd"]);
    expect(said("birch fenn ltd entries", firms).values).toEqual(["counterparty=Birch & Fenn Ltd @birch fenn ltd"]);
    expect(said("accounts for lane, avery", firms).values).toEqual(["counterparty=Lane, Avery @lane, avery"]);
    expect(said("accounts for lane avery", firms).values).toEqual(["counterparty=Lane, Avery @lane avery"]);
    expect(said("hollis-greaves partners accounts", firms).values).toEqual([
      "counterparty=Hollis-Greaves Partners @hollis-greaves partners",
    ]);
    expect(said("hollis greaves partners accounts", firms).values).toEqual([
      "counterparty=Hollis-Greaves Partners @hollis greaves partners",
    ]);
    expect(said("hollis_greaves.partners accounts", firms).values).toEqual([
      "counterparty=Hollis-Greaves Partners @hollis_greaves.partners",
    ]);
    expect(said("accounts for cedar (europe) ltd", firms).values).toEqual(["counterparty=Cedar (Europe) Ltd @cedar (europe) ltd"]);
    expect(said("accounts for cedar europe ltd", firms).values).toEqual(["counterparty=Cedar (Europe) Ltd @cedar europe ltd"]);
    expect(said("d'alder freight accounts", firms).values).toEqual(["counterparty=D'Alder Freight @d'alder freight"]);
    expect(said("D’Alder Freight’s accounts", firms).values).toEqual(["counterparty=D'Alder Freight @d'alder freight"]);
    expect(said("accounts for avery-lane").values).toEqual(["advisor_name=Avery Lane @avery-lane"]);
    expect(said("o'jessup accounts", { counterparty: ["O Jessup"] }).values).toEqual(["counterparty=O Jessup @o'jessup"]);
    expect(said("accounts for zoë åldersen", { counterparty: ["Zoë Åldersen"] }).values).toEqual([
      "counterparty=Zoë Åldersen @zoë åldersen",
    ]);
    expect(said("ACC-0001", { counterparty: ["ACC-0001"] }).values).toEqual(["counterparty=ACC-0001 @acc-0001"]);
  });
  it("is not read across punctuation that separates two names", () => {
    // A comma lists two names. "Lane Blake" is a made-up third advisor whose words sit across the comma.
    const three = { advisor_name: ["Avery Lane", "Blake Moreno", "Lane Blake"] };
    expect(said("Avery Lane, Blake Moreno", three).values).toEqual([
      "advisor_name=Avery Lane @avery lane",
      "advisor_name=Blake Moreno @blake moreno",
    ]);
    expect(said("Avery Lane, Blake Moreno", three).ties).toEqual([]);
    const pair = { household: ["Hollis Greaves"] };
    expect(said("accounts for hollis, greaves", pair).values).toEqual([]);
    expect(said("accounts for hollis/greaves", pair).values).toEqual([]);
    expect(said("accounts for hollis - greaves", pair).values).toEqual([]);
    expect(said("accounts for hollis & greaves", pair).values).toEqual([]);
    expect(said("accounts for hollis > greaves", pair).values).toEqual([]);
    expect(said("accounts for hollis: greaves", pair).values).toEqual([]);
    // Each word is still one word of the value, so the part asks rather than drop it.
    expect(said("accounts for hollis, greaves", pair).words.map((w) => w.at)).toEqual(["hollis", "greaves"]);
  });
  it("is not read in another order, in part, or run together", () => {
    expect(said("accounts for lane avery").values).toEqual([]);
    expect(said("accounts for averylane").values).toEqual([]);
    expect(said("accounts for avery").values).toEqual([]);
    expect(said("accounts for avery and lane").values).toEqual([]);
  });
  it("has no plural form", () => {
    expect(said("the avery lanes").values).toEqual([]);
    expect(said("alder households").values).toEqual([]);
    expect(said("the alder household").values).toEqual(["household=Alder Household @alder household"]);
    // The word that is still whole is one word of the value, and asks.
    expect(said("the avery lanes").words.map((w) => w.at)).toEqual(["avery"]);
  });
  it("is read once for each place it is named, and several of one column are each found", () => {
    expect(said("Avery Lane or Blake Moreno").values).toEqual([
      "advisor_name=Avery Lane @avery lane",
      "advisor_name=Blake Moreno @blake moreno",
    ]);
    expect(said("Avery Lane, Blake Moreno or Casey Ortiz").values).toHaveLength(3);
    expect(said("Avery Lane or the Alder household").values).toEqual([
      "advisor_name=Avery Lane @avery lane",
      "household=Alder Household @alder household",
    ]);
    expect(said("show taxable accounts, sort by value for avery lane").values).toEqual(["advisor_name=Avery Lane @avery lane"]);
  });
  it("is never read inside quoted text, or across it", () => {
    expect(said('advisor containing "Avery Lane"')).toEqual(nothing);
    expect(said('advisor containing "Lane"')).toEqual(nothing);
    expect(said('accounts for avery "x" lane').values).toEqual([]);
    expect(said('avery lane\'s accounts with household containing "alder"').values).toEqual(["advisor_name=Avery Lane @avery lane"]);
    expect(said('avery lane\'s accounts with household containing "alder"').words).toEqual([]);
  });
});

describe("the longest name wins", () => {
  it("reads a value that holds a column's name or an entity word as the value", () => {
    expect(said("the Alder household")).toEqual({ values: ["household=Alder Household @alder household"], ties: [], words: [] });
    expect(said("show the Birch household").values).toEqual(["household=Birch Household @birch household"]);
    expect(said("sort by market value for the Alder household").values).toEqual(["household=Alder Household @alder household"]);
    // A value that holds a declared value's name and other words.
    const firms = { counterparty: ["Hollis Trust Group", "Fairholm Taxable Fund"] };
    expect(said("hollis trust group accounts", firms)).toEqual({
      values: ["counterparty=Hollis Trust Group @hollis trust group"],
      ties: [],
      words: [],
    });
    expect(said("accounts for fairholm taxable fund", firms).values).toEqual(["counterparty=Fairholm Taxable Fund @fairholm taxable fund"]);
  });
  it("reads the longer of two values, in one column or in two", () => {
    const firms = {
      counterparty: ["Cedar", "Cedar Works", "Cedar Works North"],
      household: ["Works North", "Alder"],
      advisor_name: ["Alder Household"],
    };
    expect(said("cedar works north accounts", firms)).toEqual({
      values: ["counterparty=Cedar Works North @cedar works north"],
      ties: [],
      words: [],
    });
    expect(said("cedar works accounts", firms)).toEqual({ values: ["counterparty=Cedar Works @cedar works"], ties: [], words: [] });
    expect(said("the alder household", firms)).toEqual({ values: ["advisor_name=Alder Household @alder household"], ties: [], words: [] });
  });
  it("reads a value inside a longer value when it is named on its own", () => {
    const firms = { counterparty: ["Cedar", "Cedar Works"] };
    expect(said("cedar accounts", firms)).toEqual({ values: ["counterparty=Cedar @cedar"], ties: [], words: [] });
    expect(said("accounts for cedar and cedar works", firms).values).toEqual([
      "counterparty=Cedar @cedar",
      "counterparty=Cedar Works @cedar works",
    ]);
  });
  it("reads an amount inside a value as part of the name", () => {
    const funds = { counterparty: ["Fund 7", "Fund 12", "Q3 Holdings", "Tier 1 Capital"] };
    expect(said("show fund 7", funds)).toEqual({ values: ["counterparty=Fund 7 @fund 7"], ties: [], words: [] });
    expect(said("fund 12 accounts over $1m", funds).values).toEqual(["counterparty=Fund 12 @fund 12"]);
    expect(said("q3 holdings accounts", funds).values).toEqual(["counterparty=Q3 Holdings @q3 holdings"]);
    expect(said("accounts for tier 1 capital", funds).values).toEqual(["counterparty=Tier 1 Capital @tier 1 capital"]);
    // A word that holds an amount is still one word: a code is read whole, and is offered as one word of a longer value.
    const codes = { counterparty: ["AB123", "Q3", "ZX900 Holdings"] };
    expect(said("ab123 accounts", codes)).toEqual({ values: ["counterparty=AB123 @ab123"], ties: [], words: [] });
    expect(said("accounts for q3", codes).values).toEqual(["counterparty=Q3 @q3"]);
    expect(said("zx900 accounts", codes).words.map((w) => w.at)).toEqual(["zx900"]);
    // The amount alone is an amount, never one word of a value.
    expect(said("accounts over 7", funds)).toEqual(nothing);
    expect(said("top 12 accounts", funds)).toEqual(nothing);
  });
  it("leaves a value inside a longer declared name to that name", () => {
    const odd = { household: ["Market", "Summit", "Roth"] };
    expect(said("sort by market value", odd)).toEqual(nothing);
    expect(said("accounts at summit trust", odd)).toEqual(nothing);
    expect(said("roth ira accounts", odd)).toEqual(nothing);
    expect(said("market accounts", odd).values).toEqual(["household=Market @market"]);
    expect(said("summit accounts", odd).values).toEqual(["household=Summit @summit"]);
  });
  it("asks when two values' words cross", () => {
    const crossed = { advisor_name: ["Avery Lane", "Lane Blake"] };
    const read = said("avery lane blake", crossed);
    expect(read.values).toEqual([]);
    expect(read.ties).toEqual([{ at: "avery lane blake", values: ["advisor_name=Avery Lane", "advisor_name=Lane Blake"], names: [] }]);
    expect(read.words).toEqual([]);
    // Every value the crossing words touch is a tie, whichever was found first.
    const chained = said("avery lane-blake moreno", { advisor_name: ["Avery Lane", "Lane Blake", "Blake Moreno"] });
    expect(chained.values).toEqual([]);
    expect(chained.ties.map((t) => t.at)).toEqual(["avery lane-blake", "lane-blake moreno"]);
  });
  it("asks when a value's words cross a declared name's", () => {
    const read = said("blue market value over $1m", { household: ["Blue Market"] });
    expect(read.values).toEqual([]);
    expect(read.ties).toEqual([{ at: "blue market", values: ["household=Blue Market"], names: ["column:Market value"] }]);
  });
});

describe("a value made only of GridCue's own words", () => {
  const own = {
    advisor_name: [
      "Top",
      "Show All",
      "First",
      "May",
      "Top 10",
      "As Well",
      "More Than",
      "7",
      "2026",
      "50k",
      "Largest",
      "Sort By",
      "Max",
      "Can You",
      "I Want",
    ],
  };
  it("is never read from the grid", () => {
    for (const text of [
      "top accounts",
      "show all",
      "show all accounts",
      "largest first",
      "accounts opened in may",
      "top 10 accounts",
      "taxable accounts as well",
      "accounts with more than 7",
      "accounts over 50k",
      "largest accounts",
      "sort by value",
      "can you show trusts",
      "i want trusts",
      "accounts opened in 2026",
      "max accounts",
    ]) {
      expect(said(text, own), text).toEqual(nothing);
    }
  });
  it("is never read even where a Host declares one of its words as a name", () => {
    // "Compact" is a density GridCue reads. A Host may still declare a value by that name.
    const compact = defineSchema(columns, {
      ...options,
      columns: { ...options.columns, custodian: { enumValues: [{ id: "compact", label: "Compact" }] } },
    });
    expect(said("the compact accounts", { household: ["The Compact"] }, compact)).toEqual(nothing);
  });
  it("is never offered for one of its words", () => {
    expect(said("show accounts", own)).toEqual(nothing);
    expect(said("accounts as of today", own)).toEqual(nothing);
    // "As" and "can" are on no list, but the only values that hold them are never read, so they are no choice.
    expect(said("trusts as usual", own)).toEqual(nothing);
    expect(said("what can be seen", own)).toEqual(nothing);
  });
  it("is still read when it holds one word that is not GridCue's own", () => {
    const mixed = { counterparty: ["Top Flight", "First Ellery", "May Fair", "The Works"] };
    expect(said("top flight accounts", mixed).values).toEqual(["counterparty=Top Flight @top flight"]);
    expect(said("accounts for first ellery", mixed).values).toEqual(["counterparty=First Ellery @first ellery"]);
    expect(said("accounts for the works", mixed).values).toEqual(["counterparty=The Works @the works"]);
    // A value that is never read hides no other value: "The Top" is made of GridCue's own words, "Top Flight" is not.
    expect(said("the top flight accounts", { counterparty: ["The Top", "Top Flight"] }).values).toEqual([
      "counterparty=Top Flight @top flight",
    ]);
    // One of GridCue's own words is never offered; the other word is.
    expect(said("top accounts", mixed)).toEqual(nothing);
    expect(said("flight accounts", mixed).words).toEqual([
      { at: "flight", count: 1, columns: ["counterparty:1"], choices: ["counterparty=Top Flight"] },
    ]);
  });
});

describe("ties", () => {
  it("asks about a value two columns hold", () => {
    const both = { advisor_name: ["Jordan Blake", "Avery Lane"], household: ["Jordan Blake", "Alder Household"] };
    expect(said("jordan blake's accounts", both)).toEqual({
      values: [],
      ties: [{ at: "jordan blake", values: ["advisor_name=Jordan Blake", "household=Jordan Blake"], names: [] }],
      words: [],
    });
    // The other values of both columns are still certain.
    expect(said("avery lane's accounts", both).values).toEqual(["advisor_name=Avery Lane @avery lane"]);
  });
  it("asks about a value one column holds in two spellings, and offers a spelling that differs only in letter case once", () => {
    const spelt = { household: ["Hollis-Greaves", "Hollis Greaves", "HOLLIS GREAVES"] };
    expect(said("hollis greaves accounts", spelt).ties).toEqual([
      { at: "hollis greaves", values: ["household=Hollis-Greaves", "household=Hollis Greaves"], names: [] },
    ]);
  });
  it("asks about a value that is also a column's name", () => {
    expect(said("show custodian", { household: ["Custodian"] }).ties).toEqual([
      { at: "custodian", values: ["household=Custodian"], names: ["column:Custodian"] },
    ]);
    // By an alias, and where the Mentions read the name as the rows.
    expect(said("sort by balance", { household: ["Balance"] }).ties).toEqual([
      { at: "balance", values: ["household=Balance"], names: ["column:Market value"] },
    ]);
    expect(said("custodian with a trust", { household: ["Custodian"] }).ties).toEqual([
      { at: "custodian", values: ["household=Custodian"], names: ["column:Custodian"] },
    ]);
  });
  it("asks about a value that is also a declared value's name, or a Value Group's", () => {
    expect(said("trust accounts", { household: ["Trust"] }).ties).toEqual([
      { at: "trust", values: ["household=Trust"], names: ["value:Trust"] },
    ]);
    expect(said("roth accounts", { household: ["Roth"] }).ties).toEqual([
      { at: "roth", values: ["household=Roth"], names: ["value:Roth IRA"] },
    ]);
    expect(said("retirement accounts", { household: ["Retirement"] }).ties).toEqual([
      { at: "retirement", values: ["household=Retirement"], names: ["valueGroup:Retirement"] },
    ]);
  });
  it("asks about a value that is also the Row Noun or an entity word", () => {
    expect(said("show account", { household: ["Account"] }).ties[0]?.names).toContain("rowNoun:account");
    expect(said("show accounts by firm", { household: ["Firm"] }).ties).toEqual([
      { at: "firm", values: ["household=Firm"], names: ["entity:firm"] },
    ]);
  });
  it("asks about a value that is also a House Term's name", () => {
    expect(said("large accounts", { household: ["Large"] }).ties).toEqual([
      { at: "large", values: ["household=Large"], names: ["houseTerm:Large"] },
    ]);
    expect(said("big accounts", { household: ["Big"] }).ties[0]?.names).toContain("houseTerm:Large");
  });
  it("asks about a value in a form GridCue finds a declared name in", () => {
    // The plural of a declared name, and a name written with nothing between its words.
    expect(said("trusts", { household: ["Trusts"] }).ties).toEqual([
      { at: "trusts", values: ["household=Trusts"], names: ["value:Trust"] },
    ]);
    expect(said("show the marketvalue", { household: ["Marketvalue"] }).ties[0]?.names).toEqual(["column:Market value"]);
    expect(said("accounts by advisors", { household: ["Advisors"] }).ties[0]?.values).toEqual(["household=Advisors"]);
    // Also where the Mentions read the joined name as the rows, and so hold no Mention for it.
    expect(said("marketvalue with a trust", { household: ["Marketvalue"] }).ties[0]?.names).toEqual(["column:Market value"]);
  });
  it("asks about a value at the words of a Mention or of another code-read filter", () => {
    const zephyr = [{ columnId: "household", index: indexLocalValues(["Zephyr"]) }];
    const clause = { index: 0, text: "show zephyr", literals: [] };
    expect(readLocalValues({ clause, mentions: [], codeRead: [], schema }, zephyr).values).toHaveLength(1);
    // A Mention in a form the schema's names do not show word by word.
    const mention = readLocalValues(
      { clause, mentions: [{ clauseIndex: 0, columnId: "custodian", start: 5, end: 11 }], codeRead: [], schema },
      zephyr,
    );
    expect(mention.values).toEqual([]);
    expect(mention.ties).toEqual([
      {
        start: 5,
        end: 11,
        values: [{ columnId: "household", value: "Zephyr", start: 5, end: 11 }],
        names: [{ kind: "column", label: "Custodian", columnId: "custodian" }],
      },
    ]);
    // Another part's Mention says nothing here.
    expect(
      readLocalValues({ clause, mentions: [{ clauseIndex: 1, columnId: "custodian", start: 5, end: 11 }], codeRead: [], schema }, zephyr)
        .values,
    ).toHaveLength(1);
    const filter = readLocalValues({ clause, mentions: [], codeRead: [{ start: 5, end: 11 }], schema }, zephyr);
    expect(filter.ties[0]?.names).toEqual([{ kind: "codeRead", label: "zephyr" }]);
    // Inside a longer code-read filter, the words are that filter's.
    expect(readLocalValues({ clause, mentions: [], codeRead: [{ start: 0, end: 11 }], schema }, zephyr)).toEqual({
      ...nothing,
      valueWords: ["zephyr"],
    });
  });
  it("asks about a value whose every word is a declared name or one of GridCue's own words", () => {
    // Without the value, "trust accounts" already reads whole as the Trust accounts.
    expect(said("show trust accounts", { household: ["Trust Accounts"] })).toEqual({
      values: [],
      ties: [
        { at: "trust accounts", values: ["household=Trust Accounts"], names: ["value:Trust", "rowNoun:account", "column:Account number"] },
      ],
      words: [],
    });
    expect(said("show the household", { advisor_name: ["The Household"] }).ties[0]?.values).toEqual(["advisor_name=The Household"]);
    expect(said("show the household", { advisor_name: ["The Household"] }).values).toEqual([]);
  });
  it("asks about a value that ends in a possessive mark when the grid also holds it without", () => {
    const marked = { counterparty: ["Darcy's", "Darcy", "Dana's"] };
    expect(said("darcy's accounts", marked)).toEqual({
      values: [],
      ties: [{ at: "darcy's", values: ["counterparty=Darcy's", "counterparty=Darcy"], names: [] }],
      words: [],
    });
    expect(said("accounts for darcy", marked).values).toEqual(["counterparty=Darcy @darcy"]);
    // With no such other value, the mark is the value's own.
    expect(said("dana's accounts", marked).values).toEqual(["counterparty=Dana's @dana's"]);
  });
  it("asks about a value that may list two other values", () => {
    const firms = {
      counterparty: ["Alder and Cedar", "Alder", "Cedar", "Fenn & Fenn", "Fenn", "Birch & Fenn Ltd", "Birch", "Fenn Ltd"],
    };
    expect(said("alder and cedar accounts", firms)).toEqual({
      values: [],
      ties: [{ at: "alder and cedar", values: ["counterparty=Alder and Cedar", "counterparty=Alder", "counterparty=Cedar"], names: [] }],
      words: [],
    });
    expect(said("accounts for birch & fenn ltd", firms).ties.map((t) => t.at)).toEqual(["birch & fenn ltd"]);
    // One value twice is no list, and nor are two values with nothing joining them.
    expect(said("fenn & fenn accounts", firms).values).toEqual(["counterparty=Fenn & Fenn @fenn & fenn"]);
    expect(said("accounts for birch fenn ltd", firms).values).toEqual(["counterparty=Birch & Fenn Ltd @birch fenn ltd"]);
    // With one of the two missing from the grid, the longer value is the only reading.
    expect(said("alder and cedar accounts", { counterparty: ["Alder and Cedar", "Alder"] }).values).toEqual([
      "counterparty=Alder and Cedar @alder and cedar",
    ]);
    // A word that is not GridCue's own belongs to the longer name.
    expect(said("alder family cedar accounts", { counterparty: ["Alder Family Cedar", "Alder", "Cedar"] }).values).toEqual([
      "counterparty=Alder Family Cedar @alder family cedar",
    ]);
  });
  it("reads a possessive after a value as no word of any value", () => {
    const s = { counterparty: ["Lane S Fund", "S Corp Holdings"], advisor_name: ["Avery Lane"] };
    expect(said("avery lane's fund", s).values).toEqual(["advisor_name=Avery Lane @avery lane"]);
    expect(said("avery lane's fund", s).words.map((w) => w.at)).toEqual(["fund"]);
    expect(said("accounts for lane s fund", s).values).toEqual(["counterparty=Lane S Fund @lane s fund"]);
  });
});

describe("one word of a value", () => {
  it("is offered with the one value that holds it", () => {
    expect(said("Lane's accounts")).toEqual({
      values: [],
      ties: [],
      words: [{ at: "lane", count: 1, columns: ["advisor_name:1"], choices: ["advisor_name=Avery Lane"] }],
    });
    expect(said("taxable accounts for Lane").words).toEqual([
      { at: "lane", count: 1, columns: ["advisor_name:1"], choices: ["advisor_name=Avery Lane"] },
    ]);
    expect(said("the Alder accounts").words).toEqual([
      { at: "alder", count: 1, columns: ["household:1"], choices: ["household=Alder Household"] },
    ]);
  });
  it("gives the exact span, in the part's own offsets", () => {
    const [part] = readAll("taxable accounts for Lane", names);
    expect(part?.read.words).toEqual([
      {
        start: 21,
        end: 25,
        word: "lane",
        count: 1,
        columns: [{ columnId: "advisor_name", count: 1 }],
        choices: [{ columnId: "advisor_name", value: "Avery Lane" }],
      },
    ]);
  });
  const lees = (n: number) =>
    Array.from({ length: n }, (_, i) => `${["Arden", "Brook", "Corin", "Darcy", "Ellis", "Faron", "Greer"][i]} Lee`);
  it("is offered with five values", () => {
    expect(MAX_LOCAL_VALUE_CHOICES).toBe(5);
    const read = said("lee's accounts", { advisor_name: lees(5) });
    expect(read.words).toEqual([
      {
        at: "lee",
        count: 5,
        columns: ["advisor_name:5"],
        choices: ["Arden Lee", "Brook Lee", "Corin Lee", "Darcy Lee", "Ellis Lee"].map((v) => `advisor_name=${v}`),
      },
    ]);
  });
  it("offers no choices with six values, and says how many hold it", () => {
    expect(said("lee's accounts", { advisor_name: lees(6) }).words).toEqual([
      { at: "lee", count: 6, columns: ["advisor_name:6"], choices: [] },
    ]);
    expect(said("lee's accounts", { advisor_name: lees(7) }).words).toEqual([
      { at: "lee", count: 7, columns: ["advisor_name:7"], choices: [] },
    ]);
  });
  it("counts the values of every column that hold it", () => {
    const both = { advisor_name: ["Frankie Dunmore", "Avery Lane"], counterparty: ["Dunmore Freight", "Dunmore Supply Co"] };
    expect(said("dunmore accounts", both).words).toEqual([
      {
        at: "dunmore",
        count: 3,
        columns: ["advisor_name:1", "counterparty:2"],
        choices: ["advisor_name=Frankie Dunmore", "counterparty=Dunmore Freight", "counterparty=Dunmore Supply Co"],
      },
    ]);
    const many = { advisor_name: lees(4), household: ["Lee Household", "Lee Family"] };
    expect(said("lee accounts", many).words).toEqual([{ at: "lee", count: 6, columns: ["advisor_name:4", "household:2"], choices: [] }]);
  });
  it("counts a value once when it holds the word twice", () => {
    expect(said("lee accounts", { advisor_name: ["Lee Lee Partners", "Arden Lee"] }).words[0]?.count).toBe(2);
  });
  it("is not offered for a word of a whole value the part names", () => {
    expect(said("Avery Lane's accounts").words).toEqual([]);
    expect(said("the Alder household").words).toEqual([]);
    // Named whole once and in part once: only the part is offered.
    expect(said("avery lane or moreno").words.map((w) => w.at)).toEqual(["moreno"]);
  });
  it("is never offered for a declared name", () => {
    // "Household" is a word of every household, and the Household column's name and entity word.
    expect(said("show household")).toEqual(nothing);
    expect(said("households with a trust")).toEqual(nothing);
    expect(said("sort by household")).toEqual(nothing);
    const firms = { counterparty: ["Hollis Trust Group", "Custodian Partners", "Northgate Supply", "Large Cap Fund", "Account Services"] };
    expect(said("trust accounts", firms)).toEqual(nothing);
    expect(said("trusts", firms)).toEqual(nothing);
    expect(said("custodian with a trust", firms)).toEqual(nothing);
    expect(said("accounts at northgate", firms)).toEqual(nothing);
    expect(said("large accounts", firms)).toEqual(nothing);
    expect(said("accounts", firms)).toEqual(nothing);
    // A word of a longer declared name.
    expect(said("sort by market value", { counterparty: ["Blue Market"] })).toEqual(nothing);
  });
  it("is never offered for one of GridCue's own words, an amount, or a lead-in", () => {
    const firms = {
      counterparty: [
        "Top Flight",
        "Group Jessup",
        "Want Not Ltd",
        "First Ellery",
        "Fund 7",
        "Show Stoppers",
        "Well Being",
        "Z Corp",
        "Over Easy",
      ],
    };
    for (const text of [
      "top accounts",
      "group by custodian",
      "i want to see trusts",
      "largest first",
      "accounts over 7",
      "show trusts",
      "show trusts as well",
      "sort by custodian a to z",
      "accounts over $1m",
    ]) {
      expect(said(text, firms), text).toEqual(nothing);
    }
    // Words GridCue reads that the placed-words lists do not hold: a time word, an order word, a word for no value, a
    // word that leaves rows out, a comparison's word.
    const read = { counterparty: ["May Fair", "First Ellery", "Blank Slate", "Except Co", "Max Ivers", "Today Media", "Compact Discs"] };
    for (const text of [
      "accounts opened in may",
      "first accounts",
      "blank accounts",
      "accounts except trusts",
      "max accounts",
      "accounts today",
      "compact accounts",
    ]) {
      expect(said(text, read), text).toEqual(nothing);
    }
    expect(said("fair accounts", read).words.map((w) => w.at)).toEqual(["fair"]);
  });
  it("is offered for a word no list places", () => {
    const firms = { counterparty: ["Want Not Ltd", "Well Being"] };
    expect(said("trusts for want", firms).words.map((w) => w.at)).toEqual(["want"]);
    expect(said("trusts for well", firms).words.map((w) => w.at)).toEqual(["well"]);
  });
  it("is never offered from quoted text", () => {
    expect(said('household containing "alder"').words).toEqual([]);
    expect(said('advisor starts with "lane"').words).toEqual([]);
  });
});

describe("the same input reads the same", () => {
  it("returns an equal answer each time, and a new one", () => {
    const index = indexLocalValues(ADVISORS);
    const part = {
      clause: normalize("avery lane or hale").clauses[0] ?? { index: 0, text: "", literals: [] },
      mentions: [],
      codeRead: [],
      schema,
    };
    const first: LocalValuesRead = readLocalValues(part, [{ columnId: "advisor_name", index }]);
    const second = readLocalValues(part, [{ columnId: "advisor_name", index }]);
    expect(second).toEqual(first);
    expect(first.values).toHaveLength(1);
    expect(first.words).toHaveLength(1);
    first.values.length = 0;
    expect(readLocalValues(part, [{ columnId: "advisor_name", index }]).values).toHaveLength(1);
    const empty = readLocalValues({ ...part, clause: { index: 0, text: "show trusts", literals: [] } }, [
      { columnId: "advisor_name", index },
    ]);
    empty.values.push({ columnId: "x", value: "y", start: 0, end: 1 });
    expect(
      readLocalValues({ ...part, clause: { index: 0, text: "show trusts", literals: [] } }, [{ columnId: "advisor_name", index }]).values,
    ).toEqual([]);
  });
});

// The bars of spec section 10: 50,000 distinct synthetic names built in at most 250 ms, and a request read in at
// most 5 ms, the median of 20. CI is about three times slower than a developer's machine, so the code aims far below.
describe("the value index stays fast", () => {
  const SYLLABLES = [
    "ka",
    "ri",
    "lo",
    "me",
    "tu",
    "sa",
    "ne",
    "vi",
    "do",
    "pe",
    "zu",
    "ha",
    "bi",
    "go",
    "fe",
    "wy",
    "qua",
    "jo",
    "xi",
    "ny",
  ];
  const madeUp = (n: number, offset: number) => {
    const at = (k: number) => SYLLABLES[(Math.floor(n / 20 ** k) + offset * (k + 1)) % 20] ?? "";
    const word = `${at(0)}${at(1)}${at(2)}${offset ? "x" : ""}`;
    return word.charAt(0).toUpperCase() + word.slice(1);
  };
  /** `count` distinct made-up names, two words each: 250 first words, each with as many second words as it takes. */
  const synthetic = (count: number) => Array.from({ length: count }, (_, i) => `${madeUp(i % 250, 0)} ${madeUp(Math.floor(i / 250), 3)}`);
  const median = (times: number[]) => [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? Number.POSITIVE_INFINITY;

  for (const count of [1_000, 10_000, 50_000]) {
    it(`builds ${count.toLocaleString("en-US")} distinct names in under 250 ms, and reads a request in under 5 ms`, () => {
      const list = synthetic(count);
      expect(new Set(list).size).toBe(count);
      // The best of three: a busy test runner is slow once, while slow code is slow every time.
      let built = Number.POSITIVE_INFINITY;
      let index = indexLocalValues(list);
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        index = indexLocalValues(list);
        built = Math.min(built, performance.now() - started);
      }
      expect(index.values).toHaveLength(count);
      expect(built, "build").toBeLessThan(250);

      const whole = list[Math.floor(count / 2)] ?? "";
      const [firstWord = "", secondWord = ""] = whole.split(" ");
      const unit = `accounts for ${whole} or ${secondWord}, `;
      const requests = [
        `show taxable accounts for ${whole} sorted by market value`,
        `${firstWord}'s accounts over $1m`,
        "show taxable accounts over $1m sorted by market value, largest first",
        unit.repeat(Math.ceil(2000 / unit.length)).slice(0, 2000),
      ];
      const indexes = [{ columnId: "advisor_name", index }];
      for (const request of requests) {
        const normalized = normalize(request);
        const mentions = matchMentions(normalized.clauses, schema.columns.filter(isExposed), { rowNoun: schema.rowNoun });
        const input = withoutNamedSizes(normalized, mentions);
        const codeRead = readCodeFilters(input, mentions, schema);
        const parts = input.clauses.map((clause) => ({
          clause,
          mentions: mentions.filter((m) => m.clauseIndex === clause.index),
          codeRead: codeRead.filter((r) => r.clauseIndex === clause.index),
          schema,
        }));
        const times: number[] = [];
        let found = 0;
        for (let run = 0; run < 20; run++) {
          const started = performance.now();
          found = 0;
          for (const part of parts) {
            const read = readLocalValues(part, indexes);
            found += read.values.length + read.ties.length + read.words.length;
          }
          times.push(performance.now() - started);
        }
        expect(median(times), request.slice(0, 60)).toBeLessThan(5);
        // The requests that name a value find it: the time is not that of an empty answer.
        if (request.includes(firstWord)) expect(found, request.slice(0, 60)).toBeGreaterThan(0);
      }
    });
  }
});
