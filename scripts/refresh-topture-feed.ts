import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { readCsv } from "../src/domain/import/csv";
import { Product } from "../src/domain/product";

const root = resolve(process.cwd());
const feedPath = resolve(process.argv[2] ?? join(root, "intake/topture/products-2026-09-15.csv"));
const checkedOn = process.argv[3] ?? new Date().toISOString().slice(0, 10);
const text = readFileSync(feedPath, "utf8");
const parsed = readCsv(text, Buffer.byteLength(text));
if (!parsed.ok) throw new Error(parsed.reason);

const rows = parsed.rows.map((cells) => Object.fromEntries(parsed.headers.map((header, index) => [header, cells[index] ?? ""])));
const cleanUrl = (raw: string) => {
  const url = new URL(raw);
  url.searchParams.delete("ref");
  return url.toString();
};
const byUrl = new Map(rows.map((row) => [cleanUrl(row.product_url), row]));
const bySku = new Map(rows.map((row) => [row.sku, row]));
const availability = (value: string) =>
  value === "in_stock" ? "in_stock" as const
    : value === "backorder" ? "backorder" as const
      : value === "made_to_order" ? "preorder" as const
        : value === "out_of_stock" ? "out_of_stock" as const
          : "unknown" as const;

let matched = 0;
let changed = 0;
let missing = 0;
for (const name of readdirSync(join(root, "catalog/products")).filter((file) => file.startsWith("topture-") && file.endsWith(".json"))) {
  const path = join(root, "catalog/products", name);
  const product = Product.parse(JSON.parse(readFileSync(path, "utf8")));
  const offer = product.offers.find((candidate) => candidate.merchantId === "topture-store");
  if (!offer) continue;
  const row = byUrl.get(cleanUrl(offer.url)) ?? (offer.merchantSku ? bySku.get(offer.merchantSku) : undefined);
  if (!row) { missing += 1; continue; }
  matched += 1;
  const nextPrice = Math.round(Number(row.price) * 100);
  if (!Number.isFinite(nextPrice)) throw new Error(`Invalid price for ${row.sku}`);
  const nextAvailability = availability(row.availability);
  const nextUrl = row.product_url;
  const nextList = row.compare_at_price ? Math.round(Number(row.compare_at_price) * 100) : undefined;
  const didChange = offer.priceMinor !== nextPrice || offer.availability !== nextAvailability || offer.url !== nextUrl || offer.listPriceMinor !== nextList;
  offer.priceMinor = nextPrice;
  offer.availability = nextAvailability;
  offer.url = nextUrl;
  offer.lastChecked = checkedOn;
  offer.source = {
    kind: "merchant_feed",
    ref: `Topture personal product feed, ${basename(feedPath)}`,
    url: nextUrl,
    retrievedAt: checkedOn,
    method: "direct",
    note: `Official daily partner feed. Availability reported as ${row.availability}.${row.restock_date ? ` Restock date ${row.restock_date}.` : ""}${row.lead_time_weeks ? ` Lead time ${row.lead_time_weeks} weeks.` : ""}`,
  };
  if (nextList === undefined) delete offer.listPriceMinor;
  else offer.listPriceMinor = nextList;
  if (didChange) changed += 1;
  product.availability = nextAvailability;
  product.lastUpdated = checkedOn;
  writeFileSync(path, `${JSON.stringify(Product.parse(product), null, 2)}\n`);
}

console.log(JSON.stringify({ feedRows: rows.length, matched, changed, missing }, null, 2));
