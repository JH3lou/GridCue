import { GridCueError } from "./errors";
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
    if (!response.ok) throw new GridCueError("PROVIDER_FAILED", `The GridCue endpoint returned ${response.status}.`);
    const parsed = ResolutionResult.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new GridCueError("PROVIDER_MALFORMED", "The GridCue endpoint returned an unexpected response.");
    return parsed.data;
  },
});
