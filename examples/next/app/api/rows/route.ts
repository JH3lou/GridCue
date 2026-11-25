// THE HOST'S CODE, NOT GRIDCUE'S: the server side of the paged example. It runs only on the server.
import type { DatabaseSync } from "node:sqlite";
import { generateAccounts, wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { ViewState } from "gridcue";
import { DataQueryError, openRowsDatabase, readRows } from "./query";

let database: DatabaseSync | undefined;

/** The synthetic wealth rows in an in-memory SQLite database, loaded on the first request and kept. */
const rowsDatabase = (): DatabaseSync => {
  database ??= openRowsDatabase(wealthSchema, generateAccounts());
  return database;
};

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

/**
 * POST `{ state, page: { offset, size } }`, where `state` is the Query Adapter's View State. Answers
 * `{ rows, total }`: the page's rows, without the restricted column, and how many rows the whole view has. Anything
 * that is not a View State this schema can carry out, or a page out of range, is a 400.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("The body must be JSON.");
  }
  if (typeof body !== "object" || body === null) return badRequest("The body must be { state, page }.");
  const { state, page } = body as { state?: unknown; page?: unknown };
  let parsed: ReturnType<typeof ViewState.safeParse>;
  try {
    parsed = ViewState.safeParse(state);
  } catch {
    // A View State nested too deep to read at all: the parser runs out of stack.
    return badRequest("state is nested too deep to read.");
  }
  if (!parsed.success) return badRequest("state must be a View State.");
  try {
    return Response.json(readRows(rowsDatabase(), wealthSchema, parsed.data, page as { offset: number; size: number }));
  } catch (error) {
    if (error instanceof DataQueryError) return badRequest(error.message);
    throw error;
  }
}
