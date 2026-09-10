# Preview

The built site, captured and reproducible. Screenshots are in `shots/`, taken
2026-09-10 from a production build served locally.

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

## Hosting: what is not solved here

This is a local preview. **Nothing is deployed and no host is configured.** A
link Matt can open from his own machine needs a host, which needs a decision
and an account, and neither has been made. The repository is ready for one: the
only deployment-shaped inputs are `NEXT_PUBLIC_SITE_URL` and, when indexing is
wanted, `NEXT_PUBLIC_ALLOW_INDEXING`.

Until then the screenshots below are the durable artefact: they are committed
to the repository and survive this container.

## What to look at

| Shot | What it shows |
| --- | --- |
| `home-desktop`, `home-mobile` | The whole home page: hero, three category tiles, category winners, filter shortcuts, the ranking statement, brands |
| `category-red-light-*` | Eight products ranked, badges, filter chips, the how-we-rank panel |
| `category-cold-plunge-*` | Six products, and the withheld Best Budget stated on the page with its reason |
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
- **"Tradeoff: Not assessed"** appears on 9 of 20 product cards, including
  every card on the home page. That is not a bug: the home page features
  category winners, and a category winner is exactly the product that trips no
  tradeoff rule. The copy is honest and it reads as unfinished. Whether to hide
  the line when there is nothing to say is a copy decision, not a defect, and
  it has not been made.
- **Some prices are relayed rather than read**, and the page says which.
- **Some specs are prototype values**, labelled "Demo data" wherever they
  appear. `docs/PROTOTYPE-VALUE-AUDIT.md` traces all 12 through every surface.

## Fixed while capturing these

**Compare qualifiers read "Not ranked. at least one source…"** with a lowercase
letter after the full stop, on every unranked row. The component turns the
source string's colon into a full stop and was not capitalising what followed.
Fixed in `src/components/compare/CompareView.tsx`; the tooltip keeps the
original single-sentence wording.
