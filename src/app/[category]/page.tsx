import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryHero, FacetChips, MatcherInput, RankingTransparency } from "@/components/category/sections";
import { WinnersRow } from "@/components/category/WinnersRow";
import { ProductCard } from "@/components/product/ProductCard";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";
import { categories } from "@/domain/categories";
import { getCategoryPage } from "@/lib/queries";

type Props = { params: Promise<{ category: string }> };

export function generateStaticParams() {
  return categories.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const page = await getCategoryPage(category);
  if (!page) return {};
  return {
    title: `${page.cat.name}: ${page.products.length} compared`,
    description: page.cat.intro,
    alternates: { canonical: `/${page.cat.slug}` },
  };
}

export default async function CategoryPage({ params }: Props) {
  const { category } = await params;
  const page = await getCategoryPage(category);
  if (!page) notFound();
  const { cat, products } = page;

  return (
    <Shell current={`/${cat.slug}`} trayCategoryId={cat.id}>
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: cat.name }]} />
      </Container>
      <CategoryHero cat={cat} title={cat.tagline} description={cat.intro} count={products.length} />
      <div className="mt-8 flex flex-col gap-10">
        <MatcherInput cat={cat} />
        <FacetChips cat={cat} />
      </div>
      <div className="mt-10">
        <WinnersRow products={products} cat={cat} />
      </div>
      <div className="mt-12 flex flex-col gap-10">
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">All {cat.navLabel.toLowerCase()}</p>
              <h2 className="font-display mt-1 text-3xl">Ranked by quality score.</h2>
            </div>
            <p className="text-sm text-fg-muted">{products.length} products</p>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((item, i) => (
              <ProductCard key={item.view.id} item={item} cat={cat} priority={i < 4} />
            ))}
          </div>
        </section>
        <RankingTransparency cat={cat} />
      </div>
    </Shell>
  );
}
