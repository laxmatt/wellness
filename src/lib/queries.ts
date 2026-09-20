import { cache } from "react";
import { categories, categoryBySlug } from "@/domain/categories";
import type { CategoryDefinition } from "@/domain/category";
import { matchesAll } from "@/domain/conditions";
import { facetOptionId, filterOptionSpecs } from "@/domain/filters";
import { buildNeedCatalogue, type NeedDefinition } from "@/domain/needs";
import type { Brand } from "@/domain/product";
import { similarProducts } from "@/domain/personalization/similar";
import { recommendCategory, type RecommendedProduct, type RecommendationSet } from "@/domain/recommend";
import { buyableOffers, type ProductView } from "@/domain/view";
import { getCatalog } from "@/providers";

// Server-side read helpers. Every page reads the catalog through these so
// product data lives once and ranking runs once per category per request.

export type CategoryPage = {
  cat: CategoryDefinition;
  /** The models a shopper chooses between. Configurations of one of them are not here. */
  products: RecommendedProduct[];
  /**
   * Records that are a configuration of one of the above: a finish, a size.
   *
   * Published, priced, linked and reachable, and not a card of their own. A
   * merchant selling one cabin on two pages is selling one cabin, and a grid
   * offering both asks a shopper to choose between a product and its own paint.
   */
  members?: RecommendedProduct[];
  set: RecommendationSet;
};

export const getCategoryPage = cache(async (slug: string): Promise<CategoryPage | null> => {
  const cat = categoryBySlug(slug);
  if (!cat) return null;
  const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
  const { products, set } = recommendCategory(views, cat);
  const ids = new Set(products.map((p) => p.view.id));
  // A configuration whose model is not published here stands on its own rather
  // than disappearing: a record vanishing from a category is worse than one
  // appearing without the family it belongs to.
  const isMember = (p: RecommendedProduct): boolean => p.view.family !== undefined && ids.has(p.view.family.of);
  return { cat, products: products.filter((p) => !isMember(p)), members: products.filter(isMember), set };
});

/** The configurations of one model, cheapest first. */
export function configurationsOf(page: CategoryPage, id: string): RecommendedProduct[] {
  return (page.members ?? [])
    .filter((m) => m.view.family?.of === id)
    .sort((a, b) => (a.view.price.money?.amountMinor ?? Infinity) - (b.view.price.money?.amountMinor ?? Infinity));
}

/** The lowest amount anyone can pay for this model or one of its configurations. */
export function fromPrice(page: CategoryPage, item: RecommendedProduct): number | undefined {
  const amounts = [item, ...configurationsOf(page, item.view.id)].map((p) => p.view.price.money?.amountMinor).filter((n): n is number => n !== undefined);
  return amounts.length > 0 ? Math.min(...amounts) : undefined;
}

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
  /** The configurations this model is sold in, each its own record. */
  configurations: RecommendedProduct[];
};

/**
 * Where a configuration's own address sends a shopper.
 *
 * A finish is not a second product, so it does not get a second page competing
 * with the one it belongs to. Its record stays published, priced and linked,
 * and its address leads to the model it is a configuration of, where its price
 * and its own link are listed.
 */
export const getProductRedirect = cache(async (slug: string): Promise<string | null> => {
  const view = await getCatalog().getProductView(slug);
  if (!view || view.status !== "published" || !view.family) return null;
  const cat = categories.find((c) => c.id === view.categoryId);
  if (!cat) return null;
  const page = await getCategoryPage(cat.slug);
  const of = page?.products.find((p) => p.view.id === view.family!.of);
  return of ? `/products/${of.view.slug}` : null;
});

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
  return { item, page, similar, configurations: configurationsOf(page, view.id) };
});

/**
 * Brands a shopper can actually get to a product from.
 *
 * The catalogue holds a brand record for every product it holds, drafts
 * included, and a draft is nobody's to see. Listing every brand published three
 * sauna partners on `/brands`, on the home page and in the sitemap while their
 * products were still drafts and their category was not published: three names
 * announced, each linking to a page with nothing on it.
 *
 * It is the same rule the rest of the site follows and the brand list was the
 * one place it was missing. A brand with no published product is not a dead end
 * to hide, it is a page with nothing to say.
 */
export const getBrands = cache(async (): Promise<Brand[]> => {
  const pages = await getAllCategoryPages();
  const withProducts = new Set(pages.flatMap((p) => p.products.map((x) => x.view.brand.id)));
  return (await getCatalog().listBrands()).filter((b) => withProducts.has(b.id));
});

export const getBrandPage = cache(async (slug: string) => {
  const brand = await getCatalog().getBrand(slug);
  if (!brand) return null;
  const pages = await getAllCategoryPages();
  const products = pages.flatMap((p) => p.products.filter((x) => x.view.brand.id === brand.id).map((item) => ({ item, cat: p.cat })));
  // No published product, no page. The route already 404s on an unknown slug
  // and this is the same answer for a slug that resolves to nothing a shopper
  // can reach.
  if (products.length === 0) return null;
  return { brand, products };
});

export const getProductViewsByIds = cache(async (ids: string[]): Promise<ProductView[]> => {
  if (ids.length === 0) return [];
  return getCatalog().listProductViews({ ids, status: ["published"] });
});

/**
 * The cheapest listing a shopper can actually be sent to, or nothing.
 *
 * `view.offers` is every offer on the record, cheapest first, and that includes
 * the ones no buying surface may link: an amount that belongs to another
 * product, and a listing that is no longer current. Reading `offers[0]` took
 * whichever of those happened to be cheapest. Two records in the catalogue make
 * that concrete: Plunge's only offer is disputed and Edge Theory Labs' only
 * offer is discontinued, and this returned a shopping link for both while every
 * surface that renders them correctly shows none.
 */
export function lowestOfferUrl(view: ProductView): string | undefined {
  return buyableOffers(view)[0]?.url;
}
