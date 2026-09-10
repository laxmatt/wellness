# Mito Red Light MitoPRO 1500+: manufacturer page reading

| | |
| --- | --- |
| Product | `mito-mitopro-1500-plus` |
| Page | https://mitoredlight.com/products/mitopro-series |
| Offer link | https://mitoredlight.com/products/mitopro-series?variant=32084839432292 |
| Read on | 2026-09-09, at 17:40 Pacific |
| Read by | Codex, using its own web tool, and supplied to this repository |
| Read by this repository | No. Nothing here fetched anything. |

## Which product this is

A series page selling several panels. The record is the 1500+, read from the
third column of the comparison table. The 300+, the 1500X and the array bundles
are on the same page and none of their figures belong here.

## The price, and what is not settled about it

$1,169. The explicitly labelled 1500+ row and the size selector both show it,
and the Shop link on that column resolves to
`?variant=32084839432292`, which Codex followed rather than assembled. The
offer now points at that variant-scoped URL instead of the bare series page.

The record already said $1,169, relayed from a search summary. The amount has
not changed; what it is worth has.

**Two limits stay on the record.** The page's static text still carries the
default 300+ cart at $369, so nothing here verifies what a checkout would
actually charge for the 1500+, and nothing verifies whether the variant is in
stock. Both are in the offer note. A followed link and a displayed price are
what was observed, and that is all the record claims.

## What else was recorded

- **Dimensions 36 by 12 in**, read, replacing a relayed 35 by 13. Longest side
  first, matching how this record already read. The depth was not read, so none
  is recorded rather than a third number being supplied.
- **Weight 22 lb**, read, a field this record did not have.
- **Power 375 W**, read, replacing a relayed 270 W the page does not support.
  Recorded as consumption, with the note saying so: what a panel draws is not
  what it emits.
- **Coverage "full body"**, promoted from an editorial inference to a maker
  statement, because the page describes it. Footprint stays an editorial class
  and now rests on read dimensions.
- **Wavelengths 630, 660, 830 and 850 nm; 300 LEDs; a 3-year warranty**,
  confirmed on the page rather than relayed.

  The count is 300 and the reading says nothing about dual chips. The record
  had "300 dual-chip LEDs" from a search summary, and an earlier version of
  this file kept that adjective while calling the line freshly read. It is
  removed. Confirming a number does not confirm the words that were sitting
  beside it, and this catalogue's rule about not adding chips into a count
  does not need an unread adjective to state it. Corrected on 2026-09-10.
- **Returns 60 days** unchanged and still cited as relayed. The reading did not
  cover returns, and a reading that did not reach a figure says nothing about
  whether the page states it.

## The irradiance, withdrawn

The record carried **76.5 mW/cm2**, relayed as an average across the panel face
with no distance stated at all. The page does not show that number.

What the page shows is a table giving more than 170 and more than 68 at six
inches, marked `**` and `*`. The footnotes label `*` consumer-grade and `**`
laboratory. The page's own prose says the consumer readings are the higher
ones, which is the opposite of what the footnotes assign. The page does not
settle which method produced which number, and nothing here read a report
behind either.

So no figure is recorded: no value, `not_stated`, with all of it in the note.
Recording 170 would import a method the page contradicts itself about.
Recording 76.5 would keep a number the page does not show, measured at a
distance nobody stated.

This is the second red-light product in two readings to end this way, for the
same underlying reason: the field holds one unqualified number and the
comparison ranks those numbers against each other, so a figure that cannot be
made comparable cannot go in it. Three of eight products in the category now
carry an irradiance figure, and one of those three is a bound. That is logged
as an open architecture question in `docs/LAUNCH-READINESS.md` rather than
solved by a reading.

## What was not recorded

**Stock, images, therapeutic claims.** None verified.

## What it changed in the rankings

MitoPRO 1500+ keeps **Best Value** at 85.7, unchanged, and losing its
irradiance figure cost it nothing. The reason is worth stating rather than
being taken as luck: 76.5 was the lowest figure among the products that had
one, so it normalized to zero and contributed nothing to the score. A number
that was never doing any work has stopped being asserted.

Withdrawing it did move the bottom of the range for everyone else, from 76.5 to
Infraredi's 79:

| product | before | after |
| --- | --- | --- |
| Hooga PRO1500 | 85.7, Best Overall | unchanged |
| MitoPRO 1500+ | 85.7, Best Value | unchanged |
| BIOMAX 900 | 78.6, Best Premium | unchanged |
| Joovv Solo 3.0 | 71.2 | 70.8 |
| Infraredi Flex Max | 29.1 | 28.6 |

No badge moved.
