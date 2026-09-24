import type { IncomingMessage, ServerResponse } from "node:http";
import type { GridCueHandler } from "./handler";

type NodeRequest = IncomingMessage & { body?: unknown; originalUrl?: string };

const readBody = async (req: NodeRequest, limit: number): Promise<string> => {
  if (req.body !== undefined) return typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw Object.assign(new Error("too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

/**
 * Wraps a Fetch-standard handler as a Node `(req, res)` listener.
 * Mounts in Express, Fastify, Connect, Vite's dev server, or `node:http`.
 */
export const toNodeHandler =
  (handler: GridCueHandler, { maxBodyBytes = 32_768 } = {}) =>
  async (req: NodeRequest, res: ServerResponse): Promise<void> => {
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    let body: string | undefined;
    try {
      body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req, maxBodyBytes);
    } catch {
      res
        .writeHead(413, { "content-type": "application/json" })
        .end(JSON.stringify({ error: { code: "INPUT_TOO_LARGE", message: "Request too large." } }));
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    const url = new URL(req.originalUrl ?? req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const response = await handler(
      new Request(url, { method: req.method ?? "POST", headers, ...(body === undefined ? {} : { body }), signal: controller.signal }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  };
