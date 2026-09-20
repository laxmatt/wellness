/**
 * The preview catalogue on disk, and the only code that writes to it.
 *
 * Every path is built from a record id that matched `^preview-[a-z0-9-]+$`, and
 * every path is then checked to resolve inside the store's own root. Nothing
 * read out of a supplier file reaches a path: the id is derived here, from
 * text, through `previewProductId`, and the pattern it has to match admits no
 * separator, no dot and no space.
 *
 * The store never writes outside its root, so it cannot touch `catalog/`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { previewFileName } from "@/domain/inventory/identity";
import { Product, type Brand, type Merchant } from "@/domain/product";
import { readCatalogRecords, validateCatalog, type CatalogRecords, type LoadedCatalog } from "./LocalCatalogProvider";
import { mergeCatalog, overlayRefusals } from "./preview-overlay";

export type PreviewKind = "products" | "brands" | "merchants";
const KINDS: PreviewKind[] = ["products", "brands", "merchants"];

export class PreviewStore {
  constructor(readonly root: string) {}

  path(kind: PreviewKind, id: string): string {
    const path = resolve(this.root, kind, previewFileName(id));
    // The second lock. `previewFileName` already refuses anything that is not a
    // preview id; this does not depend on that pattern staying right.
    if (!path.startsWith(resolve(this.root) + sep)) {
      throw new Error(`Refusing to touch a path outside the preview catalogue: ${path}`);
    }
    return path;
  }

  records(): CatalogRecords {
    if (!existsSync(this.root)) return { products: [], brands: [], merchants: [] };
    return readCatalogRecords(this.root, true);
  }

  has(id: string): boolean {
    return existsSync(this.path("products", id));
  }

  /** One staged product, or a thrown error naming what is wrong with the file. */
  product(id: string): Product {
    const path = this.path("products", id);
    if (!existsSync(path)) throw new Error(`No staged record with id "${id}".`);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      throw new Error(`${path} is not readable as JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    const parsed = Product.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${path} is not a valid product record:\n${parsed.error.issues.map((i) => `  ${i.path.join(".") || "record"}: ${i.message}`).join("\n")}`);
    }
    return parsed.data;
  }

  write(kind: PreviewKind, id: string, data: Product | Brand | Merchant): void {
    const path = this.path(kind, id);
    mkdirSync(join(this.root, kind), { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  remove(id: string): void {
    const path = this.path("products", id);
    if (!existsSync(path)) throw new Error(`No staged record with id "${id}".`);
    rmSync(path);
  }

  clear(): number {
    if (!existsSync(this.root)) return 0;
    let removed = 0;
    for (const kind of KINDS) {
      const dir = join(this.root, kind);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        rmSync(join(dir, file));
        removed++;
      }
    }
    return removed;
  }
}

/**
 * Every reason a set of preview records may not be laid over this catalogue.
 *
 * Run before writing, never after. An operator finding out that a staged record
 * collides with the real catalogue by noticing the storefront quietly stopped
 * showing it is the wrong way round.
 */
export function refusalsFor(base: LoadedCatalog, records: CatalogRecords): string[] {
  return overlayRefusals(base, records);
}

export { mergeCatalog, validateCatalog };
