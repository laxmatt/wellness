import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { validateAttributeAgainstDefinition } from "@/domain/attributes";
import { categories, categoryById } from "@/domain/categories";
import type { CategoryDefinition } from "@/domain/category";
import { Brand, Merchant, Product } from "@/domain/product";
import { toProductView, type ProductView } from "@/domain/view";
import type { CatalogProvider, ProductQuery } from "./CatalogProvider";

export type LoadedCatalog = {
  categories: CategoryDefinition[];
  products: Product[];
  brands: Brand[];
  merchants: Merchant[];
};

export type CatalogIssue = { file: string; message: string };

function readJsonDir(dir: string): { file: string; data: unknown }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: join(dir, f), data: JSON.parse(readFileSync(join(dir, f), "utf8")) }));
}

// Cross-entity checks Zod cannot express: references, attribute typing
// against the category definition, uniqueness.
export function validateCatalog(cat: LoadedCatalog): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const brandIds = new Set(cat.brands.map((b) => b.id));
  const merchantIds = new Set(cat.merchants.map((m) => m.id));
  const seenSlugs = new Set<string>();
  const seenIds = new Set<string>();

  for (const p of cat.products) {
    const file = `products/${p.id}`;
    if (seenIds.has(p.id)) issues.push({ file, message: `duplicate product id ${p.id}` });
    if (seenSlugs.has(p.slug)) issues.push({ file, message: `duplicate slug ${p.slug}` });
    seenIds.add(p.id);
    seenSlugs.add(p.slug);
    if (!brandIds.has(p.brandId)) issues.push({ file, message: `unknown brandId ${p.brandId}` });
    const category = categoryById(p.categoryId);
    if (!category) {
      issues.push({ file, message: `unknown categoryId ${p.categoryId}` });
      continue;
    }
    if (p.subcategoryId && !category.subcategories.some((s) => s.id === p.subcategoryId)) {
      issues.push({ file, message: `unknown subcategoryId ${p.subcategoryId}` });
    }
    for (const [key, sv] of Object.entries(p.attributes)) {
      const def = category.attributeDefinitions.find((a) => a.key === key);
      if (!def) {
        issues.push({ file, message: `attribute "${key}" is not defined for ${category.id}` });
        continue;
      }
      const err = validateAttributeAgainstDefinition(def, sv.value);
      if (err) issues.push({ file, message: `attribute "${key}": ${err}` });
      if (sv.verification === "independently_verified" && sv.source.kind !== "independent_test") {
        issues.push({ file, message: `attribute "${key}" claims independent verification without an independent_test source` });
      }
    }
    for (const o of p.offers) {
      if (!merchantIds.has(o.merchantId)) issues.push({ file, message: `offer ${o.id} has unknown merchantId ${o.merchantId}` });
    }
    const hasPrimary = p.images.some((i) => i.role === "primary");
    if (!hasPrimary) issues.push({ file, message: "no primary image" });
  }
  return issues;
}

export function loadLocalCatalog(root: string): LoadedCatalog {
  const products = readJsonDir(join(root, "products")).map(({ file, data }) => {
    const r = Product.safeParse(data);
    if (!r.success) throw new Error(`${file}: ${z.prettifyError(r.error)}`);
    return r.data;
  });
  const brands = readJsonDir(join(root, "brands")).map(({ file, data }) => {
    const r = Brand.safeParse(data);
    if (!r.success) throw new Error(`${file}: ${z.prettifyError(r.error)}`);
    return r.data;
  });
  const merchants = readJsonDir(join(root, "merchants")).map(({ file, data }) => {
    const r = Merchant.safeParse(data);
    if (!r.success) throw new Error(`${file}: ${z.prettifyError(r.error)}`);
    return r.data;
  });
  const loaded = { categories, products, brands, merchants };
  const issues = validateCatalog(loaded);
  if (issues.length > 0) {
    throw new Error(`Catalog invalid:\n${issues.map((i) => `  ${i.file}: ${i.message}`).join("\n")}`);
  }
  return loaded;
}

export class LocalCatalogProvider implements CatalogProvider {
  private readonly data: LoadedCatalog;

  constructor(data: LoadedCatalog) {
    this.data = data;
  }

  static fromDirectory(root: string): LocalCatalogProvider {
    return new LocalCatalogProvider(loadLocalCatalog(root));
  }

  async listCategories() {
    return this.data.categories;
  }

  async getCategory(slug: string) {
    return this.data.categories.find((c) => c.slug === slug) ?? null;
  }

  async listProducts(query: ProductQuery = {}) {
    return this.data.products.filter((p) => {
      if (query.categoryId && p.categoryId !== query.categoryId) return false;
      if (query.brandId && p.brandId !== query.brandId) return false;
      if (query.status && !query.status.includes(p.status)) return false;
      if (query.ids && !query.ids.includes(p.id)) return false;
      return true;
    });
  }

  async getProduct(slug: string) {
    return this.data.products.find((p) => p.slug === slug) ?? null;
  }

  async listBrands() {
    return this.data.brands;
  }

  async getBrand(slug: string) {
    return this.data.brands.find((b) => b.slug === slug) ?? null;
  }

  async listMerchants() {
    return this.data.merchants;
  }

  private view(p: Product): ProductView {
    const category = categoryById(p.categoryId);
    if (!category) throw new Error(`Unknown category ${p.categoryId}`);
    return toProductView(p, { category, brands: this.data.brands, merchants: this.data.merchants });
  }

  async listProductViews(query?: ProductQuery) {
    return (await this.listProducts(query)).map((p) => this.view(p));
  }

  async getProductView(slug: string) {
    const p = await this.getProduct(slug);
    return p ? this.view(p) : null;
  }
}
