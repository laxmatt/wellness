import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryBrowse } from "@/components/category/CategoryBrowse";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";
import { categories } from "@/domain/categories";
import { facetSelection, getCategoryPage } from "@/lib/queries";
import { social } from "@/lib/metadata";

type Props = { params: Promise<{ category: string; facet: string }> };

export function generateStaticParams() {
  return categories.flatMap((c) => c.facets.map((f) => ({ category: c.slug, facet: f.slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, facet } = await params;
  const page = await getCategoryPage(category);
  const def = page?.cat.facets.find((f) => f.slug === facet);
  if (!page || !def) return {};
  return {
    title: def.title,
    description: def.description,
    alternates: { canonical: `/${page.cat.slug}/${def.slug}` },
    ...social({ title: def.title, description: def.description, path: `/${page.cat.slug}/${def.slug}` }),
  };
}

/**
 * A facet URL is the category, opened with one chip already pressed.
 *
 * It used to be its own product set, built by filtering the category and handing
 * the smaller list to the grid. Everything downstream inherited that: the chips
 * were built from the subset, the counts were of the subset, and no control on
 * the page could reach a product outside it. The narrowing was in the route, and
 * a route is not something a shopper can take off.
 */
export default async function FacetPage({ params }: Props) {
  const { category, facet } = await params;
  const page = await getCategoryPage(category);
  if (!page) notFound();
  const def = page.cat.facets.find((f) => f.slug === facet);
  if (!def) notFound();
  const { cat, products } = page;

  return (
    <Shell
      current={`/${cat.slug}`}
      trayCategoryId={cat.id}
      assistantCategoryId={cat.id}
      compareSeeds={products.map((p) => ({ id: p.view.id, slug: p.view.slug, name: p.view.name, categoryId: cat.id }))}
    >
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { href: `/${cat.slug}`, label: cat.name }, { label: def.title }]} />
      </Container>
      <CategoryBrowse page={page} title={def.title} description={def.description} initialSelected={facetSelection(page, def.slug)} startingFrom={def.label} />
    </Shell>
  );
}
