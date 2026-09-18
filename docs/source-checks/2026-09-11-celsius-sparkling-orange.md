# CELSIUS Sparkling Orange, 12 pack: the maker's page and its back label

| | |
| --- | --- |
| Product | `celsius-sparkling-orange-12` |
| Pages | https://www.celsius.com/products/celsius/sparkling-orange/<br>https://www.celsius.com/wp-content/uploads/2023/08/Orange-supp.png |
| Read on | 2026-09-11 |
| Read by | Codex, using its own web tool, including visual inspection of the label image |
| Read by this repository | No. Every manufacturer domain is refused at this container's egress proxy. |

This product had never been read. It was the only wellness drink with no source
check at all, and five of its fields declared `kind: "manufacturer"` while
citing `https://www.amazon.com/dp/B007R8XGJA`. An Amazon listing is a retailer,
not the maker speaking. This engagement had already made that correction once,
for an Edge claim that came from a Shop listing.

## What was read

The back-label panel, titled SPARKLING ORANGE, states serving size 12 fl oz
(355 mL), servings per container 1, calories 10, and "Caffeine Content: 200mg".

The product page shows zero sugar, gluten free, kosher and non-GMO icons.

## What was recorded

Every figure below already held this value. Nothing changed except what it
rests on, which was the whole problem.

| Field | Value | Now cited to |
| --- | --- | --- |
| `serving_size` | 1 can (12 fl oz) | the label image |
| `calories` | 10 kcal | the label image |
| `caffeine_mg` | 200 mg | the label image |
| `sugar_g` | 0 g | the product page's zero sugar icon |
| `dietary` | gluten_free, non_gmo | the product page's icons |

`dietary` gained `gluten_free`, which the page states and the record did not
hold. That is the one value added.

All five stay `manufacturer_reported`. A maker's own label is the maker
reporting, not an independent test, and reading it does not make it one.

## What was read and deliberately not recorded

**Kosher.** The page shows the icon. This category defines no value for kosher:
`dietary` admits vegan, gluten_free, keto, non_gmo and paleo. A fact with
nowhere to go is left unrecorded rather than forced into a field that does not
mean it. If kosher matters to the launch, it is a category change, not a
product one.

**Vegan.** No vegan icon was read and none is inferred from the others. Gluten
free, kosher and non-GMO say nothing about animal products.

**Servings per pack.** The label says servings per container 1, and that
container is one can. This record is a 12 pack. A per-can panel cannot state a
pack count, so `servings_per_pack` is untouched and stays editorial.

**Price per serving.** Still the pack price divided by the cans. The label says
nothing about price.

**Sweeteners.** Still a demo value. The ingredient list was not part of this
reading, and its absence from the handoff says nothing about whether the label
carries one.

**Images.** The label was read as evidence. No right to reproduce it has been
established and none is claimed. It is cited as a URL and nothing on this site
displays it.

## What it did to the site

Nothing a shopper can see moved. Score 60.9, no badges, unchanged; caffeine
still 200 mg, so the caffeine-free filter still rules this product out for a
stated reason. `dietary` gained gluten free, which appears in the comparison
table and is not a filter row in this category.

What changed is what the record would survive. Five fields no longer claim the
manufacturer said something while pointing at a retailer.

## Still open on this product

The record still holds one demo field, `sweeteners`, and two editorial ones,
`function` and `format`. None of them was part of this reading.
