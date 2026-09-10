# Launch handoff

One page, from the repository as it stands on 2026-09-10. Written to be
decided from, not read twice.

Standing decisions this document keeps: **all three categories launch**, a
product **without a price still launches**, and **no product is cut for having
weak evidence**. The site says what it knows and what it does not; that is the
product.

Detail lives in `docs/LAUNCH-READINESS.md` (catalogue),
`docs/PUBLICATION-READINESS.md` (publishing), `docs/PARTNER-SHOWCASE-CHECKLIST.md`
(per product), `docs/source-checks/` (one file per reading) and
`docs/drafts/` (about copy, privacy inventory, image rights).

## 1. Done, and not blocking anything

The shopping surfaces behave. 20 products, 17 brands, 3 categories, every page
served and checked by a browser harness on each build.

- **Prices.** A placeholder amount is never shown; the page offers to check
  with the retailer instead. An amount that cannot be shown to belong to the
  product is withheld from every buying surface, including structured data. A
  product with no usable amount says so and still ranks.
- **Rankings.** Deterministic and affiliate-blind, proven by a test that flips
  every offer's affiliate status and asserts identical output. A badge is
  withheld with a stated reason rather than quietly awarded.
- **Provenance.** Every figure carries who reported it, when, and whether the
  page was read or the figure relayed. Conflicts are kept and shown, not
  resolved by choosing.
- **Publishing.** Canonicals on every route. robots.txt and sitemap.xml.
  Indexing off unless explicitly switched on, with previews held out even when
  they inherit a production URL. Social card copy on every route, no image.
- **Legal-adjacent copy.** `/disclosure` says there is no affiliate programme
  and no commission. The footer says the site gives no medical advice.

## 2. Necessary before a first public launch

Five items. Only two need the owner.

| # | What | Smallest next action | Owner |
| --- | --- | --- | --- |
| 2.1 | **A domain.** Canonicals, sitemap and robots all read `NEXT_PUBLIC_SITE_URL`; unset, the site refuses indexing by design. | Decide the domain and set the variable. | **Matt** |
| 2.2 | **A host.** No deployment configuration exists in this repository. | Choose a host and set `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_ALLOW_INDEXING=1`, `DATABASE_URL`, and the assistant credentials if it ships. | **Matt** |
| 2.3 | **A privacy notice.** The site processes personal data today: a salted IP hash for rate limiting, a session id, and assistant text sent to a model provider. | Fill the four blanks in `docs/drafts/PRIVACY-DATA-INVENTORY.md`: controller, contact, retention period, named subprocessors. | **Matt**, from a drafted inventory |
| 2.4 | **A contact route.** No contact page exists and nothing links to one. | Supply an address or form endpoint; the page itself is ten minutes. | **Matt** supplies, we build |
| 2.5 | **Retention.** There is no deletion code anywhere: rate-limit rows accumulate forever, so any retention period a notice states would be false. | Matt picks a window; we implement a scheduled delete. | Both |

**Not on this list, on purpose:** affiliate approval, product photography,
every record being read, and CI. None of them stops a launch.

## 3. Catalogue gaps, exactly

15 of the 20 products have had a manufacturer page read; `docs/source-checks/`
holds 17 files, the other two being a merchant listing claim about Edge and an
identity review of a Cold Pod model that turned out not to be ours. The
evidence state today:

| State | Count | Products |
| --- | --- | --- |
| Price read from the merchant | 13 | the rest |
| Price relayed, never re-checked | 4 | Edge Tub Elite, Ice Barrel 400, The Cold Pod, CELSIUS |
| Price is a placeholder, page says "check current price" | 2 | Infraredi Flex Max, Joovv Solo 3.0 |
| No price at all | 1 | Plunge Original |
| Prototype attribute values | 12 across 8 | Edge (4), Infraredi (2), one each on BIOMAX, Ice Barrel 400, Cold Pod, AG1, CELSIUS, LMNT |

### Four open identity questions

| Question | State | Smallest next action | Owner |
| --- | --- | --- | --- |
| **Plunge Original's configuration.** Cold-only or heater is unresolved, so its price and whether it heats are both withheld. | Product has no price. | One reading of the page's configuration options. | Codex |
| **The Cold Pod's identity.** Our record is an 88-gallon Amazon listing; the maker's page reads 85 gallons at a different price. | Capacity marked unreliable, nothing rescoped. | Read the Amazon listing, or find a maker's page for an 88-gallon model. | Codex |
| **Edge Theory Labs.** A Shop listing says the brand is out of business. | Recorded as an unconfirmed merchant listing; availability unknown. | Read the maker's own site and support channel. | Codex |
| **Ice Barrel 400.** Product URL redirects to the home page; nothing about it has been read. | Scores 0, holds no badge. | Find a current product URL. | Codex |

### Two consequences worth seeing before launch

- **Best Premium in Cold Plunges sits on Edge Tub Elite at 44.4**, the weakest
  record in the category, because it inherited the badge when Plunge's price
  was withheld. Fixed by reading either record, not by changing badge rules.
- **Best Budget is withheld in Cold Plunges and in Drinks.** Correct in both
  cases and visible on the page with its reason.

### Four policy questions logged, none urgent

Out-of-stock products can hold price badges; stock status is only as fresh as
its reading; a badge tier can be thin without saying so; affiliate status is
`unknown` on all 26 offers. Written up in `docs/LAUNCH-READINESS.md` for one
review, not for piecemeal changes.

## 4. Images

**24 of 24 are procedural placeholders. Nothing here presents one as a
photograph**, and the social cards deliberately carry no image for that reason.
A site of placeholder images is the most visible weakness a partner will see,
and it is the only item on this page with a hard dependency on other companies.

One reuse term has been established, and it is a refusal: Hooga's terms require
express written permission before copying. Five brands' terms are unread.
`docs/drafts/IMAGE-RIGHTS-MATRIX.md` has the six-product matrix and the
per-brand questions.

Also recorded there: four of those six products sit on pages selling several
variants, so even a permissive licence leaves the question of which asset shows
the product on our record.

| Path | Smallest next action | Owner |
| --- | --- | --- |
| Read the remaining five brands' terms | Public research, no account, no contact | Codex |
| Ask a brand for permission | An approach to a company | **Matt** |
| Photograph products somebody owns | The only path with no third-party dependency | **Matt** |

## 5. The assistant

It works and it is optional. The site is fully usable with it switched off, and
every ranking, filter and comparison is computed without it.

What is not established: it has not been verified against a live model in a
deployed environment. The last live test ran locally on 2026-09-09 against
`gpt-4o-mini` in proxy credential mode, and 7 of 10 conversations matched the
constraints a careful person would have entered. That is a local result on a
local build, not a production verification.

| Decision | Smallest next action | Owner |
| --- | --- | --- |
| Launch with the assistant switched off, and enable it later | Leave the model credential unset | **Matt** |
| Launch with it on | Set credentials, then re-run the live test against the deployed site and read the report | Both |

The spend ledger, rate limiter and budget cap all exist and are tested. Nothing
about the assistant blocks a launch either way.

## 6. What can launch before any affiliate approval

All of it. There is no affiliate programme, `/disclosure` says so plainly, and
the ranking code cannot read affiliate status: a test flips every offer's
status and asserts the output is identical. Links carry
`rel="sponsored nofollow noopener"` and no tracking parameter.

A partner conversation is easier with a live site than with a description of
one, and approval is the step that follows a site worth showing.

## 7. Later, and explicitly not now

- Affiliate applications, tracking links, commission reporting.
- A product feed or importer. The catalogue is 20 hand-built records.
- An admin interface. There is one admin API route and no UI.
- CI. Every check is run by hand; `.github/workflows` does not exist.
- Reworking irradiance to carry a measurement method, which two readings have
  now shown the single unqualified field cannot express.

## 8. If only three things happen next

1. **Matt:** decide the domain and the host. Everything in section 2 unblocks
   from those two.
2. **Codex:** read Plunge's configuration and the Edge record. Those two fix
   the worst-looking thing on the site, a Best Premium badge on its weakest
   entry.
3. **Matt:** decide whether the assistant ships on day one.
