import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { readCsv } from "../src/domain/import/csv";
import { Brand, Merchant, Product, type Availability, type Product as ProductRecord } from "../src/domain/product";

const input = resolve(process.argv[2] ?? "../outputs/partner-inventory/sweat-kingdom/2026-09-13.csv");
const previewRoot = resolve("catalog-preview");
const text = readFileSync(input, "utf8");
const table = readCsv(text, Buffer.byteLength(text));
if (!table.ok) throw new Error(table.reason);

const column = new Map(table.headers.map((header, index) => [header, index]));
const value = (row: string[], key: string) => row[column.get(key) ?? -1] ?? "";
const sourceFor = (rowNumber: number, url?: string) => ({
  kind: "merchant_feed" as const,
  ref: `${basename(input)}, row ${rowNumber}`,
  ...(url ? { url } : {}),
  retrievedAt: "2026-09-13",
  method: "direct" as const,
  note: "Supplied inventory-feed value. Wellness Fit Check has not independently verified it.",
});
const slugify = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 110);
const coreSauna = (title: string, category: string) => /sauna/i.test(category) && !/(heater package|stain|light kit|hat|bucket|ladle|thermometer|hygrometer|drip tray|backrest|cleaner|assembly|plunge|contrast)/i.test(title);
const capacity = (title: string) => {
  const range = title.match(/\((\d)\s*-\s*(\d) Person\)/i);
  if (range) return `${range[1]}–${range[2]} people`;
  const single = title.match(/\((\d) Person\)/i);
  return single ? `${single[1]} person` : "Not stated";
};
const placement = (title: string) => /mobile|barrel|outpost|summit|ridge|ascent/i.test(title) ? ["Outdoor"] : ["Indoor"];
const connection = (title: string) => /120v|plug/i.test(title) ? "plug_in" : "hardwired";
const availability = (raw: string): Availability => raw === "in_stock" || raw === "out_of_stock" ? raw : "unknown";

const brand = Brand.parse({ id: "preview-sweat-kingdom", slug: "preview-sweat-kingdom", name: "Sweat Kingdom", websiteUrl: "https://sweatkingdom.com" });
const merchant = Merchant.parse({ id: "preview-sweat-kingdom-store", slug: "preview-sweat-kingdom-store", name: "Sweat Kingdom", websiteUrl: "https://sweatkingdom.com", network: "awin" });

const products: ProductRecord[] = table.rows.map((row, index) => {
  const rowNumber = index + 2;
  const feedId = value(row, "id");
  const name = value(row, "title").trim();
  const listingUrl = value(row, "link");
  const affiliateUrl = value(row, "aw_deep_link") || listingUrl;
  const source = sourceFor(rowNumber, listingUrl);
  const amount = Math.round(Number.parseFloat(value(row, "price")) * 100);
  const imageUrl = value(row, "image_link");
  const additionalImageUrl = value(row, "additional_image_link");
  const lifestyleImageUrl = value(row, "lifestyle_image_link");
  const isCore = coreSauna(name, value(row, "google_product_category"));
  const id = `preview-sweat-kingdom-${feedId}`;
  const heater = name.match(/(Harvia|HUUM)[^/\-]*/i)?.[0]?.trim();
  const voltage = name.match(/(120|240)v/i)?.[1];
  const attrs: Record<string, unknown> = {
    heat_type: { value: "traditional", source, verification: "manufacturer_reported" },
    capacity: { value: capacity(name), source, verification: "manufacturer_reported" },
    placement: { value: placement(name), source, verification: "manufacturer_reported" },
    connection: { value: connection(name), source, verification: "manufacturer_reported" },
    ...(voltage ? { voltage: { value: Number(voltage), source, verification: "manufacturer_reported" } } : {}),
  };
  return Product.parse({
    id, slug: id, name, brandId: brand.id, categoryId: "saunas", subcategoryId: "traditional",
    description: value(row, "description") || "Description supplied in the Sweat Kingdom inventory feed.",
    status: isCore ? "published" : "draft", availability: availability(value(row, "availability")), market: "US",
    images: [
      ...(imageUrl ? [{ id: `${id}-primary`, kind: "affiliate_feed" as const, role: "primary" as const, src: imageUrl, alt: `${name}, image supplied in the partner feed`, source }] : []),
      ...(additionalImageUrl ? [{ id: `${id}-gallery`, kind: "affiliate_feed" as const, role: "gallery" as const, src: additionalImageUrl, alt: `${name}, additional image supplied in the partner feed`, source }] : []),
      ...(lifestyleImageUrl ? [{ id: `${id}-lifestyle`, kind: "affiliate_feed" as const, role: "lifestyle" as const, src: lifestyleImageUrl, alt: `${name}, lifestyle image supplied in the partner feed`, source }] : []),
    ],
    offers: Number.isFinite(amount) && affiliateUrl ? [{ id: `${id}-offer`, merchantId: merchant.id, market: "US", currency: "USD", priceMinor: amount, url: affiliateUrl, affiliate: { status: "affiliate", network: "awin", programRef: "125462" }, availability: availability(value(row, "availability")), merchantSku: feedId, lastChecked: "2026-09-13", source }] : [],
    identifiers: { gtin: value(row, "gtin") ? [value(row, "gtin")] : [], mpn: value(row, "mpn") || undefined, merchantSkus: { [merchant.id]: feedId } },
    attributes: attrs, source, lastUpdated: "2026-09-13", flags: { demo: false, newArrival: true },
    editorial: { strengths: heater ? [{ text: `Configured with ${heater}.`, author: "Supplier feed", date: "2026-09-13", source, experiential: false }] : [], tradeoffs: [] },
  });
});

for (const dir of ["products", "brands", "merchants"]) mkdirSync(join(previewRoot, dir), { recursive: true });
const write = (kind: string, id: string, record: unknown) => {
  const path = join(previewRoot, kind, `${id}.json`);
  if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
};
write("brands", brand.id, brand);
write("merchants", merchant.id, merchant);
for (const product of products) write("products", product.id, product);
const published = products.filter((product) => product.status === "published").length;
console.log(`Staged all ${products.length} feed rows. ${published} core sauna variants are published to the private preview; ${products.length - published} accessory or adjacent rows remain drafts.`);
