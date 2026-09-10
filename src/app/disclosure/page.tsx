import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";

export const metadata: Metadata = { title: "How this site is paid", description: "How this site makes money, what that means for the rankings, and what it does not.", alternates: { canonical: "/disclosure" } };

export default function DisclosurePage() {
  return (
    <Shell>
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "How this site is paid" }]} />
        <div className="mt-6 max-w-2xl text-fg-soft">
          <p className="eyebrow">Disclosure</p>
          <h1 className="font-display mt-2 text-5xl leading-none text-fg">How this site is paid.</h1>
          <p className="mt-4 text-lg">
            It is not. There is no affiliate programme behind this site today, no commission on anything you buy, and no
            partnership with any brand or retailer listed here.
          </p>
          <p className="mt-3">
            Every &ldquo;Visit&rdquo; and &ldquo;Shop&rdquo; link is an ordinary link to the maker&rsquo;s or retailer&rsquo;s own page. No tracking
            parameter is added, no network sits in the middle, and nobody is told you came from here. Each retailer link
            says what the relationship is, and today every one of them says there is none.
          </p>
          <p className="mt-3">
            That may change. If this site joins an affiliate programme later, the links that earn a commission will say so
            on the page where they appear, this page will be updated before that happens, and the rule below will not
            change with it.
          </p>
          <p className="mt-3">
            <strong className="text-fg">The rule.</strong> Affiliate status is not an input to how products are scored,
            ranked or badged, and it never will be. The ranking reads specifications and price. It cannot see whether a
            link pays, because that data is not passed to it. <Link className="text-accent-strong underline-offset-2 hover:underline" href="/how-we-choose">How we choose</Link> shows the
            weights and the arithmetic.
          </p>
          <p className="mt-3">We do not sell products, process payments, or handle returns. Those belong to the retailer.</p>
        </div>
      </Container>
    </Shell>
  );
}
