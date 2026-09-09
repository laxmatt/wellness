# Launch readiness, read-only inventory

Taken from the repository at 58ecd85, updated through the bounded-value pass. Nothing was deployed, contacted, changed
or purchased to produce it. Every line below is either **verified** against a
file in this repository or **not evidenced here**, meaning this repository does
not carry the evidence a launch would need. "Not evidenced here" is a claim
about the repository, never a claim that the work was not done somewhere else.

Corrected on 2026-09-09 after review: the brand count, the placeholder-price
count, the provenance figures, and three sections whose earlier wording turned
an absence of evidence into a positive finding. Each correction is marked.

The assistant is deliberately out of scope: it has its own record in
`docs/ASSISTANT.md` and `docs/live-test-results/`. This is the rest of the
site.

## Catalogue data

| | |
| --- | --- |
| Products | 20, across 3 categories |
| Brands | **17 files** (was recorded as 14; `ls catalog/brands` and `catalog:check` both say 17) |
| Merchants | 16 files, each with `websiteUrl` and market |

**Attribute provenance, verified.** Every attribute carries a source and a
verification tier. Across all 20 products, 196 attributes: **123
manufacturer-reported, 46 unknown, 24 demo, 3 not stated**. By retrieval
method: 72 direct, 124 secondhand. Five of the manufacturer-reported figures
are bounds rather than measurements, and are marked as bounds.

**Nothing is independently verified, and that is a smaller problem than the
first draft implied.** (Corrected.) A manufacturer's own figure is legitimate
evidence when it is faithfully sourced and attributed, which is what the site
does: every spec shows who said it, and `independently_verified` exists as a
tier for the day a figure is checked against something else. Nobody needs to
buy a panel and meter it to launch.

The real gap is the quality of the sourcing, not the absence of a lab:

- **124 of 196 attributes are secondhand**, carrying the note "relayed via
  search summary; manufacturer page not fetched directly". The claim is
  attributed to the maker, but the maker's page was never read.
- **46 attributes record no source at all** (`unknown`). The site shows
  "source not recorded", which is honest and unusable.

Fetching the manufacturer pages directly would move most of that first number
without any independent testing. That is the cheap fix and it is not done.

**14 of 20 products carry demo attributes**, 24 fields in total.

**Eight of the twenty selected-view prices are placeholders** (corrected: the
earlier "six" counted the red-light panels and then described two drinks as
well, which is eight). Computed from `toProductView(...).price.isDemo`, the
same value the page renders: `bon-charge-max`, `hooga-hg300`, `hooga-pro1500`,
`infraredi-flex-max`, `joovv-solo-3`, `platinumled-biomax-900`,
`liquid-iv-hydration-multiplier-16`, `olipop-root-beer-12`. Twelve prices are
real.

The site handles placeholders correctly and visibly: they are withheld from
price claims, listed apart as unconfirmed, excluded from price-based badges,
and marked with a "Demo data" tag. The handling is verified. What is missing is
the real data.

**Four products are ineligible for badges**: Infraredi Flex Max, AG1, Cure
Hydration and OLIPOP. Two of those four became ineligible in 58ecd85, when
unsupported zero values were removed from AG1 and Cure rather than left
standing as facts. Deleting a number the label does not state lowers
completeness, and it should: the site now knows less than it claimed to.

### Bounds, and what is left for a person

Five figures in the catalogue are bounds their sources state rather than
measurements, and until 2026-09-09 they were stored as exact numbers: AG1's
sugar, recorded as `1` against a label that says "less than 1 g", and the
irradiance floors of BON CHARGE Max (142), Hooga HG300 (73), Hooga PRO1500
(189) and Joovv Solo 3.0 (100), each stated by its maker as "over" or "greater
than" that figure.

They now carry the bound with the value. The qualifier is shown wherever the
figure is shown, matching answers only what the bound settles, no comparison
row holding a bound marks a winner, and scoring reads the stated end, which is
the end that cannot flatter the product. `docs/ASSISTANT.md` records the
capability that costs.

Two things remain for a person, because no check settles them:

1. **Five of the seven irradiance figures state no measurement distance**
   (BON CHARGE, Hooga PRO1500, Joovv, Mito MitoPRO, Infraredi). Irradiance
   without a distance is not comparable between brands. The comparison table
   refuses to rank those rows and the ranking still scores them, which is the
   honest limit of what the data supports.
2. **Infraredi reports two irradiance figures by two instruments**, 167 by
   solar meter and 79 by spectrometer, and the catalogue records 79. That is a
   choice about which instrument to believe, not a bound.

## Offers and affiliate readiness

| | Verified | Not evidenced here |
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

The schema is ready for the real thing: `affiliate_feed`, `approved_creative`
and `licensed_upload` are defined alongside `demo_placeholder`, and each image
can carry a source. Nothing uses them.

Launching with procedural placeholders is a decision, not an accident, and it
is the single most visible gap on a shopping site.

## Deployment configuration

(Corrected. The earlier version read the absence of these files as a statement
about how the site would deploy. It is not. Hosting settings live in a
provider's dashboard as often as in a repository, so what follows says only
what this repository does and does not carry.)

| | In the repository |
| --- | --- |
| `next.config.ts` | present and **empty**: no image domains, no headers, no redirects |
| Host config | none: no `vercel.json`, `Dockerfile`, `netlify.toml` or `fly.toml` |
| CI | none: no `.github/workflows` |
| `robots.txt` | none |
| `sitemap.xml` | none |
| `manifest` | none |
| `NEXT_PUBLIC_SITE_URL` | read by `src/lib/site.ts`, defaults to `http://localhost:3000` |

What follows from that, and only this much: **a deploy that does not set
`NEXT_PUBLIC_SITE_URL` out of band publishes canonical URLs pointing at
localhost**, and nothing in the code fails if it is unset. Whether a host
already sets it is not answerable from here. Someone with access to the
hosting account has to say.

The same applies to CI: **this repository automates nothing**, and that does
not tell you whether checks run somewhere else.

Everything that does exist passes, run by hand today at 58ecd85:

- **623 tests** in 39 files, all passing, including the two Postgres ledger
  suites run against the disposable test database. They skip without
  `TEST_DATABASE_URL`, and a skip is not a pass.
- **46 browser checks** in `e2e/set-aside-updates-page.mjs`, all passing
  against a real build with a stubbed model. Re-run after the catalogue change,
  not carried over from an earlier run.
- `npm run catalog:check`, `npm run lint`, `npm run typecheck` and
  `npm run build`.

Environment variables the code reads: `ADMIN_ACCESS_KEY`, `DATABASE_URL`,
`NEXT_PUBLIC_SITE_URL`, `OPENAI_*`, and the `ASSISTANT_*` family. Only the
assistant's are documented, in `docs/ASSISTANT.md`.

## Public journeys, other than the assistant

Ten routes exist: `/`, `/[category]`, `/[category]/[facet]`, `/brands`,
`/brands/[slug]`, `/compare`, `/disclosure`, `/explore`, `/how-we-choose`,
`/products/[slug]`.

**Verified by the build and the test suite**: every route prerenders, category
filtering and the comparison table work without the assistant, badge and value
selection are computed and explained by `catalog:check`, and `/how-we-choose`
documents the ranking.

**Not covered by any committed harness**: filtering by chip, the comparison
table, brand pages, product pages and `/explore` have unit coverage and no
end-to-end coverage. The only committed browser harness is the assistant's
effect on the category page. There is no committed accessibility audit, no
performance measurement, no mobile-viewport check and no analytics.

(Corrected. The earlier version said these journeys were "not verified
anywhere". That overstates it. Browser and keyboard journeys are reported in
earlier working threads; what this repository lacks is a committed harness that
would re-run them. An uncommitted check that passed once is worth less than a
committed one and more than nothing, and the honest statement is that the
evidence is not here to re-run.)

## What would block a launch

In the order that matters:

1. **Images.** 24 of 24 are procedural placeholders. Nothing to license, and
   nothing showing the products.
2. **Affiliate.** No programme, no tracking, no revenue path, and a disclosure
   page describing a relationship that does not exist.
3. **Prices.** Eight of twenty shown as unconfirmed placeholders, and 13 of 26
   real ones never fetched from the merchant.
4. **`NEXT_PUBLIC_SITE_URL` and a host config**, unless the hosting account
   already carries them. Canonicals point at localhost by default.
5. **No robots or sitemap**, on a site whose whole purpose is search traffic.
6. **No CI in the repository.** Every check here is run by hand.

Sourcing is the quieter one. 124 of 196 attributes and 13 of 26 prices are
relayed from search summaries rather than read from the maker's page. Fetching
those pages is ordinary work, needs no lab, and would move the site from
"attributed to the maker" to "attributed to the maker and actually read".
