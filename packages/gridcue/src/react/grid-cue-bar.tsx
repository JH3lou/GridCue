import { type FormEvent, useId, useRef, useState } from "react";
import type { GridCueController } from "../index";
import { APPLY_SHORTCUT, STATUS_LABEL, useGridCue } from "./use-grid-cue";

export interface GridCueBarProps {
  controller: GridCueController;
  /** Visible label for the input. Default "Describe the view you want". */
  label?: string;
  /** Example text in the empty input. Default "e.g. taxable accounts over $1M, largest first": set one from your domain. */
  placeholder?: string;
  className?: string;
}

/** A ready-made command bar styled by `gridcue/styles.css`. Works in any React app without Tailwind. */
export const GridCueBar = ({
  controller,
  label = "Describe the view you want",
  placeholder = "e.g. taxable accounts over $1M, largest first",
  className,
}: GridCueBarProps) => {
  const cue = useGridCue(controller);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const busy = cue.status === "resolving" || cue.status === "applying";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void cue.propose(text);
  };
  const edit = () => inputRef.current?.focus();

  return (
    <section className={["gridcue-bar", className].filter(Boolean).join(" ")} aria-label="GridCue" aria-busy={busy}>
      <form className="gridcue-form" onSubmit={submit}>
        <label className="gridcue-label" htmlFor={`${id}-input`}>
          {label}
        </label>
        <div className="gridcue-row">
          <input
            ref={inputRef}
            id={`${id}-input`}
            className="gridcue-input"
            value={text}
            placeholder={placeholder}
            autoComplete="off"
            aria-describedby={`${id}-status`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={cue.onInputKeyDown}
          />
          <button className="gridcue-button" type="submit" disabled={busy || !text.trim()}>
            Preview
          </button>
        </div>
      </form>

      <div id={`${id}-status`} className="gridcue-status" role="status" aria-live="polite" data-status={cue.status}>
        {STATUS_LABEL[cue.status] && <strong className="gridcue-status-label">{STATUS_LABEL[cue.status]}</strong>}
        {cue.message && <span className="gridcue-message"> {cue.message}</span>}
      </div>

      {cue.status === "ready" && cue.preview && (
        <div className="gridcue-panel">
          <h2 className="gridcue-heading">This will change</h2>
          <ul className="gridcue-list">
            {cue.preview.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="gridcue-note">No records will be changed.</p>
          <div className="gridcue-actions">
            <button
              className="gridcue-button gridcue-primary"
              type="button"
              aria-keyshortcuts={APPLY_SHORTCUT.aria}
              onClick={() => void cue.apply()}
            >
              Apply
            </button>
            <button className="gridcue-button" type="button" onClick={cue.cancel}>
              Cancel
            </button>
            <span className="gridcue-hint" aria-hidden="true">
              <kbd>{APPLY_SHORTCUT.label}</kbd>
            </span>
          </div>
        </div>
      )}

      {cue.status === "needs_clarification" && cue.plan?.clarifications[0]?.options?.length ? (
        <fieldset className="gridcue-panel gridcue-fieldset" aria-label={cue.plan.clarifications[0].prompt}>
          <div className="gridcue-actions">
            {cue.plan.clarifications[0].options.map((option) => (
              <button
                key={option.id}
                className="gridcue-button"
                type="button"
                onClick={() => cue.answer(cue.plan?.clarifications[0]?.id ?? "", option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {(cue.status === "unsupported" || cue.status === "error" || cue.status === "needs_clarification") && (
        <div className="gridcue-actions">
          <button className="gridcue-button" type="button" onClick={edit}>
            Edit request
          </button>
        </div>
      )}

      {cue.canUndo && (
        <div className="gridcue-actions">
          <button className="gridcue-button" type="button" onClick={() => void cue.undo()}>
            Undo
          </button>
        </div>
      )}
    </section>
  );
};
