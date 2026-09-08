import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompareToggle } from "@/components/compare/CompareToggle";
import { InsightsPanel, OfferList, ProvenanceBlock, SpecGroups } from "@/components/product/detail";
import { Gallery } from "@/components/product/Gallery";
import { MiniCard } from "@/components/product/MiniCard";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";
import { Badge } from "@/components/ui/Badge";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { SpecRow } from "@/components/ui/SpecRow";
import { primaryStrength } from "@/domain/recommend";
import { getCatalog } from "@/providers";
import { getProductPage } from "@/lib/queries";
import { SITE_URL } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const products = await getCatalog().listProducts({ status: ["published"] });
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getProductPage(slug);
  if (!data) return {};
  const { view } = data.item;
  return {
    title: `${view.brand.name} ${view.name}`,
    description: view.description,
    alternates: { canonical: `/products/${view.slug}` },
  };
}

const schemaAvailability: Record<string, string> = {
  in_stock: "https://schema.org/InStock",
  backorder: "https://schema.org/BackOrder",
  preorder: "https://schema.org/PreOrder",
  out_of_stock: "https://schema.org/OutOfStock",
  discontinued: "https://schema.org/Discontinued",
};

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const data = await getProductPage(slug);
  if (!data) notFound();
  const { item, page, similar } = data;
  const { view } = item;
  const cat = page.cat;
  const primaryBadge = item.badges[0];
  const alsoValue = item.badges.includes("best_overall") && item.badges.includes("best_value");
  const lowest = view.offers[0];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${view.brand.name} ${view.name}`,
    brand: { "@type": "Brand", name: view.brand.name },
    description: view.description,
    url: `${SITE_URL}/products/${view.slug}`,
    ...(view.offers.length > 0
      ? {
          offers: view.offers.map((o) => ({
            "@type": "Offer",
            price: (o.price.amountMinor / 100).toFixed(2),
            priceCurrency: o.price.currency,
            url: o.url,
            seller: { "@type": "Organization", name: o.merchant.name },
            ...(schemaAvailability[o.availability] ? { availability: schemaAvailability[o.availability] } : {}),
          })),
        }
      : {}),
  };

  return (
    <Shell current={`/${cat.slug}`} trayCategoryId={cat.id}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { href: `/${cat.slug}`, label: cat.name }, { label: `${view.brand.name} ${view.name}` }]} />
        <div className="mt-4 grid gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-6">
            <Gallery images={view.images} name={view.name} />
          </div>
          <div className="flex flex-col gap-5 lg:col-span-6">
            <div className="flex flex-wrap items-center gap-2">
              {primaryBadge ? <Badge kind={primaryBadge} /> : null}
              {view.flags.demo ? <span className="rounded-pill border border-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-accent-strong">Demo data</span> : null}
              {view.flags.newArrival ? <span className="rounded-pill bg-warm-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-fg">New</span> : null}
            </div>
            <div>
              <Link href={`/brands/${view.brand.slug}`} className="eyebrow hover:text-fg">
                {view.brand.name}
              </Link>
              <h1 className="font-display mt-1 text-4xl leading-[0.98] sm:text-5xl">{view.name}</h1>
              {alsoValue ? <p className="mt-2 text-sm font-semibold text-positive">Also the strongest value in {cat.name.toLowerCase()}.</p> : null}
              {item.badgeReasons[0] ? <p className="mt-1 text-sm text-fg-soft">{item.badgeReasons[0]}</p> : null}
            </div>
            <p className="text-base text-fg-soft">{view.description}</p>
            <PriceDisplay price={view.price} size="lg" />
            <div className="divide-y divide-edge rounded-card border border-edge bg-surface-raised px-4">
              {view.cardSpecs.map((s) => (
                <SpecRow key={s.key} spec={s} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <CompareToggle size="lg" item={{ id: view.id, slug: view.slug, name: view.name, categoryId: view.categoryId }} />
              {lowest ? (
                <a href={view.offers.length > 1 ? "#retailers" : lowest.url} target={view.offers.length > 1 ? undefined : "_blank"} rel={view.offers.length > 1 ? undefined : "sponsored nofollow noopener"} className="tap inline-flex h-13 items-center justify-center rounded-pill bg-fg px-6 text-base font-semibold text-fg-inverse hover:bg-accent-strong">
                  {view.offers.length > 1 ? `See ${view.offers.length} retailers` : `Shop at ${lowest.merchant.name.replace(/\s*\(direct\)$/, "")}`}
                </a>
              ) : null}
            </div>
            {primaryStrength(view, cat) ? (
              <p className="text-sm">
                <span className="font-semibold text-positive">Why it ranks: </span>
                {primaryStrength(view, cat)}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-12">
          <section>
            <h2 className="font-display text-3xl">Strengths and tradeoffs</h2>
            <p className="mt-1 text-sm text-fg-muted">Derived from the specs below by published rules. No experiential claims without a source.</p>
            <div className="mt-5">
              <InsightsPanel insights={item.insights} view={view} />
            </div>
          </section>

          <section>
            <h2 className="font-display text-3xl">Specifications</h2>
            <div className="mt-5">
              <SpecGroups view={view} cat={cat} />
            </div>
          </section>

          <section id="retailers">
            <h2 className="font-display text-3xl">Where to buy</h2>
            <p className="mt-1 text-sm text-fg-muted">Prices shown as last checked. Retailer relationships never affect ranking.</p>
            <div className="mt-5">
              <OfferList view={view} />
            </div>
          </section>

          {similar.length > 0 ? (
            <section>
              <div className="flex items-end justify-between gap-4">
                <h2 className="font-display text-3xl">Similar {cat.name.toLowerCase()}</h2>
                <Link href={`/${cat.slug}`} className="tap hidden items-center text-sm font-semibold text-accent-strong hover:underline sm:inline-flex">
                  All {cat.navLabel.toLowerCase()}
                </Link>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
                {similar.map((s) => (
                  <MiniCard key={s.view.id} item={s} note={primaryStrength(s.view, cat)} />
                ))}
              </div>
            </section>
          ) : null}

          <ProvenanceBlock view={view} />
        </div>
      </Container>
    </Shell>
  );
}
