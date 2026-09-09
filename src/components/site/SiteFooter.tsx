import Link from "next/link";
import { NAV, SITE_NAME } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-edge bg-surface-sunken/60">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-3 lg:px-8">
        <div>
          <p className="font-display text-2xl">{SITE_NAME}</p>
          <p className="mt-2 max-w-sm text-sm text-fg-soft">
            Product facts from makers and retailers, compared on the same terms. Rankings follow published rules, never who pays us.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-2 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="tap flex items-center text-fg-soft hover:text-fg">
              {n.label}
            </Link>
          ))}
          <Link href="/disclosure" className="tap flex items-center text-fg-soft hover:text-fg">
            How this site is paid
          </Link>
        </nav>
        <div className="text-xs text-fg-muted">
          <p>
            Prototype. Specifications are relayed from public sources and each one says who reported it. Where no price
            has been confirmed, the page says so instead of showing an amount. No affiliate programme, no commission.
          </p>
          <p className="mt-2">
            This site helps you compare products by their stated specifications and price. It does not give medical advice, and no product here is presented as treating any condition.
          </p>
        </div>
      </div>
    </footer>
  );
}
