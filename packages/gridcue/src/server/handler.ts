import { type IntentProvider, isGridCueError, ResolutionRequest, ResolutionResult } from "../index";

export interface HandlerOptions {
  provider: IntentProvider;
  /** Largest accepted request body, in bytes. Default 32 KB. */
  maxBodyBytes?: number;
}

export type GridCueHandler = (request: Request) => Promise<Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

/**
 * A Fetch-standard endpoint that resolves requests with a server-side provider.
 * It never logs requests, payloads, or keys.
 */
export const createGridCueHandler =
  ({ provider, maxBodyBytes = 32_768 }: HandlerOptions): GridCueHandler =>
  async (request) => {
    if (request.method !== "POST") return fail(405, "INPUT_METHOD", "Use POST.");
    if (!request.headers.get("content-type")?.includes("application/json")) return fail(415, "INPUT_CONTENT_TYPE", "Send JSON.");
    const body = await request.text();
    if (new TextEncoder().encode(body).length > maxBodyBytes) return fail(413, "INPUT_TOO_LARGE", "Request too large.");
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return fail(400, "INPUT_INVALID", "Malformed JSON.");
    }
    const parsed = ResolutionRequest.safeParse(data);
    if (!parsed.success) return fail(400, "INPUT_INVALID", "Invalid resolution request.");
    try {
      const result = ResolutionResult.parse(await provider.resolve(parsed.data, request.signal));
      return json(200, result);
    } catch (error) {
      const code = isGridCueError(error) && error.code.startsWith("PROVIDER_") ? error.code : "PROVIDER_FAILED";
      return fail(502, code, "The intent provider failed.");
    }
  };
