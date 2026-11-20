/**
 * Runs the Query Check against a Data Query module shaped like query.ts, for the tests beside it. Test code only.
 */
import { createQueryAdapter, type ViewSchema } from "gridcue";
import { queryCheck } from "gridcue/testing";
import type { openRowsDatabase, readRows } from "./query";

/** What the run needs from a Data Query: query.ts itself, or a wrong copy of it (query-mutants.ts). */
export interface DataQueryModule {
  openRowsDatabase: typeof openRowsDatabase;
  readRows: typeof readRows;
}

export interface Failure {
  /** The failing case's name: the rule it tests, then the view in plain words. */
  name: string;
  message: string;
}

/**
 * Runs every case of the Query Check through `query`, on the check's synthetic rows in an in-memory database. It reads
 * each case twice: in one page, and in pages of 7, so a count cut after paging fails too. Returns what failed.
 */
export const runQueryCheck = (schema: ViewSchema, id: string, query: DataQueryModule): { cases: number; failures: Failure[] } => {
  // A Query Adapter with countBeforePaging lists limit.set, so the check has its count cases.
  const operations = createQueryAdapter({ schema, countBeforePaging: true }).getCapabilities().operations;
  const check = queryCheck(schema, { id, operations });
  const db = query.openRowsDatabase(schema, check.rows);
  const failures: Failure[] = [];
  const fail = (name: string, message: string) => failures.push({ name, message });
  try {
    for (const c of check.cases) {
      const whole = query.readRows(db, schema, c.state, { offset: 0, size: check.rows.length });
      const result = c.compare(whole.rows.map((row) => row[id] as string | number));
      if (!result.ok) fail(c.name, result.message);
      if (whole.total !== whole.rows.length) fail(c.name, `${c.name}: total is ${whole.total}, ${whole.rows.length} rows came back`);

      const paged: Array<string | number> = [];
      for (let offset = 0; offset < whole.total + 7; offset += 7) {
        const page = query.readRows(db, schema, c.state, { offset, size: 7 });
        if (page.total !== whole.total) fail(c.name, `${c.name}: the total changed from page to page`);
        paged.push(...page.rows.map((row) => row[id] as string | number));
      }
      const byPage = c.compare(paged);
      if (!byPage.ok) fail(c.name, `in pages of 7, ${byPage.message}`);
    }
  } finally {
    db.close();
  }
  return { cases: check.cases.length, failures };
};
