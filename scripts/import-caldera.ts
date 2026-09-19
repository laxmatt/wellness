/** Merge Caldera's approved catalogue into existing products by manufacturer SKU. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Product } from "@/domain/product";
import { bodyText } from "@/domain/ingestion/shopify";

const TODAY = "2026-09-19";
const productsDir = join(process.cwd(), "catalog/products");
const snapshot = JSON.parse(readFileSync(join(process.cwd(), "intake/shopify/caldera-shopify.json"), "utf8")) as { products: any[] };
const records = readdirSync(productsDir).filter((name) => name.endsWith(".json")).map((name) => ({ name, value: JSON.parse(readFileSync(join(productsDir, name), "utf8")) }));
const normalizeSku = (value: unknown) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const existingBySku = new Map<string, { name: string; value: any }>();
for (const record of records) for (const sku of Object.values(record.value.identifiers?.merchantSkus || {})) existingBySku.set(normalizeSku(sku), record);
const excluded = /(accessor|cover|filter|chiller|heater|controller|steam generator|stone|bucket|ladle|panel|therapy|light|door|thermometer|valve|chimney|stove|bench|backrest)/i;
const selected = snapshot.products.filter((raw) => !excluded.test(`${raw.title} ${raw.product_type}`));
const sourceFor = (raw: any, url: string) => ({ kind: "merchant_feed" as const, ref: "Caldera Sauna, official public Shopify snapshot", url, retrievedAt: TODAY, method: "direct" as const, note: "Caldera instructed Wellness Fit Check to use its site as the product source and issued checkout code MO926. Supplier claims are not independent testing." });
let merged = 0, created = 0;
for (const raw of selected) {
  const variant = raw.variants[0];
  const url = `https://www.calderasauna.com/products/${raw.handle}`;
  const source = sourceFor(raw, url);
  const offer = { id: `caldera-${raw.handle}-offer`, merchantId: "caldera-store", market: "US" as const, currency: "USD" as const, priceMinor: Math.round(Number(variant.price) * 100), url, affiliate: { status: "affiliate" as const, network: "direct" as const, programRef: "MO926" }, discountCodes: [{ code: "MO926", description: "Use Caldera's issued code at checkout to reveal the affiliate discount.", source }], availability: variant.available ? "in_stock" as const : "out_of_stock" as const, merchantSku: variant.sku || undefined, lastChecked: TODAY, source };
  const existing = existingBySku.get(normalizeSku(variant.sku));
  if (existing) {
    existing.value.offers = [...existing.value.offers.filter((item: any) => item.merchantId !== "caldera-store"), offer];
    existing.value.identifiers.merchantSkus["caldera-store"] = variant.sku;
    existing.value.lastUpdated = TODAY;
    writeFileSync(join(productsDir, existing.name), `${JSON.stringify(Product.parse(existing.value), null, 2)}\n`);
    merged++;
    continue;
  }
  const id = `caldera-${raw.handle}`.replace(/[^a-z0-9-]+/g, "-");
  const title = raw.title.replace(/\s*\|\s*SKU:.*/i, "");
  const capacityMatch = /(\d+)\s*[–-]?\s*(\d+)?\s*Person/i.exec(title);
  const capacity = Number(capacityMatch?.[2] || capacityMatch?.[1] || 1);
  const brandId = /orivon/i.test(title) ? "orivon-wellness" : "dynamic-saunas";
  const description = bodyText(raw.body_html || "") || title;
  const record = Product.parse({ id, slug: id, name: title, brandId, categoryId: "saunas", description, status: "published", availability: variant.available ? "in_stock" : "out_of_stock", market: "US", images: raw.images.slice(0, 4).map((image: any, index: number) => ({ id: `${id}-image-${index + 1}`, kind: "affiliate_feed", role: index ? "gallery" : "primary", src: image.src, alt: title, source })), offers: [offer], variants: [], identifiers: { gtin: [], merchantSkus: { "caldera-store": variant.sku } }, attributes: { sauna_type: { value: "far_infrared", source, verification: "manufacturer_reported" }, sauna_style: { value: "cabin", source, verification: "manufacturer_reported" }, placement: { value: "indoor", source, verification: "manufacturer_reported" }, capacity_label: { value: capacityMatch?.[0] || `${capacity}-person`, source, verification: "manufacturer_reported" }, capacity_max_people: { value: capacity, source, verification: "manufacturer_reported" } }, sourceTitle: raw.title, editorial: { strengths: [], tradeoffs: [] }, source, lastUpdated: TODAY, flags: { demo: false, newArrival: true } });
  writeFileSync(join(productsDir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  created++;
}
console.log(`Caldera: merged ${merged} retailer offers; created ${created} products; excluded ${snapshot.products.length - selected.length} accessory/non-sauna rows.`);
