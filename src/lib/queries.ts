import { cache } from "react";
import { categories, categoryBySlug } from "@/domain/categories";
import type { CategoryDefinition } from "@/domain/category";
import { matchesAll } from "@/domain/conditions";
import type { Brand } from "@/domain/product";
import { recommendCategory, type RecommendedProduct, type RecommendationSet } from "@/domain/recommend";
import type { ProductView } from "@/domain/view";
import { getCatalog } from "@/providers";

// Server-side read helpers. Every page reads the catalog through these so
// product data lives once and ranking runs once per category per request.

export type CategoryPage = {
  cat: CategoryDefinition;
  products: RecommendedProduct[];
  set: RecommendationSet;
};

export const getCategoryPage = cache(async (slug: string): Promise<CategoryPage | null> => {
  const cat = categoryBySlug(slug);
  if (!cat) return null;
  const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
  const { products, set } = recommendCategory(views, cat);
  return { cat, products, set };
});

export const getAllCategoryPages = cache(async (): Promise<CategoryPage[]> => {
  const pages = await Promise.all(categories.map((c) => getCategoryPage(c.slug)));
  return pages.filter((p): p is CategoryPage => p !== null);
});

export function facetProducts(page: CategoryPage, facetSlug: string): { facet: CategoryDefinition["facets"][number]; products: RecommendedProduct[] } | null {
  const facet = page.cat.facets.find((f) => f.slug === facetSlug);
  if (!facet) return null;
  return { facet, products: page.products.filter((p) => matchesAll(p.view, page.cat, facet.conditions)) };
}

export type ProductPage = {
  item: RecommendedProduct;
  page: CategoryPage;
  similar: RecommendedProduct[];
};

export const getProductPage = cache(async (slug: string): Promise<ProductPage | null> => {
  const view = await getCatalog().getProductView(slug);
  if (!view || view.status !== "published") return null;
  const cat = categories.find((c) => c.id === view.categoryId);
  if (!cat) return null;
  const page = await getCategoryPage(cat.slug);
  if (!page) return null;
  const idx = page.products.findIndex((p) => p.view.id === view.id);
  const item = page.products[idx];
  if (!item) return null;
  // Similar: ranking neighbors first, then fill from the rest.
  const neighbors = [idx - 1, idx + 1, idx - 2, idx + 2, idx - 3, idx + 3]
    .filter((i) => i >= 0 && i < page.products.length)
    .map((i) => page.products[i]);
  const similar = neighbors.slice(0, 3);
  return { item, page, similar };
});

export const getBrands = cache(async (): Promise<Brand[]> => getCatalog().listBrands());

export const getBrandPage = cache(async (slug: string) => {
  const brand = await getCatalog().getBrand(slug);
  if (!brand) return null;
  const pages = await getAllCategoryPages();
  const products = pages.flatMap((p) => p.products.filter((x) => x.view.brand.id === brand.id).map((item) => ({ item, cat: p.cat })));
  return { brand, products };
});

export const getProductViewsByIds = cache(async (ids: string[]): Promise<ProductView[]> => {
  if (ids.length === 0) return [];
  return getCatalog().listProductViews({ ids, status: ["published"] });
});

export function lowestOfferUrl(view: ProductView): string | undefined {
  return view.offers[0]?.url;
}
