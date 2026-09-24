import type { Clarification } from "gridcue";
import { PRESS } from "@/components/gridcue/preview-panel";
import { Button } from "@/components/ui/button";

export interface ClarificationPromptProps {
  clarification: Clarification;
  onAnswer: (clarificationId: string, optionId: string) => void;
}

/** Offers a clarification's bounded choices as buttons. */
export function ClarificationPrompt({ clarification, onAnswer }: ClarificationPromptProps) {
  if (!clarification.options?.length) return null;
  return (
    <fieldset aria-label={clarification.prompt} className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
      {clarification.options.map((option) => (
        <Button key={option.id} size="sm" variant="outline" className={PRESS} onClick={() => onAnswer(clarification.id, option.id)}>
          {option.label}
        </Button>
      ))}
    </fieldset>
  );
}
