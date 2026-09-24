import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { defineSchema } from "../src/core/schema";
import { buildResolutionRequest, createRemoteProvider, emptyViewState, GridCueError, normalize } from "../src/index";
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

  it("answers 413 with INPUT_TOO_LARGE for a streamed body over maxBodyBytes, with no Content-Length", async () => {
    const url = await listen(toNodeHandler(handler, { maxBodyBytes: 1024 }));
    const { hostname, port, pathname } = new URL(url);
    const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        { hostname, port, path: pathname, method: "POST", headers: { "content-type": "application/json" } },
        (res) => {
          let received = "";
          res.on("data", (chunk) => {
            received += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: received }));
        },
      );
      req.on("error", reject);
      // No Content-Length is set, so Node sends this as a chunked request body, over several writes.
      expect(req.getHeader("content-length")).toBeUndefined();
      req.write("x".repeat(2000));
      req.write("x".repeat(2000));
      req.end();
    });
    expect(status).toBe(413);
    expect(JSON.parse(body)).toMatchObject({ error: { code: "INPUT_TOO_LARGE" } });
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

  it("passes through the handler's own error code, such as PROVIDER_TOO_COMPLEX", async () => {
    const tooComplex = createGridCueHandler({
      provider: {
        resolve: async () => {
          throw new GridCueError("PROVIDER_TOO_COMPLEX", "That request is too complex. Try a shorter one.");
        },
      },
    });
    const url = await listen(toNodeHandler(tooComplex));
    await expect(createRemoteProvider({ endpoint: url }).resolve(request)).rejects.toMatchObject({ code: "PROVIDER_TOO_COMPLEX" });
  });

  it("falls back to PROVIDER_FAILED for a body code that isn't a GridCue error code", async () => {
    const provider = createRemoteProvider({
      endpoint: "http://x",
      fetch: async () => new Response(JSON.stringify({ error: { code: "ECONNRESET", message: "connection reset" } }), { status: 500 }),
    });
    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
  });

  it("falls back to PROVIDER_FAILED when the body carries no code at all", async () => {
    const provider = createRemoteProvider({ endpoint: "http://x", fetch: async () => new Response(null, { status: 500 }) });
    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
  });

  it("never surfaces the server's own error message text to the caller", async () => {
    const provider = createRemoteProvider({
      endpoint: "http://x",
      fetch: async () =>
        new Response(JSON.stringify({ error: { code: "PROVIDER_TOO_COMPLEX", message: "internal detail nobody should see" } }), {
          status: 500,
        }),
    });
    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_TOO_COMPLEX" });
    try {
      await provider.resolve(request);
      throw new Error("expected resolve() to reject");
    } catch (error) {
      expect((error as Error).message).not.toContain("internal detail nobody should see");
    }
  });
});
