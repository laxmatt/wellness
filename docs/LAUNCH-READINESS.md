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
verification tier. Attributes are counted in
`docs/PARTNER-SHOWCASE-CHECKLIST.md`, which computes them; as of the readings
of 2026-09-09 the tiers run manufacturer-reported, unknown, demo and not
stated, and most records are still relayed rather than read. Five of the manufacturer-reported figures
are bounds rather than exact values, and are marked as bounds. These counts
move as readings arrive; `docs/PARTNER-SHOWCASE-CHECKLIST.md` computes the
current ones.

**Nothing is independently verified, and that is a smaller problem than the
first draft implied.** (Corrected.) A manufacturer's own figure is legitimate
evidence when it is faithfully sourced and attributed, which is what the site
does: every spec shows who said it, and `independently_verified` exists as a
tier for the day a figure is checked against something else. Nobody needs to
buy a panel and meter it to launch.

The real gap is the quality of the sourcing, not the absence of a lab:

- **Most attributes are secondhand**, carrying the note "relayed via search
  summary; manufacturer page not fetched directly". The claim is attributed to
  the maker, but the maker's page was never read. It was 124 of 196 before the
  readings of 2026-09-09; `docs/PARTNER-SHOWCASE-CHECKLIST.md` computes the
  current count, and `docs/source-checks/` records each reading.
- **45 attributes record no source at all** (`unknown`). The site shows
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

**Five products are ineligible for badges**: Infraredi Flex Max, AG1, Cure
Hydration, Liquid I.V. and OLIPOP. Two became ineligible when unsupported zero
values were removed from AG1 and Cure rather than left standing as facts, and
Liquid I.V. joined them when its per-serving cost was withheld along with the
prototype pack price it was computed from. Deleting a figure nobody stated
lowers completeness, and it should: the site now knows less than it claimed
to.

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

**No affiliate programme is joined, which is a state, not a fault.** There
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

## Product by product

`docs/PARTNER-SHOWCASE-CHECKLIST.md` carries the per-product version of this
document: for each of the 20, the sources on file, the specifications that are
missing or unsupported, the price status, the images, the merchant links and a
computed verdict on whether it is worth putting in front of a partner. It is
generated by `npm run partner:checklist` and a test fails if the committed file
drifts from the catalogue.

It reports evidence on three independent dimensions and makes no launch
selection: which products to publish, and in what order, is not a question the
catalogue answers. Its figures are computed, so they move when the data does.
As of 2026-09-09, after twelve readings: a real amount is the shown price on 18
of 20, eleven products have that amount read from the merchant's own page
rather than relayed, and no product has a real image. The record-level counts
are in the checklist, which computes them.

An amount on record is not a verified price, and a reading is not a
measurement. `docs/source-checks/` holds one file per reading: who read the
page, when, what it said, and what was deliberately left alone. This
repository's tooling fetched none of them; its network policy refuses outbound
HTTPS to everything but the model provider.

## What would hold a launch back

Corrected: an earlier version of this list opened with the absence of an
affiliate programme. That is not a blocker. A site with no programme is a site
that earns nothing yet, and it says so plainly on `/disclosure`; nothing about
it misleads a reader or a partner. Joining a programme is the business step
that follows a site worth showing, not a prerequisite for having one.

What actually holds it back, in the order that matters:

1. **Images.** 24 of 24 are procedural placeholders. Nothing to license, and
   nothing showing the products. This is the one a partner sees first, it has
   not moved at all through ten readings, and no amount of further reading
   will move it: reading a page grants no right to its pictures. Every other
   item on this list is work this project can do. This one needs permission
   from somebody, or photographs of products somebody owns.
2. **Sourcing.** Most records still cite a search summary rather than a page
   somebody opened. Eleven products have their shown price read from the
   merchant; the remaining nine are the cheapest large improvement available,
   because the URLs are already on file.
3. **Prototype specifications.** 13 values across 9 products are demo data,
   down from 24 across 14. Each is marked on the page, which is honest and
   still reads as unfinished.
4. **`NEXT_PUBLIC_SITE_URL` and a host config**, unless the hosting account
   already carries them. Canonicals point at localhost by default.
5. **No robots or sitemap**, on a site whose whole purpose is search traffic.
6. **No CI in the repository.** Every check here is run by hand.

Two products have no amount on record, and that is not on this list. The page
says "Check current price" and links to the merchant, which is a normal way for
a comparison site to behave and is honest about what is known.

## Launch selection

**All three categories are in scope and stay in scope.** The checklist reports
evidence, and an evidence gap is work to do rather than grounds for dropping a
category. Nothing below narrows what the site launches with; it says where the
remaining source work sits.

What the evidence says, per category, as of 2026-09-09:

- **Red Light Therapy, 8 products.** Six have a price read from the maker.
  Infraredi Flex Max is the one unread record left: ineligible, two demo
  values, no amount on record.
- **Wellness Drinks, 6 products.** All six read, five of them on 2026-09-09.
  Every product is eligible and every one carries a real price. What is left
  is Liquid I.V.'s nutrition, still entirely relayed because that reading did
  not reach the table, and AG1's dietary claims.
- **Cold Plunges, 6 products.** The least read, and the one with an open
  identity question: The Cold Pod's record is an Amazon listing for an
  88-gallon tub, and the maker's own page reads 85 gallons at a different
  price, near enough to be the same product and not close enough to assume it.
  See `docs/source-checks/2026-09-09-the-cold-pod-usa.md`. Ice Barrel 400 scores 0 with a
  product URL that redirects to the home page, Edge Theory Labs has four demo
  values and an unconfirmed listing claim that the brand is out of business,
  and Best Budget is withheld because no budget-tier product scores above
  zero. Two of the six carry demo values.

  **Best Premium sits on the weakest record in the category.** Edge Tub Elite
  holds it on 44.4, with four prototype values, every figure relayed from a
  search summary, and an unconfirmed listing claim that its brand is out of
  business. It did not improve: it inherited the badge when Plunge Original's
  price was withheld, because a price-tier badge needs a product with a price
  and Plunge no longer has one. The badge rule is working as written and the
  outcome is still a partner-facing problem. Logged as a source problem, not a
  reason to change ranking rules: the fix is reading the Edge record, or
  settling Plunge's configuration, not tuning the badge.

  Plunge Original now has **no price at all**. Its $6,990 was relayed, the page
  read 2026-09-09 displays $6,790, and the page prices a configuration this
  record's tub has not been matched to. Neither amount can be defended, so the
  offer is withheld with its figure and its history intact and the page says
  "Check current price". The product is still browseable, comparable and
  scored; it holds no price-tier badge, and Best Premium moved to Edge Tub
  Elite. Settling the configuration is a reading, not a decision.

Where the remaining source work sits, then: Cold Plunges first by need, and
Infraredi in Red Light as the single cheapest fix. That is where to read next,
not a ranking of which categories deserve to launch.

## Open policy questions, for one consolidated review

Each of these is a rule the site follows that nobody has decided on
deliberately. None is a defect today. All are logged here rather than changed
piecemeal.

1. **An out-of-stock product can win a price badge.** `pricedOffers` excludes
   only `discontinued` offers, so an out-of-stock product keeps a real price
   and stays eligible for Best Value, Best Budget and Best Premium. OLIPOP is
   out of stock today and holds no badge, so nothing is wrong on the page. The
   question is whether a recommendation should be able to point at something
   nobody can buy, and it is the same shape as the zero-score badge defect that
   was fixed on 2026-09-09: eligible is not the same as recommendable.
2. **Stock status is only as fresh as the reading.** An `out_of_stock` marker
   is what a page said on a date, and the page will change without this record
   changing. The site shows the date beside it, which is honest and does not
   answer whether an old stock status should be shown at all.
3. **A badge tier can be silently thin.** `minQualifying` withholds a badge
   when fewer than two priced products sit in a tier, and states why. Nothing
   states how thin a tier is when it does clear the bar: Best Premium in Cold
   Plunges is the best of three.
4. **Affiliate status is `unknown` on all 26 offers.** Unrecorded, not checked
   and found to be none. The site says so, and the ranking cannot see the
   field either way. Worth deciding whether `unknown` should ever be published
   or whether every offer needs a recorded answer first.

## Fixed on 2026-09-10, worth remembering

**A product could not have no price.** `derivePrice` threw when every offer was
withheld and there was no reference price, and behind that a second defect
wrote an undefined into the provenance map, which crashed the catalogue report
on `Object.values`. Both were found by actually withholding a real offer rather
than reasoning about it, and both were used as an argument for leaving a
contradicted amount on a public page. A type that cannot express "no price" is
not a reason to publish a price. `PriceView.money` is optional now, with a
`none` basis; the value formula, the tier badges, the filters, the conditions,
the compare table, the structured data and the partner checklist each decide
what a missing amount means, and none of them substitutes a number for it.

## Fixed on 2026-09-09, worth remembering

**Structured data was publishing amounts the page had hidden.** The JSON-LD on
every product page listed every offer, so a prototype amount that the page
displayed as "Check current price" was still being handed to search engines as
this product's price, on four products. The display side of that was fixed
earlier the same day and the markup underneath was not changed with it. A
disputed offer's amount and its link were being published the same way. Hiding a number in one surface is not
withholding it; every surface that states a price has to be checked, and the
browser harness now checks the published offer count against the offers that
actually price the product on all 20.

## Known defects, logged for a bounded fix

1. ~~**Duplicate React key in the comparison table.**~~ Fixed on 2026-09-09.
   Wellness Drinks defines a "Buying" group of subscription specs and the
   compare model appends a "Buying" group of retailers to every category, so
   keying the group list by label made React see one group twice. The table is
   keyed by position now, which is safe because groups are built in a fixed
   order from the category definition and never reordered. A regression asserts
   that a model with two same-labelled groups renders without the warning.

2. **Irradiance carries no method, and the criterion is thinning.** The field
   holds one unqualified number and the comparison table ranks those numbers
   against each other, so a figure that cannot be made comparable cannot go in
   it. Two readings on 2026-09-09 ended that way: the MitoMIN 2.0 page gives
   more than 115 mW/cm2 from a consumer meter and more than 52 from a
   maker-described laboratory method at the same 6 in, and the MitoPRO series
   page gives more than 170 and more than 68 at six inches with footnote method
   labels its own prose contradicts. Both are recorded as `not_stated` with the
   figures and the methods in the note.

   That is honest and it has a cost: 3 of 8 red-light products now carry an
   irradiance figure, and one of those is a bound. A criterion that most of the
   category cannot answer is close to not being a criterion. A method dimension
   beside the number is the real fix and is architecture: it should follow a
   decision, not a reading.
