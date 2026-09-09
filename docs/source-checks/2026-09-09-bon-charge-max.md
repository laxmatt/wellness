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

**Coverage.** The catalogue's own class rule, computed from panel height, says
full body for a 35.8-inch panel. The maker calls it targeted half-body with
flexibility for small full-body sessions. Those do not agree, and the enum has
no value for "half body, sometimes more". Marked `disputed`: the value stays
visible and matches nothing, so the panel no longer answers a full-body filter
its maker does not claim.

That last one is a judgement call with the largest consequence in this file,
and the alternative is worth stating: recording `half_body`, the maker's own
first word, would keep the panel scoring on coverage at rank 2 instead of
withholding the criterion. It was not taken because the sentence names three
levels and picking one is the thing this project keeps refusing to do. If the
call should go the other way, it is one field and one note.

**Stock.** A "Sold out" label, an "In Stock" line and an "Add to cart" control
on the same page. Availability stays `unknown`.

Nothing was recorded from any health claim or certification mark, and no image
right is claimed or implied.

## What it changed in the rankings

| | Before | After |
| --- | --- | --- |
| BON CHARGE score | 59.8 | **8.6** |
| BON CHARGE shown price | Check current price ($1,099 prototype) | $999 |
| Best Overall | PlatinumLED BIOMAX 900 | unchanged |
| Best Value / Budget / Premium | MitoPRO / HG300 / PRO1500 | unchanged |
| Panels with a prototype price | 3 of 7 eligible | 2 of 7 |

The score falls because the two criteria it fell hardest on are now unresolved:
coverage carries a weight of 3 of 7 and LED count 1 of 7, and both are withheld.
It gains a little back from the 30-day return window, which the record did not
have before. No badge moved. The panel is still listed, still comparable on
what it does state, and its page says which figures its own maker left
unsettled.
