import type { GridCueController } from "gridcue";
import { STATUS_LABEL, useGridCue } from "gridcue/react";
import { type FormEvent, useId, useRef, useState } from "react";
import { ClarificationPrompt } from "@/components/gridcue/clarification-prompt";
import { PreviewPanel } from "@/components/gridcue/preview-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface Suggestion {
  label: string;
  /** A suggestion that shows GridCue refusing, such as a request to trade. */
  refusal?: boolean;
}

/**
 * The Site's request bar: the registry's command bar, composed from its PreviewPanel and ClarificationPrompt parts,
 * with suggestion chips that fill the input. Hosts build the same thing from the same parts.
 */
export function AskBar({
  controller,
  suggestions = [],
  placeholder = "e.g. taxable accounts over $1M, biggest concentration first",
}: {
  controller: GridCueController;
  suggestions?: Suggestion[];
  placeholder?: string;
}) {
  const cue = useGridCue(controller);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const busy = cue.status === "resolving" || cue.status === "applying";
  const clarification = cue.status === "needs_clarification" ? cue.plan?.clarifications[0] : undefined;

  const ask = (value: string) => {
    setText(value);
    void cue.propose(value);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void cue.propose(text);
  };

  return (
    <section aria-label="Ask the grid" aria-busy={busy} className="grid gap-3">
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor={`${id}-input`} className="sr-only">
          Describe the view you want
        </label>
        <Input
          ref={inputRef}
          id={`${id}-input`}
          value={text}
          placeholder={placeholder}
          autoComplete="off"
          aria-describedby={`${id}-status`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={cue.onInputKeyDown}
          className="h-10 bg-background"
        />
        <Button type="submit" disabled={busy || !text.trim()} className="press h-10">
          Preview
        </Button>
      </form>

      {suggestions.length > 0 && (
        <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">Try one of these</legend>
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => ask(s.label)}
              className={`press rounded-full border px-3 py-1 text-xs transition-colors duration-150 ${
                s.refusal ? "text-destructive border-destructive/30" : "text-muted-foreground"
              } hover:text-foreground`}
            >
              {s.label}
            </button>
          ))}
        </fieldset>
      )}

      <div id={`${id}-status`} role="status" aria-live="polite" className="text-muted-foreground flex min-h-5 items-center gap-2 text-sm">
        {STATUS_LABEL[cue.status] && (
          <Badge variant={cue.status === "error" || cue.status === "unsupported" ? "destructive" : "secondary"}>
            {STATUS_LABEL[cue.status]}
          </Badge>
        )}
        {cue.message && <span>{cue.message}</span>}
      </div>

      {cue.status === "ready" && cue.preview && (
        <div className="preview-enter">
          <PreviewPanel preview={cue.preview} onApply={() => void cue.apply()} onCancel={cue.cancel} />
        </div>
      )}
      {clarification && <ClarificationPrompt clarification={clarification} onAnswer={cue.answer} />}

      <div className="flex gap-2 empty:hidden">
        {(cue.status === "unsupported" || cue.status === "error" || cue.status === "needs_clarification") && (
          <Button size="sm" variant="outline" className="press" onClick={() => inputRef.current?.focus()}>
            Edit request
          </Button>
        )}
        {cue.canUndo && (
          <Button size="sm" variant="outline" className="press" onClick={() => void cue.undo()}>
            Undo
          </Button>
        )}
      </div>
    </section>
  );
}
