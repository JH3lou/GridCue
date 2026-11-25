import { describe, expect, it } from "vitest";
import { labelledRequests, loadPayloads, providerRequest } from "./payloads";
import { runCase } from "./run";

// The payload pin (operation set spec, 4.1; ADR 0028). Code may read more of a request itself, such as the count's
// closed words, but what it sends an Intent Provider for a labelled request stays what was last recorded. The first
// record was made from the source as it was before code read any view words (2026-11-13).
//
// A change that means to alter the request, or a new labelled set, records again with `pnpm build && pnpm
// eval:payloads`, and its pull request says why.
//
// House Terms and Local Values are never sent (named filters spec, 4.3; ADRs 0024 and 0025): the request is built
// before they are looked at. So each request on the wealth or ledger schema is also sent with its schema's House Terms
// switched, with its Local Values switched, and with both, and each must equal the same record. No second pin is kept.
// Nor is the Calendar, or anything read with the clock (spec 5.5; ADR 0026): every request is also sent with the
// Calendar of `evals/clock.ts` set and its clock fixed, and must equal the same record.
describe("the provider request for every labelled request", () => {
  const recorded = loadPayloads();
  const labelled = labelledRequests();

  for (const { file, id, case: c } of labelled) {
    it(`${file}: ${id}`, async () => {
      const key = `${file}: ${id}`;
      expect(recorded.has(key), `No request is recorded for ${key}. Record it with "pnpm build && pnpm eval:payloads".`).toBe(true);
      expect(await providerRequest(c)).toEqual(recorded.get(key));
      // The Calendar and the clock are never sent either (spec 4.3, 5.5): with them set, the request is the same.
      expect(await providerRequest(c, (x, p) => runCase(x, p, undefined, { calendar: true })), "with a Calendar").toEqual(
        recorded.get(key),
      );
      if (c.schema === undefined || c.schema === "ledger") {
        expect(await providerRequest({ ...c, terms: !c.terms }), "with the House Terms switched").toEqual(recorded.get(key));
        expect(await providerRequest({ ...c, values: !c.values }), "with the Local Values switched").toEqual(recorded.get(key));
        expect(await providerRequest({ ...c, terms: !c.terms, values: !c.values }), "with both switched").toEqual(recorded.get(key));
      }
    });
  }

  it("records nothing but labelled requests", () => {
    const keys = new Set(labelled.map(({ file, id }) => `${file}: ${id}`));
    expect([...recorded.keys()].filter((key) => !keys.has(key))).toEqual([]);
  });
});
