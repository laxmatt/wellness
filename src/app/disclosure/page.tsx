import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";
import { social } from "@/lib/metadata";

const description = "How this site makes money, what that means for the rankings, and what it does not.";
export const metadata: Metadata = {
  title: "How this site is paid",
  description,
  alternates: { canonical: "/disclosure" },
  ...social({ title: "How this site is paid", description, path: "/disclosure" }),
};

export default function DisclosurePage() {
  return (
    <Shell>
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "How this site is paid" }]} />
        <div className="mt-6 max-w-2xl text-fg-soft">
          <p className="eyebrow">Disclosure</p>
          <h1 className="font-display mt-2 text-5xl leading-none text-fg">How this site is paid.</h1>
          <p className="mt-4 text-lg">
            We may earn a commission when you buy through a link marked as an affiliate link. The notice beside each
            retailer link tells you its recorded relationship with this site.
          </p>
          <p className="mt-3">
            A non-affiliate notice means the link is recorded as not earning us a commission. An unconfirmed notice
            means we have not established the relationship; it is not a promise that the link is paid or unpaid.
          </p>
          <p className="mt-3">
            An account with an affiliate service does not by itself make every product link an affiliate link. We label
            the individual offer. These notices describe commission relationships, not the retailer&rsquo;s privacy or
            tracking practices.
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
