import { useState } from "react";

/** Recorded by `pnpm eval:record` (evals/record.ts) (Site spec §5.3). */
export interface StrategyRuns {
  recordedAt: string;
  model: string;
  requests: Array<{
    utterance: string;
    /** The view the request starts from, when it builds on one: "sorted by Advisor". */
    start?: string;
    runs: Array<{
      strategy: "focused" | "fan-out" | "mock";
      status: string;
      preview: string[];
      message?: string;
      questions?: number;
      latencyMs?: number;
    }>;
  }>;
}

const recorded = Object.values(import.meta.glob<StrategyRuns>("../../data/strategy-runs.json", { eager: true, import: "default" }))[0];

const LABEL = { focused: "Jev · focused", "fan-out": "Jev · fan-out", mock: "Mock Provider" } as const;

export function CompareStrategies() {
  // Open on the first request where the strategies disagree: that is what this tab is for.
  const [index, setIndex] = useState(() =>
    Math.max(0, recorded?.requests.findIndex((r) => new Set(r.runs.map((run) => `${run.status}|${run.preview.join()}`)).size > 1) ?? 0),
  );
  if (!recorded) {
    return <p className="text-muted-foreground text-sm">No recorded runs yet. Run `pnpm eval:record` locally to create them.</p>;
  }
  const request = recorded.requests[index];
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground max-w-3xl text-sm">
        Recorded from live Jev ({recorded.model}) on {recorded.recordedAt}, for the same request under each strategy. The live demo runs on
        the Mock Provider; no key is used on this site.
      </p>
      <label className="grid max-w-xl gap-1 text-sm">
        <span className="font-medium">Request</span>
        <select value={index} onChange={(e) => setIndex(Number(e.target.value))} className="bg-background h-10 rounded-md border px-3">
          {recorded.requests.map((r, i) => (
            <option key={r.utterance} value={i}>
              {r.start ? `${r.utterance} (from a view ${r.start})` : r.utterance}
            </option>
          ))}
        </select>
      </label>
      {request?.start && (
        <p className="text-muted-foreground text-sm">
          Starting from a view <span className="text-foreground">{request.start}</span>.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {request?.runs.map((run) => (
          <div key={run.strategy} className="bg-card grid content-start gap-3 rounded-xl p-5 shadow-[var(--shadow-raised)]">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">{LABEL[run.strategy]}</h3>
              <span className="text-muted-foreground text-xs tabular-nums">
                {run.questions !== undefined ? `${run.questions} questions · ` : ""}
                {run.latencyMs !== undefined ? `${run.latencyMs} ms` : "in browser"}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">{run.status.replace("_", " ")}</p>
            {run.preview.length > 0 ? (
              <ul className="grid gap-1 text-sm">
                {run.preview.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">{run.message ?? "No change proposed."}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
