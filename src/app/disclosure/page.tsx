import type { Metadata } from "next";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";

export const metadata: Metadata = { title: "Affiliate disclosure" };

export default function DisclosurePage() {
  return (
    <Shell>
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Affiliate disclosure" }]} />
        <div className="mt-6 max-w-2xl text-ink-soft">
          <p className="eyebrow">Disclosure</p>
          <h1 className="font-display mt-2 text-5xl leading-none text-ink">How this site is paid.</h1>
          <p className="mt-4 text-lg">Some retailer links on this site are affiliate links. When you buy through one, the retailer may pay us a commission. The price you pay is the same.</p>
          <p className="mt-3">Each retailer link states whether an affiliate relationship exists. Affiliate status is never an input to how products are scored or badged. Products with no affiliate relationship appear, and rank first, when the data supports it.</p>
          <p className="mt-3">We do not sell products, process payments, or handle returns. Those belong to the retailer.</p>
        </div>
      </Container>
    </Shell>
  );
}
