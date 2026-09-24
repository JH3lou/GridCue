import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { defineSchema } from "../src/core/schema";
import { buildResolutionRequest, createRemoteProvider, emptyViewState, normalize } from "../src/index";
import { createMockProvider } from "../src/mock";
import { createGridCueHandler, toNodeHandler } from "../src/server";

const schema = defineSchema([{ id: "value", kind: "number" }]);
const caps = { operations: ["sort.set", "filter.add"], supportsAtomicApply: true, supportsSnapshotRestore: true, observesChanges: true };
const request = buildResolutionRequest(normalize("sort by value"), schema, caps, emptyViewState(["value"]));
const handler = createGridCueHandler({ provider: createMockProvider() });
const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  handler(new Request("http://x/api/gridcue", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("createGridCueHandler", () => {
  it("resolves a valid request", async () => {
    const res = await post(request);
    expect(res.status).toBe(200);
    expect((await res.json()).clauses[0].families[0].id).toBe("sort");
  });

  it.each([
    ["wrong method", () => handler(new Request("http://x", { method: "GET" })), 405],
    ["not JSON", () => post("x", { "content-type": "text/plain" }), 415],
    ["malformed JSON", () => post("{nope"), 400],
    ["invalid shape", () => post({ hello: 1 }), 400],
    ["too large", () => post({ ...request, utterance: "x".repeat(40_000) }), 413],
  ])("rejects %s", async (_n, call, status) => {
    expect((await call()).status).toBe(status);
  });

  it("hides provider errors behind a stable code", async () => {
    const failing = createGridCueHandler({
      provider: {
        resolve: async () => {
          throw new Error("secret detail");
        },
      },
    });
    const res = await failing(
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }),
    );
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("secret detail");
  });
});

describe("toNodeHandler and createRemoteProvider", () => {
  let close: () => void = () => {};
  afterEach(() => close());

  const listen = async (app: Parameters<typeof createServer>[1]) => {
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    close = () => server.close();
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/gridcue`;
  };

  it("serves plain node:http", async () => {
    const url = await listen(toNodeHandler(handler));
    const result = await createRemoteProvider({ endpoint: url }).resolve(request);
    expect(result.clauses[0]?.families[0]?.id).toBe("sort");
  });

  it("serves Express, with or without a JSON body parser", async () => {
    const app = express();
    app.use(express.json());
    app.post("/api/gridcue", toNodeHandler(handler));
    const url = await listen(app);
    const result = await createRemoteProvider({ endpoint: url }).resolve(request);
    expect(result.clauses[0]?.families[0]?.id).toBe("sort");
  });

  it("reports endpoint failures with stable codes", async () => {
    const provider = createRemoteProvider({ endpoint: "http://x", fetch: async () => new Response("nope", { status: 500 }) });
    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
  });
});
