import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryBrowse } from "@/components/category/CategoryBrowse";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";
import { categories } from "@/domain/categories";
import { getCategoryPage } from "@/lib/queries";
import { social } from "@/lib/metadata";

type Props = { params: Promise<{ category: string }> };

export function generateStaticParams() {
  return categories.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const page = await getCategoryPage(category);
  if (!page) return {};
  const title = `${page.cat.name}: ${page.products.length} compared`;
  return {
    title,
    description: page.cat.intro,
    alternates: { canonical: `/${page.cat.slug}` },
    ...social({ title, description: page.cat.intro, path: `/${page.cat.slug}` }),
  };
}

export default async function CategoryPage({ params }: Props) {
  const { category } = await params;
  const page = await getCategoryPage(category);
  if (!page) notFound();
  const { cat, products } = page;

  return (
    <Shell
      current={`/${cat.slug}`}
      trayCategoryId={cat.id}
      assistantCategoryId={cat.id}
      compareSeeds={products.map((p) => ({ id: p.view.id, slug: p.view.slug, name: p.view.name, categoryId: cat.id }))}
    >
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: cat.name }]} />
      </Container>
      <CategoryBrowse page={page} />
    </Shell>
  );
}
