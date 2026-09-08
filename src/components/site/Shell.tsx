import type { ReactNode } from "react";
import { AssistantDock } from "@/components/assistant/AssistantDock";
import { AssistantProvider, type CompareSeed } from "@/components/assistant/AssistantProvider";
import { CompareTray } from "@/components/compare/CompareTray";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

export function Shell({
  children,
  current,
  trayCategoryId,
  tray = true,
  // Pages that can offer the assistant pass the category it should shop in.
  // Pages that do not simply omit it and render exactly as before.
  assistantCategoryId,
  compareSeeds,
}: {
  children: ReactNode;
  current?: string;
  trayCategoryId?: string;
  tray?: boolean;
  assistantCategoryId?: string;
  compareSeeds?: CompareSeed[];
}) {
  const body = (
    <>
      <main className="flex-1 pb-28">{children}</main>
      <SiteFooter />
    </>
  );
  return (
    <>
      <SiteHeader current={current} />
      {assistantCategoryId ? (
        <AssistantProvider categoryId={assistantCategoryId} compareSeeds={compareSeeds}>
          <AssistantDock>{body}</AssistantDock>
        </AssistantProvider>
      ) : (
        body
      )}
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
