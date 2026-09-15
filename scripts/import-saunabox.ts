/** Build reviewed SAUNABOX products from its official public Shopify snapshot. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Product } from "@/domain/product";
import { bodyText } from "@/domain/ingestion/shopify";
import { extractSaunaEnvironment } from "@/domain/ingestion/sauna-environment";

const TODAY = "2026-09-15";
const REFERRAL = "https://www.saunabox.com/MATT41058";
const INCLUDED = ["forge-sauna", "solara-2-person", "pulse-pro-portable-ir-sauna-with-redlights", "saunabox-smartsteam-kit-pro-with-red-light-therapy", "solara-full-spectrum-infrared-sauna", "saunabox-go", "saunabox-smartsteam-kit"] as const;
const specs: Record<string, Record<string, string | number>> = {
  "forge-sauna": { capacity_label: "1 person", capacity_max_people: 1, sauna_type: "traditional", sauna_style: "cabin", placement: "outdoor", width_in: 43.31, depth_in: 41.34, height_in: 80.71, connection: "hardwired", voltage: "240v", heater_kw: 3.5, heater_model: "Harvia Vega Compact BU (HCBU352401)" },
  "solara-2-person": { capacity_label: "2 person", capacity_max_people: 2, sauna_type: "far_infrared", sauna_style: "cabin", placement: "indoor", width_in: 51, depth_in: 41, height_in: 71, connection: "plug_in", amperage_a: 20, heater_model: "8 Carbon Coated ThermoCell infrared panels" },
  "pulse-pro-portable-ir-sauna-with-redlights": { sauna_type: "far_infrared", sauna_style: "tent", placement: "indoor", connection: "plug_in", voltage: "120v", heater_model: "6 ThermoCell far-infrared panels" },
  "saunabox-smartsteam-kit-pro-with-red-light-therapy": { sauna_type: "steam", sauna_style: "tent", placement: "indoor_outdoor", width_in: 35, depth_in: 35, height_in: 74, connection: "plug_in", voltage: "120v", heater_model: "SmartSteam Pro heating unit" },
  "solara-full-spectrum-infrared-sauna": { capacity_label: "1 person", capacity_max_people: 1, sauna_type: "far_infrared", sauna_style: "cabin", placement: "indoor", width_in: 35, depth_in: 37, height_in: 63, connection: "plug_in", voltage: "120v", heater_model: "Ultra-low EMF infrared panels" },
  "saunabox-go": { capacity_label: "2 person", capacity_max_people: 2, sauna_type: "steam", sauna_style: "tent", placement: "indoor", width_in: 56, depth_in: 49, height_in: 53, connection: "plug_in", voltage: "120v", heater_model: "SmartSteam Pro heating unit" },
  "saunabox-smartsteam-kit": { sauna_type: "steam", sauna_style: "tent", placement: "indoor_outdoor", width_in: 35, depth_in: 35, height_in: 74, connection: "plug_in", voltage: "120v", heater_model: "SmartSteam Pro heating unit" },
};

const snapshotPath = join(process.cwd(), "intake/shopify/saunabox-shopify.json");
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as { products: any[] };
const selected = snapshot.products.filter((product) => INCLUDED.includes(product.handle));
if (selected.length !== INCLUDED.length) throw new Error(`Expected ${INCLUDED.length} complete saunas; found ${selected.length}.`);

const productSource = (url: string) => ({ kind: "manufacturer" as const, url, retrievedAt: TODAY, method: "direct" as const, ref: "SAUNABOX official public Shopify storefront snapshot", note: "Read from SAUNABOX's official product listing. Supplier claims are not independent testing." });
const output = join(process.cwd(), "catalog/products");
mkdirSync(output, { recursive: true });

for (const raw of selected) {
  const id = `saunabox-${raw.handle.replace(/[^a-z0-9]+/g, "-")}`;
  const productUrl = `https://www.saunabox.com/products/${raw.handle}`;
  const variants = raw.variants as any[];
  const active = variants.filter((variant) => variant.available);
  const representative = (active.length ? active : variants).reduce((best, variant) => Number(variant.price) < Number(best.price) ? variant : best);
  const source = productSource(productUrl);
  const description = bodyText(raw.body_html ?? "");
  const attributes = Object.fromEntries(Object.entries(specs[raw.handle]).map(([key, value]) => [key, { value, source, verification: "manufacturer_reported" }]));
  for (const fact of extractSaunaEnvironment(description)) attributes[fact.key] = { value: fact.value, source: { ...source, note: `Explicit product-page evidence: “${fact.matched}”. Supplier claim; not independently verified.` }, verification: "manufacturer_reported" };
  const offer = (variant: any, suffix = "offer") => ({ id: `${id}-${suffix}`, merchantId: "saunabox", market: "US" as const, currency: "USD" as const, priceMinor: Math.round(Number(variant.price) * 100), url: REFERRAL, affiliate: { status: "affiliate" as const, network: "direct" as const, programRef: "80182564" }, discountCodes: [], availability: variant.available ? "in_stock" as const : "out_of_stock" as const, merchantSku: variant.sku || undefined, lastChecked: TODAY, source: { ...source, note: "Price, variant and availability come from SAUNABOX's official Shopify listing. Outbound uses the exact Social Snowball referral URL issued to Matt; no unverified deep-link transformation is applied. The referral advertises 5% customer savings and 5% commission." } });
  const record = Product.parse({ id, slug: id, name: raw.title.replace(/^SaunaBox®\s*/, "SAUNABOX "), brandId: "saunabox", categoryId: "saunas", description, status: "published", availability: active.length ? "in_stock" : "out_of_stock", market: "US", images: raw.images.slice(0, 4).map((image: any, index: number) => ({ id: `${id}-image-${index + 1}`, kind: "affiliate_feed", role: index === 0 ? "primary" : "gallery", src: image.src, alt: raw.title, source: { ...source, note: "Remote image URL published in SAUNABOX's official Shopify storefront. Used in place with official-source provenance; not independently licensed or downloaded." } })), offers: [offer(representative)], variants: variants.length > 1 ? variants.map((variant, index) => ({ id: `${id}-variant-${index + 1}`, supplierVariantId: String(variant.id), label: variant.title, options: [{ category: "Finish", value: variant.title }], offer: offer(variant, `variant-offer-${index + 1}`), source })) : [], identifiers: { gtin: [], merchantSkus: representative.sku ? { saunabox: representative.sku } : {} }, attributes, sourceTitle: raw.title, editorial: { strengths: [], tradeoffs: [] }, source, lastUpdated: TODAY, flags: { demo: false, newArrival: false } });
  writeFileSync(join(output, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ scanned: snapshot.products.length, included: selected.map((p) => p.handle), excluded: snapshot.products.length - selected.length }, null, 2));
