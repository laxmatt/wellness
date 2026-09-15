# Sweat Kingdom, Awin feed F3219: audit and private preview

Advertiser 125462, publisher 3090899, downloaded 2026-09-13. The file is kept
verbatim at `intake/sweat-kingdom/awin-125462-f3219-2026-09-13.csv`
(sha256 `9db0be0014d640489585346d4776760458e8c5d2b136dc9490dcd03da726bb6d`).

This is the first real partner feed. It supersedes the public-page reading of
The Sweat Box, which has been removed: a page read by hand is not a merchant's
catalogue, and where the merchant publishes one, that is the record.

## What the feed actually carries

225 rows, 62 columns, **47 of them empty in every row**.

| Carries a value | Rows |
|---|---|
| `advertiser_id`, `advertiser_name`, `id`, `title`, `description`, `link`, `image_link`, `aw_deep_link`, `brand`, `availability`, `price`, `condition` | 225 |
| `google_product_category` | 193 |
| `mpn`, `identifier_exists` | 97 |

**There is not one structured specification in it.** `product_detail`,
`product_highlight`, `certification`, `product_weight`, `product_height`,
`product_width`, `product_length`, `material`, `size` and `color` are empty on
every row. Everything a sauna would be compared on is either absent or in prose.
So the records built here carry **no attributes at all**: reading
"5X6 Footprint - 2-3 Person" out of a title is a guess wearing a parser's
clothes, and the brief said no invented specifications.

**`item_group_id` is empty on every row**, so the feed states no variant
grouping. The merchant's own product path does: 225 rows share **38 product
paths**. That is the grouping used, because it is the merchant's and not ours.

| | |
|---|---|
| Currency | `USD` on all 225 rows, as `"5145.00 USD"` in one field |
| Availability | `out_of_stock` 210, `in_stock` 15 |
| Condition | `new` on all 225 |
| Brands | Sweat Kingdom 192, ReGen Total Wellness 30, Harvia 3 |
| Images | 225 `image_link`, **57 distinct**, all `cdn.shopify.com`. No `additional_image_link` anywhere |
| Tracking | 225 `aw_deep_link`, all `www.awin1.com/cread.php`, one per variant |

## Families, variants and what is not a sauna

38 families. The largest are configurable products, not duplicates:

| Rows | Price range | Family |
|---|---|---|
| 27 | $17,995–$31,200 | `/products/the-sk-110` |
| 18 | $5,145–$9,645 | `/products/the-large-barrel-sauna-6-person` |
| 18 | $20,500–$31,200 | `/products/sk-210` |
| 18 | $6,945–$11,745 | `/products/the-summit` |
| 18 | $31,995–$54,495 | `/products/sk-contrast` |
| 12 | $4,990–$6,840 | `/products/the-og-plunge-tub` |

The SK 110's 27 rows are three footprints (5×6 / 2-3 person, 6×8 / 4-5 person,
7×10 / 6-8 person) × three sidings × three wood grades. Emitting 27 products
would fill a comparison with near-identical rows. Emitting one unpriced product
would throw away prices the feed does carry.

**The rule used: one product per family, represented by its cheapest
configuration** — that variant's title, its price, its own issued tracking link,
and a note saying how many configurations it was chosen from and what the range
is. The choice is editorial and it is written down on the record.

**The feed sells more than saunas.** 17 of 38 families are classified
`Home & Garden > Pool & Spa > Saunas` (126 rows). The rest are Spa Systems (30
rows, ReGen plunge tubs), Sauna Heaters (25), Sauna Accessories (12), and a
`$1,500` line called `professional-installation`, which is a service. Only a
family the feed itself classifies as a sauna is built. **A blank category is not
a yes**: `sk-contrast` (18 rows, $31,995–$54,495) and `the-outpost` (12 rows,
$19,245) are unclassified and look like saunas from their names, and they are
refused rather than guessed at. They need the partner's classification.

## The private preview

Five families of 38, 39 rows of 225, chosen to exercise both shapes:

| Record | Rows in family | Price used | Availability |
|---|---|---|---|
| `sweat-kingdom-the-sweat-box-1-person` | 1 | $5,545 | out_of_stock |
| `sweat-kingdom-the-deluxe-sweat-cabin` | 1 | $11,245 | out_of_stock |
| `sweat-kingdom-the-ascent` | 1 | $11,745 | out_of_stock |
| `sweat-kingdom-the-large-barrel-sauna-6-person` | 18 | $5,145 of $5,145–$9,645 | out_of_stock |
| `sweat-kingdom-the-summit` | 18 | $6,945 of $6,945–$11,745 | out_of_stock |

Every one is a **draft in an unpublished category**. Verified against a
production build: `/saunas`, every sauna product page and `/brands/sweat-kingdom`
all 404, and the home page, `/explore`, `/brands` and the sitemap contain no
occurrence of "sauna" or "Sweat Kingdom".

**Availability is recorded as the merchant states it.** The feed says
`out_of_stock` and many descriptions say "Availability: 5 week lead time". Both
are kept: the field as stated, the description whole. Nothing here reads a lead
time out of prose or contradicts the field beside it, and a five-week lead time
on a handmade cabin is how the thing is sold rather than a defect.

**Links are the ones Awin issued.** Each offer's URL is the `aw_deep_link` for
the exact variant priced, carrying `awinmid=125462` and `awinaffid=3090899`.
These are real affiliate links, so they are recorded as `affiliate`, marked
`rel="sponsored"`, and the page says a commission may be earned. Nothing was
composed here.

## Images: what is known and what is not

Every record carries the feed's `image_link`, recorded as `kind: "affiliate_feed"`
with **no `license`**. Two things are open and neither blocks private review:

1. **Reachability is unverified from this container.** All five image URLs
   returned 403 at this container's egress proxy, which refuses
   `cdn.shopify.com` as it refuses every partner domain. `npm run
   feed:sweatkingdom -- --check-images` does a HEAD on each and reports the
   status; run it from a machine with network access. It downloads nothing.
2. **No image terms have been read.** A feed carrying an image is not a grant to
   publish it. Awin's own programme terms and Sweat Kingdom's terms both need
   reading before anything goes public.

One observation, recorded as an observation: several file names are of the form
`ChatGPT_Image_Jul_28_2026_at_01_41_14_PM.png`, which suggests generated renders
rather than photographs. That is the merchant's own file name, not a finding
about the product, and it is worth settling before any of these are shown as
product photography.

## Feed inconsistencies worth reporting to the partner

- `/products/the-sweat-cabin-deluxe-6-person-copy` has `brand: "Sweat Kingdom"`
  while its title begins `REGEN`. The structured field is recorded and the
  disagreement is noted on the record. The `-copy` slug also suggests a
  duplicated listing, though its price, heater and image differ from
  `/products/the-deluxe-sweat-cabin`, so it is not obviously a duplicate.
- `/products/the-ascent`'s description is just its title.
- `google_product_category` is blank on 32 rows including two large sauna
  families.
- `mpn` is present on 97 of 225 rows and `gtin` on none, so most rows have no
  manufacturer identifier.

## What is still missing

1. **Select Saunas and SaunaCloud have sent nothing.** Their two records remain
   from public-page readings and are unchanged.
2. **Classification for `sk-contrast` and `the-outpost`**, worth $31,995–$54,495
   and $19,245 respectively.
3. **Image terms**, and the render question above.
4. **A representation for configurable products.** The cheapest-variant rule is
   defensible and it is not the only option; a "from $X" presentation would need
   UI work that has not been done.
5. **Specifications.** Nothing in this feed compares saunas. Type, capacity,
   footprint and power would have to come from somewhere else entirely.

## Checks

```
npx tsc --noEmit                                   clean
npm run catalog:check                              Catalog OK: 27 products, 20 brands, 19 merchants
npx vitest run                                     1135 passed, 26 skipped
npx eslint src scripts e2e                         clean
npm run build                                      no sauna route in the output
npm run e2e:public                                 880 checks, all passed
npm run feed:sweatkingdom -- --audit               38 families, 17 classified as saunas
npm run feed:sweatkingdom                          repeat run: 0 created, 0 differ, 5 already match
npm run feed:sweatkingdom -- --check-images        0 of 5 reachable: blocked at this container's proxy
```

`src/__tests__/awin-sweat-kingdom.test.ts` holds 22 tests that read the real feed
file, not a fixture.
