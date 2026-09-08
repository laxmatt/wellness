import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";
import { getAllCategoryPages, getBrands } from "@/lib/queries";

export const metadata: Metadata = { title: "Brands", description: "Every brand in the catalog and what we compare from each." };

export default async function BrandsPage() {
  const [brands, pages] = await Promise.all([getBrands(), getAllCategoryPages()]);
  const countFor = (brandId: string) => pages.reduce((n, p) => n + p.products.filter((x) => x.view.brand.id === brandId).length, 0);
  const catsFor = (brandId: string) => pages.filter((p) => p.products.some((x) => x.view.brand.id === brandId)).map((p) => p.cat.navLabel);
  return (
    <Shell current="/brands">
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Brands" }]} />
        <p className="eyebrow mt-6">Brands</p>
        <h1 className="font-display mt-2 text-5xl leading-none">{brands.length} brands tracked.</h1>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <li key={b.id}>
              <Link href={`/brands/${b.slug}`} className="lift flex items-center justify-between gap-3 rounded-card bg-paper p-4 shadow-card hover:-translate-y-0.5 hover:shadow-float">
                <div>
                  <p className="font-display text-xl">{b.name}</p>
                  <p className="text-xs text-ink-mute">{catsFor(b.id).join(" · ")}</p>
                </div>
                <span className="tabular text-sm font-semibold text-ink-soft">{countFor(b.id)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </Shell>
  );
}
