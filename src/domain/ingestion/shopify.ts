/**
 * A Shopify storefront's own product catalogue, read as rows.
 *
 * Three of the approved partners run Shopify and publish `/products.json`,
 * which is the store's own structured catalogue: product and variant ids, SKUs,
 * titles, product types, tags, prices, compare-at prices, availability, images,
 * handles and timestamps. It is the same kind of evidence as a merchant feed
 * and a better kind than a page read by hand.
 *
 * **One row per variant.** A Shopify product is a model and its variants are
 * the configurations it is sold in, which is the shape this pipeline already
 * groups: the rows come out flat, the profile groups them on the product
 * handle, and the cheapest variant represents the model exactly as the
 * cheapest row of the Awin feed does. Nothing new had to be invented for that.
 *
 * **Nothing here fetches.** Reading and fetching are separate on purpose: this
 * takes text and returns rows, so it is pure, testable and reachable from the
 * loopback tool without giving that tool the ability to make requests. The
 * fetching lives in `scripts/fetch-shopify.ts`, is run by a person, and writes
 * a snapshot this reads.
 *
 * **Nothing here carries a credential.** `/products.json` is public and takes
 * none. A snapshot records the addresses it read, and those addresses have no
 * key in them; if one ever did, `IngestionStore` refuses to save it.
 */

import type { SourceAdapter, SourceTable } from "./adapter";

/** The columns every Shopify source produces, in the order a person reads them. */
export const SHOPIFY_COLUMNS = [
  "product_id",
  "product_handle",
  "product_title",
  "vendor",
  "product_type",
  "tags",
  "product_url",
  "product_created_at",
  "product_updated_at",
  "variant_id",
  "variant_title",
  "variant_sku",
  "variant_url",
  "price",
  "compare_at_price",
  "available",
  "variant_position",
  "variant_updated_at",
  "image_src",
  "image_count",
  "variant_count",
  "option_names",
  "body_text",
] as const;

/**
 * What a fetched snapshot holds.
 *
 * The products as the store returned them, and enough about the fetch to say
 * what was read and when: every address requested, how many pages came back,
 * and the moment the last page arrived. A record built from it cites this.
 */
export type ShopifySnapshot = {
  /** The partner source this belongs to. */
  sourceId: string;
  /** The store's own origin, which is where product addresses are built from. */
  storeUrl: string;
  /** Every address read, in order. Public, and never carrying a key. */
  requested: string[];
  pages: number;
  productCount: number;
  variantCount: number;
  /** When the last page arrived, as an instant. */
  fetchedAt: string;
  products: ShopifyProduct[];
};

export type ShopifyVariant = {
  id: number | string;
  title?: string;
  sku?: string | null;
  price?: string | number | null;
  compare_at_price?: string | number | null;
  available?: boolean;
  position?: number;
  updated_at?: string;
  featured_image?: { src?: string } | null;
};

export type ShopifyProduct = {
  id: number | string;
  title?: string;
  handle?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  body_html?: string;
  created_at?: string;
  updated_at?: string;
  variants?: ShopifyVariant[];
  images?: { src?: string; position?: number }[];
  options?: { name?: string }[];
};

/**
 * How many bytes one product costs, measured rather than guessed.
 *
 * Select Saunas' real catalogue is 737 products in 6,333 kB: 8.6 kB each, and
 * almost all of that is `body_html`, a merchant's marketing page stored as
 * markup. 12 kB gives the worst store measured half again in headroom, and it
 * is the number every bound below is derived from, so raising one raises all
 * of them for one stated reason.
 */
export const BYTES_PER_PRODUCT = 12_000;

/** Bounds. A storefront catalogue is thousands of variants, not millions. */
export const SHOPIFY_LIMITS = {
  products: 5_000,
  variants: 25_000,
  /** 5,000 products at 12 kB each. Not a round number chosen to look safe. */
  bytes: 5_000 * BYTES_PER_PRODUCT,
} as const;

/**
 * The largest snapshot that may arrive through the browser, which is a
 * different question from how large a snapshot may be.
 *
 * A file picked in the tool travels as a string inside a JSON command, and the
 * server holds the chunks, the joined body, the parsed text and the built table
 * at once. A catalogue that big does not need to make that trip: `npm run
 * fetch:shopify` has already written it to `intake/shopify/`, atomically, and
 * the tool reads it from there by naming the source rather than a path.
 *
 * A thousand products at the measured rate. Every real partner catalogue today
 * fits with room to spare: the largest is 737 products and 6,333 kB.
 */
export const SNAPSHOT_UPLOAD_LIMIT = 1_000 * BYTES_PER_PRODUCT;

const text = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

/**
 * Markup to readable text, with the markup thrown away rather than parsed.
 *
 * `body_html` is a description a merchant wrote. It is kept so a draft has a
 * description and so a reviewer can read it; nothing reads a specification out
 * of it, here or anywhere, and the profiles refuse to map a rule onto it.
 */
export function bodyText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** The store's own address for a product, built from the store's own origin and handle. */
export function productUrl(storeUrl: string, handle: string): string {
  return `${storeUrl.replace(/\/+$/, "")}/products/${handle}`;
}

export type SnapshotResult = { ok: true; snapshot: ShopifySnapshot } | { ok: false; reason: string };

/** A snapshot read back from text, or the reason it was refused. */
export function readSnapshot(input: string, byteLength = input.length): SnapshotResult {
  if (byteLength > SHOPIFY_LIMITS.bytes) {
    return { ok: false, reason: `This snapshot is ${Math.round(byteLength / 1_000_000)} MB. This reads snapshots up to ${SHOPIFY_LIMITS.bytes / 1_000_000} MB.` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch (e) {
    return { ok: false, reason: `This is not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "A snapshot is a JSON object." };
  const obj = raw as Partial<ShopifySnapshot> & { products?: unknown };
  if (!Array.isArray(obj.products)) {
    return { ok: false, reason: 'A snapshot holds a "products" array. This one holds none, so it is not a Shopify catalogue.' };
  }
  const products = obj.products as ShopifyProduct[];
  if (products.length > SHOPIFY_LIMITS.products) {
    return { ok: false, reason: `This snapshot holds ${products.length} products. This reads up to ${SHOPIFY_LIMITS.products}.` };
  }
  const variantCount = products.reduce((n, p) => n + (p.variants?.length ?? 0), 0);
  if (variantCount > SHOPIFY_LIMITS.variants) {
    return { ok: false, reason: `This snapshot holds ${variantCount} variants. This reads up to ${SHOPIFY_LIMITS.variants}.` };
  }
  const storeUrl = text(obj.storeUrl);
  if (storeUrl === "") {
    return { ok: false, reason: "A snapshot says which store it came from. Without it no product address can be built, and this will not guess one." };
  }
  return {
    ok: true,
    snapshot: {
      sourceId: text(obj.sourceId),
      storeUrl,
      requested: Array.isArray(obj.requested) ? obj.requested.map(text) : [],
      pages: typeof obj.pages === "number" ? obj.pages : 0,
      productCount: products.length,
      variantCount,
      fetchedAt: text(obj.fetchedAt),
      products,
    },
  };
}

/** One row per variant, flat, in the column order above. */
export function tableFromSnapshot(snapshot: ShopifySnapshot): SourceTable {
  const rows: Record<string, string>[] = [];
  let skippedProducts = 0;
  let skippedVariants = 0;

  for (const product of snapshot.products) {
    const handle = text(product.handle);
    if (handle === "") {
      // No handle, no address. A product this store will not name is one this
      // cannot link to, so it is counted and left out rather than guessed at.
      skippedProducts += 1;
      continue;
    }
    const url = productUrl(snapshot.storeUrl, handle);
    const tags = Array.isArray(product.tags) ? product.tags.join(", ") : text(product.tags);
    const variants = product.variants ?? [];
    const shared = {
      product_id: text(product.id),
      product_handle: handle,
      product_title: text(product.title),
      vendor: text(product.vendor),
      product_type: text(product.product_type),
      tags,
      product_url: url,
      product_created_at: text(product.created_at),
      product_updated_at: text(product.updated_at),
      image_count: String(product.images?.length ?? 0),
      variant_count: String(variants.length),
      option_names: (product.options ?? []).map((o) => text(o.name)).filter(Boolean).join(", "),
      body_text: bodyText(text(product.body_html)),
    };
    if (variants.length === 0) {
      skippedProducts += 1;
      continue;
    }
    for (const variant of variants) {
      const id = text(variant.id);
      if (id === "") {
        skippedVariants += 1;
        continue;
      }
      rows.push({
        ...shared,
        variant_id: id,
        variant_title: text(variant.title),
        variant_sku: text(variant.sku),
        variant_url: `${url}?variant=${id}`,
        price: text(variant.price),
        compare_at_price: text(variant.compare_at_price),
        available: variant.available === true ? "true" : variant.available === false ? "false" : "",
        variant_position: text(variant.position),
        variant_updated_at: text(variant.updated_at),
        image_src: text(variant.featured_image?.src) || text(product.images?.[0]?.src),
      });
    }
  }

  const notes = [
    `Read from ${snapshot.storeUrl}: ${snapshot.productCount} products, ${snapshot.variantCount} variants, ${snapshot.pages} page${snapshot.pages === 1 ? "" : "s"}.`,
    snapshot.fetchedAt ? `Fetched ${snapshot.fetchedAt}.` : "The snapshot records no fetch time.",
  ];
  if (skippedProducts > 0) notes.push(`${skippedProducts} products carry no handle or no variant and produced no row.`);
  if (skippedVariants > 0) notes.push(`${skippedVariants} variants carry no id and produced no row.`);

  return { columns: [...SHOPIFY_COLUMNS], rows, notes, truncated: 0 };
}

export const shopifyAdapter: SourceAdapter = {
  format: "json",
  label: "Shopify catalogue snapshot",
  note: `A snapshot of a store's own /products.json, one row per variant, up to ${SHOPIFY_LIMITS.products} products and ${SHOPIFY_LIMITS.variants} variants. Fetched by \`npm run fetch:shopify\`, which is run by a person and writes the snapshot this reads. Nothing in the tool makes a request.`,
  maxUploadBytes: SNAPSHOT_UPLOAD_LIMIT,
  overLimitAdvice:
    "A snapshot that size is already on this machine: `npm run fetch:shopify` wrote it to intake/shopify/. Choose \"read the snapshot on disk\" beside the source instead of sending the same bytes back through the browser. That route reads the file the fetch command wrote, by naming the partner rather than a path.",
  read(input, byteLength) {
    const snapshot = readSnapshot(input, byteLength);
    if (!snapshot.ok) return { ok: false, reason: snapshot.reason };
    const table = tableFromSnapshot(snapshot.snapshot);
    if (table.rows.length === 0) return { ok: false, reason: "This snapshot produced no rows: every product in it carries no handle, or no variant." };
    return { ok: true, table };
  },
};
