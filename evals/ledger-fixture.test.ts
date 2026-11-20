import { generateLedger, ledgerColumns, ledgerSchema } from "@gridcue-internal/ledger-fixtures";
import { describe, expect, it } from "vitest";

describe("the ledger fixture", () => {
  it("has a schema that carries every column kind a ledger case needs", () => {
    expect(ledgerSchema.columns.map((c) => c.id)).toEqual(ledgerColumns.map((c) => c.id));
    const kinds = new Set(ledgerSchema.columns.map((c) => c.kind));
    for (const kind of ["string", "date", "datetime", "number", "currency", "percent", "enum", "boolean"]) {
      expect(kinds.has(kind as never)).toBe(true);
    }
    expect(ledgerSchema.rowNoun).toBe("entry");
  });

  it("gives the same rows every run", () => {
    expect(generateLedger()).toEqual(generateLedger());
    expect(generateLedger(5, 7)).toEqual(generateLedger(400, 7).slice(0, 5));
  });

  it("leaves some text, category and date values empty", () => {
    const rows = generateLedger();
    for (const key of ["counterparty", "category", "booked"] as const) {
      const empty = rows.filter((r) => r[key] === null).length;
      expect(empty).toBeGreaterThan(0);
      expect(empty).toBeLessThan(rows.length);
    }
  });
});
