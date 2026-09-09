# Launch readiness, read-only inventory

Every figure and check below was taken from the repository at the head this
document was last revised on, and that head is named where the checks are
listed rather than here, so a stale commit id cannot outlive the numbers.
Nothing was deployed, contacted, changed
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
are bounds rather than exact values, and are marked as bounds.

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

No placeholder amount is shown to a shopper any more. Where one exists, the
page says **"Check current price"** and sends the reader to the merchant: on
the card, on the product page, in the offer row, in the comparison table and in
the assistant's answer. The figures were already withheld from price claims,
from price-based badges and from the assistant's evidence; they were still
printed as prices, which is the part that mattered.

Two consequences worth naming, both measured before the change:

- **A money figure computed from a placeholder price is withheld too.** Liquid
  I.V.'s price per serving was its demo pack price divided by 16, recorded as
  an editorial calculation and shown as a fact. It and OLIPOP's are gone from
  display, from matching and from scoring, which drops Liquid I.V. below the
  completeness floor. Five products now sit below it rather than four.
- **A placeholder price no longer sets the affordability range.** Six of the
  eight red-light panels carry one, and their invented figures were both ends
  of the range the two real-priced panels were measured against. Placeholder
  priced products get no value number now, and the range is drawn from real
  prices only. **No badge changed in any category**: Best Overall, Best Value,
  Best Budget and Best Premium are identical before and after. What changed is
  the numbers on the page: red light 39.1 to 42 and 64.5 to 56, drinks 58.3 to
  48.8.

The handling is verified. What is missing is the real data.

**Four products are ineligible for badges**: Infraredi Flex Max, AG1, Cure
Hydration and OLIPOP. Two of those four became ineligible in 58ecd85, when
unsupported zero values were removed from AG1 and Cure rather than left
standing as facts. Deleting a number the label does not state lowers
completeness, and it should: the site now knows less than it claimed to.

### Bounds, and what is left for a person

Five figures in the catalogue are bounds their sources state rather than
exact values, and until 2026-09-09 they were stored as exact numbers: AG1's
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
be published in this state and it earns nothing, which is now what the site
says: `/disclosure` states there is no programme, no commission and no
partnership, that links are ordinary ones with no tracking parameter, that this
may change and will be said on the page when it does, and that affiliate status
is not an input to ranking. Every offer row reads "Ordinary link. No
commission." 

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

Everything that does exist passes, run by hand at the head named here:

- **635 tests** in 40 files, all passing, including the two Postgres ledger
  suites run against the disposable test database. They skip without
  `TEST_DATABASE_URL`, and a skip is not a pass.
- **46 browser checks** in `e2e/set-aside-updates-page.mjs` and **485** in
  `e2e/public-journeys.mts`, all passing against a production build. The first
  stubs the model; the second needs no model at all.
- `npm run catalog:check`, `npm run lint`, `npm run typecheck` and
  `npm run build`.

Head these were run at: **255681a**, plus the working tree of the commit that
carries this revision.

Environment variables the code reads: `ADMIN_ACCESS_KEY`, `DATABASE_URL`,
`NEXT_PUBLIC_SITE_URL`, `OPENAI_*`, and the `ASSISTANT_*` family. Only the
assistant's are documented, in `docs/ASSISTANT.md`.

## Public journeys, other than the assistant

Ten routes exist: `/`, `/[category]`, `/[category]/[facet]`, `/brands`,
`/brands/[slug]`, `/compare`, `/disclosure`, `/explore`, `/how-we-choose`,
`/products/[slug]`.

**Covered by a committed browser harness**: `e2e/public-journeys.mts`, 485
checks against a production build with no model and nothing leaving localhost.
It compares the page to the engine rather than to numbers typed into the test:
the grid against `recommendCategory`'s order, each filter chip against its own
`matchIds`, each comparison cell, tag and winner dot against
`buildCompareModel`, each facet against `matchesAll`. It covers the home page,
all three categories, every facet, all 20 product pages, the comparison table,
the remaining routes, keyboard operation, and a 390x844 phone.

What it checks that a count cannot:

- every outbound offer link carries `rel="sponsored nofollow noopener"`,
  `target="_blank"` and the merchant URL the catalogue records
- every value the source does not support is labelled where it is shown, and
  every bounded figure keeps its qualifier
- a placeholder price says so **in the block holding the amount**, proved
  sensitive by deleting the tag from the live page and confirming the same
  check then fails
- three products selected through the real toggles, one removed from the tray,
  re-added, and the selection still standing after leaving the page and coming
  back
- on a phone, a populated comparison table scrolls inside its own container
  while the page does not scroll sideways, and scrolling it leaves the page
  where it was
- a filter chip is tapped **once**, after the page's own readiness signal says
  React has attached its handlers. Retrying a tap until something happened
  would have hidden a control that ignores taps, which is the defect worth
  catching
- by keyboard alone: a filter chip applies and removes its filter, a compare
  toggle selects and deselects, the assistant opens on Enter, moves focus into
  itself, closes on Escape and hands focus back to the button that opened it.
  No message is typed and no request is made
- every visible `button`, `a[href]` and `[role="button"]` on the home page, a
  category page, a product page, the comparison and the phone has non-empty
  text from `aria-label`, `aria-labelledby`, its own text, `title` or a nested
  image's alt. That is a heuristic over those elements, not a computed
  accessible name and not a check of every control: inputs, custom widgets and
  anything hidden from this selector are outside it
- the focused control is not covered by the sticky header

**Three defects it found, all fixed:**

1. **A placeholder price was shown as a price.** Eight of twenty products show
   one. Every placeholder *spec* carried a "Demo data" tag; the price, the
   number a shopper actually decides on, carried nothing. `PriceDisplay` now
   tags it, on the card and on the product page.
2. **An empty facet was still offered.** Removing the assumed `placement`
   values left `/cold-plunge/indoor` matching nothing, while the category page
   and the home page both still linked it. The page itself was honest ("nothing
   in our set fits this filter yet"); the link was not. Facets are filtered by
   `liveFacets` now, and the active one is still shown so a shopper arriving by
   URL can see where they are.
3. **Closing the assistant dropped focus on the floor.** Escape closed the
   panel and left `document.body` focused, so a keyboard shopper who opened it
   from the middle of a category page had to tab from the top of the document
   again. The panel remembers what was focused when it opened and restores it.

**One observation, not fixed:** the comparison lays its columns out in
catalogue order, not the order the shopper picked. It is deterministic and
nothing misreads it, so it is left alone and recorded here.

**Still not covered, stated so nobody reads the above as an accessibility
pass:** there is no accessibility audit. What exists is alt text on every
image, one h1 per page, a name on every visible control, keyboard operation of
the filters, the compare toggle and the assistant, and a focus check on two
controls. There is no axe or equivalent run (it needs tooling this environment
cannot fetch), no screen-reader verification, no colour-contrast check, no
focus-order review, no touch-target audit beyond one chip, no performance
measurement and no analytics.

## What would block a launch

In the order that matters:

1. **Images.** 24 of 24 are procedural placeholders. Nothing to license, and
   nothing showing the products.
2. **Affiliate.** No programme, no tracking and no revenue path. The
   disclosure page now says exactly that: no commission, ordinary links, and
   the ranking cannot see affiliate status because it is never passed to it.
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
