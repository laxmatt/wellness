/**
 * Category policy shared by every sauna feed adapter.
 *
 * An adapter reads partner-specific columns. This module decides which
 * normalized facts may shape browse/compare and which remain checkout choices.
 * Identity is deliberately absent: family membership comes from reviewed,
 * saved partner decisions, never title similarity.
 */
export const SAUNA_COMPARISON_FIELDS = [
  "form", "capacity", "placement", "footprint", "heating_options",
  "electrical", "lead_time", "warranty", "standout_features",
] as const;

export const SAUNA_CHECKOUT_ONLY_OPTION_KINDS = [
  "color", "stain", "wood_finish", "siding", "roof_color", "roof_kit",
  "door_orientation", "window_orientation", "decorative", "accessory",
] as const;

export type SaunaOption = {
  kind: string;
  label: string;
  value: string;
  /** A reviewer may promote a normally cosmetic choice only for this reason. */
  reviewedMaterialReason?: string;
};

export type SaunaListingCandidate<Raw = unknown> = {
  partnerId: string;
  partnerListingId: string;
  raw: Raw;
  comparison: Partial<Record<(typeof SAUNA_COMPARISON_FIELDS)[number], unknown>>;
  options: SaunaOption[];
};

export type SaunaIdentityDecision = {
  partnerId: string;
  partnerListingId: string;
  canonicalFamilyId: string;
  reviewedBy: string;
  reviewedAt: string;
};

const checkoutKinds = new Set<string>(SAUNA_CHECKOUT_ONLY_OPTION_KINDS);

export function partitionSaunaOptions(options: SaunaOption[]): { comparison: SaunaOption[]; checkout: SaunaOption[] } {
  const comparison: SaunaOption[] = [];
  const checkout: SaunaOption[] = [];
  for (const option of options) {
    // A reason is required to override the category default. Recording only a
    // boolean would lose why this choice affects fit, installation, safety or
    // performance and make the exception impossible to audit.
    if (checkoutKinds.has(option.kind) && !option.reviewedMaterialReason?.trim()) checkout.push(option);
    else comparison.push(option);
  }
  return { comparison, checkout };
}

export function groupSaunaListings<Raw>(listings: SaunaListingCandidate<Raw>[], decisions: SaunaIdentityDecision[]) {
  const byListing = new Map(decisions.map((d) => [`${d.partnerId}\0${d.partnerListingId}`, d]));
  const families = new Map<string, SaunaListingCandidate<Raw>[]>();
  const unresolved: SaunaListingCandidate<Raw>[] = [];
  for (const listing of listings) {
    const decision = byListing.get(`${listing.partnerId}\0${listing.partnerListingId}`);
    if (!decision) {
      unresolved.push(listing);
      continue;
    }
    families.set(decision.canonicalFamilyId, [...(families.get(decision.canonicalFamilyId) ?? []), listing]);
  }
  return { families, unresolved };
}
