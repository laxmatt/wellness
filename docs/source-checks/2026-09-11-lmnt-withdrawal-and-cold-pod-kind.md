# Two integrity corrections: a zero nobody stated, and a retailer called a maker

| | |
| --- | --- |
| Date | 2026-09-11 |
| Readings behind them | Codex, on LMNT's product, FAQ and ingredients pages |
| Catalogue changes | `lmnt-citrus-salt-30.caffeine_mg` withdrawn; four `the-cold-pod-88` attributes re-labelled |

## LMNT Citrus Salt: the zero is withdrawn

`caffeine_mg` was 0, `manufacturer_reported`, from a 2026-09-08 search summary
that was relayed rather than read. Three direct readings of the maker's own
pages have since failed to confirm it:

| Read | Page | Result |
| --- | --- | --- |
| 2026-09-09 | product page | no caffeine figure for this flavour |
| 2026-09-11 | FAQ | no caffeine text exposed |
| 2026-09-11 | ingredients | one amount, 50 mg, for Lemonade Iced Tea |

The only caffeine amount this maker states belongs to a different flavour, so it
says nothing about this one. The field is now `not_stated` with no value.

**This does not say the product contains caffeine.** It says this catalogue does
not know. That was always the true state; the record was asserting otherwise,
and a shopper filtering for caffeine-free was being handed this product as
though the maker had said so.

The history stays in the note: what the value was, where it came from, which
three readings looked, and what the 50 mg actually belongs to. The gap now costs
the record completeness, which is the correct price.

### What it changed

| | Before | After |
| --- | --- | --- |
| Caffeine free filter | OLIPOP and LMNT | OLIPOP alone |
| Drinks with no usable figure | 3 | 4 |
| LMNT in the fit section | "Matches" caffeine-free | "Needs confirmation", both directions |
| LMNT score and badges | 100, Best Overall and Best Value | unchanged |
| Every other nutrition figure on LMNT | sugar 0, sodium 1000, $1.50 a serving | unchanged |

Caffeine is not a scoring criterion in this category, so withdrawing it moves
completeness and nothing else. No badge changed hands.

The one remaining caffeine-free answer is OLIPOP's, and it rests on a page the
maker wrote to answer that question. Same arithmetic as before either reading,
better evidence under it.

## The Cold Pod 88: four attributes stop claiming the maker

`chiller_included`, `water_capacity_gal`, `fits_height_in` and `insulated` all
declared `kind: "manufacturer"` while citing
`https://www.amazon.com/dp/B0CPKYNJ9Q`. They now declare `kind: "retailer"`.

Values, verifications, dispute flags, methods and URLs are untouched. All four
were already `method: "secondhand"`, which is what says the reading was not the
maker's page. `water_capacity_gal` keeps `disputed: true` and stays withheld,
as it was.

### The vocabulary had no word for this

`SourceKind` ran manufacturer, merchant_feed, independent_test, editorial, demo.
A hand-read Amazon listing is none of those: it is not the maker speaking, and
it is not a structured feed a merchant publishes. The only way to satisfy the
schema was to pick a word that was false, and the catalogue picked
"manufacturer" nine times across two products.

`retailer` is added, and that is the whole change. It is not a policy: nothing
branches on it.

### Whether it changes usability, traced

It does not.

- `isUsable()` reads `verification`, never `kind`. Unchanged here, so nothing is
  withheld that was not, and nothing is admitted that was not.
- `toProductView` withholds on value, usability, dispute and derived-from-price.
  None involves `kind`.
- `completeness()` uses the same predicate. Unchanged.
- Filtering, scoring and badges read attribute values. Cold Pod still scores
  18.5 and still holds Best Value; the whole cold plunge ranking is unchanged.
- `validateCatalog` is the one place that reads `kind` for a rule, and the rule
  is about `independently_verified` requiring an `independent_test` source.
  Untouched by this.

One thing changes, on screen: the sources block on the product page reads
"Retailer" beside that URL instead of "Manufacturer". Verified in a browser.

### One residual, reported rather than widened

The assistant renders a fact's attribution from `verification`, so these four
still read "reported by the maker". That is defensible, because
`manufacturer_reported` means whose claim it is rather than who was read, and
`method: "secondhand"` carries the remove. It is named here so nobody discovers
it later and thinks it was missed. Changing it would mean a new verification
value, which is a policy change and not this correction.

### A test that was enforcing the mislabel

`catalog.test.ts` required every `manufacturer_reported` attribute to have
`kind: "manufacturer"`. That rule is why the catalogue held nine false labels:
the only way to pass it, for a spec relayed by a retailer, was to claim the
maker. It now requires a URL and a date as before, and adds the rule that was
actually wanted: a `manufacturer_reported` value citing anything other than the
maker must be `method: "secondhand"`. A maker's claim read somewhere else is
still a maker's claim, and it may not pretend to be a direct reading.

The exception list naming these four attributes in `caffeine-evidence.test.ts`
is gone with them. That rule now holds outright.
