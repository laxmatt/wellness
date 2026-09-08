import Link from "next/link";
import { NAV, SITE_NAME } from "@/lib/site";
import { MobileMenu } from "./MobileMenu";

export function SiteHeader({ current }: { current?: string }) {
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-edge bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="font-display text-xl tracking-tight">
          {SITE_NAME}
        </Link>
        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-1 whitespace-nowrap">
            {NAV.map((n) => {
              const active = current === n.href;
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`tap inline-flex items-center rounded-pill px-3.5 text-sm font-semibold transition-colors ${active ? "bg-fg text-fg-inverse" : "text-fg-soft hover:bg-surface-sunken hover:text-fg"}`}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex items-center gap-2 lg:hidden">
          <Link href="/compare" className="tap inline-flex items-center rounded-pill border border-edge-strong bg-surface-raised px-4 text-sm font-semibold">
            Compare
          </Link>
          <MobileMenu current={current} />
        </div>
      </div>
    </header>
  );
}
