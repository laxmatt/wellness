/**
 * The small set of fields a supplier file can reach, and what each one costs to
 * accept.
 *
 * Deliberately small. A supplier feed is a claim from a party with an interest
 * in the sale, and every field here is one a reviewer still has to sign off
 * before it reaches the catalogue. Widening this list is a decision about
 * evidence, not a parsing convenience, so it is made by editing this file.
 *
 * Nothing here writes anything. These definitions produce draft values and the
 * reasons a draft cannot be trusted yet.
 */

export type FieldKind = "identity" | "classification" | "list" | "measure" | "money" | "count" | "reference";

export type TargetField = {
  key: string;
  label: string;
  kind: FieldKind;
  /** Where the value would land in a catalogue record, for a reviewer to check. */
  catalogPath: string;
  /** The unit this site stores the figure in. A file stating another unit is flagged, never quietly rewritten. */
  unit?: "g" | "mg";
  /** Values this site recognises, for a classification or a list. */
  allowed?: string[];
  required: boolean;
  /** What a human still has to settle about this field, whatever the file says. */
  review: string;
  /** Header names this site recognises, written down rather than matched by resemblance. */
  synonyms: string[];
};

/** Wellness drinks only. One category, to keep the demonstration about evidence rather than coverage. */
export const DRINK_FIELDS: TargetField[] = [
  {
    key: "supplier_sku",
    label: "Supplier SKU",
    kind: "reference",
    catalogPath: "identifiers.merchantSkus[supplier]",
    required: true,
    review: "A supplier's own code identifies a line in their catalogue, not a product in ours. It is kept so a reviewer can trace the row back, and it never becomes our id.",
    synonyms: ["sku", "supplier_sku", "item code", "item_code", "item no", "article", "article_number", "product code", "product_code"],
  },
  {
    key: "name",
    label: "Product name",
    kind: "identity",
    catalogPath: "name",
    required: true,
    review: "A supplier's description is not a product identity. Flavour, size and pack count have to be read off it and confirmed against the maker before this names a record.",
    synonyms: ["name", "product", "product name", "product_name", "title", "description", "item name", "item_name"],
  },
  {
    key: "brand",
    label: "Brand",
    kind: "identity",
    catalogPath: "brandId",
    required: true,
    review: "Matched to a brand we already hold, or created deliberately. Two suppliers spell one brand three ways, and none of those spellings is an id.",
    synonyms: ["brand", "manufacturer", "maker", "vendor", "brand name", "brand_name"],
  },
  {
    key: "category",
    label: "Category",
    kind: "classification",
    catalogPath: "categoryId",
    allowed: ["wellness-drinks"],
    required: true,
    review: "The row has to be for a category this site compares. Anything else is out of scope and is not a draft.",
    synonyms: ["category", "categoryid", "category_id", "department", "type", "product type", "product_type"],
  },
  {
    key: "function",
    label: "Function",
    kind: "list",
    catalogPath: "attributes.function",
    allowed: ["electrolytes", "greens", "energy", "prebiotic", "hydration"],
    required: true,
    review: "A supplier's own words for what a drink is for. Anything outside the five values this site filters on is a value judgement somebody has to make, not a translation.",
    synonyms: ["function", "functions", "use", "usage", "purpose", "benefit", "benefits", "segment"],
  },
  {
    key: "sugar_g",
    label: "Sugar",
    kind: "measure",
    catalogPath: "attributes.sugar_g",
    unit: "g",
    required: false,
    review: "Per serving, and the file has to say so. A figure per 100 ml and a figure per stick are different numbers with the same name.",
    synonyms: ["sugar", "sugar_g", "sugars", "total sugar", "total_sugar", "sugar (g)", "sugar per serving"],
  },
  {
    key: "caffeine_mg",
    label: "Caffeine",
    kind: "measure",
    catalogPath: "attributes.caffeine_mg",
    unit: "mg",
    required: false,
    review: "An empty cell is not zero caffeine. A drink with no stated figure and a drink stated as caffeine free are different records here.",
    synonyms: ["caffeine", "caffeine_mg", "caffeine (mg)", "caffeine per serving"],
  },
  {
    key: "price",
    label: "Pack price",
    kind: "money",
    catalogPath: "offers[].priceMinor with offers[].currency",
    required: false,
    review: "A supplier's price is one merchant's price on one day. It becomes an offer with that merchant named and a date attached, never the product's price.",
    synonyms: ["price", "unit price", "unit_price", "pack price", "pack_price", "rrp", "msrp", "cost", "price_usd", "unit_price_usd"],
  },
  {
    key: "servings_per_pack",
    label: "Servings per pack",
    kind: "count",
    catalogPath: "attributes.servings_per_pack",
    required: false,
    review: "Servings, not units. A 12-can pack is 12 servings only if a can is one serving, and the file rarely says which it means.",
    synonyms: ["servings", "servings_per_pack", "serving count", "pack size", "pack_size", "pack", "count", "units per pack", "units_per_pack"],
  },
  {
    key: "source_reference",
    label: "Source reference",
    kind: "reference",
    catalogPath: "attributes.*.source.url or .ref",
    required: true,
    review: "Where the supplier says the figures came from. Held as text and never opened by this tool. Whose page it is, and whether that makes it evidence, is a reviewer's call: a feed can come from the maker or from somebody reselling them.",
    synonyms: ["source", "source_url", "source reference", "reference", "ref", "datasheet", "spec sheet", "spec_url", "url", "link"],
  },
];

export const fieldByKey = (key: string): TargetField | undefined => DRINK_FIELDS.find((f) => f.key === key);

/** Headers compare on this form only: case, spaces and punctuation are noise, spelling is not. */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
