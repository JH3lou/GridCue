/**
 * The fixed clock and Calendar the date cases run with (named filters spec, 5.5), declared by the lead before any case
 * was labelled. A case with `"clock": true` runs at this instant with this Calendar on its schema, so today is
 * 2026-11-13 in New York, the spec's own example day, and the year starts in January. They live here, not in the
 * fixtures, so no other case sees them: a case without the field runs with no Calendar and the default clock.
 *
 * Only the ledger schema's cases are labelled on them: its Booked column holds dates and its Posted at column dates and
 * times. The check that a Calendar changes nothing old (`evals/calendar.test.ts`) also runs every other case, on any
 * schema, with this Calendar and this clock (`RunOptions.calendar` in `evals/run.ts`).
 */
export const EVAL_NOW = "2026-11-13T15:00:00.000Z";

/** The clock a `clock` case's Controller is given: a new `Date` at the fixed instant on every call. */
export const evalNow = (): Date => new Date(EVAL_NOW);

/** The Calendar a `clock` case's schema declares: the Host's time zone and the first month of its year. */
export interface EvalCalendar {
  timeZone: string;
  fiscalYearStart: number;
}

export const EVAL_CALENDAR: EvalCalendar = { timeZone: "America/New_York", fiscalYearStart: 1 };

/**
 * The clock and Calendar a case runs with: the fixed ones when it says `clock: true`, else none. It throws for a
 * schema other than the ledger's, which is the only one the date cases were labelled on.
 */
export const clockFor = (c: { clock?: boolean; schema?: string }): { now: () => Date; calendar: EvalCalendar } | undefined => {
  if (!c.clock) return undefined;
  if (c.schema !== "ledger") throw new Error(`The fixed clock is declared for the ledger schema only, not "${c.schema ?? "wealth"}".`);
  return { now: evalNow, calendar: EVAL_CALENDAR };
};
