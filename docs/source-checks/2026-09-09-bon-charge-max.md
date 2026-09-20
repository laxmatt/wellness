# BON CHARGE Max: manufacturer page reading

| | |
| --- | --- |
| Product | `bon-charge-max` |
| Page | https://boncharge.com/products/max-red-light-device |
| Read on | 2026-09-09, about 13:17 Pacific |
| Read by | Codex, using its own web tool, and supplied to this repository |
| Read by this repository | No. Nothing here fetched anything. |

## What the page stated

$999 USD. A one-year warranty. 30-day easy returns. 91 x 21 x 6.5 cm, with
35.8 x 8.37 x 2.56 in given as its own approximate conversion. 8 kg, with
17.64 lb as its own conversion. Irradiance strictly greater than 142 mW/cm²,
with no measurement distance anywhere in the specifications. 660 nm 200 pcs and
850 nm 200 pcs, described as 5 W dual-chip LEDs. 1000 W, without saying whether
that is draw. A door mount, height-adjusting pulley, cables, goggles and a
power cord are included. The description calls the panel targeted half-body,
with flexibility for small full-body sessions.

Manufacturer statements about its own product. Nothing here is a measurement.

## What was recorded

- The **direct offer** carries $999.00, read from the page, replacing $1,099.00
  that was prototype data.
- **warranty_years, warranty, wavelengths_nm, mounting**: same values, moved
  from relayed to read. Mounting stays `["door_hang"]`; the page includes a
  door mount and a pulley and offers no stand.
- **irradiance_mw_cm2** keeps its floor of 142. The page states it strictly,
  once, so unlike the two Hooga panels there is nothing to dispute. **No
  measurement distance is recorded**, because the specifications give none.
- **return_window_days = 30** and a **returnPolicy** of "30-day returns" are
  new. The record had neither.
- **weight** is new: 17.64 lb, the page's own conversion of its 8 kg.
- **dimensions** keep the page's inch figures, with the note saying the page's
  own figures are metric and the inches are its approximate conversion. No
  conversion was computed here.

## What was refused

**LED count.** The page gives 660 nm 200 pcs and 850 nm 200 pcs, as 5 W
dual-chip LEDs. Whether that is 200 packages carrying both wavelengths or 400
emitters is not stated. The record carried 200, which was one of the two
numbers taken from a summary. It is marked `disputed`: the value stays visible,
the note says exactly what the page says, and it answers nothing and scores
nothing. Summing to 400 would have been arithmetic on an unresolved term.

**Power.** The page lists 1000 W without saying whether it is consumption. No
`power_w` is recorded. The two Hooga panels state their draw explicitly and
carry one; this does not.

**Coverage, corrected on review.** The catalogue's own class rule, computed
from panel height, said full body for a 35.8-inch panel. The maker calls it
targeted half-body, with flexibility for small full-body sessions. This file
first marked the field disputed, on the reading that the sentence named three
levels and none could be picked. That was wrong: "targeted half-body" is a
primary description, and the full-body flexibility is the maker's qualifier on
it, not a competing class. The record now says **half_body**,
`manufacturer_reported`, with the whole sentence in its note along with the
height rule it replaces. The panel no longer answers a full-body filter, and it
does answer a half-body one, which is what its maker says.

**Stock.** A "Sold out" label, an "In Stock" line and an "Add to cart" control
on the same page. Availability stays `unknown`.

Nothing was recorded from any health claim or certification mark, and no image
right is claimed or implied.

## What it changed in the rankings

| | Before | After |
| --- | --- | --- |
| BON CHARGE score | 59.8 | **30.1** |
| BON CHARGE shown price | Check current price ($1,099 prototype) | $999 |
| BON CHARGE coverage | Full body, from panel height | **Half body**, the maker's own word |
| Best Overall | PlatinumLED BIOMAX 900 | unchanged |
| Best Value / Budget / Premium | MitoPRO / HG300 / PRO1500 | unchanged |
| Panels with a prototype price | 3 of 7 eligible | 2 of 7 |

The score falls for two reasons that are both the evidence rather than the
formula: coverage drops a rank, from full body to the half body its maker
describes, and the LED count is withheld as unresolved. It gains a little from
the 30-day return window the record did not have. No badge moved. The panel is
still listed, still comparable on what it does state, and its page says which
figures its own maker left unsettled.

## A defect this reading exposed

The generated checklist read "3 of 4 required specifications carry a usable
value" and "completeness 100%" for this product at the same time. Both figures
were computed, and they disagreed. `completeness()` asked only whether a
required attribute held a usable verification tier, so a field withheld as
disputed still counted toward completeness and toward badge eligibility, while
every screen and every filter treated it as absent.

Fixed: completeness counts a required value only when it survives into
`attributes`, which now means not a placeholder, not unstated, not computed
from a prototype price and not disputed. A synthetic regression holds it, since
no live product currently has a disputed required field. No other product's
completeness or eligibility changed.
