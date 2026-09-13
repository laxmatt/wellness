/**
 * A local preview catalogue, laid over the real one and never into it.
 *
 * The overlay holds records staged from a supplier file: invented products, an
 * invented brand and an invented supplier. It exists so an operator can watch
 * one run the whole way through, from a file to a category page, on their own
 * machine.
 *
 * Three rules keep it from being anything more than that.
 *
 * **It only adds.** An overlay record may not take an id or a slug the real
 * catalogue already holds, and every overlay id has to start with `preview-`.
 * There is no path through here that edits, shadows or contradicts a catalogue
 * fact, so every existing fact survives the overlay by construction rather than
 * by care.
 *
 * **It is all or nothing.** A file that does not parse, an id that collides, or
 * a merged catalogue that fails validation refuses the whole overlay, not the
 * offending record. Dropping one record quietly is how an operator ends up
 * looking at a catalogue that is missing something they staged and saying
 * nothing about it.
 *
 * **It never breaks the site.** A refused overlay serves the real catalogue,
 * unchanged, and writes its reasons to stderr. An operator's scratch directory
 * is not a reason for a storefront to stop rendering.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isPreviewId } from "@/domain/inventory/identity";
import { categories } from "@/domain/categories";
import { previewInventoryDecision, type PreviewInventoryEnv } from "@/lib/preview-inventory";
import { loadLocalCatalog, readCatalogRecords, validateCatalog, type CatalogRecords, type LoadedCatalog } from "./LocalCatalogProvider";

export type OverlayOutcome =
  | { loaded: true; catalog: LoadedCatalog; added: { products: number; brands: number; merchants: number } }
  | { loaded: false; catalog: LoadedCatalog; refused: string[] };

/**
 * Every reason these overlay records may not be laid over this base, in one
 * place.
 *
 * Shared with the operator tool, which runs it before writing anything: an
 * operator finding out that a staged record collides with the real catalogue
 * when the storefront quietly stops showing it is the wrong time to find out.
 */
export function overlayRefusals(base: LoadedCatalog, overlay: CatalogRecords): string[] {
  const refused: string[] = [];
  const baseProductIds = new Set(base.products.map((p) => p.id));
  const baseProductSlugs = new Set(base.products.map((p) => p.slug));
  const baseBrandIds = new Set(base.brands.map((b) => b.id));
  const baseBrandSlugs = new Set(base.brands.map((b) => b.slug));
  const baseMerchantIds = new Set(base.merchants.map((m) => m.id));
  const baseMerchantSlugs = new Set(base.merchants.map((m) => m.slug));

  const check = (kind: string, id: string, slug: string, ids: Set<string>, slugs: Set<string>) => {
    if (!isPreviewId(id)) {
      refused.push(`${kind} "${id}" is not a preview id. Everything in the preview catalogue has to be named "preview-..." so it cannot be confused with, or collide with, a real record.`);
    }
    if (ids.has(id)) refused.push(`${kind} "${id}" already exists in the real catalogue. The preview catalogue adds records and never replaces one.`);
    if (slugs.has(slug)) {
      refused.push(`${kind} "${id}" uses the slug "${slug}", which the real catalogue already uses. The preview catalogue adds records and never takes a real record's address.`);
    }
  };

  for (const p of overlay.products) check("Product", p.id, p.slug, baseProductIds, baseProductSlugs);
  for (const b of overlay.brands) check("Brand", b.id, b.slug, baseBrandIds, baseBrandSlugs);
  for (const m of overlay.merchants) check("Merchant", m.id, m.slug, baseMerchantIds, baseMerchantSlugs);

  if (refused.length > 0) return refused;

  return validateCatalog(mergeCatalog(base, overlay)).map((i) => `${i.file}: ${i.message}`);
}

export function mergeCatalog(base: LoadedCatalog, overlay: CatalogRecords): LoadedCatalog {
  return {
    categories,
    products: [...base.products, ...overlay.products],
    brands: [...base.brands, ...overlay.brands],
    merchants: [...base.merchants, ...overlay.merchants],
  };
}

/** Merge an overlay directory into a base catalogue, or say why it was refused. */
export function applyPreviewOverlay(base: LoadedCatalog, previewRoot: string): OverlayOutcome {
  if (!existsSync(previewRoot)) return { loaded: false, catalog: base, refused: [] };

  let overlay: CatalogRecords;
  try {
    overlay = readCatalogRecords(previewRoot, true);
  } catch (e) {
    return { loaded: false, catalog: base, refused: [e instanceof Error ? e.message : String(e)] };
  }

  const refused = overlayRefusals(base, overlay);
  if (refused.length > 0) return { loaded: false, catalog: base, refused };

  return {
    loaded: true,
    catalog: mergeCatalog(base, overlay),
    added: { products: overlay.products.length, brands: overlay.brands.length, merchants: overlay.merchants.length },
  };
}

/**
 * What the preview directory holds right now, as one string.
 *
 * The point is to notice a change made while the site is running. An operator
 * approves a record and reloads the page; nothing has restarted, and the page
 * has to show it.
 *
 * Contents, not modification times. Two writes inside one filesystem timestamp
 * tick are exactly the case this has to catch, and an operator pressing approve
 * twice in a second is not unusual. The directory holds a handful of small JSON
 * files and this runs only where the preview catalogue is allowed at all, so
 * the real site never reads a byte of it.
 */
export function previewSignature(root: string): string {
  if (!existsSync(root)) return "absent";
  const hash = createHash("sha256");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else hash.update(path).update("\u0000").update(readFileSync(path));
    }
  };
  walk(root);
  return hash.digest("hex");
}

export type CatalogLoad = { catalog: LoadedCatalog; notices: string[] };

/**
 * The real catalogue, plus the preview overlay when this machine may have it.
 *
 * The decision is taken here rather than by a caller, so there is no call site
 * that can forget it.
 */
export function loadCatalogWithPreview(baseRoot: string, previewRoot: string, env: PreviewInventoryEnv): CatalogLoad {
  const base = loadLocalCatalog(baseRoot);
  const decision = previewInventoryDecision(env);
  if (!decision.allowed) {
    return { catalog: base, notices: decision.announce ? [`Preview catalogue not loaded. ${decision.reason}`] : [] };
  }

  const outcome = applyPreviewOverlay(base, previewRoot);
  if (!outcome.loaded) {
    if (outcome.refused.length === 0) return { catalog: base, notices: [] };
    return {
      catalog: base,
      notices: [
        `Preview catalogue refused, and the real catalogue is being served unchanged. ${outcome.refused.length} problem${outcome.refused.length === 1 ? "" : "s"}:`,
        ...outcome.refused.map((r) => `  ${r}`),
      ],
    };
  }

  const { products, brands, merchants } = outcome.added;
  return {
    catalog: outcome.catalog,
    notices: [
      `Preview catalogue loaded: ${products} product${products === 1 ? "" : "s"}, ${brands} brand${brands === 1 ? "" : "s"}, ${merchants} supplier${merchants === 1 ? "" : "s"}. These are invented records staged from a sample file and must not be served to anybody.`,
    ],
  };
}
