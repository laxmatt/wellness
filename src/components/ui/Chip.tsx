import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Chip({
  selected = false,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; children: ReactNode }) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "tap inline-flex items-center gap-1.5 rounded-pill border px-3.5 text-sm font-medium transition-colors",
        selected ? "border-fg bg-fg text-fg-inverse" : "border-edge-strong bg-surface-raised text-fg hover:border-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
