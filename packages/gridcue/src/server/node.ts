import type { GridCueHandler } from "./handler";

// Structural types for Node's `IncomingMessage` and `ServerResponse`, so the published types don't need
// `@types/node`: a Workers-only project that never calls this still typechecks (pre-launch fix).
interface NodeRequest extends AsyncIterable<Uint8Array | string> {
  method?: string | undefined;
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  originalUrl?: string;
}
interface NodeResponse {
  readonly writableEnded: boolean;
  on(event: "close", listener: () => void): unknown;
  writeHead(status: number, headers: Record<string, string>): NodeResponse;
  end(body?: string): unknown;
}

const readBody = async (req: NodeRequest, limit: number): Promise<string> => {
  const tooLarge = () => Object.assign(new Error("too large"), { status: 413 });
  // A body a framework already parsed is held to the same limit once serialized again.
  if (req.body !== undefined) {
    const text = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (new TextEncoder().encode(text).length > limit) throw tooLarge();
    return text;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    size += bytes.length;
    if (size > limit) throw tooLarge();
    chunks.push(bytes);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const bytes of chunks) {
    all.set(bytes, at);
    at += bytes.length;
  }
  return new TextDecoder().decode(all);
};

/**
 * Wraps a Fetch-standard handler as a Node `(req, res)` listener.
 * Mounts in Express, Fastify, Connect, Vite's dev server, or `node:http`.
 */
export const toNodeHandler =
  (handler: GridCueHandler, { maxBodyBytes = 32_768 } = {}) =>
  async (req: NodeRequest, res: NodeResponse): Promise<void> => {
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    let body: string | undefined;
    try {
      body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req, maxBodyBytes);
    } catch {
      res
        .writeHead(413, { "content-type": "application/json", "cache-control": "no-store" })
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
