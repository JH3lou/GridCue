import { describe, expect, it } from "vitest";
import { createGridCue } from "../src/core/controller";
import type { IntentProvider } from "../src/core/resolution";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { buildResolutionRequest, emptyViewState, normalize } from "../src/index";
import { createGridCueHandler, toNodeHandler } from "../src/server";

// Fixes from the 0.1.0 pre-publish audit.
const schema = defineSchema([{ id: "value", kind: "number" }]);
const caps = { operations: ["sort.set"], supportsAtomicApply: true, supportsSnapshotRestore: true, observesChanges: true };
const request = buildResolutionRequest(normalize("sort by value"), schema, caps, emptyViewState(["value"]));

describe("the Server Handler", () => {
  it("reports a result that breaks the protocol as malformed, like the Controller does", async () => {
    const broken: IntentProvider = { resolve: async () => ({ clauses: "nope" }) as never };
    const res = await createGridCueHandler({ provider: broken })(
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("PROVIDER_MALFORMED");
  });
});

describe("toNodeHandler", () => {
  const run = async (req: object) => {
    const sent: { status?: number; headers?: Record<string, string>; body?: string } = {};
    const res = {
      writableEnded: false,
      on: () => res,
      writeHead: (status: number, headers: Record<string, string>) => {
        Object.assign(sent, { status, headers });
        return res;
      },
      end: (body?: string) => {
        sent.body = body;
      },
    };
    const never: IntentProvider = { resolve: async () => ({ clauses: [] }) };
    await toNodeHandler(createGridCueHandler({ provider: never }), { maxBodyBytes: 64 })(
      { method: "POST", url: "/", headers: { "content-type": "application/json" }, [Symbol.asyncIterator]: async function* () {}, ...req },
      res,
    );
    return sent;
  };

  it("holds a body a framework already parsed to maxBodyBytes", async () => {
    const sent = await run({ body: { utterance: "x".repeat(200) } });
    expect(sent.status).toBe(413);
    expect(sent.headers?.["cache-control"]).toBe("no-store");
  });
});

describe("maxUtteranceLength", () => {
  it("can't exceed what the protocol accepts", () => {
    expect(() =>
      createGridCue({
        adapter: createRowsAdapter({ schema }),
        provider: { resolve: async () => ({ clauses: [] }) },
        maxUtteranceLength: 5000,
      }),
    ).toThrow("maxUtteranceLength can be at most 2000.");
  });
});
