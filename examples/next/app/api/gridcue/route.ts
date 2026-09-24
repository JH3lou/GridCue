import { wealthMockOptions } from "@gridcue-internal/wealth-fixtures";
import { createMockProvider } from "gridcue/mock";
import { createGridCueHandler, createJevProvider } from "gridcue/server";

const apiKey = process.env.JEV_API_KEY;

/** Jev when JEV_API_KEY is set on the server, the Mock Provider otherwise. The key never reaches the browser. */
export const POST = createGridCueHandler({
  provider: apiKey ? createJevProvider({ apiKey }) : createMockProvider(wealthMockOptions),
});
