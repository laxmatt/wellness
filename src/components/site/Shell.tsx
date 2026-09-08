import type { ReactNode } from "react";
import { CompareTray } from "@/components/compare/CompareTray";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

export function Shell({ children, current, trayCategoryId, tray = true }: { children: ReactNode; current?: string; trayCategoryId?: string; tray?: boolean }) {
  return (
    <>
      <SiteHeader current={current} />
      <main className="flex-1 pb-28">{children}</main>
      <SiteFooter />
      {tray ? <CompareTray categoryId={trayCategoryId} /> : null}
    </>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}

export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-fg-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {it.href ? (
              <a href={it.href} className="hover:text-fg">
                {it.label}
              </a>
            ) : (
              <span className="text-fg-soft">{it.label}</span>
            )}
            {i < items.length - 1 ? <span aria-hidden>/</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
