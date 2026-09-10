import type { MetadataRoute } from "next";
import { categories } from "@/domain/categories";
import { getAllCategoryPages, getBrands } from "@/lib/queries";
import { SITE_URL, hasPublicSiteUrl } from "@/lib/site-url";

// Empty until a public address is configured. A sitemap is a list of absolute
// URLs, and without a configured host every one of them would say localhost.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!hasPublicSiteUrl()) return [];

  const [pages, brands] = await Promise.all([getAllCategoryPages(), getBrands()]);
  const at = (path: string, lastModified?: string) => ({
    url: `${SITE_URL}${path}`,
    ...(lastModified ? { lastModified: new Date(lastModified) } : {}),
  });

  return [
    at("/"),
    at("/explore"),
    at("/brands"),
    at("/how-we-choose"),
    at("/disclosure"),
    ...categories.flatMap((c) => [at(`/${c.slug}`), ...c.facets.map((f) => at(`/${c.slug}/${f.slug}`))]),
    ...brands.map((b) => at(`/brands/${b.slug}`)),
    ...pages.flatMap((page) => page.products.map((p) => at(`/products/${p.view.slug}`, p.view.lastUpdated))),
  ];
}
