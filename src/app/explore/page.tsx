import type { Metadata } from "next";
import Link from "next/link";
import { BrandStrip, CategoryTiles, DiscoveryModules } from "@/components/home/sections";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";
import { getAllCategoryPages, getBrands } from "@/lib/queries";

export const metadata: Metadata = { title: "Explore", description: "Every category, filter and brand we track." };

export default async function ExplorePage() {
  const [pages, brands] = await Promise.all([getAllCategoryPages(), getBrands()]);
  return (
    <Shell current="/explore">
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Explore" }]} />
        <p className="eyebrow mt-6">Explore</p>
        <h1 className="font-display mt-2 text-5xl leading-none">Three categories. One method.</h1>
        <p className="mt-3 max-w-xl text-lg text-ink-soft">Start with a category, or jump straight to a filter.</p>
      </Container>
      <div className="mt-10 flex flex-col gap-16">
        <CategoryTiles pages={pages} />
        <DiscoveryModules pages={pages} />
        <BrandStrip brands={brands} />
        <Container>
          <Link href="/how-we-choose" className="text-sm font-semibold text-ember-deep hover:underline">
            How we choose
          </Link>
        </Container>
      </div>
    </Shell>
  );
}
