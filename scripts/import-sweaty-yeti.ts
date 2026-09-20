/** Import the sauna-containing models from Sweaty Yeti's public WooCommerce Store API snapshot. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Product } from "@/domain/product";
import { productLink, programmeFor } from "@/domain/affiliate/programmes";

const TODAY = "2026-09-18";
const SNAPSHOT = join(process.cwd(), "intake/woocommerce/sweaty-yeti-woocommerce.json");
const OUTPUT = join(process.cwd(), "catalog/products");
const programme = programmeFor("sweaty-yeti-woocommerce");
if (!programme) throw new Error("Sweaty Yeti programme is not recorded.");

type WooProduct = {
  id: number;
  name: string;
  permalink: string;
  description?: string;
  short_description?: string;
  prices: { price: string; currency_code: string; currency_minor_unit: number };
  categories?: { name: string }[];
  images?: { id: number; src: string; alt?: string }[];
  is_in_stock?: boolean;
  stock_status?: string;
};

const text = (html = "") => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const slug = (url: string) => new URL(url).pathname.split("/").filter(Boolean).at(-1)!.replace(/[^a-z0-9]+/g, "-");
const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as WooProduct[];
const selected = snapshot.filter((raw) => raw.categories?.some((category) => category.name.toLowerCase() === "sauna"));
if (selected.length === 0) throw new Error("No sauna-category products were found.");

mkdirSync(OUTPUT, { recursive: true });
for (const raw of selected) {
  const handle = slug(raw.permalink);
  const id = `sweaty-yeti-${handle}`;
  const affiliate = productLink(programme, raw.permalink);
  if (!affiliate.ok) throw new Error(affiliate.reason);
  const description = text(raw.short_description || raw.description) || `${raw.name} from Sweaty Yeti Sauna.`;
  const source = {
    kind: "merchant_feed" as const,
    ref: `Sweaty Yeti official WooCommerce Store API snapshot, product ${raw.id}`,
    url: raw.permalink,
    retrievedAt: TODAY,
    method: "direct" as const,
    note: "Product identity, price, stock state, description, categories and image URL come from the merchant's official public Store API. Supplier claims are not independent testing.",
  };
  const capacity = /([0-9]+)\s*[-–]\s*([0-9]+)\s+Person/i.exec(description);
  const amperage = /Requires\s+([0-9]+)\s+amp/i.exec(description);
  const attributes: Record<string, unknown> = {};
  if (capacity) {
    attributes.capacity_label = { value: `${capacity[1]}-${capacity[2]} person`, source, verification: "manufacturer_reported" };
    attributes.capacity_max_people = { value: Number(capacity[2]), source, verification: "manufacturer_reported" };
  }
  if (amperage) attributes.amperage_a = { value: Number(amperage[1]), source, verification: "manufacturer_reported" };
  const priceMinor = Number(raw.prices.price);
  const record = Product.parse({
    id,
    slug: id,
    name: raw.name,
    brandId: "sweaty-yeti",
    categoryId: "saunas",
    description,
    status: "published",
    availability: raw.is_in_stock === false || raw.stock_status === "outofstock" ? "out_of_stock" : "in_stock",
    market: "US",
    images: (raw.images || []).slice(0, 4).map((image, index) => ({
      id: `${id}-image-${index + 1}`,
      kind: "affiliate_feed",
      role: index === 0 ? "primary" : "gallery",
      src: image.src,
      alt: image.alt || raw.name,
      source: { ...source, note: `${source.note} Published under the site's standing owner decision that an approved partner directing Wellness Fit Check to its official inventory source is sufficient permission to use supplied product imagery.` },
    })),
    offers: [{
      id: `${id}-offer`, merchantId: "sweaty-yeti-store", market: "US", currency: raw.prices.currency_code,
      priceMinor, url: affiliate.url,
      affiliate: { status: "affiliate", network: "other", programRef: "126" },
      discountCodes: [{ code: "wellnessfitcheck5", description: "Partner-issued checkout coupon", source }],
      availability: raw.is_in_stock === false || raw.stock_status === "outofstock" ? "out_of_stock" : "in_stock",
      lastChecked: TODAY, source,
    }],
    variants: [], identifiers: { gtin: [], merchantSkus: {} }, attributes,
    sourceTitle: raw.name, editorial: { strengths: [], tradeoffs: [] }, source, lastUpdated: TODAY,
    flags: { demo: false, newArrival: true },
  });
  writeFileSync(join(OUTPUT, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ scanned: snapshot.length, published: selected.map((raw) => raw.name), excluded: snapshot.filter((raw) => !selected.includes(raw)).map((raw) => raw.name) }, null, 2));
