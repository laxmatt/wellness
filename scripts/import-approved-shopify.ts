/** Publish reviewed products from newly approved partners' official Shopify snapshots. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Product } from "@/domain/product";
import { bodyText } from "@/domain/ingestion/shopify";
import { productLink, programmeFor } from "@/domain/affiliate/programmes";
import { extractSaunaEnvironment } from "@/domain/ingestion/sauna-environment";

const TODAY = "2026-09-19";
const OUT = join(process.cwd(), "catalog/products");
const configs = [
  {
    source: "sweattent-shopify", merchantId: "sweattent-store", brandId: "sweattent", categoryId: "saunas", network: "refersion",
    snapshot: "sweattent-shopify.json", handles: ["sweattent"], fallbackLink: "https://sweattent.com/?rfsn=9327296.77dd76",
  },
  {
    source: "frostonic-shopify", merchantId: "frostonic-store", brandId: "frostonic", categoryId: "cold-plunge", network: "goaffpro",
    snapshot: "frostonic-shopify.json", handles: ["frostonic-icebarrel-go", "comfort-modular-independent-plunge-tub", "structured-modular-independent-plunge", "integrated-ice-bath-with-ladder", "air-round-inflatable-cold-plunge-tub", "air-pro-inflatable-ice-bath-tub", "integrated-all-in-one-cold-plunge-tub"],
  },
] as const;

mkdirSync(OUT, { recursive: true });
for (const config of configs) {
  const programme = programmeFor(config.source);
  if (!programme) throw new Error(`Missing programme ${config.source}`);
  const snapshot = JSON.parse(readFileSync(join(process.cwd(), "intake/shopify", config.snapshot), "utf8")) as { products: any[] };
  const selected = snapshot.products.filter((raw) => (config.handles as readonly string[]).includes(raw.handle));
  if (selected.length !== config.handles.length) throw new Error(`${config.source}: expected ${config.handles.length}, found ${selected.length}`);
  for (const raw of selected) {
    const id = `${config.brandId}-${raw.handle}`.replace(/[^a-z0-9-]+/g, "-");
    const productUrl = `https://${new URL(programme.inventory.kind === "shopify_json" ? programme.inventory.url : programme.referralLink!).hostname}/products/${raw.handle}`;
    const tagged = productLink(programme, productUrl);
    const outbound = tagged.ok ? tagged.url : ("fallbackLink" in config ? config.fallbackLink : undefined);
    if (!outbound) throw new Error(tagged.ok ? "Missing outbound link" : tagged.reason);
    const variants = raw.variants as any[];
    const active = variants.filter((variant) => variant.available);
    const representative = (active.length ? active : variants).reduce((best, variant) => Number(variant.price) < Number(best.price) ? variant : best);
    const description = bodyText(raw.body_html || "") || raw.title;
    const source = { kind: "merchant_feed" as const, ref: `${config.source}, official public Shopify snapshot`, url: productUrl, retrievedAt: TODAY, method: "direct" as const, note: "Product identity, description, price, availability and images come from the approved merchant's official storefront catalogue. Supplier claims are not independent testing." };
    const attributes: Record<string, unknown> = {};
    if (config.categoryId === "saunas") {
      attributes.sauna_type = { value: "traditional", source: { ...source, note: `${source.note} The product description explicitly describes a wood-fired sauna.` }, verification: "manufacturer_reported" };
      attributes.sauna_style = { value: "tent", source, verification: "manufacturer_reported" };
      attributes.placement = { value: "outdoor", source, verification: "manufacturer_reported" };
      const temperature = /(200)°F\+/i.exec(description);
      if (temperature) attributes.max_temperature_f = { value: Number(temperature[1]), source, verification: "manufacturer_reported" };
      for (const fact of extractSaunaEnvironment(description)) attributes[fact.key] = { value: fact.value, source, verification: "manufacturer_reported" };
    } else {
      attributes.chiller_included = { value: /all-in-one/i.test(raw.title), source, verification: "manufacturer_reported" };
      attributes.tub_type = { value: /barrel/i.test(raw.title) ? "barrel" : /inflatable/i.test(`${raw.title} ${raw.product_type}`) ? "inflatable" : "tub", source, verification: "manufacturer_reported" };
    }
    const offer = (variant: any, suffix: string) => ({ id: `${id}-${suffix}`, merchantId: config.merchantId, market: "US" as const, currency: "USD" as const, priceMinor: Math.round(Number(variant.price) * 100), url: outbound, affiliate: { status: "affiliate" as const, network: config.network, programRef: programme.programRef }, discountCodes: [], availability: variant.available ? "in_stock" as const : "out_of_stock" as const, merchantSku: variant.sku || undefined, lastChecked: TODAY, source: { ...source, note: tagged.ok ? `${source.note} Product link was generated with the portal-verified tracking parameter.` : `${source.note} Outbound uses the exact storefront referral link issued in the approval email; no unverified product-link transformation is applied.` } });
    const record = Product.parse({ id, slug: id, name: raw.title, brandId: config.brandId, categoryId: config.categoryId, description, status: "published", availability: active.length ? "in_stock" : "out_of_stock", market: "US", images: raw.images.slice(0, 4).map((image: any, index: number) => ({ id: `${id}-image-${index + 1}`, kind: "affiliate_feed", role: index === 0 ? "primary" : "gallery", src: image.src, alt: raw.title, source: { ...source, note: `${source.note} Published under the site's standing owner decision that an approved partner directing Wellness Fit Check to its official inventory source is sufficient permission to use supplied product imagery.` } })), offers: [offer(representative, "offer")], variants: variants.length > 1 ? variants.map((variant, index) => ({ id: `${id}-variant-${index + 1}`, supplierVariantId: String(variant.id), label: variant.title, options: [{ category: "Configuration", value: variant.title }], offer: offer(variant, `variant-offer-${index + 1}`), source })) : [], identifiers: { gtin: [], merchantSkus: representative.sku ? { [config.merchantId]: representative.sku } : {} }, attributes, sourceTitle: raw.title, editorial: { strengths: [], tradeoffs: [] }, source, lastUpdated: TODAY, flags: { demo: false, newArrival: true } });
    writeFileSync(join(OUT, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }
  console.log(`${config.source}: published ${selected.length}; excluded ${snapshot.products.length - selected.length}`);
}
