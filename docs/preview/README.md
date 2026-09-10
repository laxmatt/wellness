# Preview

The built site, captured and reproducible. **Open `index.html` in a browser**
for the gallery: it reads the committed images with relative paths, so it works
from a clone with no server and no network.

Screenshots are in `shots/`, taken 2026-09-10 from a production build served
locally.

## Running it yourself

```
npm ci
npm run preview          # builds, then serves on http://localhost:3000
```

That is the whole dependency list for browsing. **No database and no model
credential are needed**: every page above was served with `DATABASE_URL` unset
and all of them returned 200. Node and the repository are enough.

Two things do need more:

- **The assistant.** Without a model credential it runs a scripted stand-in and
  says so in a banner on the panel. With one it needs `DATABASE_URL` for the
  spend ledger and rate limiter.
- **Public indexing.** Off unless `NEXT_PUBLIC_SITE_URL` and
  `NEXT_PUBLIC_ALLOW_INDEXING=1` are both set and no preview signal is present.
  A local run is `noindex` and that is correct.

To refresh the screenshots after a change:

```
npm run preview          # in one shell
npm run preview:shots    # in another
```

`preview:shots` refuses to run unless the server is serving the build in
`.next`, so a set of images can never quietly describe older code.

## Hosting

**A local preview needs no host and no account.** Clone the repository, run
`npm ci && npm run preview`, open `http://localhost:3000`. That is the whole
path on a Mac, and it gives the real site rather than pictures of it.

A *public* URL is a different thing and is not solved here. **No external
deployment configuration exists in this repository and none has been verified
from here**, which is a statement about what is on disk and what this container
could check, not a claim that nothing is deployed anywhere. Publishing would
need a host, and the only deployment-shaped inputs the code has are
`NEXT_PUBLIC_SITE_URL` and, when indexing is wanted,
`NEXT_PUBLIC_ALLOW_INDEXING`.

The screenshots and `index.html` are the artefact that travels: committed to
the repository, readable offline, and independent of this container.

## What to look at

| Shot | What it shows |
| --- | --- |
| `home-desktop`, `home-mobile` | The whole home page: hero, three category tiles, category winners, filter shortcuts, the ranking statement, brands |
| `category-red-light-*` | Eight products ranked, badges, filter chips, the how-we-rank panel |
| `category-cold-plunge-*` | Six products, and the withheld Best Budget stated on the page with its reason |
| `category-wellness-drinks-*` | Six products scored on sugar, added sugar, calories and subscription, with Best Budget withheld and explained |
| `product-renu-*` | A well-sourced product: score breakdown, specs by group, retailers, sources |
| `product-plunge-no-price-*` | **The most unusual state, worth a careful look.** A product with no price at all: the block says "Current price unavailable", the retailer section explains it in a shopper's words, one withheld listing is acknowledged without its amount, and the product still ranks and compares |
| `compare-*` | Three cold plunges side by side, sticky product header |
| `compare-scrolled-*` | The same table scrolled, showing the disputed-value qualifiers under the row labels |
| `how-we-choose-*` | The published rules behind every badge |
| `disclosure-*` | No affiliate programme, no commission |

`BUILD.txt` in `shots/` records the build the images came from.

## What is deliberately unfinished, and visible

- **Every product image is a procedural placeholder**, marked "DEMO IMAGE" on
  the image itself. Nothing here is presented as a photograph. See
  `docs/drafts/IMAGE-RIGHTS-MATRIX.md`.
- **Some cards carry a tradeoff line and some do not.** A card shows one when a
  rule fired and omits the line when none did, which is often the case for a
  category winner. The statement itself still exists where there is room to say
  it properly: the product page explains that no rule firing is not the same as
  finding no tradeoff, and the compare table keeps its row.
- **Some prices are relayed rather than read**, and the page says which.
- **Some specs are prototype values**, labelled "Demo data" wherever they
  appear. `docs/PROTOTYPE-VALUE-AUDIT.md` traces all 12 through every surface.

## Changed while capturing these

**Compare qualifiers read "Not ranked. at least one source…"** with a lowercase
letter after the full stop, on every unranked row. The component turns the
source string's colon into a full stop and was not capitalising what followed.
Fixed in `src/components/compare/CompareView.tsx`; the tooltip keeps the
original single-sentence wording.

**Cards no longer print "Tradeoff: Not assessed."** Every category winner trips
no tradeoff rule, so all four cards on the home page carried the same empty
line. The line is omitted when there is nothing to say. Actual tradeoffs are
untouched, no ranking logic changed, and the product page and compare table
still state explicitly what "not assessed" means.
