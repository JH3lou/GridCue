import { HomeLayout } from "fumadocs-ui/layouts/home";
import { RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarList } from "@/components/ui/bar-list";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ComposedChart } from "@/components/ui/composed-chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDelta, formatNumber } from "@/lib/format";
import { baseOptions } from "@/lib/layout.shared";
import {
  type DayCount,
  FIRST_PUBLISHED,
  fetchDailyDownloads,
  fetchVersionDownloads,
  movingAverage,
  PACKAGE,
  summarize,
  totalsBy,
  type VersionCount,
  type WindowSummary,
  yesterdayUtc,
} from "@/lib/npm-downloads";
import { cn } from "@/lib/utils";

// Unlisted: no nav link, left out of the sitemap, and noindex (download stats grill, Q2).
export function meta() {
  return [{ title: "Downloads · GridCue admin" }, { name: "robots", content: "noindex, nofollow" }];
}

type Loaded<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

function useDownloads() {
  const [days, setDays] = useState<Loaded<DayCount[]>>({ status: "loading" });
  const [versions, setVersions] = useState<Loaded<VersionCount[]>>({ status: "loading" });
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    const current = () => request === latest.current;
    setRefreshing(true);
    const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
    // The two cards fail on their own, so a versions error never blanks the totals.
    await Promise.all([
      fetchDailyDownloads(PACKAGE, FIRST_PUBLISHED, yesterdayUtc()).then(
        (data) => current() && setDays({ status: "ready", data }),
        (error) => current() && setDays({ status: "error", message: message(error) }),
      ),
      fetchVersionDownloads(PACKAGE).then(
        (data) => current() && setVersions({ status: "ready", data }),
        (error) => current() && setVersions({ status: "error", message: message(error) }),
      ),
    ]);
    if (current()) {
      setUpdatedAt(new Date());
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      latest.current++;
    };
  }, [load]);

  return { days, versions, updatedAt, refreshing, refresh: load };
}

const count = (n: number) => formatNumber(n);
const utcDate = (day: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });

const panel = "gap-4 border-0 py-5 shadow-(--shadow-raised) ring-1 ring-border";

export default function AdminDownloads() {
  const { days, versions, updatedAt, refreshing, refresh } = useDownloads();
  const summary = useMemo(() => (days.status === "ready" ? summarize(days.data) : null), [days]);
  const week = summary?.windows[1];

  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-8 md:px-8 md:py-10">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-2">
          <div className="grid gap-1.5">
            <span className="w-fit rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
              Admin
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">Downloads</h1>
            <p className="text-sm text-pretty text-muted-foreground" aria-live="polite">
              {week ? finding(week) : days.status === "error" ? "Downloads are unavailable right now." : "Loading downloads from npm…"}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {updatedAt && summary?.lastDay && (
              <span className="tabular-nums">
                Updated {updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · data through{" "}
                {utcDate(summary.lastDay)} UTC
              </span>
            )}
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} className={press}>
              <RefreshCw className={cn(refreshing && "motion-safe:animate-spin")} strokeWidth={1.75} aria-hidden />
              {refreshing ? "Refreshing" : "Refresh"}
            </Button>
          </div>
        </header>

        {days.status === "error" ? (
          <Card className={panel}>
            <CardHeader className="px-5">
              <CardTitle>Couldn't load downloads from npm</CardTitle>
              <CardDescription>{days.message}</CardDescription>
            </CardHeader>
            <CardContent className="px-5">
              <Button size="sm" onClick={refresh} disabled={refreshing} className={press}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Kpis summary={summary} />
            <DailyChart days={days.status === "ready" ? days.data : null} />
          </>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Versions versions={versions} retry={refresh} />
          {days.status !== "error" && <Totals days={days.status === "ready" ? days.data : null} />}
        </div>
      </main>
    </HomeLayout>
  );
}

function finding({ current, delta }: WindowSummary) {
  const change = delta === null ? "" : `, ${formatDelta(delta)} on the 7 days before`;
  return `${count(current)} downloads in the last 7 days${change}.`;
}

const press = "transition-[scale,background-color,color] duration-(--duration-press) ease-(--ease-out) active:scale-[0.96]";

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)} />;
}

function Kpis({ summary }: { summary: ReturnType<typeof summarize> | null }) {
  const labels = ["Last day", "Last 7 days", "Last 30 days"];
  return (
    <section
      aria-label="Download totals"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border shadow-(--shadow-raised) ring-1 ring-border lg:grid-cols-4"
    >
      <Kpi label="All time" lead value={summary?.allTime}>
        since {utcDate(FIRST_PUBLISHED, { month: "short", day: "numeric", year: "numeric" })}
      </Kpi>
      {labels.map((label, i) => {
        const window = summary?.windows[i];
        return (
          <Kpi key={label} label={label} value={window?.current}>
            {window && <Delta window={window} />}
          </Kpi>
        );
      })}
    </section>
  );
}

function Kpi({ label, value, lead, children }: { label: string; value?: number; lead?: boolean; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1 bg-card p-5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {value === undefined ? (
        <Skeleton className={cn("my-1", lead ? "h-8 w-32" : "h-7 w-24")} />
      ) : (
        <span className={cn("font-semibold tracking-tight tabular-nums", lead ? "text-3xl" : "text-2xl")}>{count(value)}</span>
      )}
      <span className="min-h-4 text-xs text-muted-foreground">{value === undefined ? null : children}</span>
    </div>
  );
}

function Delta({ window: { days, delta } }: { window: WindowSummary }) {
  const period = days === 1 ? "prior day" : `prior ${days} days`;
  if (delta === null) return <>No {period} yet</>;
  const tone = delta > 0 ? "text-emerald-700 dark:text-emerald-400" : delta < 0 ? "text-red-700 dark:text-red-400" : "";
  return (
    <>
      <span className={cn("font-medium tabular-nums", tone)}>{formatDelta(delta)}</span> vs {period}
    </>
  );
}

const ranges = [
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "all", label: "All" },
];

function DailyChart({ days }: { days: DayCount[] | null }) {
  const [range, setRange] = useState("90");
  const rows = useMemo(() => {
    if (!days) return [];
    const average = movingAverage(
      days.map((d) => d.downloads),
      7,
    );
    const all = days.map((d, i) => ({ day: d.day, downloads: d.downloads, average: average[i] }));
    return range === "all" ? all : all.slice(-Number(range));
  }, [days, range]);

  return (
    <Card className={panel}>
      <CardHeader className="px-5">
        <CardTitle>Daily downloads</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px] bg-muted-foreground/35" /> Each day
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-3 rounded-full bg-(--chart-1)" /> 7-day average
          </span>
          <span>UTC</span>
        </CardDescription>
        <CardAction>
          <Segmented label="Date range" options={ranges} value={range} onChange={setRange} />
        </CardAction>
      </CardHeader>
      <CardContent className="px-3">
        {days ? (
          <ComposedChart
            data={rows}
            xKey="day"
            series={[
              {
                key: "downloads",
                label: "Downloads",
                type: "bar",
                color: "color-mix(in oklab, var(--muted-foreground) 35%, transparent)",
              },
              { key: "average", label: "7-day average", type: "line", curve: "linear", color: "var(--chart-1)" },
            ]}
            showYAxis
            animate={false}
            barRadius={2}
            yFormatter={count}
            className="h-64"
            role="img"
            aria-label={`Daily downloads, ${rows.length} days`}
          />
        ) : (
          <Skeleton className="mx-2 h-64" />
        )}
      </CardContent>
    </Card>
  );
}

function Versions({ versions, retry }: { versions: Loaded<VersionCount[]>; retry: () => void }) {
  const used = versions.status === "ready" ? versions.data.filter((v) => v.downloads > 0) : [];
  return (
    <Card className={panel}>
      <CardHeader className="px-5">
        <CardTitle>By version</CardTitle>
        <CardDescription className="text-xs">Last 7 days</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {versions.status === "loading" ? (
          <div className="grid gap-1.5">
            <Skeleton className="h-8" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : versions.status === "error" ? (
          <div className="grid justify-items-start gap-3 text-sm text-muted-foreground">
            <p>Couldn't load version counts: {versions.message}</p>
            <Button variant="outline" size="sm" onClick={retry} className={press}>
              Try again
            </Button>
          </div>
        ) : used.length === 0 ? (
          <p className="text-sm text-muted-foreground">No downloads in the last 7 days.</p>
        ) : (
          <BarList
            data={used.map((v) => ({ name: v.version, value: v.downloads }))}
            sortOrder="none"
            valueFormatter={count}
            showPercentage
            className="font-mono"
          />
        )}
      </CardContent>
      {used.length > 0 && (
        <CardFooter className="mt-auto justify-between px-5 text-xs text-muted-foreground">
          <span className="tabular-nums">{count(used.reduce((total, v) => total + v.downloads, 0))} in total</span>
          <a
            href={`https://www.npmjs.com/package/${PACKAGE}?activeTab=versions`}
            className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            All versions on npm
          </a>
        </CardFooter>
      )}
    </Card>
  );
}

const units = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

function Totals({ days }: { days: DayCount[] | null }) {
  const [unit, setUnit] = useState<"week" | "month">("week");
  const rows = useMemo(() => (days ? totalsBy(days, unit).slice(0, 6) : []), [days, unit]);
  const first = days?.[0]?.day ?? "";
  const name = (start: string) => (unit === "week" ? `Week of ${utcDate(start)}` : utcDate(start, { month: "long", year: "numeric" }));

  return (
    <Card className={panel}>
      <CardHeader className="px-5">
        <CardTitle>Totals</CardTitle>
        <CardDescription className="text-xs">{unit === "week" ? "Weeks start Monday, UTC" : "Calendar months, UTC"}</CardDescription>
        <CardAction>
          <Segmented label="Period" options={units} value={unit} onChange={setUnit} />
        </CardAction>
      </CardHeader>
      <CardContent className="px-3">
        {days ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-normal text-muted-foreground">Period</TableHead>
                <TableHead className="text-right font-normal text-muted-foreground">Downloads</TableHead>
                <TableHead className="text-right font-normal text-muted-foreground">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.start}>
                  <TableCell>
                    {name(row.start)}
                    {row.partial && (
                      <span className="text-muted-foreground">{row.start < first ? ` · from ${utcDate(first)}` : " · so far"}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{count(row.downloads)}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {row.delta === null ? "–" : formatDelta(row.delta)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="grid gap-2 px-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            press,
            "h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs",
          )}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
