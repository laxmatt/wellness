import { z } from "zod";

export const SourceKind = z.enum([
  "manufacturer",
  "merchant_feed",
  "independent_test",
  "editorial",
  "demo",
]);
export type SourceKind = z.infer<typeof SourceKind>;

export const Verification = z.enum([
  "manufacturer_reported",
  "independently_verified",
  "demo",
  // The source was read and does not state this. Distinct from "demo", which
  // is a value this project made up, and from "unknown", which is a real value
  // whose provenance was not recorded. A figure nobody stated must not be
  // matched on: AG1's caffeine was carried as 0 while its own note said the
  // brand reports trace caffeine from green tea with no amount on the label,
  // so a search for zero caffeine returned it as a factual zero.
  "not_stated",
  "unknown",
]);
export type Verification = z.infer<typeof Verification>;

// method: "direct" means the source document was read. "secondhand" means the
// value was relayed (search summary, reseller listing) and must be re-checked
// against the source before production.
export const Source = z.object({
  kind: SourceKind,
  ref: z.string().min(1).optional(),
  url: z.url().optional(),
  retrievedAt: z.iso.date().optional(),
  method: z.enum(["direct", "secondhand"]).default("direct"),
  note: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

// A value the source states only as a bound: "less than 1 g of sugar",
// "over 189 mW/cm2". The number recorded is the bound itself, and it is the
// only number anybody stated. Recording it bare made the site assert an exact
// amount nobody claimed: AG1's label says less than 1 g and the page said 1 g.
//
// Strict, both of them, because that is what the five sources say. A value
// carrying `less_than: 1` is somewhere below 1 and nowhere else.
export const Bound = z.enum(["less_than", "greater_than"]);
export type Bound = z.infer<typeof Bound>;

// What a value was computed from, when it was computed rather than observed.
// Only one relationship is modelled, because only one exists in the data: a
// per-serving cost is the pack price divided by servings, and every one of the
// six records says so in its own note. Anything else stands on its own source
// until somebody records otherwise; this is not a dependency system and must
// not be used as a guess.
export const DerivedFrom = z.enum(["price"]);
export type DerivedFrom = z.infer<typeof DerivedFrom>;

export const Provenance = z.object({
  source: Source,
  verification: Verification,
  unit: z.string().optional(),
  bound: Bound.optional(),
  derivedFrom: DerivedFrom.optional(),
});
export type Provenance = z.infer<typeof Provenance>;

export function sourced<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    // Absent when the source states nothing. The entry stays so the note
    // survives: "the label does not say" is worth recording, and a number is
    // not invented to stand in for it. `check-catalog` refuses an absent value
    // whose verification claims the source reported it.
    value: value.optional(),
    unit: z.string().optional(),
    source: Source,
    verification: Verification,
    // Present when the source states a bound rather than an exact value. The
    // value is the bound. `check-catalog` refuses one that is not a number,
    // one whose verification cannot support a fact, and one pointing the
    // flattering way for its attribute's direction.
    bound: Bound.optional(),
    // Set when this value was computed from the product's price, so it is
    // worth exactly what that price is worth.
    derivedFrom: DerivedFrom.optional(),
  });
}

export type Sourced<T> = {
  value?: T;
  unit?: string;
  source: Source;
  verification: Verification;
  bound?: Bound;
  derivedFrom?: DerivedFrom;
};

export const DEMO_SOURCE: Source = {
  kind: "demo",
  ref: "Prototype demo value",
  method: "direct",
  note: "Not a real measurement. Replace before production.",
};

export function demo<T>(value: T, unit?: string): Sourced<T> {
  return { value, unit, source: DEMO_SOURCE, verification: "demo" };
}

// Values that cannot be used as fact: made up, or never stated by the source.
// Both are withheld from matching, from scoring and from the assistant, and
// both keep their note so a reader can see why.
export function isUsable(verification: Verification): boolean {
  return verification !== "demo" && verification !== "not_stated";
}

export function manufacturer<T>(
  value: T,
  opts: { url: string; retrievedAt: string; method?: "direct" | "secondhand"; unit?: string; note?: string },
): Sourced<T> {
  return {
    value,
    unit: opts.unit,
    verification: "manufacturer_reported",
    source: {
      kind: "manufacturer",
      url: opts.url,
      retrievedAt: opts.retrievedAt,
      method: opts.method ?? "direct",
      note: opts.note,
    },
  };
}

export function stripProvenance<T>(s: Sourced<T>): T | undefined {
  return s.value;
}

export function provenanceOf<T>(s: Sourced<T>): Provenance {
  return { source: s.source, verification: s.verification, unit: s.unit, bound: s.bound, derivedFrom: s.derivedFrom };
}

// The direction a bound points, as text a person can read: the qualifier the
// display and the phrasing layers both put in front of the number.
export const BOUND_WORDS: Record<Bound, string> = {
  less_than: "less than",
  greater_than: "more than",
};
