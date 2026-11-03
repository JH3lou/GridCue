import { describe, expect, it } from "vitest";
import {
  addDays,
  chunkRanges,
  type DayCount,
  fetchDailyDownloads,
  fetchVersionDownloads,
  movingAverage,
  summarize,
  totalsBy,
} from "./npm-downloads";

const series = (start: string, counts: number[]): DayCount[] => counts.map((downloads, i) => ({ day: addDays(start, i), downloads }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("chunkRanges", () => {
  it("covers every day exactly once, in chunks of at most maxDays", () => {
    const chunks = chunkRanges("2020-01-01", "2026-11-02", 500);
    expect(chunks[0]?.[0]).toBe("2020-01-01");
    expect(chunks.at(-1)?.[1]).toBe("2026-11-02");
    for (const [i, [from, to]] of chunks.entries()) {
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
      expect(days).toBeLessThanOrEqual(500);
      if (i > 0) expect(from).toBe(addDays(chunks[i - 1]?.[1] ?? "", 1));
    }
  });

  it("returns one chunk for a single day and none for an empty range", () => {
    expect(chunkRanges("2026-09-25", "2026-09-25")).toEqual([["2026-09-25", "2026-09-25"]]);
    expect(chunkRanges("2026-09-26", "2026-09-25")).toEqual([]);
  });
});

describe("fetchDailyDownloads", () => {
  it("requests each chunk once and concatenates the days in order", async () => {
    const urls: string[] = [];
    const fetch = async (url: string | URL | Request) => {
      urls.push(String(url));
      const [from, to] = String(url).split("/range/")[1]?.split("/")[0]?.split(":") ?? [];
      return json({ downloads: [{ day: from, downloads: 1 }, ...(from === to ? [] : [{ day: to, downloads: 2 }])] });
    };
    const days = await fetchDailyDownloads("gridcue", "2024-01-01", "2026-01-01", { fetch, retryDelayMs: 0 });
    expect(urls).toEqual([
      "https://api.npmjs.org/downloads/range/2024-01-01:2025-05-14/gridcue",
      "https://api.npmjs.org/downloads/range/2025-05-15:2026-01-01/gridcue",
    ]);
    expect(days.map((d) => d.day)).toEqual(["2024-01-01", "2025-05-14", "2025-05-15", "2026-01-01"]);
  });

  it("retries a 429 and a 5xx, then succeeds", async () => {
    const statuses = [429, 503];
    const fetch = async () => {
      const status = statuses.shift();
      return status ? json({ error: "busy" }, status) : json({ downloads: [{ day: "2026-10-01", downloads: 5 }] });
    };
    const days = await fetchDailyDownloads("gridcue", "2026-10-01", "2026-10-01", { fetch, retryDelayMs: 0 });
    expect(days).toEqual([{ day: "2026-10-01", downloads: 5 }]);
  });

  it("gives up after three retries, and does not retry a 404", async () => {
    let calls = 0;
    const busy = async () => {
      calls++;
      return json({ error: "busy" }, 429);
    };
    await expect(fetchDailyDownloads("gridcue", "2026-10-01", "2026-10-01", { fetch: busy, retryDelayMs: 0 })).rejects.toThrow("429");
    expect(calls).toBe(4);

    calls = 0;
    const missing = async () => {
      calls++;
      return json({ error: "not found" }, 404);
    };
    await expect(fetchDailyDownloads("gridcue", "2026-10-01", "2026-10-01", { fetch: missing, retryDelayMs: 0 })).rejects.toThrow("404");
    expect(calls).toBe(1);
  });

  it("rejects a response that is not a list of days", async () => {
    const fetch = async () => json({ downloads: [{ day: "yesterday", downloads: "12" }] });
    await expect(fetchDailyDownloads("gridcue", "2026-10-01", "2026-10-01", { fetch })).rejects.toThrow("Unexpected response");
  });
});

describe("fetchVersionDownloads", () => {
  it("returns versions newest first", async () => {
    const fetch = async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://api.npmjs.org/versions/gridcue/last-week");
      return json({ package: "gridcue", downloads: { "0.9.0": 4, "1.0.0-rc.1": 2, "0.10.0": 20, "1.0.0": 9, "0.2.0": 1 } });
    };
    expect(await fetchVersionDownloads("gridcue", { fetch })).toEqual([
      { version: "1.0.0", downloads: 9 },
      { version: "1.0.0-rc.1", downloads: 2 },
      { version: "0.10.0", downloads: 20 },
      { version: "0.9.0", downloads: 4 },
      { version: "0.2.0", downloads: 1 },
    ]);
  });

  it("rejects a malformed response", async () => {
    const fetch = async () => json({ downloads: { "0.1.0": "many" } });
    await expect(fetchVersionDownloads("gridcue", { fetch })).rejects.toThrow("Unexpected response");
  });
});

describe("summarize", () => {
  it("compares each window with the one before it", () => {
    // 14 days: the first week 10 a day, the second week 20 a day, the last day 30.
    const days = series("2026-10-01", [...Array(7).fill(10), ...Array(6).fill(20), 30]);
    const summary = summarize(days);
    expect(summary.allTime).toBe(70 + 120 + 30);
    expect(summary.lastDay).toBe("2026-10-14");
    expect(summary.windows[0]).toEqual({ days: 1, current: 30, previous: 20, delta: 0.5 });
    expect(summary.windows[1]).toEqual({ days: 7, current: 150, previous: 70, delta: 80 / 70 });
  });

  it("has no delta when the previous window reaches before the first day or is zero", () => {
    const summary = summarize(series("2026-10-01", [0, 0, 5, 5, 5, 5, 5, 5]));
    expect(summary.windows[2]).toMatchObject({ days: 30, current: 30, delta: null });
    expect(summarize(series("2026-10-01", [0, 4])).windows[0]).toEqual({ days: 1, current: 4, previous: 0, delta: null });
    expect(summarize(series("2026-10-01", [4])).windows[0]).toEqual({ days: 1, current: 4, previous: null, delta: null });
  });

  it("handles no data", () => {
    expect(summarize([])).toEqual({
      allTime: 0,
      lastDay: null,
      windows: [1, 7, 30].map((days) => ({ days, current: 0, previous: null, delta: null })),
    });
  });
});

describe("totalsBy", () => {
  it("groups by Monday-start weeks across a year boundary, newest first", () => {
    // 2026-12-28 is a Monday. Data runs Sunday 2026-12-27 to Tuesday 2027-01-12.
    const days = series("2026-12-27", Array(17).fill(1));
    expect(totalsBy(days, "week")).toEqual([
      { start: "2027-01-11", downloads: 2, delta: null, partial: true },
      { start: "2027-01-04", downloads: 7, delta: 0, partial: false },
      { start: "2026-12-28", downloads: 7, delta: null, partial: false },
      { start: "2026-12-21", downloads: 1, delta: null, partial: true },
    ]);
  });

  it("groups by calendar month", () => {
    const days = series("2026-09-25", Array(40).fill(2));
    expect(totalsBy(days, "month")).toEqual([
      { start: "2026-11-01", downloads: 6, delta: null, partial: true },
      { start: "2026-10-01", downloads: 62, delta: null, partial: false },
      { start: "2026-09-01", downloads: 12, delta: null, partial: true },
    ]);
  });
});

describe("movingAverage", () => {
  it("averages the trailing window, using what exists at the start", () => {
    expect(movingAverage([7, 1, 1, 1], 3)).toEqual([7, 4, 3, 1]);
  });
});
