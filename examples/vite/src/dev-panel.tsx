import type { GridCueController } from "gridcue";
import { useGridCue } from "gridcue/react";

/** Shows the plan, confidence, and validation issues behind each request. For developers only. */
export function DevPanel({ controller }: { controller: GridCueController }) {
  const cue = useGridCue(controller);
  return (
    <details open className="bg-muted rounded-md p-3 text-xs">
      <summary className="cursor-pointer font-medium">
        Plan · status {cue.status} · confidence {cue.plan?.confidence?.toFixed(2) ?? "–"}
      </summary>
      <pre className="mt-2 max-h-80 overflow-auto">{JSON.stringify({ plan: cue.plan, issues: cue.issues }, null, 2)}</pre>
    </details>
  );
}
