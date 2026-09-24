import type { Preview } from "gridcue";
import { APPLY_SHORTCUT } from "gridcue/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

/** Tactile press feedback for GridCue buttons (better-ui: scale 0.96 on press). */
export const PRESS = "active:not-disabled:scale-[0.96] motion-reduce:active:scale-100";

export interface PreviewPanelProps {
  preview: Preview;
  onApply: () => void;
  onCancel: () => void;
}

/** Shows exactly what a GridCue plan will change, with Apply and Cancel. */
export function PreviewPanel({ preview, onApply, onCancel }: PreviewPanelProps) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">This will change</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {preview.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-2 text-xs">No records will be changed.</p>
      </CardContent>
      <CardFooter className="gap-2 px-4">
        <Button size="sm" className={PRESS} aria-keyshortcuts={APPLY_SHORTCUT.aria} onClick={onApply}>
          Apply
        </Button>
        <Button size="sm" variant="outline" className={PRESS} onClick={onCancel}>
          Cancel
        </Button>
        <span aria-hidden="true" className="text-muted-foreground ml-auto text-xs">
          <kbd className="font-sans">{APPLY_SHORTCUT.label}</kbd>
        </span>
      </CardFooter>
    </Card>
  );
}
