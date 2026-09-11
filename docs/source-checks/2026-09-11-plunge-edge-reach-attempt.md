# Plunge and Edge: reachability from this container, and what would settle each

| | |
| --- | --- |
| Attempted on | 2026-09-11 |
| Attempted by | This repository's container, under authorisation to read where reachable |
| Result | Refused. No page was read. No catalogue change. |

## The attempt, once, by three clients

| Client | `plunge.com` | `edgetheorylabs.com` |
| --- | --- | --- |
| curl through the container proxy | no response, tunnel refused | no response, tunnel refused |
| the fetch tool | `EGRESS_BLOCKED` | `EGRESS_BLOCKED` |
| Chromium via Playwright | `ERR_TUNNEL_CONNECTION_FAILED` | `ERR_TUNNEL_CONNECTION_FAILED` |

The browser fails the same way as the other two because it shares the
container's proxy. This is the network policy, not a site problem, and it is the
same refusal every manufacturer domain has given. Stopped here.

---

## Plunge: what to capture, given that the text does not expose the variant

The record already sits closer to an answer than it looks. Seven attributes were
read direct from this page on 2026-09-09: chiller, minimum temperature,
capacity, fits-height, placement, warranty and insulation. Only three come from
the 2026-09-08 material that named no generation, and those three are the
disputed ones.

So the open question is narrow: **which variant the $6,790 belongs to, and
whether that variant heats.**

### Where a Shopify store keeps the identifier

`plunge.com/products/plunge` has the shape of a Shopify product URL, and the
variant id already on the Mito record, `?variant=32084839432292`, is that
platform's id format. If that holds here, the variant list is published as JSON
beside the page and does not need the rendered text at all:

- `https://plunge.com/products/plunge.json`
- `https://plunge.com/products/plunge.js`

Either returns every variant with its `id`, `title`, `price` and `available`, so
"Cold Only" and "Add Heater" arrive as named rows with their own prices rather
than as options whose selection has to be inferred. The canonical URL for one is
then `https://plunge.com/products/plunge?variant=<id>`.

This is a hypothesis about the platform, not a fact about the page. If those
paths return something other than a variant list, the fallback is to select the
option in a browser and read the `?variant=` the URL gains.

Read-only either way. Nothing here involves a cart.

### The alignment, prepared, conditional on that evidence

Apply only what the named variant supports:

| Field | Now | If the variant is Cold Only |
| --- | --- | --- |
| `heating` | `not_stated`, blank | `false`, manufacturer_reported, cited to the variant URL |
| offer `plunge-original-direct` | $6,990, disputed, withheld | $6,790 against the variant URL, same offer id, the $6,990 and why it was withheld kept in its note |
| `plumbing` (dedicated_circuit) | disputed | **unchanged unless the page states it for this generation** |
| `sanitation_system` (true) | disputed | **unchanged unless stated** |
| `sanitation_methods` (ozone) | disputed | **unchanged unless stated** |
| the seven read on 2026-09-09 | direct | unchanged; they are shell and chiller properties, not variant ones |

The three disputed rows are the trap. A variant identifier settles which tub is
being priced and says nothing about ozone or a dedicated circuit. Resolving them
because the price question was resolved is exactly the mixed-attribute record
this product already has.

If the variant is **Add Heater**, this record is not that product: it is the
Original, and the cold-only variant is the one to align to.

---

## Edge: what would settle it, without retrying the same URL

The product URL returned an internal error for Codex today, and this container
cannot reach the domain at all. A Shop listing says the brand is no longer in
business and remains the only source for that.

One error on one product page is not evidence of closure. Three things would be:

1. `https://www.edgetheorylabs.com/` itself. A site that does not resolve, or
   resolves to a holding page, is evidence. A working storefront is evidence the
   other way and ends this.
2. Whether anything is purchasable. A collection page with products that reach a
   checkout says the business is operating, whatever one product URL does.
3. A support or contact channel that answers, or visibly does not.

Until one of those, the record is right as it stands: the offer is neither
removed nor marked dead, and availability stays `unknown`.

The reason this one is urgent is not the figures. Edge Tub Elite holds **Best
Premium in Cold Plunges at 44.4**, so the site is recommending it. If the brand
is gone, that recommendation is the defect, not the relayed $5,490.
