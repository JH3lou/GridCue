import { describe, expect, it } from "vitest";
import { matchMentions } from "../src/core/mentions";
import { normalize } from "../src/core/normalize";
import { isExposed } from "../src/core/schema";
import { unknownTerm } from "../src/core/terms";
import { defineSchema } from "../src/index";

const schema = defineSchema(
  [
    { id: "item", label: "Item number", kind: "string" },
    { id: "price", label: "Price", kind: "currency" },
    { id: "owner", label: "Owner", kind: "string" },
    { id: "state", label: "State", kind: "enum" },
    { id: "region", label: "Region", kind: "enum" },
    { id: "secret", label: "Secret" },
  ],
  {
    restricted: ["secret"],
    columns: {
      item: { aliases: ["item"] },
      owner: { aliases: ["rep", "seller"] },
      price: { aliases: ["cost"] },
      state: {
        enumValues: [
          { id: "open", label: "Open" },
          { id: "sold", label: "Sold", aliases: ["closed"] },
        ],
      },
      region: {
        enumValues: [
          { id: "north", label: "North" },
          { id: "open_air", label: "Open air", aliases: ["outdoor"] },
        ],
      },
    },
  },
);
const columns = schema.columns.filter(isExposed);
const found = (text: string) =>
  matchMentions(normalize(text).clauses, columns).map((m) => (m.valueId === undefined ? m.columnId : `${m.columnId}=${m.valueId}`));

describe("matchMentions", () => {
  it("matches labels, aliases, and plurals as whole words", () => {
    expect(found("sort by rep")).toEqual(["owner"]);
    expect(found("group by sellers")).toEqual(["owner"]);
    expect(found("hide item numbers")).toEqual(["item"]);
    expect(found("hide the representative")).toEqual([]);
  });

  it("matches enum values and their aliases, masking them from column matching", () => {
    expect(found("only closed items")).toEqual(["state=sold"]);
    expect(found("open and sold, sorted by price")).toEqual(["state=open", "state=sold", "price"]);
  });

  it("reads a column name after another name as the rows (rule 1)", () => {
    expect(found("show open items")).toEqual(["state=open"]);
  });

  it("reads a column name before a qualifier as the rows (rule 2)", () => {
    expect(found("items with a price above $5")).toEqual(["price"]);
    expect(found("show items without an owner")).toEqual(["owner"]);
  });

  it("reads a column name before 'by' as the rows (rule 3)", () => {
    expect(found("sort items by price")).toEqual(["price"]);
  });

  it("reads a column name compared with a literal it can't hold as the rows (rule 4)", () => {
    expect(found("items over $500")).toEqual([]);
    expect(found("cost over $500")).toEqual(["price"]);
    expect(found("group the items under each owner")).toEqual(["owner"]);
  });

  it("always reads a name after 'by' or before 'column' as a column", () => {
    expect(found("sort by price in descending order")).toEqual(["price"]);
    expect(found("group by items")).toEqual(["item"]);
    expect(found("hide the item column")).toEqual(["item"]);
  });

  it("leaves an ambiguous name to the provider", () => {
    const twoOwners = defineSchema(
      [
        { id: "a", label: "Owner", kind: "string" },
        { id: "b", label: "Owner name", kind: "string" },
      ],
      { columns: { b: { aliases: ["owner"] } } },
    );
    expect(matchMentions(normalize("sort by owner").clauses, twoOwners.columns)).toEqual([]);
    const twoOpens = defineSchema(
      [
        { id: "a", kind: "enum" },
        { id: "b", kind: "enum" },
      ],
      {
        columns: { a: { enumValues: [{ id: "open", label: "Open" }] }, b: { enumValues: [{ id: "open", label: "Open" }] } },
      },
    );
    expect(matchMentions(normalize("only open").clauses, twoOpens.columns)).toEqual([]);
  });

  it("never matches a column that is not exposed", () => {
    expect(found("sort by secret")).toEqual([]);
  });

  it("keeps each Mention on its own Clause", () => {
    const mentions = matchMentions(normalize("group by owner, then sort by price").clauses, columns);
    expect(mentions.map((m) => [m.clauseIndex, m.columnId])).toEqual([
      [0, "owner"],
      [1, "price"],
    ]);
  });
});

describe("unknownTerm", () => {
  it("names the words after a column verb", () => {
    expect(unknownTerm("sort by risk score")).toBe("risk score");
    expect(unknownTerm("group by the region code, largest first")).toBe("region code");
  });

  it("returns nothing for a pronoun, an empty remainder, or a sentence", () => {
    expect(unknownTerm("sort them")).toBeUndefined();
    expect(unknownTerm("sort by")).toBeUndefined();
    expect(unknownTerm("sort by the thing my manager asked about yesterday")).toBeUndefined();
  });
});

describe("matchMentions superlatives", () => {
  it("reads a name after a superlative, with at most one word between, as the rows (rule 5)", () => {
    expect(found("biggest items first")).toEqual([]);
    expect(found("largest open items first")).toEqual(["state=open"]);
    // Leaning toward the rows: this falls back to the provider rather than being matched.
    expect(found("sort by the largest cost")).toEqual([]);
  });
});
