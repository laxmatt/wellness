import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryHero, FacetChips, MatcherInput, RankingTransparency } from "@/components/category/sections";
import { FilterChips, FilterableGrid } from "@/components/category/FilterBar";
import { CategoryFilterProvider } from "@/components/category/FilterContext";
import { ProductCard } from "@/components/product/ProductCard";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";
import { categories } from "@/domain/categories";
import { buildFilterGroups } from "@/domain/filters";
import { facetProducts, getCategoryPage } from "@/lib/queries";

type Props = { params: Promise<{ category: string; facet: string }> };

export function generateStaticParams() {
  return categories.flatMap((c) => c.facets.map((f) => ({ category: c.slug, facet: f.slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, facet } = await params;
  const page = await getCategoryPage(category);
  if (!page) return {};
  const fp = facetProducts(page, facet);
  if (!fp) return {};
  return {
    title: fp.facet.title,
    description: fp.facet.description,
    alternates: { canonical: `/${page.cat.slug}/${fp.facet.slug}` },
  };
}

export default async function FacetPage({ params }: Props) {
  const { category, facet } = await params;
  const page = await getCategoryPage(category);
  if (!page) notFound();
  const fp = facetProducts(page, facet);
  if (!fp) notFound();
  const { cat } = page;
  const filterGroups = buildFilterGroups(fp.products.map((p) => p.view), cat);

  return (
    <Shell
      current={`/${cat.slug}`}
      trayCategoryId={cat.id}
      assistantCategoryId={cat.id}
      compareSeeds={fp.products.map((p) => ({ id: p.view.id, slug: p.view.slug, name: p.view.name, categoryId: cat.id }))}
    >
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { href: `/${cat.slug}`, label: cat.name }, { label: fp.facet.title }]} />
      </Container>
      <CategoryHero cat={cat} title={fp.facet.title} description={fp.facet.description} count={fp.products.length} />
      <div className="mt-8 flex flex-col gap-10">
        <MatcherInput cat={cat} />
        <FacetChips cat={cat} active={fp.facet.slug} />
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">{fp.facet.title}</p>
              <h2 className="font-display mt-1 text-3xl">Ranked by {cat.scoring.label.toLowerCase()}.</h2>
            </div>
            <p className="text-sm text-fg-muted">
              {fp.products.length} of {page.products.length}
            </p>
          </div>
          {fp.products.length === 0 ? (
            <div className="mt-6 rounded-card border border-edge bg-surface-raised p-8 text-center">
              <p className="font-display text-2xl">Nothing in our set fits this filter yet.</p>
              <p className="mt-2 text-fg-soft">Badges are awarded across the whole category, so the closest picks are on the main page.</p>
              <Link href={`/${cat.slug}`} className="tap mt-4 inline-flex items-center rounded-pill bg-fg px-5 text-sm font-semibold text-fg-inverse">
                See all {cat.navLabel.toLowerCase()}
              </Link>
            </div>
          ) : (
            <CategoryFilterProvider groups={filterGroups} ids={fp.products.map((p) => p.view.id)}>
              <div className="mt-6">
                <FilterChips />
              </div>
              <div className="mt-6">
                <FilterableGrid emptyHref={`/${cat.slug}`} emptyLabel={`See all ${cat.navLabel.toLowerCase()}`}>
                  {fp.products.map((item, i) => (
                    <ProductCard key={item.view.id} item={item} cat={cat} priority={i < 4} />
                  ))}
                </FilterableGrid>
              </div>
            </CategoryFilterProvider>
          )}
          <p className="mt-4 text-xs text-fg-muted">Badges are decided across all {page.products.length} {cat.name.toLowerCase()} we track, not within this filter.</p>
        </section>
        <RankingTransparency cat={cat} />
      </div>
    </Shell>
  );
}
