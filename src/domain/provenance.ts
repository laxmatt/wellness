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

export const Provenance = z.object({
  source: Source,
  verification: Verification,
  unit: z.string().optional(),
});
export type Provenance = z.infer<typeof Provenance>;

export function sourced<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value,
    unit: z.string().optional(),
    source: Source,
    verification: Verification,
  });
}

export type Sourced<T> = {
  value: T;
  unit?: string;
  source: Source;
  verification: Verification;
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

export function stripProvenance<T>(s: Sourced<T>): T {
  return s.value;
}

export function provenanceOf<T>(s: Sourced<T>): Provenance {
  return { source: s.source, verification: s.verification, unit: s.unit };
}
