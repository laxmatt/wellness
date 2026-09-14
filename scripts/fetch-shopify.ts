/**
 * Fetch a partner's own Shopify catalogue into a snapshot, on a machine that
 * can reach it.
 *
 *   npm run fetch:shopify -- topture
 *   npm run fetch:shopify -- --all
 *
 * The only thing in this project that makes a request to a partner, and it is a
 * command a person runs rather than anything the loopback tool can reach. That
 * separation is the point: the admin server answers unauthenticated requests on
 * loopback, and a server that could be asked to fetch an arbitrary address is a
 * proxy into whatever else that machine can see.
 *
 * `/products.json` is the store's own structured catalogue. It is public, takes
 * no credential, and this sends none: no header, no cookie, no query parameter
 * but the page and the page size. The snapshot records every address it read,
 * and `IngestionStore` refuses to save a file that looks like it carries a key.
 *
 * A failed fetch leaves the last good snapshot alone. Pages are written to a
 * temporary file and moved into place only when every page has arrived, so a
 * partner going down mid-run costs a refresh rather than the inventory.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SHOPIFY_LIMITS, type ShopifyProduct, type ShopifySnapshot } from "@/domain/ingestion/shopify";
import { SHOPIFY_SOURCES } from "./shopify-partners";

const ROOT = process.cwd();
const OUT = join(ROOT, "intake", "shopify");

/** Bounds on one run. A storefront is tens of pages, never hundreds. */
const PAGE_SIZE = 250;
const MAX_PAGES = 40;
const TIMEOUT_MS = 30_000;
const RETRIES = 2;

type PageResult = { ok: true; products: ShopifyProduct[] } | { ok: false; reason: string };

async function readPage(url: string): Promise<PageResult> {
  for (let attempt = 0; ; attempt++) {
    const clock = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: clock,
        redirect: "follow",
        // Said plainly. A partner reading their own logs should be able to see
        // who this is and why, and nothing here pretends to be a browser.
        headers: { accept: "application/json", "user-agent": "wellness-fit-check/1.0 (affiliate catalogue sync; contact the site owner)" },
      });
      if (!response.ok) {
        // 401, 403 and 429 are answers, not accidents: a partner saying no, or
        // saying not so fast. Retrying past one of those is the thing this must
        // not do.
        if ([401, 403, 404, 429].includes(response.status) || attempt >= RETRIES) {
          return { ok: false, reason: `${url.replace(/\?.*$/, "")} answered ${response.status} ${response.statusText}.` };
        }
      } else {
        const body = (await response.json()) as { products?: unknown };
        if (!Array.isArray(body.products)) return { ok: false, reason: `${url.replace(/\?.*$/, "")} returned no products array.` };
        return { ok: true, products: body.products as ShopifyProduct[] };
      }
    } catch (e) {
      if (attempt >= RETRIES) return { ok: false, reason: `${url.replace(/\?.*$/, "")} could not be reached: ${e instanceof Error ? e.message : String(e)}` };
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
}

export async function fetchStore(sourceId: string, storeUrl: string): Promise<{ ok: true; snapshot: ShopifySnapshot } | { ok: false; reason: string; requested: string[] }> {
  const requested: string[] = [];
  const products: ShopifyProduct[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${storeUrl.replace(/\/+$/, "")}/products.json?limit=${PAGE_SIZE}&page=${page}`;
    requested.push(url);
    const result = await readPage(url);
    if (!result.ok) return { ok: false, reason: result.reason, requested };
    products.push(...result.products);
    if (products.length > SHOPIFY_LIMITS.products) return { ok: false, reason: `More than ${SHOPIFY_LIMITS.products} products; stopping rather than reading a catalogue this size.`, requested };
    // A short page is the last page. An empty one is too.
    if (result.products.length < PAGE_SIZE) break;
  }
  return {
    ok: true,
    snapshot: {
      sourceId,
      storeUrl,
      requested,
      pages: requested.length,
      productCount: products.length,
      variantCount: products.reduce((n, p) => n + (p.variants?.length ?? 0), 0),
      fetchedAt: new Date().toISOString(),
      products,
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wanted = args.includes("--all") ? SHOPIFY_SOURCES.map((s) => s.id) : args.filter((a) => !a.startsWith("--"));
  if (wanted.length === 0) {
    console.error(`Name a source, or --all. Known: ${SHOPIFY_SOURCES.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });
  let failed = 0;
  for (const id of wanted) {
    const source = SHOPIFY_SOURCES.find((s) => s.id === id);
    if (!source) {
      console.error(`${id}: not a source this knows.`);
      failed += 1;
      continue;
    }
    process.stdout.write(`${source.name}: `);
    const result = await fetchStore(source.id, source.storeUrl);
    if (!result.ok) {
      console.log(`failed. ${result.reason}`);
      console.log(`  ${result.requested.length} address(es) tried. The last good snapshot, if there is one, was not touched.`);
      failed += 1;
      continue;
    }
    const path = join(OUT, `${source.id}.json`);
    const temp = `${path}.partial`;
    writeFileSync(temp, `${JSON.stringify(result.snapshot, null, 2)}\n`, "utf8");
    renameSync(temp, path);
    console.log(`${result.snapshot.productCount} products, ${result.snapshot.variantCount} variants, ${result.snapshot.pages} page(s) → intake/shopify/${source.id}.json`);
  }
  if (failed > 0) process.exit(1);
}

if (process.argv[1]?.endsWith("fetch-shopify.ts")) void main();
