import { GridCueError, type GridCueErrorCode } from "./errors";
import { type IntentProvider, ResolutionResult } from "./resolution";

export interface RemoteProviderOptions {
  /** The Host's Server Handler URL, such as "/api/gridcue". */
  endpoint: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

/** Calls a Host's Server Handler, so the browser never holds a provider key. */
export const createRemoteProvider = (options: RemoteProviderOptions): IntentProvider => ({
  async resolve(request, signal) {
    const doFetch = options.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await doFetch(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new GridCueError("PROVIDER_UNREACHABLE", "Couldn't reach the GridCue endpoint.");
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      // Reuse the handler's own stable code (never its message text, which may hold detail meant for the
      // Host's own logs) so a specific failure, such as PROVIDER_TOO_COMPLEX, isn't flattened into a generic one.
      if (typeof code === "string" && /^(PROVIDER|INPUT)_[A-Z_]+$/.test(code)) {
        throw new GridCueError(code as GridCueErrorCode, `The GridCue endpoint returned ${response.status}.`);
      }
      throw new GridCueError("PROVIDER_FAILED", `The GridCue endpoint returned ${response.status}.`);
    }
    const parsed = ResolutionResult.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new GridCueError("PROVIDER_MALFORMED", "The GridCue endpoint returned an unexpected response.");
    return parsed.data;
  },
});
