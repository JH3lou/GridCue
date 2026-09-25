import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Copies text, and cross-fades the icon from copy to check (better-ui contextual icons: scale 0.25 → 1,
 * opacity 0 → 1, blur 4px → 0). Both icons stay in the DOM, so there is an enter and an exit with no dependency.
 */
export function CopyButton({ text, label, className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const icon = "absolute inset-0 size-4 transition-[opacity,scale,filter] duration-200 ease-[var(--ease-icon)]";
  return (
    <button
      type="button"
      aria-label={label ?? `Copy ${text}`}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
      className={`press text-muted-foreground hover:text-foreground inline-flex items-center gap-2 ${className}`}
    >
      <span className="relative size-4">
        <Copy strokeWidth={1.5} className={`${icon} ${copied ? "scale-25 opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-0"}`} />
        <Check strokeWidth={1.5} className={`${icon} ${copied ? "scale-100 opacity-100 blur-0" : "scale-25 opacity-0 blur-[4px]"}`} />
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
