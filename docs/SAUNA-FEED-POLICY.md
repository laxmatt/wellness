# Sauna feed and family policy

Sauna browse and comparison operate on reviewed product families, not supplier
rows. A partner adapter may parse any file shape, but it must produce normalized
listing candidates and replay saved `(partner, listing id) → canonical family`
decisions. Titles and image similarity may support a review screen; neither is
authority to merge products, especially across partners.

The category-level boundary lives in
`src/domain/categories/sauna-policy.ts`. Comparison-worthy facts are form/style,
explicit capacity, explicit dimensions or footprint, heating approach, explicit
electrical requirements, supported lead time and warranty, honest starting or
price ranges, and sourced standout features. Unknown values stay unknown.

Colors, stains, siding and wood finishes, roof colors/kits, door/window
orientation, decorative choices and accessories remain checkout-only by
default. A reviewer may promote one only by recording why it materially changes
fit, installation, safety or performance. The reason travels with the decision.

Raw partner rows and their provenance remain below the family. A family page
summarizes configuration categories and links to the partner's family page for
exact selection; it does not recreate checkout. Starting price is the minimum
active underlying offer and is labelled **From**, with the warning that final
price depends on configuration.

## Partner adapter contract

1. Read partner columns without guessing missing claims.
2. Emit a stable partner listing id, raw row, normalized comparison facts and
   typed configuration options.
3. Apply saved identity decisions. Leave unknown listings unresolved.
4. Partition options through the category policy.
5. Stage atomically; never drop unresolved or adjacent rows.

The Sweat Kingdom script is one adapter. A second synthetic adapter in
`src/__tests__/sauna-policy.test.ts` proves the policy has no dependency on its
headings, title syntax or option parser.
