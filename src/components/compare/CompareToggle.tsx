"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { useCompare, type CompareItem } from "./CompareProvider";

export function CompareToggle({ item, className, size = "md" }: { item: CompareItem; className?: string; size?: "md" | "lg" }) {
  const { has, toggle, ready } = useCompare();
  const [note, setNote] = useState<string | null>(null);
  const selected = ready && has(item.id);
  return (
    <div className={cn("flex flex-col", className)}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => {
          const r = toggle(item);
          setNote(r.ok ? null : (r.reason ?? null));
        }}
        className={cn(
          "tap inline-flex w-full items-center justify-center gap-2 rounded-pill border font-semibold transition-colors",
          size === "lg" ? "h-13 px-6 text-base" : "h-11 px-4 text-sm",
          selected ? "border-tide bg-tide text-paper" : "border-line-strong bg-paper text-ink hover:border-ink",
        )}
      >
        <span aria-hidden className={cn("inline-block h-4 w-4 rounded-sm border", selected ? "border-paper bg-paper/20" : "border-ink-mute")}>
          {selected ? <svg viewBox="0 0 16 16" className="h-full w-full"><path d="M3.5 8.5l3 3 6-6" fill="none" stroke="currentColor" strokeWidth="2" /></svg> : null}
        </span>
        {selected ? "Comparing" : "Compare"}
      </button>
      {note ? <span className="mt-1 text-xs text-ember-deep">{note}</span> : null}
    </div>
  );
}
