/** Publish Hooga's current red-light panel range from its approved Shopify feed. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Product } from "@/domain/product";
import { bodyText } from "@/domain/ingestion/shopify";
import { productLink, programmeFor } from "@/domain/affiliate/programmes";

const TODAY = "2026-09-19";
const SOURCE_ID = "hooga-shopify";
const OUT = join(process.cwd(), "catalog/products");
const snapshot = JSON.parse(
  readFileSync(join(process.cwd(), "intake/shopify/hooga-shopify.json"), "utf8"),
) as { products: any[] };
const programme = programmeFor(SOURCE_ID);
if (!programme) throw new Error(`Missing programme ${SOURCE_ID}`);

const models: Record<string, { id: string; label: string }> = {
  "hooga-200": { id: "hooga-hg200", label: "HG200" },
  "hooga-300w-red-and-near-infrared-light-therapy-panel": { id: "hooga-hg300", label: "HG300" },
  "hooga-500w-red-and-near-infrared-light-therapy-panel": { id: "hooga-hg500", label: "HG500" },
  "hooga-1000w-red-and-near-infrared-light-therapy-panel": { id: "hooga-hg1000", label: "HG1000" },
  "hg1500-red-light-therapy-device": { id: "hooga-hg1500", label: "HG1500" },
  hgpro300: { id: "hooga-pro300", label: "PRO300" },
  hgpro750: { id: "hooga-pro750", label: "PRO750" },
  hgpro1500: { id: "hooga-pro1500", label: "PRO1500" },
  hgpro4500: { id: "hooga-pro4500", label: "PRO4500" },
  "ultra-360": { id: "hooga-ultra360", label: "ULTRA360" },
  "ultra-750": { id: "hooga-ultra750", label: "ULTRA750" },
  "ultra-1500": { id: "hooga-ultra1500", label: "ULTRA1500" },
  "ultra4500-red-light-therapy": { id: "hooga-ultra4500", label: "ULTRA4500" },
};

const numberFrom = (text: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return Number(match[1]);
  }
};
const wavelengthsFrom = (text: string) =>
  [...new Set([...text.matchAll(/\b(630|660|810|850)\s*nm\b/gi)].map((match) => Number(match[1])))].sort((a, b) => a - b);
const dimensionsFrom = (text: string) => {
  const match = /(\d+(?:\.\d+)?)\s*(?:"|in(?:ches)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(?:"|in(?:ches)?)/i.exec(text);
  if (!match) return undefined;
  return { height: Number(match[1]), width: Number(match[2]) };
};
const coverageFrom = (text: string, dimensions?: { height: number }) => {
  if (dimensions) {
    if (dimensions.height >= 35) return "full_body";
    if (dimensions.height >= 20) return "half_body";
    return "targeted";
  }
  if (/full[- ]body|head to toe/i.test(text)) return "full_body";
  if (/half[- ]body|head to hip|torso/i.test(text)) return "half_body";
  return "targeted";
};
const footprintFrom = (dimensions?: { height: number; width?: number }) => {
  const longest = Math.max(dimensions?.height ?? 0, dimensions?.width ?? 0);
  return longest > 40 ? "large" : longest >= 20 ? "standard" : "compact";
};

mkdirSync(OUT, { recursive: true });
let published = 0;
for (const raw of snapshot.products) {
  const model = models[raw.handle];
  if (!model) continue;
  const text = bodyText(raw.body_html || "") || raw.title;
  const productUrl = `https://hoogahealth.com/products/${raw.handle}`;
  const tagged = productLink(programme, productUrl);
  if (!tagged.ok) throw new Error(`${raw.handle}: ${tagged.reason}`);
  const variants = raw.variants as any[];
  const active = variants.filter((variant) => variant.available);
  const representative = (active.length ? active : variants).reduce((best, variant) =>
    Number(variant.price) < Number(best.price) ? variant : best,
  );
  const dimensions = dimensionsFrom(text);
  const wavelengths = wavelengthsFrom(text);
  const irradiance = numberFrom(text, [/irradiance (?:of )?(?:over )?(\d+(?:\.\d+)?)\s*mW\/cm/i, /(?:producing|delivering) (?:over )?(\d+(?:\.\d+)?)\s*mW\/cm/i]);
  const irradianceDistance = numberFrom(text, [/mW\/cm(?:²|2)?\s+at\s+(\d+(?:\.\d+)?)\s+in/i]);
  const ledCount = numberFrom(text, [/(\d+)\s*(?:×\s*\d+W\s*)?(?:single-chip |dual-chip |quad-chip )?LEDs/i]);
  const power = numberFrom(text, [/\b(\d+)W\b/i]);
  const source = {
    kind: "merchant_feed" as const,
    ref: `${SOURCE_ID}, official public Shopify snapshot`,
    url: productUrl,
    retrievedAt: TODAY,
    method: "direct" as const,
    note: "Product identity, description, price, availability, images and stated specifications come from Hooga's approved official storefront catalogue. Supplier claims are not independent testing.",
  };
  const fact = (value: unknown, unit?: string, note?: string) => ({
    value,
    ...(unit ? { unit } : {}),
    source: note ? { ...source, note } : source,
    verification: "manufacturer_reported" as const,
  });
  const coverage = coverageFrom(text, dimensions);
  const attributes: Record<string, unknown> = {
    coverage: fact(coverage, undefined, `${source.note} Coverage is the site's editorial class based on the maker-stated size and intended treatment area.`),
    footprint: fact(footprintFrom(dimensions), undefined, `${source.note} Footprint is the site's editorial class based on the maker-stated longest side.`),
    warranty_years: fact(3, "yr"),
    return_window_days: fact(60, "days"),
  };
  if (wavelengths.length) attributes.wavelengths_nm = fact(wavelengths, "nm");
  if (irradiance) attributes.irradiance_mw_cm2 = fact(irradiance, "mW/cm²");
  if (irradianceDistance) attributes.irradiance_distance_in = fact(irradianceDistance, "in");
  if (ledCount) attributes.led_count = fact(ledCount);
  if (power) attributes.power_w = fact(power, "W");
  const mounting = [
    /tabletop|built-in.*stand/i.test(text) ? "tabletop" : undefined,
    /door mount|hanging kit|back of.*door/i.test(text) ? "door_hang" : undefined,
    /mobile stand|stand.compatible/i.test(text) ? "floor_stand_optional" : undefined,
  ].filter(Boolean);
  if (mounting.length) attributes.mounting = fact(mounting);
  if (/puls(?:e|ing|ed)/i.test(text)) attributes.pulsing = fact(true);

  const offer = (variant: any, id: string) => ({
    id,
    merchantId: "hooga-store",
    market: "US" as const,
    currency: "USD" as const,
    priceMinor: Math.round(Number(variant.price) * 100),
    url: tagged.url,
    affiliate: { status: "affiliate" as const, network: "goaffpro", programRef: programme.programRef },
    discountCodes: [],
    availability: variant.available ? "in_stock" as const : "out_of_stock" as const,
    merchantSku: variant.sku || undefined,
    lastChecked: TODAY,
    source: { ...source, note: `${source.note} Product link was generated with Hooga's portal-verified referral parameter.` },
  });
  const record = Product.parse({
    id: model.id,
    slug: model.id,
    name: model.label,
    brandId: "hooga",
    categoryId: "red-light",
    subcategoryId: "panel",
    description: text,
    status: "published",
    availability: active.length ? "in_stock" : "out_of_stock",
    market: "US",
    images: raw.images.slice(0, 5).map((image: any, index: number) => ({
      id: `${model.id}-image-${index + 1}`,
      kind: "affiliate_feed",
      role: index === 0 ? "primary" : "gallery",
      src: image.src,
      alt: raw.title,
      source,
    })),
    offers: [offer(representative, `${model.id}-direct`) ],
    variants: variants.length > 1 ? variants.map((variant, index) => ({
      id: `${model.id}-variant-${index + 1}`,
      supplierVariantId: String(variant.id),
      label: variant.title,
      options: [{ category: "Configuration", value: variant.title }],
      offer: offer(variant, `${model.id}-variant-offer-${index + 1}`),
      source,
    })) : [],
    identifiers: { gtin: [], merchantSkus: representative.sku ? { "hooga-store": representative.sku } : {} },
    warranty: fact("3-year warranty"),
    returnPolicy: fact("60-day return window from delivery; return shipping deducted"),
    attributes,
    sourceTitle: raw.title,
    editorial: { strengths: [], tradeoffs: [] },
    source,
    lastUpdated: TODAY,
    flags: { demo: false, newArrival: true },
  });
  writeFileSync(join(OUT, `${model.id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  published += 1;
}

if (published !== Object.keys(models).length) throw new Error(`Expected ${Object.keys(models).length} panels, published ${published}`);
console.log(`Hooga: published ${published} current panel models; excluded ${snapshot.products.length - published} accessories, open-box items and non-panel products.`);
