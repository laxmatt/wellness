/**
 * Turning reviewed drafts into records this catalogue can hold.
 *
 * A draft is a proposal built from one supplier row. A record is a `Product`,
 * the same shape every other product in this catalogue has, with
 * `status: "draft"` so that nothing shopper-facing reads it. There is no second
 * product model and no parallel store: the status field the catalogue already
 * has is the approval gate, and every shopper read in `src/lib/queries.ts`
 * already asks for published records only.
 *
 * What a figure staged from a file is worth is the whole question, and the
 * answer here is deliberately unflattering. The sample files are invented, so
 * every figure read out of one is recorded as what it is: `demo`, sourced to
 * the file and the row. `isUsable` withholds a demo figure from filters, from
 * ranking and from the assistant, so an approved sample appears in the
 * storefront and answers nothing. That is the correct outcome, and it is the
 * point: importing a feed does not produce facts. Establishing where a figure
 * came from produces facts, and no importer can do that for a reviewer.
 *
 * A mapped column whose cell is empty is recorded with no value and
 * `not_stated`, which says the file was read and states nothing. An unmapped
 * field is not recorded at all. Neither becomes a zero.
 */

import type { Draft, DraftSet } from "@/domain/import/draft";
import type { CellValue } from "@/domain/import/values";
import { Brand, Merchant, Product, type ImageAsset, type MerchantOffer } from "@/domain/product";
import type { Source } from "@/domain/provenance";
import type { AttributePrimitive, AttributeValue } from "@/domain/attributes";
import { previewBrandId, previewMerchantId, previewProductId } from "./identity";

export type StageOptions = {
  /** Who supplied the file, stated by the operator. The file rarely says. */
  supplierName: string;
  /** The file's name, recorded on every figure it produced. */
  sourceFile: string;
  /** The date the operator states these prices were current. A download date is not it. */
  pricedOn: string;
  /** The date this record was written here. */
  stagedOn: string;
};

export type StagedProduct = { row: number; label: string; product: Product };
export type StageRefusal = { row: number; label: string; reasons: string[] };

export type StageResult = {
  staged: StagedProduct[];
  brands: Brand[];
  merchant: Merchant | undefined;
  refusals: StageRefusal[];
  /** Reasons nothing in the file can be staged at all. */
  fatal: string[];
};

/** Attribute keys this fills, and nothing else. The rest of the category stays silent. */
const ATTRIBUTE_FIELDS = ["function", "sugar_g", "caffeine_mg", "servings_per_pack"] as const;

const FILE_NOTE =
  "Staged from a supplier file. The file is a synthetic sample invented for this demonstration, so this figure is not a fact about any real product. Nobody has established who would be speaking in a real feed, which is why no manufacturer, retailer or feed attribution is recorded here.";

function fileSource(opts: StageOptions, row: number, extra?: string): Source {
  return {
    kind: "demo",
    ref: `${opts.sourceFile}, row ${row}`,
    retrievedAt: opts.stagedOn,
    method: "direct",
    note: extra ? `${FILE_NOTE} ${extra}` : FILE_NOTE,
  };
}

const text = (v: CellValue | undefined): string | undefined => (v?.kind === "text" ? v.value : undefined);

function attributeValue(v: CellValue): AttributePrimitive | undefined {
  switch (v.kind) {
    case "number":
      return v.value;
    case "integer":
      return v.value;
    case "list":
      return v.value;
    case "text":
      return v.value;
    case "money":
      return undefined;
  }
}

export function stageDrafts(set: DraftSet, opts: StageOptions): StageResult {
  const fatal: string[] = [];
  if (set.missingRequired.length > 0) {
    fatal.push(
      `The mapping fills none of ${set.missingRequired.map((f) => f.label).join(", ")}. A record cannot be built without ${set.missingRequired.length === 1 ? "it" : "them"}.`,
    );
  }
  const merchantId = previewMerchantId(opts.supplierName);
  if (!merchantId) fatal.push(`"${opts.supplierName}" holds no letters or digits, so there is no supplier to attach a price to.`);
  if (fatal.length > 0) return { staged: [], brands: [], merchant: undefined, refusals: [], fatal };

  const merchant = Merchant.parse({
    id: merchantId,
    slug: merchantId,
    name: opts.supplierName,
    markets: ["US"],
  });

  const staged: StagedProduct[] = [];
  const refusals: StageRefusal[] = [];
  const brands = new Map<string, Brand>();
  const takenBy = new Map<string, number>();

  for (const draft of set.drafts) {
    const outcome = stageOne(draft, opts, merchant, takenBy);
    if ("reasons" in outcome) {
      refusals.push({ row: draft.row, label: draft.label, reasons: outcome.reasons });
      continue;
    }
    takenBy.set(outcome.product.id, draft.row);
    brands.set(outcome.brand.id, outcome.brand);
    staged.push({ row: draft.row, label: draft.label, product: outcome.product });
  }

  return { staged, brands: [...brands.values()], merchant, refusals, fatal };
}

function stageOne(
  draft: Draft,
  opts: StageOptions,
  merchant: Merchant,
  takenBy: Map<string, number>,
): { product: Product; brand: Brand } | { reasons: string[] } {
  const reasons: string[] = [];
  // Every reason the importer gave, first and verbatim. This step adds the
  // reasons a catalogue record has on top of the ones a reading has.
  for (const f of draft.fields) {
    for (const flag of f.flags) if (flag.severity === "blocker") reasons.push(`${f.field.label}: ${flag.message}`);
  }

  const by = new Map(draft.fields.map((f) => [f.field.key, f]));
  const name = text(by.get("name")?.value)?.replace(/\s+/g, " ").trim();
  const brandName = text(by.get("brand")?.value)?.replace(/\s+/g, " ").trim();
  const sku = text(by.get("supplier_sku")?.value);
  const reference = text(by.get("source_reference")?.value);
  const price = by.get("price")?.value;

  if (!name) reasons.push("No product name was read, so there is nothing to name a record.");
  if (!brandName) reasons.push("No brand was read. A record here belongs to a brand.");
  if (!sku) reasons.push("No supplier code was read. It is kept so a reviewer can trace this record back to the row.");

  // An offer needs somewhere to send a shopper, and a reference that is not a
  // link cannot be one. Nothing here opens it: whether the page behind it is a
  // real listing is a reviewer's call, and this only checks it is a URL.
  let url: string | undefined;
  if (!reference) {
    reasons.push("No source reference was read. An offer needs an address, and this is the only one the file holds.");
  } else if (!/^https?:\/\//i.test(reference)) {
    reasons.push(`The source reference "${reference}" is not an http or https address, so it cannot be the link a shopper follows.`);
  } else {
    url = reference;
  }

  if (!price) {
    reasons.push("No price was read. A record here needs an offer or a reference price, and a supplier price is the only one this file holds.");
  } else if (price.kind !== "money") {
    reasons.push("The price cell did not read as an amount of money.");
  } else if (price.currency !== "USD") {
    reasons.push(
      `This price is in ${price.currency}, and this catalogue stores USD only: \`Currency\` in src/domain/money.ts admits one code. Converting it here would invent a rate and a date, so the row is refused until the catalogue holds more than one currency.`,
    );
  }

  const id = name && brandName ? previewProductId(brandName, name) : undefined;
  const brandId = brandName ? previewBrandId(brandName) : undefined;
  if (name && brandName && (!id || !brandId)) {
    reasons.push(`"${brandName}" and "${name}" hold no letters or digits between them, so no id can be derived from them.`);
  }
  if (id && takenBy.has(id)) {
    reasons.push(
      `This row derives the id "${id}", which row ${takenBy.get(id)} already took. Two rows naming the same product, or two names that shorten to the same id, is a reviewer's decision. Nothing here adds a number to the end of one of them.`,
    );
  }

  if (reasons.length > 0 || !id || !brandId || !name || !brandName || !sku || !url || price?.kind !== "money") {
    return { reasons: reasons.length > 0 ? reasons : ["The row could not be read."] };
  }

  const attributes: Record<string, AttributeValue> = {};
  for (const key of ATTRIBUTE_FIELDS) {
    const field = by.get(key);
    if (!field) continue;
    const value = field.value ? attributeValue(field.value) : undefined;
    if (value === undefined) {
      // The column exists and this cell is empty. That is a reading, and it is
      // not a zero: "not stated" is what the file says and what is recorded.
      attributes[key] = {
        source: fileSource(opts, draft.row, `The file has a ${field.field.label.toLowerCase()} column and this row's cell is empty.`),
        verification: "not_stated",
      };
      continue;
    }
    attributes[key] = {
      value,
      unit: field.value?.kind === "number" ? field.value.unit : undefined,
      source: fileSource(opts, draft.row),
      verification: "demo",
    };
  }

  const image: ImageAsset = {
    id: `${id}-primary`,
    kind: "demo_placeholder",
    role: "primary",
    src: `demo:${id}-primary`,
    alt: `${name}: no image. This is a staged sample record and no right to any image has been established.`,
  };

  const offer: MerchantOffer = {
    id: `${id}-offer`,
    merchantId: merchant.id,
    market: "US",
    currency: "USD",
    priceMinor: price.minor,
    url,
    affiliate: { status: "unknown" },
    discountCodes: [],
    availability: "unknown",
    merchantSku: sku,
    // The date the operator states these prices were current. A supplier price
    // belongs to that supplier on that day and never becomes the product's own.
    lastChecked: opts.pricedOn,
    source: fileSource(opts, draft.row, `Stated as the supplier's price on ${opts.pricedOn}, by the operator who staged the file.`),
  };

  const brand = Brand.parse({ id: brandId, slug: brandId, name: brandName, market: "US" });

  const parsed = Product.safeParse({
    id,
    slug: id,
    name,
    brandId,
    categoryId: "wellness-drinks",
    description: `Staged from ${opts.sourceFile}, row ${draft.row}. No description has been written for this record.`,
    status: "draft",
    availability: "unknown",
    market: "US",
    images: [image],
    offers: [offer],
    identifiers: { gtin: [], merchantSkus: { [merchant.id]: sku } },
    attributes,
    source: fileSource(opts, draft.row),
    lastUpdated: opts.stagedOn,
    flags: { demo: true, newArrival: false },
  });
  if (!parsed.success) {
    return { reasons: parsed.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`) };
  }
  return { product: parsed.data, brand };
}
