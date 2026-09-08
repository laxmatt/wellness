import type { Metadata } from "next";
import { buttonStyles } from "@/components/ui/Button";
import Link from "next/link";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";
import { CompareView } from "@/components/compare/CompareView";
import { buildCompareModel } from "@/domain/compare";
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
    <Shell
      current="/compare"
      tray={false}
      assistantCategoryId={cat?.id}
      compareSeeds={(page?.products ?? []).map((p) => ({ id: p.view.id, slug: p.view.slug, name: p.view.name, categoryId: p.view.categoryId }))}
    >
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Compare" }]} />
        {items.length === 0 || !cat || !page ? (
          <div className="mt-10 max-w-2xl">
            <p className="eyebrow">Compare</p>
            <h1 className="font-display mt-2 text-5xl leading-none">Pick products to compare.</h1>
            <p className="mt-4 text-lg text-fg-soft">Tap Compare on any product card. Up to four from one category line up here, attribute by attribute.</p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {categories.map((c) => (
                <li key={c.id}>
                  <Link href={`/${c.slug}`} className={buttonStyles("primary", "md")}>
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
              <Link href={`/${cat.slug}`} className={buttonStyles("secondary", "md")}>
                Add more from {cat.navLabel}
              </Link>
            </div>
            {views.length !== sameCat.length ? <p className="mt-2 text-sm text-fg-muted">Products from other categories were left out. Compare one category at a time.</p> : null}
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <AssistantLauncher />
                <p className="text-sm text-fg-muted">Optional. Ask what the differences mean for you.</p>
              </div>
              <div className="mt-6">
                <CompareView model={buildCompareModel(items, cat)} ids={items.map((i) => i.view.id)} />
              </div>
            </>
          </>
        )}
      </Container>
    </Shell>
  );
}
