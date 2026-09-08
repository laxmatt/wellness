# Wellness Compare

Premium wellness storefront plus comparison tool. Launch categories: red light therapy, cold plunges, functional wellness drinks. This repository is the standalone product. Nothing here depends on the printer site.

Status: Phase 2 complete. Storefront homepage, category and facet pages, product detail pages, compare table, brands, explore, How We Choose. Matcher rendered but inert until Phase 4.

## Run

```
npm install
npm run dev            # http://localhost:3000 smoke route
npm test               # vitest
npm run typecheck
npm run catalog:check  # validate catalog JSON and print rankings and badges
```

Node 22. No database. No environment variables.

## Layout

```
catalog/                 The catalog. JSON per product, brand, merchant. Validated on load.
  products/*.json
  brands/*.json
  merchants/*.json
docs/DATA-MODEL.md       Field-level model and the explicit Prisma mapping for Phase 6.
prisma/schema.prisma     Draft target schema. Not wired. No Prisma dependency yet.
scripts/check-catalog.ts Loads, validates, prints rankings.
src/domain/              Pure TypeScript. No React, no IO.
  provenance.ts          Sourced<T>, Source, Verification.
  money.ts               Money in integer minor units. Market, Currency, Language.
  attributes.ts          AttributeDefinition, AttributeValue, formatting, validation.
  product.ts             Product, MerchantOffer, Brand, Merchant, ImageAsset, identifiers.
  category.ts            CategoryDefinition: attributes, filters, scoring, value, badges, insights, facets.
  categories/            red-light, cold-plunge, wellness-drinks definitions.
  view.ts                toProductView: plain values plus a provenance map for the UI.
  conditions.ts          Condition evaluation used by filters, facets, insights.
  personalization.ts     PreferenceSet, MatchResult (Phase 3 and 4 fill these in).
  analytics.ts           Typed event union.
  recommend/             score, value, badges, insights. Deterministic.
src/providers/           Replaceable interfaces plus prototype implementations.
  catalog/               CatalogProvider, LocalCatalogProvider (JSON).
  feeds/                 MerchantFeedAdapter, FeedRow, EntityResolver, review queue triage.
  ai/                    AIProvider, MockAIProvider (regex plus vocabulary).
  email/                 EmailProvider, Noop.
  analytics/             AnalyticsProvider, Console, Memory.
  index.ts               Composition root. Swap implementations here only.
src/components/ui/       Design primitives. Button, Chip, Badge, VerificationTag, PriceDisplay, SpecRow, ImageFrame, DemoArt.
src/components/product/  ProductCard.
src/app/                 Next.js App Router. page.tsx is the Phase 1 smoke route.
```

## Three layers, kept apart

1. Product truth. `Product` in `catalog/`. Every factual field is `Sourced<T>`: value, source (kind, url, retrievedAt, method, note), verification.
2. Editorial interpretation. Derived deterministically from truth by `insightRules` in the category definition. Optional authored notes on the product carry author, date and a source when experiential.
3. Personalization. `PreferenceSet` and `MatchResult`. Held in memory on the client. Never written to the catalog, never tracked.

The UI consumes `ProductView`, not `Product`. `toProductView` strips provenance into a flat `attributes` map and a parallel `provenance` map keyed by field path (`attributes.irradiance_mw_cm2`, `warranty`, `price`). Components read plain values and pull provenance when they need to render a verification tag.

## Provenance rules

Verification levels: `manufacturer_reported`, `independently_verified`, `demo`, `unknown`. `independently_verified` requires a source of kind `independent_test`; the catalog validator rejects anything else. Every prototype product is flagged `demo: true`. Manufacturer domains were unreachable from the build environment, so every manufacturer-reported value in the current catalog carries `method: "secondhand"` and a note. Re-verify against the source before production.

## Recommendation rules

Scoring: per-category weighted criteria, min-max normalized across published products in the category, direction from each attribute's `preferenceDirection`. Missing values contribute zero. Products under the completeness floor are ineligible for badges.

Value (Phase 1 placeholder, not final): `qualityWeight * quality + affordabilityWeight * affordability`. Quality is the 0 to 100 score. Affordability is 100 for the cheapest eligible product and 0 for the priciest, linear in between. Default weights 0.65 and 0.35, set per category in `value`. `priceBasis` is `price` or `attribute:<key>` (drinks use per-serving cost). `minQualityShare` is an optional guard, off by default.

Badges, in order: Best Overall (top score), Best Value (top value; when the same product wins both, the card shows Best Overall plus an "also the strongest value" note), Best Budget and Best Premium (top score in tier, at least `minQualifying` products in tier, never to a product already badged). Ties break on `tieBreak` keys then id.

`ScoringInput` carries `id`, `priceMinor`, `attributes`. No offers. A test flips every offer's affiliate status and asserts identical ranking and badges.

## Adding a product

Add `catalog/products/<id>.json`. Run `npm run catalog:check`. The loader rejects unknown attribute keys, wrong attribute types, unknown brands or merchants, missing primary images, duplicate ids or slugs, and unsupported verification claims.

## Phases

1. Done. Architecture, model, tokens, catalog, engine, tests.
2. Done. Homepage, category and facet pages, product detail, compare table, supporting pages.
3. Compare views, relaxation search, personalization core.
4. Matcher in the UI with the mock provider, then a real AIProvider behind a flag.
5. Cold Plunge and Wellness Drinks through the same components.
6. Admin and merchandising on Postgres via the Prisma mapping in docs/DATA-MODEL.md.
7. Production integrations.
