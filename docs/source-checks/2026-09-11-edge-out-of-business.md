# Edge Theory Labs: the maker states it has gone out of business

| | |
| --- | --- |
| Product | `edge-tub-elite` |
| Page | https://www.edgetheorylabs.com/ |
| Read on | 2026-09-11 |
| Read by | Codex, using its own web tool, and supplied to this repository |
| Read by this repository | No. The domain is refused at this container's egress proxy; the attempt is on file. |

## What the page stated

A heading, "Edge Theory Labs Update", and the statement that the company has
gone out of business. It directs owners to help documentation, a paid
third-party service and an extended warranty provider, and says the Edge App is
shutting down with a Tuya alternative.

The 2026-09-09 Shop listing that said the same thing was one listing repeating a
claim. This is the maker, on its own site.

## What was recorded

The direct offer is `discontinued`, and so is the product. Nothing else on the
record changed: not the $5,490, not a specification, not the id, not the slug,
not the page.

**Two things this does not say**, and the note on the offer says both out loud.
It does not say no stock exists anywhere: other sellers may still hold units and
this catalogue simply holds no confirmed listing for one. It does not say any
warranty is void: the maker's own page names an extended warranty provider, and
what that is worth was not read here.

## What changed on the site

| | Before | After |
| --- | --- | --- |
| Best Premium, Cold Plunges | Edge Tub Elite, 44.4 | withheld: fewer than 2 priced products in the tier |
| Edge's price | $5,490 | no amount quoted |
| Edge's buy button | links to the maker | none |
| Edge in the ranking | 3rd, at 44.4 | 3rd, at 44.4 |
| Every other badge | | unchanged |

The product page says: "No price and no way to buy from us. The maker states on
its own site that it has gone out of business, so we do not link to it and we
hold no other confirmed listing. Other sellers may still have stock."

## The rule behind it

`buyableOffers` dropped disputed offers and not discontinued ones, while
`pricedOffers` and `liveOffers` dropped both. So a discontinued offer priced
nothing and counted as dead, and was still a Shop button. That is fixed, and it
is now one rule.

Badges gained a condition: a badge is a recommendation, so it needs somewhere to
send a shopper. Price-based picks already excluded a product with no amount, and
that was luck rather than a rule, because Best Overall is not price-gated and
would have handed the badge over on score alone.

The sellable set is passed to `assignBadges` as its own argument rather than
carried on `ScoringInput`. ScoringInput deliberately holds no offer data and a
test enforces it: ranking must not be able to see who sells a product. Putting
`buyable` there was the first attempt and it broke that guarantee.

A second attempt filtered `eligible`, which took unbuyable products out of the
ranking as well and sent Plunge Original, scoring 64.8 with a disputed price,
below a tub scoring zero. Rank is about the product; the badge is about the
offer. A product nobody can buy today still ranks where its specifications put
it, and keeps its page, its id and its place in the comparison.

## What the harness caught

Two leaks, after the data change looked finished. The product page held its own
copy of the buyable rule, so it went on publishing a schema.org `Offer` and a
buy link for the dead maker: a price claim made to search engines, which quote
it back to people. The harness held a copy too, and went on expecting them.

Both now call `buyableOffers`. That is the fourth and fifth place this rule
lived; it now lives once.
