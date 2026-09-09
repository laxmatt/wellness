# Launch readiness, read-only inventory

Taken from the repository at 4e3a1ba. Nothing was deployed, contacted, changed
or purchased to produce it. Every line below is either **verified** against a
file in this repository or **missing**, meaning the evidence a launch would
need is not here. "Missing" is not a claim that the work was not done
somewhere; it is a claim that this repository does not show it.

The assistant is deliberately out of scope: it has its own record in
`docs/ASSISTANT.md` and `docs/live-test-results/`. This is the rest of the
site.

## Catalogue data

| | |
| --- | --- |
| Products | 20, across 3 categories |
| Brands | 14 files |
| Merchants | present, with `websiteUrl` and market |

**Attribute provenance, verified.** Every attribute carries a source and a
verification tier. Across all 20 products: **124 manufacturer-reported, 48
unknown, 24 demo**. By retrieval method: 72 direct, 124 secondhand.

**Not one attribute is independently verified.** The tier
`independently_verified` exists in the code and is used by nothing in the
catalogue. Every figure a shopper reads is either the maker's claim, a value
whose source is unrecorded, or demo data.

**14 of 20 products carry demo attributes**, 24 fields in total. Six product
prices are placeholders (all six red-light panels the assistant sees, plus two
drinks). The site handles this correctly and visibly: placeholder prices are
withheld from price claims, listed apart as unconfirmed, excluded from
price-based badges, and marked with a "Demo data" tag. The handling is
verified. What is missing is the real data.

**One product is ineligible for badges** (OLIPOP, 5 demo fields), which the
catalogue check reports.

## Offers and affiliate readiness

| | Verified | Missing |
| --- | --- | --- |
| Offer records | 26, each with merchant, market, currency, price, URL | — |
| Availability | — | all 26 are `unknown`; none says in stock |
| Affiliate status | — | all 26 are `unknown`; no network, tag or tracking id anywhere |
| Retrieval method | 13 direct | 13 `secondhand`, "relayed via search summary, manufacturer page not fetched directly" |
| Link hygiene | `rel="sponsored nofollow noopener"`, `target="_blank"` on every outbound offer link | — |
| Disclosure page | `/disclosure`, titled "Affiliate disclosure", linked in the footer | — |

**No affiliate programme is joined, or at least nothing here shows one.** There
is no network identifier, no tracking parameter, and no signed agreement in the
repository. Every "Buy" link points at a plain manufacturer URL. The site can
be published in this state, but it earns nothing and the disclosure page
describes a relationship that does not yet exist.

**Half the offer prices were not fetched from the merchant.** Thirteen carry
`method: "secondhand"` with a note saying the page was not fetched directly.
Those prices are the ones a shopper is quoted.

## Images and rights

**No image rights evidence exists, because no real image does.** All 24 images
across the catalogue are `kind: "demo_placeholder"` with `src: "demo:<seed>"`,
rendered procedurally by `ImageFrame`. There are zero image files in `public/`.

The schema is ready for the real thing: `affiliate_feed`,
`approved_creative`, `licensed_upload` are defined alongside
`demo_placeholder`, and each image can carry a source. Nothing uses them.

Launching with procedural placeholders is a decision, not an accident, and it
is the single most visible gap on a shopping site.

## Deployment configuration

| | |
| --- | --- |
| `next.config.ts` | present and **empty**: no image domains, no headers, no redirects |
| Host config | **missing**: no `vercel.json`, `Dockerfile`, `netlify.toml` or `fly.toml` |
| CI | **missing**: no `.github/workflows` |
| `robots.txt` | **missing** |
| `sitemap.xml` | **missing** |
| `manifest` | **missing** |
| `NEXT_PUBLIC_SITE_URL` | read by `src/lib/site.ts`, defaults to `http://localhost:3000` |

**A deploy would publish canonical URLs pointing at localhost** unless
`NEXT_PUBLIC_SITE_URL` is set. Nothing in the repository sets it, and nothing
fails if it is missing.

**Nothing runs the test suite automatically.** 585 tests, 46 browser checks, a
catalogue check and a typecheck all exist and all pass, and every one of them
has to be run by hand.

Environment variables the code reads: `ADMIN_ACCESS_KEY`, `DATABASE_URL`,
`NEXT_PUBLIC_SITE_URL`, `OPENAI_*`, and the `ASSISTANT_*` family. Only the
assistant's are documented, in `docs/ASSISTANT.md`.

## Public journeys, other than the assistant

Ten routes exist: `/`, `/[category]`, `/[category]/[facet]`, `/brands`,
`/brands/[slug]`, `/compare`, `/disclosure`, `/explore`, `/how-we-choose`,
`/products/[slug]`.

**Verified by the build and the test suite**: every route prerenders,
category filtering and the comparison table work without the assistant, badge
and value selection are computed and explained by `catalog:check`, and
`/how-we-choose` documents the ranking.

**Not verified anywhere**: no browser check covers any journey except the
assistant's effect on the category page. Filtering by chip, the comparison
table, brand pages, product pages and `/explore` have unit coverage and no
end-to-end coverage. There is no accessibility audit, no performance
measurement, no mobile-viewport check and no analytics.

## What would block a launch

In the order that matters:

1. **Images.** 24 of 24 are procedural placeholders. Nothing to license, and
   nothing showing the products.
2. **Affiliate.** No programme, no tracking, no revenue path, and a disclosure
   page describing a relationship that does not exist.
3. **Prices.** Six placeholders shown as unconfirmed, and 13 of 26 real ones
   never fetched from the merchant.
4. **`NEXT_PUBLIC_SITE_URL` and a host config.** Canonicals would point at
   localhost.
5. **No robots or sitemap**, on a site whose whole purpose is search traffic.
6. **No CI.** Every check is manual.

Independent verification of even one attribute per product would also change
what the site can honestly claim; today the answer to "who says so" is the
manufacturer for 124 fields and nobody for 48.
