# Launch monetization readiness

What is traced here: every outbound link to a merchant, the affiliate disclosure
around it, and the data behind both. Read against the repository at the commit
this file lands in, not against a plan.

**The headline. This site earns nothing today, and until this batch its own
markup said otherwise.** All 26 offers in `catalog/` record
`affiliate.status: "unknown"`, none carries a programme reference, no URL
carries a tracking parameter, and `/disclosure` tells a reader in as many words
that every link is ordinary. Every outbound link nonetheless carried
`rel="sponsored"`, which is Google's declaration that a link was paid for.

No tracking id has been invented here, no account has been created, and nothing
in this document claims any programme has approved this site.

## What the repository actually holds

| | |
|---|---|
| Products | 20, all `published`. No drafts, no hidden records. |
| Offers | 26, every one `https`, every one on a published product |
| Affiliate status | `unknown` × 26. `affiliate` × 0. `non_affiliate` × 0 |
| `programRef` | set on 0 offers |
| Tracking parameters | none. No `tag`, no `ascsubtag`, no network redirect |
| Merchants | 16. `amazon` carries `network: "amazon"`; the other 15 are the makers' own shops |
| Offers a shopper cannot be sent to | 3: one discontinued (`edge-tub-elite`), two disputed (`plunge-original`, and Liquid I.V.'s Amazon row) |
| Products with no buyable offer at all | 2: `plunge-original`, `edge-tub-elite` |
| Products with no offer at all | 0 |
| Discount codes | 1, across the whole catalogue |

Counted by reading `catalog/products/*.json` directly; the same figures are
asserted in `src/__tests__/outbound-links.test.ts` so they cannot drift silently.

## Where a shopper meets a merchant link

Five surfaces, all traced:

| Surface | File | Offers it links |
|---|---|---|
| Category card | `src/components/product/ProductCard.tsx:27` | `buyableOffers`; one offer links out, more than one goes to `#retailers`, none shows "Details" |
| Category winners | `src/components/category/WinnersRow.tsx:50` | `buyableOffers`, one row per offer |
| Product page hero | `src/app/products/[slug]/page.tsx:65` | `buyableOffers`; `#retailers` when there are several |
| Product page retailers | `src/components/product/detail.tsx:51` | `buyableOffers` |
| Compare | `src/components/compare/CompareView.tsx` via `src/domain/compare.ts` | `buyableOffers` |

Every one of them goes through `buyableOffers`, which drops a disputed offer and
a discontinued one. That rule holds and was verified in a browser: 880 checks in
`e2e/public-journeys.mts` pass, including "nothing offers to shop the withheld
listing" on every product page.

**Hidden and draft products cannot reach any of these.** All three shopper reads
in `src/lib/queries.ts` filter `status: ["published"]` (lines 25, 88, 114), the
sitemap is built from those same reads, and the compare page resolves ids
through `getProductViewsByIds`, which filters too. Confirmed by
`src/__tests__/inventory-preview-catalog.test.ts`, which hides a record and
watches it leave the category page, the product page and a comparison.

**There is no redirect.** No `/go` route, no click handler, no interstitial. A
link goes straight from the page to the merchant. That is a deliberate and
honest design, and it has a consequence recorded below: nothing counts a
click-out.

## Defects found, and fixed in this batch

### 1. Every outbound link claimed to be paid for

`rel="sponsored nofollow noopener"` was hard-coded at five call sites. `sponsored`
is Google's markup for an advertisement, a paid placement or an affiliate link.
None of the 26 offers is any of those, and `/disclosure` says so:

> There is no affiliate programme behind this site today, no commission on
> anything you buy … Every "Visit" and "Shop" link is an ordinary link … Each
> retailer link says what the relationship is, and today every one of them says
> there is none.

The page and its own markup disagreed. The rule now lives in
`src/domain/outbound.ts`: `sponsored` when the offer records an affiliate link,
and on no other. `nofollow` and `noopener` stay on every outbound merchant link
either way. Rendered markup, after:

```
/products/celsius-sparkling-orange-12-pack   rel="nofollow noopener" × 2
/wellness-drinks                             rel="nofollow noopener" × 7
```

When a programme is joined the data changes and the markup changes with it,
which is what the disclosure page already promises.

### 2. `lowestOfferUrl` bypassed the withholding rule

`src/lib/queries.ts` read `view.offers[0]?.url`. `view.offers` is every offer on
the record sorted cheapest first, disputed and discontinued included, so the
helper returned a shopping link for `plunge-original` (its only offer is
disputed) and `edge-tub-elite` (its only offer is discontinued) while every
surface that renders them correctly shows none. It now reads
`buyableOffers(view)[0]?.url`.

It is called only from a test today, which is exactly why it was worth fixing: it
is an exported way to get a "buy" URL that quietly disagreed with every rendering
path, waiting for a caller.

### 3. Nothing stopped a record from claiming a commission it could not earn

`affiliate.status` is the switch that turns on both `rel="sponsored"` and the
words "Affiliate link. We may earn a commission." on the product page, and any
record could flip it long before an account existed. `validateCatalog` now
refuses an offer that says `affiliate` without a `network` and a `programRef`,
and refuses a `programRef` on an offer that says it is not paid. It checks no
tracking parameter and it is not evidence of approval; it is the cheapest
consistency the record can carry.

### Checks

```
npx vitest run src/__tests__/outbound-links.test.ts   # 12, the rules and the catalogue
npx vitest run                                        # 1060 pass, 26 skipped
npm run catalog:check                                 # Catalog OK: 20 products
npm run build && npm run e2e:public                   # 880 browser checks pass
```

`e2e/public-journeys.mts` used to find shopping links with `a[rel*="sponsored"]`.
That selector would have matched nothing the moment the rel started telling the
truth, and every "nothing links to the withheld listing" assertion would have
passed by finding no links at all. Shopping anchors now carry `data-shop-link`
and the checks select on that, so the guard is independent of what the rel means.

## Needed in a file this batch must not touch

**`src/components/compare/CompareView.tsx:104` still hard-codes
`rel="sponsored nofollow noopener"`.** Codex holds uncommitted changes there, so
it was left alone, and the compare page is the one surface still claiming a paid
relationship:

```
/compare?ids=celsius-sparkling-orange-12,olipop-root-beer-12
  rel="sponsored nofollow noopener" x 2
```

The other half of that change is done: `CompareMerchant` in
`src/domain/compare.ts` now carries `affiliateStatus`, passed through from
`buyableOffers` and acted on nowhere, so the remaining edit is one line of JSX:

```tsx
import { outboundLinkProps } from "@/domain/outbound";
// …
<a key={m.offerId} href={m.url} {...outboundLinkProps(m.affiliateStatus)} className={…}>
```

That replaces the `target` and `rel` attributes on lines 102-104. Nothing else
in the file changes.

`src/__tests__/disputed-and-price-selection.test.ts` was updated for the new
field. Its subject is unchanged and slightly sharper: marking every offer as
paying still moves no retailer and no ordering, and the status is now asserted
to be carried faithfully rather than assumed.

## Remaining owner inputs

Nobody but Matt can supply these, and none of them is a code change.

1. **Which programmes to apply to.** Amazon Associates covers 8 of the 26
   offers. The other 15 merchants are makers' own shops, each with its own
   programme, its own terms and its own application.
2. **The associate tag or tracking id for each accepted programme**, once
   accepted. Nothing here has invented one and nothing should.
3. **The programme reference to record per offer**, which is what
   `validateCatalog` now asks for before an offer may say it pays.
4. **A decision on the Amazon search link.** `hooga-hg300`'s Amazon offer is
   `https://www.amazon.com/s?k=hooga+hg300`, a search results page rather than a
   listing. It cannot identify a product, and a commission on it cannot be
   attributed to one. Replacing it needs the real listing, which is a fact
   nobody here holds; removing the offer is the other option. It was left alone
   rather than guessed at, and no validation rule was added to refuse it,
   because a rule that refused it would fail the catalogue check on the
   catalogue that ships and block work on data nobody can currently supply.
5. **Whether click-outs should be counted, and how.** See below.
6. **The disclosure wording for the day a programme exists.** The current page
   is accurate today and says what will change. Somebody has to write the next
   version and decide where a per-link disclosure sits on the category card and
   the compare table, which have none today. The product page already carries
   one, above the retailer list.

## Prioritized blockers

**Before any link may say it pays**

1. Land the `CompareView.tsx` one-liner above. Until then one surface asserts a
   paid relationship the site does not have.
2. An accepted programme, with its reference recorded per offer. The catalogue
   now refuses the claim without it.
3. Disclosure copy on the surfaces that carry none: the category card, the
   winners row and the compare table all link out with no statement beside the
   link. Only the product page has one. This is the largest gap between what
   the site does and what a shopper reading one page can see.

**Before any of it can be measured**

4. **Nothing counts a click-out.** `src/domain/analytics.ts:10` types a
   `retailer_clicked` event and `getAnalytics()` builds a provider that would
   write it to the console. Nothing calls either. No event has ever been
   emitted and no store exists, which the owner dashboard already states. With
   no redirect and no event, a click that leaves this site is invisible here,
   and revenue could only ever be read from the network's own reports.
5. **No public address, and indexing is off.** `indexingAllowed()` in
   `src/lib/site-url.ts` requires a real `NEXT_PUBLIC_SITE_URL`, an explicit
   opt-in, and a non-preview deployment. All three are unset. The sitemap is
   empty and every page is `noindex`. No traffic means no clicks means no
   commission, whatever the links say.

**Data to settle, not blocking**

6. `affiliate.network` is set to `"amazon"` on 3 of the 8 Amazon offers and left
   off the other 5. The field is unread while the status is `unknown`, so
   nothing is wrong on screen, but it will matter the moment a programme is
   configured. Left alone here because picking a value is a data decision.
7. `deriveAffiliateStatus` computes a product-level `view.affiliateStatus`
   (`src/domain/view.ts:379`) that no component renders. Either a surface should
   use it or it should go; it currently just exists.

## What has not changed, and must not

Affiliate status is not an input to scoring, ranking or badging. The ranking
reads specifications and price and cannot see whether a link pays. Nothing in
this batch went near that, `/disclosure` still states the rule, and the test
that enforces it still passes. No category, no sourcing, no catalogue fact and
no ledger entry was touched.
