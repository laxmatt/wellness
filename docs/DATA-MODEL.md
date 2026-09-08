# Data model

Zod schemas in `src/domain` are canonical. This document states the explicit mapping from those schemas to the Phase 6 Postgres schema drafted in `prisma/schema.prisma`. The mapping is maintained by hand. There is no generator.

## Entities

Product (`src/domain/product.ts`)

| Zod field | Prisma | Notes |
| --- | --- | --- |
| id | Product.id (String @id) | Stable internal id. Never shown to operators. |
| slug | Product.slug (@unique) | Canonical URL segment. |
| name, description | Product.name, Product.description | |
| brandId | Product.brandId -> Brand | FK |
| categoryId, subcategoryId | Product.categoryId, Product.subcategoryId | Category definitions stay in code. Column holds the id. |
| status | Product.status (enum ProductStatus) | |
| availability | Product.availability (enum Availability) | |
| market | Product.market (enum Market) | |
| images[] | ProductImage rows | One row per asset. `role`, `kind`, `src`, `alt`, `license`, `sourceJson`. |
| offers[] | MerchantOffer rows | See below. |
| referencePrice | Product.referencePriceMinor, referencePriceCurrency, referencePriceSourceJson, referencePriceVerification | Nullable group. |
| identifiers | ProductIdentifier rows | One row per (type, value). Types: gtin, mpn, asin, manufacturer_sku, merchant_sku (with merchantId). Unique index on (type, value, merchantId). Feeds resolve against this table. |
| warranty, returnPolicy | Product.warrantyText + warrantySourceJson + warrantyVerification, same for returnPolicy | Sourced strings flatten to value plus two columns. |
| dimensions, weight | Product.dimLength, dimWidth, dimHeight, dimUnit, dimSourceJson, dimVerification; weightValue, weightUnit, weightSourceJson, weightVerification | |
| attributes | ProductAttribute rows | `key`, `valueJson`, `unit`, `sourceJson`, `verification`. Unique (productId, key). Typed against the category definition at write time, same validator as the loader. |
| editorial.strengths, tradeoffs | EditorialNote rows | `kind` strength or tradeoff, `text`, `author`, `date`, `experiential`, `sourceJson`. |
| source | Product.sourceJson | |
| lastUpdated | Product.lastUpdated | |
| flags.demo, flags.newArrival | Product.isDemo, Product.isNewArrival | |

MerchantOffer

| Zod field | Prisma |
| --- | --- |
| id | MerchantOffer.id |
| productId (implicit) | MerchantOffer.productId -> Product |
| merchantId | MerchantOffer.merchantId -> Merchant |
| market, currency | MerchantOffer.market, currency |
| priceMinor, listPriceMinor | MerchantOffer.priceMinor, listPriceMinor |
| url | MerchantOffer.url |
| affiliate.status, network, programRef | MerchantOffer.affiliateStatus, affiliateNetwork, affiliateProgramRef |
| discountCodes[] | DiscountCode rows (offerId, code, description, expiresAt, sourceJson) |
| availability, shippingNote, merchantSku | same names |
| lastChecked | MerchantOffer.lastChecked |
| source | MerchantOffer.sourceJson |

Brand, Merchant: one table each, fields map by name. Brand images go to BrandImage rows with the same shape as ProductImage.

Category definitions do not live in the database. They are code, versioned, reviewed. Phase 6 merchandising state references category ids as strings.

## Sourced values

Every `Sourced<T>` becomes three columns or fields: the value (typed or JSON), `sourceJson` (the Source object), and `verification` (enum). This keeps queries on values cheap and provenance intact. No component reads `sourceJson` directly; `toProductView` builds the provenance map.

## Phase 6 additions (not in Zod yet)

| Table | Purpose |
| --- | --- |
| MerchandisingSlot | (pageKey, moduleKey, position, productId, pinned). Drives homepage and category ordering. |
| ReviewQueueItem | Feed rows the resolver could not match: rowJson, resultJson, queuedAt, resolvedAt, resolvedProductId, resolvedBy. |
| ImportRun | adapter, startedAt, finishedAt, rowCount, matchedCount, reviewCount, errorJson. |
| PriceCheck | offerId, checkedAt, priceMinor. History for stale-price review. |
| SavedComparison | shortId, categoryId, productIds[], createdAt, ownerUserId nullable. |
| User | id, email, createdAt. Magic-link only. No password column will ever exist. |

## Entity resolution for feeds

`IdentifierEntityResolver` (src/providers/feeds) matches on GTIN, then ASIN, then normalized MPN, then a previously mapped merchant SKU. One hit is a match with a confidence. Multiple hits are ambiguous. Zero hits are unmatched. Ambiguous and unmatched rows go to `ReviewQueueItem`. When an operator resolves one, the resolver learns the merchant SKU through `ProductIdentifier`, so the next import of that row auto-matches. Title similarity is never an auto-match path.

## Internationalization fields

`market`, `currency`, `language` exist on Product, MerchantOffer and CategoryDefinition today with single allowed values (US, USD, en). Adding a market means widening three enums, not restructuring tables.
