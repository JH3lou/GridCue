import type { GridCueController } from "gridcue";
import { useGridCue } from "gridcue/react";
import { useState } from "react";
import type { LastRequest } from "./use-wealth-demo";

const TABS = ["Plan", "Evidence", "Sent to the provider", "View state"] as const;
type Tab = (typeof TABS)[number];

/**
 * What GridCue decided and why, for developers evaluating it. Collapsed by default (Site spec §2): the core loop
 * of ask, preview, apply comes first.
 */
export function DevPanel({ controller, last, viewState }: { controller: GridCueController; last: LastRequest; viewState: () => unknown }) {
  const cue = useGridCue(controller);
  const [tab, setTab] = useState<Tab>("Plan");
  const plan = cue.plan;
  const body: unknown =
    tab === "Plan"
      ? plan
        ? { status: plan.status, confidence: plan.confidence, operations: plan.operations, clarifications: plan.clarifications }
        : "Ask something first."
      : tab === "Evidence"
        ? (plan?.evidence ?? "Ask something first.")
        : tab === "Sent to the provider"
          ? last.request
            ? {
                note: "Column names, kinds, aliases and approved values only. No rows are ever sent.",
                utterance: last.request.utterance,
                clauses: last.request.clauses,
                columns: last.request.candidates.columns.map((c) => ({ id: c.id, label: c.label, kind: c.kind })),
              }
            : "Ask something first."
          : viewState();

  return (
    <details className="rounded-lg bg-muted/50 text-xs shadow-[var(--shadow-raised)]">
      <summary className="cursor-pointer px-3 py-2 font-medium">
        Developer panel · {cue.status}
        {plan?.confidence !== undefined ? ` · confidence ${plan.confidence.toFixed(2)}` : ""}
      </summary>
      <div className="grid gap-2 px-3 pb-3">
        <div role="tablist" aria-label="Developer panel" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md px-2 py-1 ${tab === t ? "bg-background text-foreground shadow-[var(--shadow-raised)]" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <pre role="tabpanel" className="bg-background max-h-80 overflow-auto rounded-md p-3 leading-relaxed">
          {typeof body === "string" ? body : JSON.stringify(body, null, 2)}
        </pre>
      </div>
    </details>
  );
}
