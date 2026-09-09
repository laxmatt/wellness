import { isUsable } from "@/domain/provenance";
import type { AttributeDefinition, AttributePrimitive } from "./attributes";
import { formatAttribute } from "./attributes";
import type { CategoryDefinition } from "./category";
import type { Money } from "./money";
import { formatMoney } from "./money";
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
import type { Bound, Provenance } from "./provenance";
import { provenanceOf } from "./provenance";

// ProductView is what components consume: plain values, plus a provenance map
// keyed by field path ("warranty", "attributes.irradiance", "price").
// Product truth stays in Product. Nothing in the UI writes back to it.

export type OfferView = {
  id: string;
  merchant: Pick<Merchant, "id" | "slug" | "name">;
  price: Money;
  // This offer's amount is prototype data, not a price anybody quoted. The
  // number is never shown; the page says to check the merchant instead.
  priceIsDemo: boolean;
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

// What a shopper is shown in place of a placeholder amount. A number nobody
// quoted is not a price, and putting one on a shopping page is the single
// easiest way to lose a reader's trust: they click through, see something
// else, and every other figure on the page is suspect.
export const PRICE_UNCONFIRMED = "Check current price";

export function displayPrice(price: PriceView): string {
  return price.isDemo ? PRICE_UNCONFIRMED : formatMoney(price.money);
}

export function displayOfferPrice(offer: OfferView): string {
  return offer.priceIsDemo ? PRICE_UNCONFIRMED : formatMoney(offer.price);
}

export type SpecView = {
  key: string;
  label: string;
  shortLabel: string;
  group: string;
  raw: AttributePrimitive | undefined;
  formatted: string;
  // Set when this value was computed from a price that is prototype data, so
  // `formatted` says to check the price rather than quoting a figure derived
  // from an invented one.
  moneyWithheld?: boolean;
  // Set when the source states the figure two ways. It is shown, marked, and
  // matched on by nothing.
  disputed?: boolean;
  // Set when the source states a bound rather than an exact value. `formatted`
  // already carries the qualifier; this is for a screen that needs to know.
  bound?: Bound;
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
  // Keys whose value is a stated bound, not an exact value. Matching reads this
  // and answers only what the bound settles; everything else is unknown, and
  // unknown never matches.
  bounds: Record<string, Bound>;
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

// Offers whose amount is a real one somebody recorded. A prototype amount is
// not a cheaper offer; it is not an offer at all for pricing purposes.
export function pricedOffers(offers: MerchantOffer[]): MerchantOffer[] {
  return offers.filter((o) => o.availability !== "discontinued" && o.source.kind !== "demo");
}

// The offer a price is taken from. Real amounts first, and only when there is
// no real amount at all does a prototype one stand in, marked unconfirmed.
//
// Sorting every offer together let an invented figure win: Hooga's HG300 had
// $199 read from its maker's own page and a prototype $149 on an Amazon
// record, and the page showed "Check current price" because the invented
// number was lower.
export function lowestOffer(offers: MerchantOffer[]): MerchantOffer | undefined {
  const live = offers.filter((o) => o.availability !== "discontinued");
  const real = pricedOffers(offers);
  return (real.length > 0 ? real : live).sort((a, b) => a.priceMinor - b.priceMinor)[0];
}

export function derivePrice(product: Product): PriceView {
  const best = lowestOffer(product.offers);
  if (best) {
    return {
      money: { amountMinor: best.priceMinor, currency: best.currency },
      basis: "lowest_offer",
      checkedAt: best.lastChecked,
      // The count belongs to the same set the price came from: "lowest of 2
      // retailers" must not count a retailer whose amount is prototype data.
      offerCount: (pricedOffers(product.offers).length || product.offers.length),
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
  // Completeness measures what is actually known, so every reason a value is
  // withheld from `attributes` counts here too: a placeholder, a figure the
  // source does not state, a figure computed from a placeholder price, and a
  // figure whose own source states it two ways. The last one was missing, so a
  // product could hold a required field it answers nothing on and still read
  // 100 per cent complete.
  const priceIsDemo = derivePrice(product).isDemo;
  const present = required.filter((a) => {
    const sv = product.attributes[a.key];
    if (sv === undefined || sv.value === undefined) return false;
    if (sv.disputed) return false;
    if (priceIsDemo && sv.derivedFrom === "price") return false;
    return isUsable(sv.verification);
  }).length;
  return present / required.length;
}

function specFor(def: AttributeDefinition, product: Product, moneyWithheld = false): SpecView {
  const sv = product.attributes[def.key];
  const displayText = def.displayField ? product[def.displayField]?.value : undefined;
  // A bound only qualifies a value that can be used as fact. A demo or
  // not-stated entry shows what it always showed.
  const bound = sv && sv.value !== undefined && isUsable(sv.verification) ? sv.bound : undefined;
  const disputed = sv?.disputed === true && sv.value !== undefined;
  return {
    key: def.key,
    label: def.label,
    shortLabel: def.shortLabel ?? def.label,
    group: def.group,
    raw: moneyWithheld || disputed ? undefined : sv?.value,
    bound,
    moneyWithheld: moneyWithheld || undefined,
    disputed: disputed || undefined,
    formatted: moneyWithheld
      ? PRICE_UNCONFIRMED
      : disputed
        ? `${formatAttribute(def, sv?.value)}, disputed`
        : (displayText ?? formatAttribute(def, sv?.value, bound)),
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
  const bounds: Record<string, Bound> = {};

  const price = derivePrice(product);
  // A value computed from a placeholder price is that placeholder, divided.
  // Liquid I.V.'s price per serving was the demo pack price over 16, recorded
  // as an editorial calculation, shown as a fact, and used to rank it.
  //
  // Only values that say they came from the price are withheld. An earlier
  // version withheld every attribute in the category's money unit, which
  // assumed a derivation nobody had recorded: a price a merchant states per
  // serving, or a shipping charge with its own source, would have been thrown
  // away because a different figure on the same product was prototype data.
  const derivedKeys = new Set(
    price.isDemo
      ? Object.entries(product.attributes)
          .filter(([, sv]) => sv.derivedFrom === "price")
          .map(([key]) => key)
      : [],
  );
  for (const [key, sv] of Object.entries(product.attributes)) {
    // Only values that can be used as fact become attributes. A demo value is
    // still shown, labelled "Demo data" by every component that renders a spec,
    // and it is withheld from the assistant entirely. What it must never do is
    // answer a question as a fact, and it did: `evaluateCondition` reads
    // `attributes`, so OLIPOP's demo zero qualified a search for zero caffeine
    // for as long as it has existed. An attribute the source does not state
    // keeps its provenance so the page can say "not stated" and show why, and
    // neither kind becomes something to match on.
    // A figure its own source states two ways is not a fact this catalogue can
    // match on. It stays visible, with both statements in its note, and
    // answers no question: "over 73" would satisfy a search for more than 73,
    // and the same page says 73 exactly.
    if (sv.value !== undefined && isUsable(sv.verification) && !derivedKeys.has(key) && !sv.disputed) {
      attributes[key] = sv.value;
      if (sv.bound) bounds[key] = sv.bound;
    }
    provenance[`attributes.${key}`] = provenanceOf(sv);
  }
  if (product.warranty) provenance.warranty = provenanceOf(product.warranty);
  if (product.returnPolicy) provenance.returnPolicy = provenanceOf(product.returnPolicy);
  if (product.dimensions) provenance.dimensions = provenanceOf(product.dimensions);
  if (product.weight) provenance.weight = provenanceOf(product.weight);
  if (product.referencePrice) provenance.referencePrice = provenanceOf(product.referencePrice);

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
      priceIsDemo: o.source.kind === "demo",
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
    .map((def) => specFor(def, product, derivedKeys.has(def.key)));
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
    bounds,
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
