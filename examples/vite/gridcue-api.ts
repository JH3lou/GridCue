import { wealthMockOptions } from "@gridcue-internal/wealth-fixtures";
import { createMockProvider } from "gridcue/mock";
import { createGridCueHandler, createJevProvider, toNodeHandler } from "gridcue/server";

/** Uses Jev when JEV_API_KEY is set on the server, and the Mock Provider otherwise. The key never reaches the browser. */
export const gridcueApi = (env: Record<string, string | undefined>) => {
  const provider = env.JEV_API_KEY ? createJevProvider({ apiKey: env.JEV_API_KEY }) : createMockProvider(wealthMockOptions);
  return { providerName: env.JEV_API_KEY ? "jev" : "mock", listener: toNodeHandler(createGridCueHandler({ provider })) };
};
