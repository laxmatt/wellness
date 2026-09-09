import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { validateAttributeAgainstDefinition } from "@/domain/attributes";
import { categories, categoryById } from "@/domain/categories";
import type { CategoryDefinition } from "@/domain/category";
import { Brand, Merchant, Product } from "@/domain/product";
import { isUsable } from "@/domain/provenance";
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
      // An attribute may hold no value, and only when the source states none.
      // "Not stated" is a real answer; a value that is simply missing while
      // the record claims the maker reported it is a hole, not an answer.
      if (sv.value === undefined) {
        if (sv.verification !== "not_stated" && sv.verification !== "demo") {
          issues.push({
            file,
            message: `attribute "${key}" has no value but is recorded as "${sv.verification}". Use "not_stated" when the source does not state it.`,
          });
        }
      } else {
        if (sv.verification === "not_stated") {
          issues.push({ file, message: `attribute "${key}" is recorded as "not_stated" and still carries a value. Remove the value or change the verification.` });
        }
        const err = validateAttributeAgainstDefinition(def, sv.value);
        if (err) issues.push({ file, message: `attribute "${key}": ${err}` });
      }
      if (sv.verification === "independently_verified" && sv.source.kind !== "independent_test") {
        issues.push({ file, message: `attribute "${key}" claims independent verification without an independent_test source` });
      }
      // A note-matching rule was tried here and removed. It flagged four
      // irradiance figures whose notes say the measurement DISTANCE is not
      // stated, which is a different fact from the figure itself, and the
      // sanitation note that records a removal. A heuristic that forces true
      // values to be deleted is worse than no heuristic: the exact checks are
      // the ones that hold.
      // A recorded derivation has to be recorded, not inferred: it needs a
      // note saying how the figure was computed, and it only makes sense on a
      // number in the category's money unit.
      if (sv.derivedFrom === "price") {
        if (def.unit !== "USD_minor") {
          issues.push({ file, message: `attribute "${key}" says it is derived from the price but is not a money figure (unit "${def.unit ?? "none"}").` });
        }
        if (!sv.source.note) {
          issues.push({ file, message: `attribute "${key}" says it is derived from the price with no note saying how.` });
        }
      }
      if (sv.bound) {
        if (typeof sv.value !== "number") {
          issues.push({ file, message: `attribute "${key}" carries a bound but its value is not a number. A bound qualifies an amount.` });
        }
        if (!isUsable(sv.verification)) {
          issues.push({ file, message: `attribute "${key}" carries a bound on a "${sv.verification}" value. A bound qualifies a fact; this is not one.` });
        }
        if (!sv.source.note) {
          issues.push({ file, message: `attribute "${key}" carries a bound with no source note. The note is where the wording that justifies it lives.` });
        }
        // Scoring reads the number, so a bound must point at the end that
        // cannot flatter the product. "More than 189" on a higher-is-better
        // figure scores 189 and understates it. The reverse, a floor on a
        // lower-is-better figure, would score the best case of a range whose
        // top nobody stated.
        const flattering =
          (sv.bound === "greater_than" && def.preferenceDirection === "lower_better") ||
          (sv.bound === "less_than" && def.preferenceDirection === "higher_better");
        if (flattering) {
          issues.push({
            file,
            message: `attribute "${key}" records a "${sv.bound}" bound on a ${def.preferenceDirection} figure, so scoring would read the flattering end of a range nobody stated.`,
          });
        }
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
