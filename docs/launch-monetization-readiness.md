# Launch monetization readiness

What is traced here: every outbound link to a merchant, the affiliate disclosure
around it, and the data behind both. Read against the repository at the commit
this file lands in, not against a plan.

**The headline. No link on this site is configured to earn anything, and
nothing here measures whether anything is earned.** Those are two separate
statements and neither of them is "revenue is zero".

What the repository proves: all 26 offers in `catalog/` record
`affiliate.status: "unknown"`, none carries a programme reference, and no URL
carries a tracking parameter. A network attributes a commission to an account
by a parameter on the link, so a click from any of these links is attributable
to nobody. That is a fact about configuration, read off the files.

What the repository cannot show: what anybody has earned. Nothing in this
project counts a click-out, there is no redirect, no event has ever been
emitted, and no store exists. Earnings live in a network's own reports and this
codebase has never seen one. **Revenue here is unmeasured, which is not the same
as measured and found to be zero**, and Matt's Amazon storefront exists
independently of this site and may have activity of its own that this repository
knows nothing about.

Until this batch the markup said something else again: every outbound link
carried `rel="sponsored"`, Google's declaration that a link was paid for, while
`/disclosure` told a reader in as many words that every link is ordinary.

No tracking id has been invented here, no account has been created, no catalogue
affiliate status has been changed, and nothing in this document claims any
programme has approved this site.

## What the repository actually holds

**A snapshot, taken 2026-09-12.** These figures are the state of the catalogue
on a date, not a rule. The tests deliberately no longer assert them: a test
demanding that this site hold no affiliate link would be a test against the
launch succeeding, and it would fail on the first day something paid. The tests
assert that the markup and the copy follow the record, whatever the record says.
This table is where the count lives, and it has to be re-read rather than
trusted.

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
words "Affiliate link. We may earn a commission.", and any record could flip it
long before an account existed. `validateCatalog` now refuses an offer that says
`affiliate` without a `network` and a `programRef`. It checks no tracking
parameter and it is not evidence of approval; it is the cheapest consistency the
record can carry.

A first version also refused a `programRef` on an offer recorded as `unknown` or
`non_affiliate`, and that was wrong. Holding a programme's identity is not the
same as a link being commissioned. An account can be open while this site is not
registered to it, which is exactly where this project stands, and recording the
reference against the offer it will apply to is how somebody keeps that
straight. Retained metadata is now permitted on any status, nothing on screen
reads it, and the status alone still decides what a shopper is told and whether
a link says it was paid for.

### 4. Two surfaces sent shoppers out with no statement beside the link

The product page has said what the relationship with each retailer is for a long
time. The category card and the winners row carried the same outbound buttons
with nothing beside them, so a shopper who never opened a product page saw a way
out of the site and no statement about who pays for it.

Both now carry one line, in the product page's own words, from the same map in
`src/domain/outbound.ts` that the product page now reads. It is computed from
the offer records and from nothing else:

| The record says | The line |
|---|---|
| `affiliate` | Affiliate link. We may earn a commission. |
| `non_affiliate` | Ordinary link. No commission. |
| `unknown` | Affiliate status not recorded for this offer. |

A winners card can hold several retailers, so a set is described once rather
than each button annotated, and a mixed set is described by the part a shopper
needs: "Some of these are affiliate links. We may earn a commission on those."
A set of ordinary and unrecorded links says "Some of these have no affiliate
status recorded", never "no commission", because that would turn an unrecorded
relationship into a denial nobody has evidence for.

A card whose action leads to this site rather than out of it carries no line.
The statement is about the link on the card, and there is no link on the card.

On `/wellness-drinks` today, rendered from a production build: nine cards read
"Affiliate status not recorded for this offer" and one winners card with two
retailers reads "…for these offers". That is what all 26 records say.

The product page's own line above the retailers used to be hard-coded: "No
affiliate programme is in place for this site, so none of these links earns a
commission." True on the day it was written, and printed directly above a row
that would read "we may earn a commission" on the first day it stopped being
true. It is read off the offers now, through the same helper, and a rendered
test holds that a paid link never has a blanket denial above it. The link to
`/disclosure` stays beside it whatever the answer is.

### Checks

```
npx vitest run src/__tests__/outbound-links.test.ts              # the rules, on fixtures and on the catalogue
npx vitest run src/__tests__/relationship-disclosure.render.test.tsx  # the three statuses, rendered
npx vitest run                                                   # 1074 pass, 26 skipped
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

## What Matt's Amazon account does and does not establish

Matt supplied an email from Amazon support confirming that his existing
**Influencer account and storefront are open and active**:

- Storefront: `amazon.com/shop/dtnmatt`
- Store ID: `mattthedorr-20`

A Store ID is the public identifier that appears in every affiliate URL a
programme issues. It is not a credential and nothing is protected by keeping it
out of this file. It has **not** been written into any code, any catalogue
record or any URL, and no offer's affiliate status was changed on the strength
of that email.

**What it establishes.** An account exists and Amazon has not closed it. That is
a real precondition, and it is the one on the list below that is now met.

**What it does not establish.** Four separate things, none of which follows from
an open account:

1. **That this website is registered to that account.** A programme approves
   the places a link may appear. A storefront being open says nothing about
   whether a new domain has been added to it and accepted.
2. **That tax information is complete.** Networks withhold payment, not
   linking, until it is, so this can be true and unnoticed for months.
3. **That product tracking is verified.** A tag that is issued is not a tag that
   has been seen to attribute a click to a product, and nothing in this project
   can observe whether it does.
4. **That anything has been earned, here or anywhere.** The storefront predates
   this site and is not connected to it. Its activity is its own and this
   repository has no view of it.

Until the first is settled, an affiliate link on this site would appear
somewhere the programme has not approved. That is why nothing here was
activated, and why `validateCatalog` now asks for a programme reference before
an offer may say it pays.

## Remaining owner inputs

Nobody but Matt can supply these, and none of them is a code change.

1. **Registering this website with the Amazon account that already exists.**
   The account is open; the site is not known to be on it. Amazon covers 8 of
   the 26 offers. The other 15 merchants are makers' own shops, each with its
   own programme, its own terms and its own application.
2. **Confirmation that tax information is complete**, and that a link from this
   domain attributes to `mattthedorr-20` when it is clicked. Neither can be
   read from here. Nothing has invented a tag and nothing should.
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
6. **The disclosure wording for the day a programme exists.** `/disclosure`
   states, in prose, that there is no affiliate programme behind this site. No
   test pins that sentence, deliberately: a test that did would fail the moment
   the page was correctly updated. It is a page somebody has to rewrite, and it
   is on this list because nothing will remind them. The current page is
   accurate today and says what will change. Somebody has to write the next
   version and decide where a per-link disclosure sits on the category card and
   the compare table, which have none today. The product page already carries
   one, above the retailer list.

## Prioritized blockers

**Before any link may say it pays**

1. Land the `CompareView.tsx` one-liner above. Until then one surface asserts a
   paid relationship the site does not have.
2. An accepted programme, with its reference recorded per offer. The catalogue
   now refuses the claim without it.
3. Disclosure on the compare table, which is the one surface still linking out
   with no statement beside the link. The card and the winners row now carry
   one and the product page always did. The same `relationshipNote` helper
   covers it, and `CompareMerchant` already carries the status it needs.

**Before any of it can be measured**

4. **Nothing counts a click-out, so nothing here can report revenue as zero or
   as anything else.** `src/domain/analytics.ts:10` types a `retailer_clicked`
   event and `getAnalytics()` builds a provider that would write it to the
   console. Nothing calls either. No event has ever been emitted and no store
   exists, which the owner dashboard already states. With no redirect and no
   event, a click that leaves this site is invisible here. Earnings could only
   ever be read from a network's own reports, and a figure of zero from this
   codebase would mean "nobody counted", not "nobody bought".
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
