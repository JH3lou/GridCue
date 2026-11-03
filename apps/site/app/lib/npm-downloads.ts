// npm download counts for the admin dashboard, fetched in the browser from npm's public API.
// npm silently cuts a download range at about 18 months, so long histories are fetched in chunks
// (https://tanstack.com/blog/npm-stats-the-right-way). Dates are UTC days, as npm counts them.

export const PACKAGE = "gridcue";
export const FIRST_PUBLISHED = "2026-09-25";
const API = "https://api.npmjs.org";
const DAY_MS = 86_400_000;

export interface DayCount {
  day: string;
  downloads: number;
}
export interface WindowSummary {
  days: number;
  current: number;
  /** Null when the data doesn't yet reach back a full previous window. */
  previous: number | null;
  /** Change as a fraction, or null when there is no previous window or it had no downloads. */
  delta: number | null;
}
export interface PeriodTotal {
  start: string;
  downloads: number;
  delta: number | null;
  /** The period is cut short by the first or last day of data. */
  partial: boolean;
}
export interface VersionCount {
  version: string;
  downloads: number;
}
interface FetchOptions {
  fetch?: (url: string) => Promise<Response>;
  retryDelayMs?: number;
}

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** npm publishes a day's counts after the day ends, so yesterday is the last full day. */
export const yesterdayUtc = (now = new Date()) => addDays(now.toISOString().slice(0, 10), -1);

/** Inclusive [from, to] ranges of at most maxDays. Each starts the day after the last ends, so no day counts twice. */
export function chunkRanges(start: string, end: string, maxDays = 500): [string, string][] {
  const chunks: [string, string][] = [];
  for (let from = start; from <= end; ) {
    const last = addDays(from, maxDays - 1);
    const to = last < end ? last : end;
    chunks.push([from, to]);
    from = addDays(to, 1);
  }
  return chunks;
}

async function getJson(url: string, { fetch: get = fetch, retryDelayMs = 1000 }: FetchOptions): Promise<unknown> {
  for (let retry = 0; ; retry++) {
    const response = await get(url);
    if (response.ok) return response.json();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || retry === 3) throw new Error(`npm responded ${response.status} for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs * 2 ** retry));
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isDayCount = (value: unknown): value is DayCount =>
  isRecord(value) && typeof value.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.day) && Number.isFinite(value.downloads);

export async function fetchDailyDownloads(pkg: string, start: string, end: string, options: FetchOptions = {}): Promise<DayCount[]> {
  const days: DayCount[] = [];
  // One chunk at a time: npm rate-limits bursts.
  for (const [from, to] of chunkRanges(start, end)) {
    const body = await getJson(`${API}/downloads/range/${from}:${to}/${pkg}`, options);
    if (!isRecord(body) || !Array.isArray(body.downloads) || !body.downloads.every(isDayCount)) {
      throw new Error(`Unexpected response from npm for ${from}:${to}`);
    }
    days.push(...body.downloads);
  }
  return days;
}

/** Downloads per version over the last 7 days, newest version first. */
export async function fetchVersionDownloads(pkg: string, options: FetchOptions = {}): Promise<VersionCount[]> {
  const body = await getJson(`${API}/versions/${pkg}/last-week`, options);
  const counts = isRecord(body) && isRecord(body.downloads) ? Object.entries(body.downloads) : null;
  if (!counts?.every(([, n]) => Number.isFinite(n))) throw new Error("Unexpected response from npm for versions");
  return (
    counts
      .map(([version, downloads]) => ({ version, downloads: downloads as number }))
      // A prerelease sorts below its release: compare the release part first, then "no prerelease" wins.
      .sort(
        (a, b) =>
          b.version.split("-")[0].localeCompare(a.version.split("-")[0], "en", { numeric: true }) ||
          Number(!b.version.includes("-")) - Number(!a.version.includes("-")) ||
          b.version.localeCompare(a.version, "en", { numeric: true }),
      )
  );
}

const sum = (values: number[]) => values.reduce((total, n) => total + n, 0);

/** All-time total, and the last 1, 7 and 30 days against the window before each. Expects one entry per day. */
export function summarize(days: DayCount[]) {
  const values = days.map((d) => d.downloads);
  const n = values.length;
  return {
    allTime: sum(values),
    lastDay: days.at(-1)?.day ?? null,
    windows: [1, 7, 30].map((size): WindowSummary => {
      const current = sum(values.slice(Math.max(n - size, 0)));
      const previous = n >= 2 * size ? sum(values.slice(n - 2 * size, n - size)) : null;
      return { days: size, current, previous, delta: previous ? (current - previous) / previous : null };
    }),
  };
}

function periodBounds(day: string, unit: "week" | "month"): [string, string] {
  if (unit === "week") {
    const start = addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
    return [start, addDays(start, 6)];
  }
  const next = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return [`${day.slice(0, 7)}-01`, addDays(next.toISOString().slice(0, 10), -1)];
}

/** Totals per Monday-start week or calendar month, newest first. Partial periods get no delta, nor does the period after one. */
export function totalsBy(days: DayCount[], unit: "week" | "month"): PeriodTotal[] {
  const first = days[0]?.day ?? "";
  const last = days.at(-1)?.day ?? "";
  const rows: PeriodTotal[] = [];
  for (const { day, downloads } of days) {
    const [start, end] = periodBounds(day, unit);
    const row = rows.at(-1);
    if (row?.start === start) row.downloads += downloads;
    else rows.push({ start, downloads, delta: null, partial: start < first || end > last });
  }
  for (const [i, row] of rows.entries()) {
    const before = rows[i - 1];
    if (before && !before.partial && !row.partial && before.downloads > 0) {
      row.delta = (row.downloads - before.downloads) / before.downloads;
    }
  }
  return rows.reverse();
}

/** Trailing average; the first window-1 points average the values that exist before them. */
export function movingAverage(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return sum(slice) / slice.length;
  });
}
