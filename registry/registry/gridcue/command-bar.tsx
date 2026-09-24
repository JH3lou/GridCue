import type { GridCueController } from "gridcue";
import { STATUS_LABEL, useGridCue } from "gridcue/react";
import { type FormEvent, useId, useRef, useState } from "react";
import { ClarificationPrompt } from "@/components/gridcue/clarification-prompt";
import { PRESS, PreviewPanel } from "@/components/gridcue/preview-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface CommandBarProps {
  controller: GridCueController;
  label?: string;
  placeholder?: string;
}

/** GridCue's command bar built on shadcn/ui. You own this file: restyle it freely. */
export function CommandBar({
  controller,
  label = "Describe the view you want",
  placeholder = "e.g. taxable accounts over $1M, largest first",
}: CommandBarProps) {
  const cue = useGridCue(controller);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const busy = cue.status === "resolving" || cue.status === "applying";
  const clarification = cue.status === "needs_clarification" ? cue.plan?.clarifications[0] : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void cue.propose(text);
  };

  return (
    <section aria-label="GridCue" aria-busy={busy} className="grid gap-3">
      <form onSubmit={submit} className="grid gap-1.5">
        <label htmlFor={`${id}-input`} className="text-sm font-medium">
          {label}
        </label>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            id={`${id}-input`}
            value={text}
            placeholder={placeholder}
            autoComplete="off"
            aria-describedby={`${id}-status`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={cue.onInputKeyDown}
          />
          <Button type="submit" disabled={busy || !text.trim()} className={PRESS}>
            Preview
          </Button>
        </div>
      </form>

      <div id={`${id}-status`} role="status" aria-live="polite" className="text-muted-foreground flex min-h-5 items-center gap-2 text-sm">
        {STATUS_LABEL[cue.status] && (
          <Badge variant={cue.status === "error" || cue.status === "unsupported" ? "destructive" : "secondary"}>
            {STATUS_LABEL[cue.status]}
          </Badge>
        )}
        {cue.message && <span>{cue.message}</span>}
      </div>

      {cue.status === "ready" && cue.preview && (
        <PreviewPanel preview={cue.preview} onApply={() => void cue.apply()} onCancel={cue.cancel} />
      )}
      {clarification && <ClarificationPrompt clarification={clarification} onAnswer={cue.answer} />}

      <div className="flex gap-2">
        {(cue.status === "unsupported" || cue.status === "error" || cue.status === "needs_clarification") && (
          <Button size="sm" variant="outline" className={PRESS} onClick={() => inputRef.current?.focus()}>
            Edit request
          </Button>
        )}
        {cue.canUndo && (
          <Button size="sm" variant="outline" className={PRESS} onClick={() => void cue.undo()}>
            Undo
          </Button>
        )}
      </div>
    </section>
  );
}
