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
        selected ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:border-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
