import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product/ProductCard";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";
import { getBrandPage, getBrands } from "@/lib/queries";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  return (await getBrands()).map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getBrandPage(slug);
  if (!data) return {};
  return { title: data.brand.name, description: data.brand.description ?? `${data.brand.name} products compared.`, alternates: { canonical: `/brands/${slug}` } };
}

export default async function BrandPage({ params }: Props) {
  const { slug } = await params;
  const data = await getBrandPage(slug);
  if (!data) notFound();
  const { brand, products } = data;
  return (
    <Shell current="/brands">
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { href: "/brands", label: "Brands" }, { label: brand.name }]} />
        <p className="eyebrow mt-6">Brand</p>
        <h1 className="font-display mt-2 text-5xl leading-none">{brand.name}</h1>
        {brand.description ? <p className="mt-3 max-w-xl text-lg text-ink-soft">{brand.description}</p> : null}
        {brand.websiteUrl ? (
          <a href={brand.websiteUrl} target="_blank" rel="noopener nofollow" className="mt-2 inline-flex text-sm font-semibold text-ember-deep hover:underline">
            {brand.websiteUrl.replace(/^https?:\/\//, "")}
          </a>
        ) : null}
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {products.map(({ item, cat }) => (
            <ProductCard key={item.view.id} item={item} cat={cat} />
          ))}
        </div>
      </Container>
    </Shell>
  );
}
