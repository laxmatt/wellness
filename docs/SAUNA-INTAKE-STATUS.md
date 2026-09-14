# Saunas: what is saved, and what is not finished

Three approved products, read on 2026-09-13, imported as drafts on 2026-09-14.
Work stopped here on Matt's instruction: no more importer, and no inference of
partner formats from public product pages until real inventory exports arrive
from SaunaCloud, Select Saunas and Sweat Kingdom.

## What is saved

**The category exists and is not published.** `saunas` lives in
`unpublishedCategories` in `src/domain/categories/index.ts`. `categoryById`
finds it so records validate and render in review; `categoryBySlug` does not, so
`/saunas` returns 404, nothing links to it and no sitemap holds it. Launching it
is moving one line between two lists.

**Three drafts, from the pages as read.**

| Record | Read from | Price | Availability |
|---|---|---|---|
| `saunacloud-atlas-one` | the maker's own page | quoted on request | unknown |
| `dynamic-barcelona-dyn-6106-01` | Select Saunas, a retailer | $1,999 | unknown, not verified |
| `sweat-kingdom-sweat-box-1p` | the maker's own page | $5,545 | unknown, the page says two things |

`intake/saunas/2026-09-13-approved.json` holds the readings, the approval and
every caveat. `npm run intake -- <file>` reports; `--write` creates what is
missing; `--update <id>` replaces one named record. It never overwrites a record
a reviewer has touched, and it never publishes.

**Quote-only is a listing, not a blocker.** Atlas One carries an offer with no
amount and `quoteOnly: true`, pointed at the one referral link SaunaCloud issued.
The page reads "Request pricing", the product is excluded from price filters
because it has no amount to filter on, and no schema.org Offer is emitted for it.

**Made-to-order is not a defect.** The Sweat Box page says sold out and also
states a five-week lead time. Availability is `unknown`, both statements are on
the record, and the merchant link stands so a shopper can check.

**Saunas are not ranked.** `scoring.criteria` is empty and `assignBadges` now
refuses every badge where a category has no criteria. That second half was found
by a test: the empty list alone still handed out Best Overall and Best Value on
a tie of zeroes.

## Three defects found and fixed on the way

1. **Brand listings published unlaunched partners.** `/brands`, the home page and
   the sitemap listed every brand in the catalogue, so SaunaCloud, Dynamic Saunas
   and Sweat Kingdom appeared with pages that had nothing on them.
   `getBrands`/`getBrandPage` now require a published product.
2. **The partner checklist assumed every record is ranked.** It crashed on the
   first draft, because `recommendCategory` reads published records only.
3. **The browser harness assumed the catalogue and the storefront are the same
   set.** It demanded a page for every record and failed on drafts.

## What each link is

| Merchant | Programme | The link on the record | What it earns |
|---|---|---|---|
| SaunaCloud | direct, approved | the issued referral link, site root | a commission; marked `affiliate`, `rel="sponsored"`, and the page says so |
| Select Saunas | UpPromote, approved | the product page | nothing; no tracking link has been issued |
| Sweat Kingdom | Awin 125462 / publisher 3090899 | the product page | nothing; no tracking link has been supplied |

No deep link was composed for any of them. Whether a commission link exists is a
separate question from whether an ordinary merchant link can be shown honestly,
and the two are recorded separately.

## Not finished

1. **Real partner inventory.** Nothing here came from a feed or an export. Three
   pages were read by hand. Scope against real samples when they arrive; do not
   infer a format from a product page.
2. **Images.** No record carries one. No brand has granted any right to reuse a
   photograph, and a publicly visible image is not a licence. A published record
   still requires a primary image; a draft no longer does, which is why these
   three could be read at all.
3. **The referral link goes to a site root, not to Atlas One.** A shopper
   pressing "Request pricing" lands on SaunaCloud's home page. Only a deep link
   from the programme fixes that, and none has been issued.
4. **Sweat Kingdom's Awin account carries an unresolved payment warning.**
5. **Whether "Atlas" is a separate company from SaunaCloud** is not established.
   The brand record carries the name on the domain that was read.
6. **Publishing the category** needs a decision nobody has made: three products
   is a thin comparison, and two of the three have no verified stock.

## Checks run on this snapshot

```
npx tsc --noEmit                 clean
npm run catalog:check            Catalog OK: 23 products, 20 brands, 19 merchants
npx vitest run                   1102 passed, 26 skipped
npx eslint src scripts e2e       clean
npm run build                    66 static pages, no sauna route
npm run e2e:public               880 checks, all passed
```

Live checks against a production build: `/saunas` 404, both sauna product pages
404, `/brands/saunacloud` 404, and no occurrence of "sauna" on the home page,
`/explore`, `/brands` or the sitemap.

One transient console error was reported by the harness on a single run
(React #418, a hydration text mismatch, on `/products/infraredi-flex-max`). It
did not reproduce on three targeted loads of that page or on the following full
run. Recorded rather than claimed fixed.
