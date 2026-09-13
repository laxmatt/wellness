# PlatinumLED BIOMAX 900: manufacturer page reading, and a generation

| | |
| --- | --- |
| Product | `platinumled-biomax-900` |
| Page | https://platinumtherapylights.com/products/biomax-rlt |
| Read on | 2026-09-09, at 14:48 and again at 15:02 Pacific |
| Read by | Codex, using its own web tool, and supplied to this repository |
| Read by this repository | No. Nothing here fetched anything. |

## The identity question, settled explicitly

The page is explicitly the **ninth generation**. The record carried no
generation at all, and its figures came from search summaries that never said
which generation they described. Combining a ninth-generation price with
specifications of unknown vintage would produce a product that does not exist.

This record is now scoped to the ninth generation. The product's name says so,
and every note added by this reading says so. Its slug is unchanged, so no link
breaks. Figures that survive are the ones the ninth-generation table states;
figures that do not are withheld, with the old value kept in the note as
history rather than carried forward.

## What the 900 row of the page's model table states

$1,299 USD. 35.83 x 11.81 x 2.76 in. 300 LEDs. 33 lb. A 3-year warranty. Full
Body. And, under separate "Number of LEDs" and "Power Consumption" headings,
380 W and 490 W.

The price comes from that row, so it does not depend on whichever model the
page's selector happens to be showing.

## What was recorded

- The **direct offer** carries $1,299.00, read from the 900 row, and its link
  now points at the page that was read. It pointed at
  `/products/biomax-900`, which nobody read; the old URL is kept in the note. It held the
  same amount as prototype data, with a note that sources reported $1,149,
  $1,299 and promotions near $799.
- **led_count 300**, **warranty_years 3** and the **warranty text**: same
  values, now read from the ninth-generation table.
- **weight 33 lb**: same value, now read.
- **dimensions** become 35.83 x 11.81 x 2.76 in, replacing 36 x 12 x 3, which
  was relayed and rounded.
- **coverage** keeps `full_body` and moves to the maker's own word: the row
  says Full Body, which is what this catalogue's height class already said.

## What was withheld, and why

**Irradiance, and its distance.** The ninth-generation page gives irradiance
only in a chart, which was not read. The record's 185 mW/cm² at 6 inches was
relayed on 2026-09-08 for a BIOMAX 900 of unrecorded generation. It is not
carried onto a ninth-generation record: both fields are now `not_stated`, with
the old figures written into their notes as history.

**Power consumption.** The row shows 380 W and 490 W, under their own headings,
and nothing on the page settles which applies to this model. The record carried 186 W, relayed, which agrees with neither. No
figure is recorded.

That last one is recorded as `not_stated` rather than `disputed`, and the tier
label is imperfect: the source does state consumption, twice, and the note says
so exactly. `disputed` was not used because it keeps one value visible, and
here the two figures differ, so displaying either would be picking a passage.
If a marker for "stated, and not settled, with no single value to show" is
worth having, this is the case that argues for it; nothing was invented to
avoid the question.

**The seven wavelengths.** The maker states seven; the exact peaks were not
read. The record's spectrum is still prototype data and still marked as such.

Nothing was recorded about stock, no image right is claimed, and nothing was
taken from a therapeutic claim.

## What it changed in the rankings

| | Before | After |
| --- | --- | --- |
| BIOMAX score | 92.9 | **78.6** |
| BIOMAX shown price | Check current price ($1,299 prototype) | $1,299 |
| Best Overall | PlatinumLED BIOMAX 900 | **Hooga PRO1500**, 85.7 |
| Best Premium | Hooga PRO1500 | **PlatinumLED BIOMAX 900** |
| Best Value / Best Budget | MitoPRO / HG300 | unchanged |
| Eligible panels with a prototype price | 2 of 7 | 1 of 7 |

BIOMAX led the category on an irradiance figure that turns out to describe an
unknown generation. Without it, PRO1500 leads on what it does state, and BIOMAX
takes the premium badge its real price now supports. Joovv rises to 71.2 and
BON CHARGE to 35.7 as the scaling range narrows.

Four tests moved onto fixtures rather than following the catalogue again: the
compare branch for a disputed figure has no live pair left to exercise it, and
the price-placeholder examples keep changing as prices become real.
