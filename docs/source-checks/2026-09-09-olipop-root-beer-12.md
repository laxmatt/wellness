# OLIPOP Classic Root Beer, 12 pack: manufacturer page reading

| | |
| --- | --- |
| Product | `olipop-root-beer-12` |
| Page | https://drinkolipop.com/products/classic-root-beer |
| Read on | 2026-09-09, at 16:15 Pacific |
| Read by | Codex, using its own web tool, and supplied to this repository |
| Read by this repository | No. Nothing here fetched anything. |

## Which product this is

The page is explicitly the refrigerated 9 g fiber formula. OLIPOP also sells a
separate 6 g formula. They are different products with different nutrition, and
this record describes one of them. The scope is written into the offer note and
into every nutrition note on the record, because the failure mode here is not
getting a number wrong, it is combining two products into one that does not
exist. The same rule sent the BIOMAX 900 record to a single generation.

## What the page stated

$35.99 for the 12 pack one-time, with a subscription price of $30.59 at 15% off
shown separately. A 12 fl oz can, 355 mL: 40 calories, 3 g of total sugars of
which 1 g is added, 9 g of fiber, 30 mg of sodium. Stevia and cassava root
syrup, with apple juice and lemon juice among the ingredients. The page showed
the product as currently out of stock, alongside a cart control.

## What was recorded

- **Price $35.99**, read, replacing a placeholder $35.88 that this repository
  had built out of a relayed "$2 to $3 a can". The subscription price is a
  separate term and is not this offer's price.
- **Subscription 15%**, read, a field this record did not have. The
  subscription flag itself was a placeholder and is now read.
- **Out of stock**, read, on both the offer and the product. The page said so
  while still showing a cart. Both facts are in the note. The offer keeps its
  price and still counts as a real price, because the price is real; the page
  now shows "Out of stock" beside it and nothing here claims it is buyable.
- **Price per serving 300**, recomputed from $35.99 over 12 cans. It was 299,
  from the placeholder the reading replaced.
- **Sugar 3 g and calories 40**, read. Both were placeholders taken from
  ranges across flavours: "2 to 5 g" and "30 to 50 kcal". A number picked out
  of a range for a different set of products was never this formula's.
- **Added sugar 1 g and sodium 30 mg**, read, two fields this record did not
  have.
- **Fiber 9 g**, confirmed on the formula's own page rather than a general
  ingredients page.
- **Sweeteners stevia, cassava root syrup and fruit juice**, read, replacing an
  unconfirmed stevia and fruit_juice placeholder. `cassava_root_syrup` is a new
  value in this catalogue's sweetener vocabulary, added because the page names
  it and no existing value describes it.
- **Serving size and 12 pack**, read.
- **Name**, now "Classic Root Beer, refrigerated 9 g fiber formula, 12 pack".
  A shopper comparing nutrition needs to know which formula the numbers belong
  to.

## What was not recorded

**Caffeine.** No figure was read. The record carried a placeholder 0 mg and the
description called the drink caffeine free. Neither was sourced. A root beer is
usually caffeine free, and usually is not a label, so the field is `not_stated`
and this product does not answer a caffeine-free filter.

**Dietary claims.** Vegan, gluten free, non-GMO, paleo and keto stay as they
were, cited to the general ingredients page and still marked as relayed rather
than read. The handoff did not mention them, and that says nothing about what
the page states.

**Images.** Still a placeholder.

**Any health claim.** Prebiotic soda copy is not verified here.

## What it changed in the rankings

This is the largest ranking movement any single reading has caused, and none of
it comes from OLIPOP's own position. OLIPOP was **ineligible**, on five
placeholder fields. It is now eligible at 51.6, fourth of six. Everything else
moved because the category's normalization range moved:

| product | before | after |
| --- | --- | --- |
| LMNT Citrus Salt | 75, Best Overall | **100**, Best Overall and Best Value |
| Cure Lemonade | 51.3 | **76.3** |
| CELSIUS Sparkling Orange | 61.1, Best Value | 61.1, **no badge** |
| OLIPOP Root Beer | ineligible | 51.6 |
| Liquid I.V. | 1.4 | 1.4 |
| AG1 | 58, ineligible | 83, ineligible |

Two causes, both mechanical:

**Added sugar gained a range.** Every eligible product with an added-sugar
figure stated 0 g, and a criterion where every product ties contributes nothing
to any score. OLIPOP's 1 g is the first non-zero, so that criterion now
separates products, and everyone stating 0 g gains its full weight. That is
exactly 25% of the weighted total, which is the whole of LMNT's 75 to 100 and
Cure's 51.3 to 76.3.

**Per-serving cost gained a more expensive end.** Affordability in this
category runs on price per serving. OLIPOP's $3.00 is the new top, so every
cheaper product's affordability rises. LMNT at $1.50 a stick goes to 90.4, and
with quality at 100 its value reaches 96.6, past CELSIUS's 74.7.

CELSIUS lost Best Value without changing in any way. That is the ranking
working: it was the best balance in a field of four, and it is not in a field
of five. Nothing was tuned to keep it, and nothing should be.

## A question this raises

OLIPOP is out of stock and still holds a real price, so it is still eligible
for price-based badges. It won none, so nothing is wrong on the page today. But
`pricedOffers` excludes only `discontinued` offers, which means an out-of-stock
product could win Best Value and send a shopper to something they cannot buy.
That is the same shape as the zero-score badge defect, and it is a policy call
rather than a data one. Flagged, not changed.
