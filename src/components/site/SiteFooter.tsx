import Link from "next/link";
import { NAV, SITE_NAME } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-ivory-deep/60">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-3 lg:px-8">
        <div>
          <p className="font-display text-2xl">{SITE_NAME}</p>
          <p className="mt-2 max-w-sm text-sm text-ink-soft">
            Product facts from makers and retailers, compared on the same terms. Rankings follow published rules, never who pays us.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-2 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="tap flex items-center text-ink-soft hover:text-ink">
              {n.label}
            </Link>
          ))}
          <Link href="/disclosure" className="tap flex items-center text-ink-soft hover:text-ink">
            Affiliate disclosure
          </Link>
        </nav>
        <div className="text-xs text-ink-mute">
          <p>Prototype. Product data is demo data relayed from public sources and marked as such. Prices shown with the date checked.</p>
          <p className="mt-2">
            This site helps you compare products by their stated specifications and price. It does not give medical advice, and no product here is presented as treating any condition.
          </p>
        </div>
      </div>
    </footer>
  );
}
