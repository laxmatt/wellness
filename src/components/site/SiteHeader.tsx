import Link from "next/link";
import { NAV, SITE_NAME } from "@/lib/site";

export function SiteHeader({ current }: { current?: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ivory/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <Link href="/" className="font-display text-xl tracking-tight">
            {SITE_NAME}
          </Link>
          <Link href="/compare" className="tap inline-flex items-center rounded-pill border border-line-strong px-4 text-sm font-semibold lg:hidden">
            Compare
          </Link>
        </div>
        <nav aria-label="Primary" className="-mx-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0 lg:pb-0">
          <ul className="flex items-center gap-1 whitespace-nowrap">
            {NAV.map((n) => {
              const active = current === n.href;
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`tap inline-flex items-center rounded-pill px-3.5 text-sm font-semibold transition-colors ${active ? "bg-ink text-paper" : "text-ink-soft hover:bg-ivory-deep hover:text-ink"}`}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
