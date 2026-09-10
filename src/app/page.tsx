import { BrandStrip, CategoryTiles, DiscoveryModules, Hero, HowWeChooseCallout, SectionHeading } from "@/components/home/sections";
import { ProductCard } from "@/components/product/ProductCard";
import { Shell } from "@/components/site/Shell";
import { getAllCategoryPages, getBrands } from "@/lib/queries";
import type { Metadata } from "next";

// The home page inherits its title and description from the root layout. It
// had no canonical of its own, which left the one page most likely to be
// linked with a query string or a trailing variation without one.
export const metadata: Metadata = { alternates: { canonical: "/" } };

// "Recently added" deferred for MVP. The newArrival flag stays in the data.
export default async function HomePage() {
  const [pages, brands] = await Promise.all([getAllCategoryPages(), getBrands()]);

  // Featured: each category's Best Overall, then Best Value picks, up to 4.
  const featured = [
    ...pages.map((p) => p.products.find((x) => x.badges.includes("best_overall"))).filter(Boolean),
    ...pages.map((p) => p.products.find((x) => x.badges.includes("best_value") && !x.badges.includes("best_overall"))).filter(Boolean),
  ].slice(0, 4) as NonNullable<(typeof pages)[number]["products"][number]>[];
  const catOf = (categoryId: string) => pages.find((p) => p.cat.id === categoryId)!.cat;

  return (
    <Shell current="/">
      <Hero pages={pages} />
      <div className="mt-4 flex flex-col gap-20">
        <CategoryTiles pages={pages} />

        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading eyebrow="Featured" title="Category winners." href="/how-we-choose" linkLabel="How badges work" />
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((item, i) => (
              <ProductCard key={item.view.id} item={item} cat={catOf(item.view.categoryId)} priority={i < 2} />
            ))}
          </div>
        </section>

        <DiscoveryModules pages={pages} />
        <HowWeChooseCallout />
        <BrandStrip brands={brands} />
      </div>
    </Shell>
  );
}
