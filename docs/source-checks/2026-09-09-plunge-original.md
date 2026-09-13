# Plunge Original: manufacturer page reading

| | |
| --- | --- |
| Product | `plunge-original` |
| Page | https://plunge.com/products/plunge |
| Read on | 2026-09-09, at 15:40 Pacific |
| Read by | Codex, using its own web tool, and supplied to this repository |
| Read by this repository | No. Nothing here fetched anything. |

## The identity question, first

The page describes a **reimagined Original with a Pro Chiller Gen2 included**.
This record was built on 2026-09-08 from search summaries that named no
generation. Nothing here establishes that they described the same model, and
this reading cannot settle it.

What can be shown is that seven figures agree exactly:

| figure | on the record since 2026-09-08 | read 2026-09-09 |
| --- | --- | --- |
| Length | 66.625 in | 66-5/8 in |
| Width | 31.5 in | 31-1/2 in |
| Height | 26 in | 26 in |
| Empty weight | 144 lb | 144 lb |
| Water capacity | 105 gal | 105 gal |
| Maximum user height | 80 in | 80 in |
| Minimum temperature | 37°F | 37°F |

Agreement to the fraction of an inch does not prove the models are the same. It
proves something narrower and sufficient: **each of these values is the same
figure either way**, so recording it against this page changes nothing about
what the record asserts. Each citation names the page and says what it
describes, so a reader can judge for themselves.

Two more figures agree in substance: a chiller is included, and the warranty
runs a year.

**Agreement licenses the number and nothing around it.** The record's warranty
read "1-year limited manufacturer warranty from date of delivery". The page
states a year. It does not state that the year runs from delivery, and an
earlier version of this record cited that whole phrase to the reading because
the number matched. It now records "1-year warranty" against the page, with
the older wording preserved in the note as wording rather than as a read term.

The same test applied to everything else the reading did not cover, and three
claims failed it.

## What was recorded

- **The seven matching figures**, recited to the page that states them, each
  with the reimagined-and-Gen2 caveat in its note.
- **1,019.7 lb filled**, read, in the weight note beside the 144 lb empty
  figure. A floor has to carry the filled number.
- **Insulated, true**, read. A field this record did not have. The page gives
  no R-value or material and none is recorded.
- **Placement indoor and outdoor**, read, replacing a placeholder that had
  guessed the same pair without a source. That was the record's last prototype
  value.
- **App temperature control**, read, in the description. Cold plunges have no
  app field in this catalogue and one was not invented for a single product.

## What was withheld

**Sanitation and power.** Ozone sanitation, a sanitation system and a dedicated
120V circuit were all relayed on 2026-09-08 from material that named no
generation. The reading does not cover them. They cannot be shown to describe
the configuration this record now cites, so all three are marked and withheld
from matching and scoring while staying visible with their notes. They are
history, not current facts.

That costs the product 16.7 points, because sanitation carries a weight of 1.5
out of 9. It is the same amount insulation gained, which is a coincidence and
not a balancing act.

**The price.** The record carried $6,990, relayed. The page displays **$6,790**,
beside **$8,490** presented as a comparable value. That $8,490 is not recorded
as a list price: a comparable value is a marketing comparison, not a proven
former price, and `listPriceMinor` would assert it was one.

$6,790 is not imported either. The page prices a configuration, and cold-only
versus heater was not separated in this reading, so that amount cannot be
attached to this record's tub.

**So this product now has no price at all.** The offer is withheld with its
$6,990 and its history intact, and the page says "Check current price" and
links to the merchant. A first version of this record kept the $6,990 public
and argued that withholding it would fail the build. That was tested, and it
was true: `derivePrice` threw, and a second defect sat behind it, an undefined
written into the provenance map that crashed the catalogue report. Both are
fixed. A type that could not express "no price" was never a reason to publish
one.

Nothing was invented to fill the gap: no reference price, no zero, no
placeholder. The product keeps its capability score of 64.8, stays eligible,
stays comparable, and is excluded from affordability and from every price-tier
badge because it has no amount to be ranked on. It lost Best Premium to Edge
Tub Elite, which does have a price.

**Shipping.** The header offers free in-home shipping. Another section offers
free curbside delivery with in-home as a paid premium. Those are different
promises and which one applies is a checkout-dependent question this reading
did not resolve, so no shipping term is recorded at all. The conflict is in the
offer note.

**Heating.** Recorded as `not_stated` with a note, rather than left silently
absent. Whether this record's tub heats is the same open question as its price:
both turn on the configuration.

**Tub type.** An editorial classification, unchanged.

**Stock, image rights, health claims.** None verified.

## What it changed in the rankings

| product | before | after |
| --- | --- | --- |
| Renu Cold Stoic 2.0 | 83.3, Best Overall | 83.3, Best Overall |
| Plunge Original | 64.8, Best Premium | 64.8, **no badge, no price** |
| Edge Tub Elite | 44.4 | 44.4, **Best Premium** |
| Ice Barrel 500 | 22.2 | 22.2 |
| The Cold Pod | 18.5, Best Value | 18.5, Best Value |
| Ice Barrel 400 | 0 | 0 |

The score is unchanged at 64.8, and that is arithmetic rather than balance:
insulation added 16.7 and the withheld sanitation claim took the same 16.7
away. Both fields carry a weight of 1.5 out of 9.

Best Premium moved to Edge Tub Elite on 44.4, which is a considerably weaker
record: four prototype values and an unconfirmed listing claim that its brand
is out of business. A tier badge goes to the best-scoring product that has a
price, and Plunge no longer has one. That is the rule working, and it is worth
seeing plainly rather than being smoothed over.

Plunge does not hold Best Overall either, and it never did: Renu leads on 83.3.
The 1.8-point gap an earlier version of this file noted was against a score
built partly on a claim that has since been withheld.
