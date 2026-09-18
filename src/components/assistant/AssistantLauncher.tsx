"use client";

import type { AssistantEntry } from "@/domain/assistant-intro";
import { cn } from "@/lib/cn";
import { useAssistant } from "./AssistantProvider";

// A plain button in the page flow. Not a floating bubble, not a pop-up, and it
// never opens by itself. When the panel is open the button reflects that.
//
// `entry` is what this button is: the invitation on a category page, the button
// beside a product, the one on a comparison. It is stated here rather than
// worked out in the panel, because the panel is mounted once for the page and
// several buttons can open it.
export function AssistantLauncher({ className, size = "md", entry = { kind: "general" } }: { className?: string; size?: "md" | "lg"; entry?: AssistantEntry }) {
  const a = useAssistant();
  if (!a) return null;
  return (
    <button
      type="button"
      aria-expanded={a.open}
      aria-controls="assistant-panel"
      onClick={() => (a.open ? a.setOpen(false) : a.openFrom(entry))}
      className={cn(
        "tap inline-flex items-center justify-center gap-2 rounded-pill border font-semibold transition-colors",
        size === "lg" ? "h-13 px-6 text-base" : "h-11 px-5 text-sm",
        a.open ? "border-fg bg-fg text-fg-inverse" : "border-edge-strong bg-surface-raised text-fg hover:border-fg",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
      </svg>
      {a.open ? "Close assistant" : "Help me choose"}
    </button>
  );
}
