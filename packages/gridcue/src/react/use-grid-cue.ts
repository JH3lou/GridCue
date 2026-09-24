import { useSyncExternalStore } from "react";
import type { ControllerState, GridCueController } from "../index";

export interface GridCueBinding extends ControllerState {
  propose: GridCueController["propose"];
  answer: GridCueController["answer"];
  apply: GridCueController["apply"];
  cancel: GridCueController["cancel"];
  undo: GridCueController["undo"];
  /**
   * Keyboard behaviour for the request input, shared by every GridCue UI:
   * Escape cancels, and Ctrl+Enter or Cmd+Enter applies a ready preview without leaving the input.
   */
  onInputKeyDown: (event: { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault(): void }) => void;
}

/** The shortcut that applies a ready preview, for `aria-keyshortcuts` and visible hints. */
export const APPLY_SHORTCUT = { aria: "Control+Enter Meta+Enter", label: "Ctrl/⌘ Enter" };

/** Subscribes a component to a GridCue controller. No styling and no credentials. */
export const useGridCue = (controller: GridCueController): GridCueBinding => {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return {
    ...state,
    propose: controller.propose,
    answer: controller.answer,
    apply: controller.apply,
    cancel: controller.cancel,
    undo: controller.undo,
    onInputKeyDown: (event) => {
      if (event.key === "Escape") {
        controller.cancel();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && controller.getState().status === "ready") {
        event.preventDefault();
        void controller.apply();
      }
    },
  };
};

/** Short, non-colour status labels shared by every GridCue UI. */
export const STATUS_LABEL: Record<ControllerState["status"], string> = {
  idle: "",
  resolving: "Working out your request…",
  ready: "Ready to apply",
  needs_clarification: "Needs your input",
  unsupported: "Can't do that",
  applying: "Applying…",
  applied: "Applied",
  error: "Something went wrong",
};
