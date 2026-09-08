import type { CategoryDefinition } from "@/domain/category";
import type { Brand, Merchant, Product, ProductStatus } from "@/domain/product";
import type { ProductView } from "@/domain/view";

export type ProductQuery = {
  categoryId?: string;
  brandId?: string;
  status?: ProductStatus[];
  ids?: string[];
};

// Read interface over the catalog. Phase 6 adds a MerchandisingStore for
// writes (pins, order, visibility). The public site only needs reads.
export interface CatalogProvider {
  listCategories(): Promise<CategoryDefinition[]>;
  getCategory(slug: string): Promise<CategoryDefinition | null>;
  listProducts(query?: ProductQuery): Promise<Product[]>;
  getProduct(slug: string): Promise<Product | null>;
  listBrands(): Promise<Brand[]>;
  getBrand(slug: string): Promise<Brand | null>;
  listMerchants(): Promise<Merchant[]>;
  // Convenience: products already normalized for the UI.
  listProductViews(query?: ProductQuery): Promise<ProductView[]>;
  getProductView(slug: string): Promise<ProductView | null>;
}
