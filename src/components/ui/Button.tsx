import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-control text-control-fg hover:bg-control-hover",
  secondary: "bg-surface-raised text-fg border border-edge-strong hover:border-fg",
  ghost: "bg-transparent text-fg hover:bg-surface-sunken",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-11 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-13 px-6 text-base",
};

// One recipe for every button-shaped control, including links styled as
// buttons. Reskinning buttons happens here and in the control tokens.
export function buttonStyles(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string): string {
  return cn("tap inline-flex items-center justify-center gap-2 rounded-pill font-semibold transition-colors disabled:opacity-50", variants[variant], sizes[size], extra);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; children: ReactNode }) {
  return (
    <button className={buttonStyles(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}
