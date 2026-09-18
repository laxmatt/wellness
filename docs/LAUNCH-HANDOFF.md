# Launch handoff

One page, from the repository as it stands on 2026-09-10. Written to be
decided from, not read twice.

Standing decisions this document keeps: **all three categories launch**, a
product **without a price still launches**, and **nothing is cut automatically
for having weak evidence**. The site says what it knows and what it does not;
that is the product.

That is not the same as every record being launch-ready. **A final review of
factual and visual credibility is still a gate**, and it is a judgement made by
looking at the site, not a threshold this document computes. "No automatic
cuts" means no product is dropped by a rule; it does not mean every product
survives that review.

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
- **Publishing.** Canonicals on every indexable route; `/compare` has none on
  purpose, because the page a comparison URL names depends on its query string.
  robots.txt and sitemap.xml. Indexing off unless explicitly switched on, with
  previews held out even when they inherit a production URL. Social card copy
  on every route, no image.
- **Legal-adjacent copy.** `/disclosure` says there is no affiliate programme
  and no commission. The footer says the site gives no medical advice.

## 2. Necessary before a first public launch

Five items, and **every one of them waits on Matt for a decision or a fact**.
Two then need work from us once he has decided. None is blocked on engineering
that has not been done.

| # | What | Smallest next action | Owner |
| --- | --- | --- | --- |
| 2.1 | **A domain.** Canonicals, sitemap and robots all read `NEXT_PUBLIC_SITE_URL`; unset, the site refuses indexing by design. | Decide the domain and set the variable. | **Matt** |
| 2.2 | **A host.** No deployment configuration exists in this repository. | Choose a host and set `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_ALLOW_INDEXING=1`, `DATABASE_URL`, and the assistant credentials if it ships. | **Matt** |
| 2.3 | **A privacy notice.** The site processes personal data today: a salted IP hash for rate limiting, a session id, and assistant text sent to a model provider. | Fill the four blanks in `docs/drafts/PRIVACY-DATA-INVENTORY.md`: controller, contact, retention period, named subprocessors. | **Matt**, from a drafted inventory |
| 2.4 | **A contact route.** No contact page exists and nothing links to one. | Supply an address or form endpoint; the page itself is ten minutes. | **Matt** supplies, we build |
| 2.5 | **Retention.** There is no deletion code anywhere: rate-limit rows accumulate forever, so any retention period a notice states would be false. | Matt picks a window; we implement a scheduled delete. | Both |

**Not on this list**, because none of them is a mechanical prerequisite:
affiliate approval, product photography, every record being read, and CI. The
site functions and tells the truth without them.

Two of those four are credibility questions rather than settled non-issues. **Photographs and source coverage are exactly what the final review
in the opening paragraph looks at**: a page of procedural placeholders and a
record citing a search summary are both honest and both weak. Whether they are
good enough to show a partner is Matt's call on the finished site, and this
document does not make it.

## 3. Catalogue gaps, exactly

Two different counts, kept apart because earlier reports blurred them.

**Source files.** `docs/source-checks/` holds 18 markdown files. One is
`README.md`, the standing rules for the folder, so there are **17 dated
records**. Earlier reports of mine said "18 source checks", counting the
README; that was wrong and this is the corrected figure.

**Product coverage.** 15 of those 17 records are readings of a manufacturer
page for a product on this record, so **15 of the 20 products have a reading**.
The other two records are not product readings: one is a Shop listing's claim
that Edge Theory Labs is out of business, and one is an identity review of a
Cold Pod page that does not clearly describe our record.

The evidence state today:

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
  was withheld.

  Reading either record resolves the evidence. It does not guarantee a
  different badge: if Plunge's configuration is settled and a price recorded,
  the badge moves only if Plunge then outscores Edge in that tier, and if the
  Edge record is read and holds up, Edge keeps it on better evidence. Either
  outcome is an improvement over a badge resting on four prototype values. The
  badge rule is not what needs changing.
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

Three brands' published terms have now been read, and none of the three permits
the reuse this site would need: Hooga requires express written permission,
Mito grants a personal non-commercial licence only, and Ice Barrel requires
written authorization and warns that some material may belong to third-party
rightsholders. Renu and LMNT reads were attempted and failed; AG1 is
unattempted.

**None of that is a refusal.** No brand has been asked for anything. These are
documents saying what they say, and Mito's even names an address for other-use
requests. `docs/drafts/IMAGE-RIGHTS-MATRIX.md` has the matrix, the sources and
the dates.

Also recorded there: four of those six products sit on pages selling several
variants, so even a permissive licence leaves the question of which asset shows
the product on our record.

| Path | Smallest next action | Owner |
| --- | --- | --- |
| Read the terms still unknown | Renu and LMNT reads failed; AG1 unattempted. Public research, no account, no contact | Codex |
| Ask a brand for permission | An approach to a company; nobody has asked anyone yet, and Mito's terms name an address for it | **Matt** |
| Photograph products somebody owns | The only path with no third-party dependency | **Matt** |

## 5. The assistant

It works and it is optional. The site is fully usable with it switched off, and
every ranking, filter and comparison is computed without it.

What is not established: it has not been verified against a live model in a
deployed environment. The last live test ran locally on 2026-09-09 against
`gpt-4o-mini` in proxy credential mode, and 7 of 10 conversations matched the
constraints a careful person would have entered. That is a local result on a
local build, not a production verification.

**There is no "off" today, and an unset credential is not one.** With no
credential configured, `resolveCredential` returns `mode: "none"` and the route
runs `ScriptedConversationProvider`: the launcher still appears, a visitor can
still open it, and it answers from a small scripted stand-in. The panel says so
in a banner, "Prototype replies. No language model is connected yet, so answers
come from a small scripted stand-in. The products listed are real and come from
the site's own ranking." The products it lists are the site's real rankings.

That is an honest state and it may well be the right one to launch with. It is
not the same as the feature being absent, and choosing it should be a decision
rather than a side effect of leaving a variable blank.

| Option | Smallest next action | Owner |
| --- | --- | --- |
| Ship the scripted prototype, banner and all | Leave the credential unset, and look at the banner on the built site first | **Matt** |
| Ship it live | Set credentials, then re-run the live test against the deployed site and read the report | Both |
| Ship with no assistant at all | Not implemented. Hiding the launcher is a small change nobody has asked for yet | Matt decides, we build |

The spend ledger, rate limiter and budget cap all exist and are tested. Nothing
about the assistant blocks a launch, but "leave it unset" needs to be read as
"ship the prototype", not as "ship without it".

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

1. **Matt:** decide the domain and the host. That unblocks canonicals, the
   sitemap and indexing, and nothing else in section 2. The privacy notice, the
   contact route and the retention window are separate facts only he holds, and
   picking a host supplies none of them.
2. **Codex:** read Plunge's configuration and the Edge record. Those improve
   the evidence behind the worst-looking thing on the site, a Best Premium
   badge on the category's weakest entry, whichever way the badge then falls.
3. **Matt:** decide what the assistant does on day one, having seen the
   prototype banner on a built page rather than assuming an unset credential
   hides it.
