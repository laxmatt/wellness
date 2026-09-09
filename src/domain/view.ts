import { isUsable } from "@/domain/provenance";
import type { AttributeDefinition, AttributePrimitive } from "./attributes";
import { formatAttribute } from "./attributes";
import type { CategoryDefinition } from "./category";
import type { Money } from "./money";
import type {
  AffiliateStatus,
  Availability,
  Brand,
  Dimensions,
  ImageAsset,
  Merchant,
  MerchantOffer,
  Product,
  ProductStatus,
} from "./product";
import { deriveAffiliateStatus } from "./product";
import type { Provenance } from "./provenance";
import { provenanceOf } from "./provenance";

// ProductView is what components consume: plain values, plus a provenance map
// keyed by field path ("warranty", "attributes.irradiance", "price").
// Product truth stays in Product. Nothing in the UI writes back to it.

export type OfferView = {
  id: string;
  merchant: Pick<Merchant, "id" | "slug" | "name">;
  price: Money;
  listPrice?: Money;
  url: string;
  affiliateStatus: AffiliateStatus;
  network?: string;
  discountCodes: { code: string; description: string; expiresAt?: string }[];
  availability: Availability;
  shippingNote?: string;
  lastChecked: string;
};

export type PriceView = {
  money: Money;
  basis: "lowest_offer" | "reference";
  checkedAt: string;
  offerCount: number;
  // The price shown is a placeholder, not a real observed price. Price-based
  // claims (Best Value, Best Budget, Best Premium) must not be made about it.
  isDemo: boolean;
};

export type SpecView = {
  key: string;
  label: string;
  shortLabel: string;
  group: string;
  raw: AttributePrimitive | undefined;
  formatted: string;
  unit?: string;
  provenance?: Provenance;
  alwaysShowVerification: boolean;
};

export type ProductView = {
  id: string;
  slug: string;
  name: string;
  brand: Pick<Brand, "id" | "slug" | "name">;
  categoryId: string;
  subcategoryId?: string;
  description: string;
  status: ProductStatus;
  availability: Availability;
  images: ImageAsset[];
  price: PriceView;
  offers: OfferView[];
  affiliateStatus: AffiliateStatus;
  warranty?: string;
  returnPolicy?: string;
  dimensions?: Dimensions & { unit: string };
  weight?: { value: number; unit: string };
  attributes: Record<string, AttributePrimitive>;
  specs: SpecView[];
  cardSpecs: SpecView[];
  editorial: { strengths: string[]; tradeoffs: string[] };
  provenance: Record<string, Provenance>;
  flags: { demo: boolean; newArrival: boolean; incomplete: boolean; completeness: number };
  lastUpdated: string;
};

export type ViewContext = {
  category: CategoryDefinition;
  brands: Brand[];
  merchants: Merchant[];
};

export function lowestOffer(offers: MerchantOffer[]): MerchantOffer | undefined {
  return offers
    .filter((o) => o.availability !== "discontinued")
    .sort((a, b) => a.priceMinor - b.priceMinor)[0];
}

export function derivePrice(product: Product): PriceView {
  const best = lowestOffer(product.offers);
  if (best) {
    return {
      money: { amountMinor: best.priceMinor, currency: best.currency },
      basis: "lowest_offer",
      checkedAt: best.lastChecked,
      offerCount: product.offers.length,
      isDemo: best.source.kind === "demo",
    };
  }
  if (!product.referencePrice?.value) throw new Error(`Product ${product.id} has no offers and no priced referencePrice`);
  return {
    money: product.referencePrice.value,
    basis: "reference",
    checkedAt: product.referencePrice.source.retrievedAt ?? product.lastUpdated,
    offerCount: 0,
    isDemo: product.referencePrice.source.kind === "demo",
  };
}

export function completeness(product: Product, category: CategoryDefinition): number {
  const required = category.attributeDefinitions.filter((a) => a.required);
  if (required.length === 0) return 1;
  const present = required.filter((a) => {
    const sv = product.attributes[a.key];
    return sv !== undefined && isUsable(sv.verification);
  }).length;
  return present / required.length;
}

function specFor(def: AttributeDefinition, product: Product): SpecView {
  const sv = product.attributes[def.key];
  const displayText = def.displayField ? product[def.displayField]?.value : undefined;
  return {
    key: def.key,
    label: def.label,
    shortLabel: def.shortLabel ?? def.label,
    group: def.group,
    raw: sv?.value,
    formatted: displayText ?? formatAttribute(def, sv?.value),
    unit: sv?.unit ?? def.unit,
    provenance: sv ? provenanceOf(sv) : undefined,
    alwaysShowVerification: def.alwaysShowVerification,
  };
}

export function toProductView(product: Product, ctx: ViewContext): ProductView {
  const brand = ctx.brands.find((b) => b.id === product.brandId);
  if (!brand) throw new Error(`Unknown brand ${product.brandId} on ${product.id}`);

  const provenance: Record<string, Provenance> = {};
  const attributes: Record<string, AttributePrimitive> = {};
  for (const [key, sv] of Object.entries(product.attributes)) {
    // Only values that can be used as fact become attributes. `specs` already
    // withheld demo values from every screen and from the assistant, while
    // `attributes` kept them, and `evaluateCondition` reads `attributes`: a
    // demo zero for OLIPOP's caffeine qualified a search for zero caffeine for
    // as long as it has existed. An attribute the source does not state keeps
    // its provenance so the page can say "not stated" and show why, and never
    // becomes something to match on.
    if (sv.value !== undefined && isUsable(sv.verification)) attributes[key] = sv.value;
    provenance[`attributes.${key}`] = provenanceOf(sv);
  }
  if (product.warranty) provenance.warranty = provenanceOf(product.warranty);
  if (product.returnPolicy) provenance.returnPolicy = provenanceOf(product.returnPolicy);
  if (product.dimensions) provenance.dimensions = provenanceOf(product.dimensions);
  if (product.weight) provenance.weight = provenanceOf(product.weight);
  if (product.referencePrice) provenance.referencePrice = provenanceOf(product.referencePrice);

  const price = derivePrice(product);
  const best = lowestOffer(product.offers);
  provenance.price = best
    ? { source: best.source, verification: "unknown" }
    : provenance.referencePrice;

  const offers: OfferView[] = product.offers.map((o) => {
    const merchant = ctx.merchants.find((m) => m.id === o.merchantId);
    if (!merchant) throw new Error(`Unknown merchant ${o.merchantId} on offer ${o.id}`);
    return {
      id: o.id,
      merchant: { id: merchant.id, slug: merchant.slug, name: merchant.name },
      price: { amountMinor: o.priceMinor, currency: o.currency },
      listPrice: o.listPriceMinor !== undefined ? { amountMinor: o.listPriceMinor, currency: o.currency } : undefined,
      url: o.url,
      affiliateStatus: o.affiliate.status,
      network: o.affiliate.network,
      discountCodes: o.discountCodes.map((d) => ({ code: d.code, description: d.description, expiresAt: d.expiresAt })),
      availability: o.availability,
      shippingNote: o.shippingNote,
      lastChecked: o.lastChecked,
    };
  }).sort((a, b) => a.price.amountMinor - b.price.amountMinor);

  const specs = [...ctx.category.attributeDefinitions]
    .sort((a, b) => a.compareOrder - b.compareOrder)
    .map((def) => specFor(def, product));
  const cardSpecs = ctx.category.cardSpecKeys
    .map((k) => specs.find((s) => s.key === k))
    .filter((s): s is SpecView => s !== undefined);

  const comp = completeness(product, ctx.category);

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand: { id: brand.id, slug: brand.slug, name: brand.name },
    categoryId: product.categoryId,
    subcategoryId: product.subcategoryId,
    description: product.description,
    status: product.status,
    availability: product.availability,
    images: product.images,
    price,
    offers,
    affiliateStatus: deriveAffiliateStatus(product.offers),
    warranty: product.warranty?.value,
    returnPolicy: product.returnPolicy?.value,
    dimensions: product.dimensions?.value ? { ...product.dimensions.value, unit: product.dimensions.unit ?? "in" } : undefined,
    weight: product.weight?.value !== undefined ? { value: product.weight.value, unit: product.weight.unit ?? "lb" } : undefined,
    attributes,
    specs,
    cardSpecs,
    editorial: {
      strengths: product.editorial.strengths.map((n) => n.text),
      tradeoffs: product.editorial.tradeoffs.map((n) => n.text),
    },
    provenance,
    flags: {
      demo: product.flags.demo,
      newArrival: product.flags.newArrival,
      incomplete: comp < ctx.category.scoring.completenessFloor,
      completeness: comp,
    },
    lastUpdated: product.lastUpdated,
  };
}

export function provenanceFor(view: ProductView, path: string): Provenance | undefined {
  return view.provenance[path];
}

// Numeric accessor used by filters, scoring and facets. "price" resolves to
// the current price in minor units. Everything else reads attributes.
export function numericValue(view: ProductView, key: string): number | undefined {
  if (key === "price") return view.price.money.amountMinor;
  const v = view.attributes[key];
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return undefined;
}
