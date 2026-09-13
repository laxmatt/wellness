# The Cold Pod: the Amazon listing was tried once, and the identity stays open

| | |
| --- | --- |
| Product | `the-cold-pod-88`, "Ice Bath Tub, 88 Gallon" |
| URL tried | https://www.amazon.com/dp/B0CPKYNJ9Q |
| Tried on | 2026-09-11, once |
| Result | `EGRESS_BLOCKED`. Not retried. |
| Catalogue change | None. |

## What was tried

One request, for the listing's own title, brand, model identifier, capacity,
dimensions, weight and price. The fetch tool refused the domain:

```
{"error_type":"EGRESS_BLOCKED","domain":"www.amazon.com",
 "message":"Access to www.amazon.com is blocked by the network egress proxy."}
```

No retry, no alternative route, no substitute product.

## Where that leaves the identity

Unresolved, and bounded. What is on record:

| | Source | Read |
| --- | --- | --- |
| 85 gallons, $119.99, standard USA model | `thecoldpod.com/products/the-cold-pod-usa` | 2026-09-09 and 2026-09-11, same both times |
| 88 gallons, $139.99 | Amazon listing `B0CPKYNJ9Q` | **never fetched**, relayed from a search summary 2026-09-08 |

The maker's page answers completely about the model it describes and says
nothing about an 88-gallon one. It does not establish that an 88 exists, that it
does not, or that the listing renamed the same tub. The one document that could
settle it is the listing itself, and it has still never been read.

Retailer evidence stays retailer evidence: the four attributes sourced to that
listing are already `kind: "retailer"` and say so on the page.

## How the page reads today

Every place the **figure** appears, it is marked and explained:

- Product page, Water capacity: **"88 gal, disputed"**.
- Comparison table, same row: **"88 gal, disputed"**, and the row is excluded
  from winner marking.
- Sources block: the full note, naming 85 gallons, the maker's URL, the date it
  was read, and the sentence that nothing establishes the two are the same tub.
- The specification is withheld from filtering and scoring, so no search for a
  capacity returns this product on the strength of either number.

One place repeats the figure without a marker: the **product's name**, "Ice Bath
Tub, 88 Gallon". It appears in the browser title, the breadcrumb, the page
heading and the category card. On the card it appears alone, because a card
shows no capacity row, so a shopper scanning the category sees "88 Gallon"
stated plainly while the site's own capacity field declines to state it.

## Recommendation

**The specification surfaces are honest and should not be touched.** The
disputed treatment is the site's existing mechanism, it is applied correctly
here, and it already says more than most comparison sites would.

**The name is the gap, and it is a one-field data edit, not a UI change.**
Dropping the capacity from the display name, to "Ice Bath Tub", would remove the
one unqualified assertion of a figure the record refuses to stand behind. It
imports nothing from the 85-gallon page, invents no product, and needs no schema
change. The slug stays `the-cold-pod-88-gallon`, so no URL moves and no history
is lost.

I have not made that edit. A product's name is part of the identity question
Codex is still resolving, and renaming a record on the strength of a blocked
reading is the same class of decision as rewriting its capacity. It is proposed,
not taken.

**If the name stays as it is**, nothing else needs adding. A second marker on
the card would restate what the product page already says with more precision,
and the page a shopper reaches from that card is one click away.

## What would actually settle it

The listing at `B0CPKYNJ9Q`, read once, for its title, brand, model identifier
and stated capacity. Everything else has been tried.
