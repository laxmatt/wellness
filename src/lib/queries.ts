import { cache } from "react";
import { categories, categoryBySlug } from "@/domain/categories";
import type { CategoryDefinition } from "@/domain/category";
import { matchesAll } from "@/domain/conditions";
import { facetOptionId, filterOptionSpecs } from "@/domain/filters";
import { buildNeedCatalogue, type NeedDefinition } from "@/domain/needs";
import type { Brand } from "@/domain/product";
import { similarProducts } from "@/domain/personalization/similar";
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

// Facets whose filter still matches something. A facet that matches nothing is
// a chip that leads to a page saying "nothing fits this filter yet", and the
// category's own filter chips already refuse to offer a dead end. Removing the
// assumed `placement` values left `/cold-plunge/indoor` empty and still linked
// from the category page and the home page.
export function liveFacets(page: CategoryPage): string[] {
  return page.cat.facets.filter((f) => page.products.some((p) => matchesAll(p.view, page.cat, f.conditions))).map((f) => f.slug);
}

/**
 * The requirements this category can express, classified against every product
 * in it.
 *
 * Over the whole category, always. A comparison can hold a product the current
 * filters exclude, and that is the case worth showing: the shopper put it there
 * and needs to see where it conflicts. Classifying against a page's visible
 * subset would report every such product as a mismatch on every requirement,
 * including the ones it meets.
 *
 * A facet is in here because `filterOptionSpecs` puts it there, as the chip it
 * is. It used to be appended separately, under its own id, which meant a
 * shopper arriving at /red-light/under-1000 and one pressing "Under $1,000" had
 * two different requirements for one thing.
 */
export function buildNeeds(page: CategoryPage): NeedDefinition[] {
  const views = page.products.map((p) => p.view);
  return buildNeedCatalogue(
    views,
    page.cat,
    filterOptionSpecs(views, page.cat).map((o) => ({ id: o.id, label: o.label, groupLabel: o.groupLabel, groupKey: o.groupKey, conditions: o.conditions, source: o.source })),
  );
}

/**
 * The chips a facet URL arrives with already pressed.
 *
 * This is the whole of what a facet page now is: the category, and a selection.
 * The products are the category's, the groups are the category's, and the
 * shopper can turn this off.
 */
export function facetSelection(page: CategoryPage, facetSlug: string): string[] {
  const id = facetOptionId(page.products.map((p) => p.view), page.cat, facetSlug);
  return id ? [id] : [];
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
  const item = page.products.find((p) => p.view.id === view.id);
  if (!item) return null;
  const byId = new Map(page.products.map((p) => [p.view.id, p]));
  const similar = similarProducts(view, page.products.map((p) => p.view), cat, 3)
    .map((v) => byId.get(v.id))
    .filter((p): p is RecommendedProduct => p !== undefined);
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
