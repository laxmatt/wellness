import type { Metadata } from "next";
import Link from "next/link";
import { CompareTable } from "@/components/compare/CompareTable";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";
import { categories, categoryById } from "@/domain/categories";
import { getCategoryPage, getProductViewsByIds } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Compare",
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<{ ids?: string }> };

export default async function ComparePage({ searchParams }: Props) {
  const { ids } = await searchParams;
  const list = (ids ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const views = await getProductViewsByIds(list);
  const cat = views[0] ? categoryById(views[0].categoryId) : undefined;
  const sameCat = cat ? views.filter((v) => v.categoryId === cat.id) : [];
  const page = cat ? await getCategoryPage(cat.slug) : null;
  const items = page ? sameCat.map((v) => page.products.find((p) => p.view.id === v.id)).filter((p): p is NonNullable<typeof p> => p !== undefined) : [];

  return (
    <Shell current="/compare" tray={false}>
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Compare" }]} />
        {items.length === 0 || !cat || !page ? (
          <div className="mt-10 max-w-2xl">
            <p className="eyebrow">Compare</p>
            <h1 className="font-display mt-2 text-5xl leading-none">Pick products to compare.</h1>
            <p className="mt-4 text-lg text-ink-soft">Tap Compare on any product card. Up to four from one category line up here, attribute by attribute.</p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {categories.map((c) => (
                <li key={c.id}>
                  <Link href={`/${c.slug}`} className="tap inline-flex items-center rounded-pill bg-ink px-5 text-sm font-semibold text-paper hover:bg-ember-deep">
                    {c.navLabel}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow">{cat.name}</p>
                <h1 className="font-display mt-1 text-4xl leading-none sm:text-5xl">
                  Comparing {items.length} {items.length === 1 ? "product" : "products"}.
                </h1>
              </div>
              <Link href={`/${cat.slug}`} className="tap inline-flex items-center rounded-pill border border-line-strong bg-paper px-5 text-sm font-semibold hover:border-ink">
                Add more from {cat.navLabel}
              </Link>
            </div>
            {views.length !== sameCat.length ? <p className="mt-2 text-sm text-ink-mute">Products from other categories were left out. Compare one category at a time.</p> : null}
            <div className="mt-8">
              <CompareTable items={items} cat={cat} ids={items.map((i) => i.view.id)} />
            </div>
          </>
        )}
      </Container>
    </Shell>
  );
}
