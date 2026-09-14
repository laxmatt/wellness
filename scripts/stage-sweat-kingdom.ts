import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { readCsv } from "../src/domain/import/csv";
import { Brand, Merchant, Product, type Availability, type MerchantOffer, type Product as ProductRecord } from "../src/domain/product";
import { partitionSaunaOptions, type SaunaOption } from "../src/domain/categories/sauna-policy";

const input = resolve(process.argv[2] ?? "../outputs/partner-inventory/sweat-kingdom/2026-09-13.csv");
const previewRoot = resolve("catalog-preview");
const text = readFileSync(input, "utf8");
const table = readCsv(text, Buffer.byteLength(text));
if (!table.ok) throw new Error(table.reason);
const column = new Map(table.headers.map((header, index) => [header, index]));
const value = (row: string[], key: string) => row[column.get(key) ?? -1] ?? "";
const sourceFor = (rowNumber: number, url?: string) => ({
  kind: "merchant_feed" as const, ref: `${basename(input)}, row ${rowNumber}`,
  ...(url ? { url } : {}), retrievedAt: "2026-09-13", method: "direct" as const,
  note: "Supplied inventory-feed value. Wellness Fit Check has not independently verified it.",
});
const slugify = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
const familyName = (title: string) => title.split(" - ")[0].trim();
// Reviewed adapter-owned identity decisions for this feed profile. An unseen
// title remains a draft; it is never folded into the closest-looking family.
const REVIEWED_FAMILIES = new Set([
  "The Sweat Barrel (2-6 Person)", "The Sweat Pod (2-4 Person)", "The Sweat Cabin (4 Person)", "The Sweat Cabin Deluxe (6 Person)",
  "SK 110", "SK 210", "SK 310", "The Sweat Box (1 Person)", "SK Mobile", "The Summit (2-6 Person)",
  "REGEN The Sweat Cabin (4 Person)", "REGEN The Sweat Pod (2-4 Person)", "REGEN The Sweat Cabin Deluxe (6 Person)", "The Ridge (2 Person)", "The Ascent (6 Person)",
]);
const coreSauna = (title: string, category: string) => /sauna/i.test(category) && !/(heater package|stain|light kit|hat|bucket|ladle|thermometer|hygrometer|drip tray|backrest|cleaner|assembly|plunge|contrast)/i.test(title);
const availability = (raw: string): Availability => raw === "in_stock" || raw === "out_of_stock" ? raw : "unknown";
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const statedCapacity = (name: string): string | undefined => {
  const range = name.match(/\((\d)\s*-\s*(\d) Person\)/i);
  if (range) return `${range[1]}–${range[2]} people`;
  const single = name.match(/\((\d) Person\)/i);
  return single ? `${single[1]} person` : undefined;
};
const form = (name: string): string[] => {
  const found = ["Barrel", "Pod", "Cabin", "Box", "Mobile", "Summit", "Ridge", "Ascent"].find((word) => new RegExp(`\\b${word}\\b`, "i").test(name));
  return found ? [found] : ["Model series"];
};
const optionParts = (title: string) => title.split(" - ").slice(1).join(" - ").split(" / ").map((part) => part.trim()).filter(Boolean);
const optionCategory = (option: string): string => {
  if (/Harvia|HUUM|heater|kw|controls?/i.test(option)) return "Heater and controls";
  if (/roof/i.test(option)) return "Roof";
  if (/person|regular|large|x-large|xl/i.test(option)) return "Size / capacity";
  if (/door|window|orientation/i.test(option)) return "Door / window orientation";
  if (/cedar|siding|finish|color|colour/i.test(option)) return "Finish";
  return "Configuration";
};
const policyKind = (category: string): string => ({
  "Roof": "roof_kit", "Door / window orientation": "door_orientation", "Finish": "wood_finish",
  "Heater and controls": "heating", "Size / capacity": "capacity",
}[category] ?? "configuration");
const heating = (titles: string[]) => unique(titles.flatMap(optionParts).filter((part) => optionCategory(part) === "Heater and controls"));
const electrical = (titles: string[]) => unique(titles.flatMap((title) => title.match(/\b(?:120|208|240)V\b|\b\d+(?:\.\d+)?\s*kW\b/gi) ?? []));
const leadTime = (descriptions: string[]): string | undefined => unique(descriptions.map((d) => d.match(/Availability:\s*([^.!]+)/i)?.[1]?.trim() ?? ""))[0];
const highlights = (descriptions: string[]): string[] => unique(descriptions.flatMap((d) => {
  const overview = d.match(/Product Overview:\s*(.*)/i)?.[1];
  if (!overview) return [];
  return (overview.match(/Handcrafted[^.]*\.|(?:reaches?|heat up)[^.]*\./gi) ?? []).map((s) => s.trim()).slice(0, 2);
})).slice(0, 3);

const brand = Brand.parse({ id: "preview-sweat-kingdom", slug: "preview-sweat-kingdom", name: "Sweat Kingdom", websiteUrl: "https://sweatkingdom.com" });
const merchant = Merchant.parse({ id: "preview-sweat-kingdom-store", slug: "preview-sweat-kingdom-store", name: "Sweat Kingdom", websiteUrl: "https://sweatkingdom.com", network: "awin" });
type Raw = { row: string[]; rowNumber: number };
const core = new Map<string, Raw[]>();
const adjacent: Raw[] = [];
for (const [index, row] of table.rows.entries()) {
  const raw = { row, rowNumber: index + 2 };
  const title = value(row, "title");
  const key = familyName(title);
  if (coreSauna(title, value(row, "google_product_category")) && REVIEWED_FAMILIES.has(key)) {
    core.set(key, [...(core.get(key) ?? []), raw]);
  } else adjacent.push(raw);
}

function offerFor(raw: Raw, id: string): MerchantOffer {
  const feedId = value(raw.row, "id");
  const listingUrl = value(raw.row, "link");
  const source = sourceFor(raw.rowNumber, listingUrl);
  return {
    id, merchantId: merchant.id, market: "US", currency: "USD",
    priceMinor: Math.round(Number.parseFloat(value(raw.row, "price")) * 100),
    url: value(raw.row, "aw_deep_link") || listingUrl,
    affiliate: { status: "affiliate", network: "awin", programRef: "125462" },
    discountCodes: [], availability: availability(value(raw.row, "availability")),
    merchantSku: feedId, lastChecked: "2026-09-13", source,
  };
}

const families: ProductRecord[] = [...core.entries()].map(([name, raws]) => {
  const id = `preview-sweat-kingdom-${slugify(name)}`;
  const titles = raws.map((raw) => value(raw.row, "title"));
  const descriptions = raws.map((raw) => value(raw.row, "description"));
  const first = raws[0];
  const familyUrl = value(first.row, "link").split("?")[0];
  const allVariantOffers = raws.map((raw, index) => offerFor(raw, `${id}-variant-${index + 1}`));
  const active = allVariantOffers.filter((offer) => offer.availability !== "discontinued" && !offer.disputed);
  const minimum = [...active].sort((a, b) => a.priceMinor - b.priceMinor)[0];
  if (!minimum) throw new Error(`${name} has no active configuration offer.`);
  const familySource = sourceFor(first.rowNumber, familyUrl);
  const capacity = statedCapacity(name);
  const heat = heating(titles);
  const normalizedOptions: SaunaOption[] = titles.flatMap(optionParts).map((option) => {
    const category = optionCategory(option);
    return { kind: policyKind(category), label: category, value: option };
  });
  // The category policy, not this partner parser, owns the default boundary.
  // Both sides remain available as a detail-page summary, while only the
  // comparison side can contribute a comparison-worthy attribute.
  const partitioned = partitionSaunaOptions(normalizedOptions);
  const configCategories = unique([...partitioned.comparison, ...partitioned.checkout].map((option) => option.label));
  const attrs: Record<string, unknown> = {
    form: { value: form(name), source: familySource, verification: "manufacturer_reported" },
    ...(capacity ? { capacity: { value: capacity, source: familySource, verification: "manufacturer_reported" } } : {}),
    heating_options: heat.length ? { value: heat, source: familySource, verification: "manufacturer_reported" } : { source: familySource, verification: "not_stated" },
    ...(electrical(titles).length ? { electrical: { value: electrical(titles), source: familySource, verification: "manufacturer_reported" } } : {}),
    ...(leadTime(descriptions) ? { lead_time: { value: leadTime(descriptions), source: familySource, verification: "manufacturer_reported" } } : {}),
    configuration_categories: { value: configCategories, source: familySource, verification: "manufacturer_reported" },
    ...(highlights(descriptions).length ? { standout_features: { value: highlights(descriptions), source: familySource, verification: "manufacturer_reported" } } : {}),
  };
  const images = unique(raws.flatMap(({ row }) => [value(row, "image_link"), value(row, "additional_image_link"), value(row, "lifestyle_image_link")])).map((src, index) => ({
    id: `${id}-image-${index + 1}`, kind: "affiliate_feed" as const, role: (index === 0 ? "primary" : "gallery") as "primary" | "gallery", src,
    alt: `${name}, image supplied in the partner feed`, source: familySource,
  }));
  return Product.parse({
    id, slug: id, name, brandId: brand.id, categoryId: "saunas", subcategoryId: "traditional",
    description: `${name} is shown as one model family with ${raws.length} feed configurations. Choose the exact size, heater, controls and finish on Sweat Kingdom's product page; final price depends on configuration. Supplier descriptions and specifications are not independently verified here.`,
    status: "published", availability: active.some((o) => o.availability === "in_stock") ? "in_stock" : active[0].availability,
    market: "US", images,
    offers: [{ ...minimum, id: `${id}-family-offer`, url: familyUrl, merchantSku: undefined, shippingNote: `From price across ${raws.length} configurations; final price depends on configuration.` }],
    variants: raws.map((raw, index) => ({ id: `${id}-configuration-${index + 1}`, supplierVariantId: value(raw.row, "id"), label: value(raw.row, "title"), options: optionParts(value(raw.row, "title")).map((option) => ({ category: optionCategory(option), value: option })), offer: allVariantOffers[index], source: sourceFor(raw.rowNumber, value(raw.row, "link")) })),
    attributes: attrs, source: familySource, lastUpdated: "2026-09-13", flags: { demo: false, newArrival: true },
  });
});

const drafts: ProductRecord[] = adjacent.map((raw) => {
  const feedId = value(raw.row, "id");
  const name = value(raw.row, "title");
  const id = `preview-sweat-kingdom-${feedId}`;
  const source = sourceFor(raw.rowNumber, value(raw.row, "link"));
  const image = value(raw.row, "image_link");
  return Product.parse({ id, slug: id, name, brandId: brand.id, categoryId: "saunas", description: value(raw.row, "description") || "Supplier-feed row retained for review.", status: "draft", availability: availability(value(raw.row, "availability")), images: image ? [{ id: `${id}-primary`, kind: "affiliate_feed", role: "primary", src: image, alt: `${name}, image supplied in the partner feed`, source }] : [], offers: [offerFor(raw, `${id}-offer`)], source, lastUpdated: "2026-09-13" });
});

for (const dir of ["products", "brands", "merchants"]) mkdirSync(join(previewRoot, dir), { recursive: true });
for (const [dir, prefix] of [["products", "preview-sweat-kingdom-"], ["brands", brand.id], ["merchants", merchant.id]] as const) {
  for (const file of readdirSync(join(previewRoot, dir))) if (file.startsWith(prefix) && file.endsWith(".json")) unlinkSync(join(previewRoot, dir, file));
}
const write = (kind: string, id: string, record: unknown) => writeFileSync(join(previewRoot, kind, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
write("brands", brand.id, brand); write("merchants", merchant.id, merchant);
for (const product of [...families, ...drafts]) write("products", product.id, product);
console.log(`Retained ${table.rows.length} rows: ${families.length} reviewed sauna families from ${families.reduce((n, p) => n + p.variants.length, 0)} variants; ${drafts.length} adjacent rows remain drafts.`);
