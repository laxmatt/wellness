# Admin inventory: supplier file to storefront, on one machine

A supplier CSV becomes draft records, you read and edit them, you approve the
ones you want, and they appear in the storefront running on your own machine.
You can hide them again and they stay staged. You can remove them and they are
gone.

`PLAN.md` beside this file is the plan this was built from, and the reasoning
behind each decision.

## Running it

Everything needs the flag. Without it every command refuses and the site loads
the real catalogue only.

```
export WELLNESS_PREVIEW_INVENTORY=1
```

Stage the sample supplier file. It is the same invented file the import
demonstration uses.

```
npm run inventory -- stage \
  --file docs/import-demo/samples/supplier-a-northwind-SYNTHETIC.csv \
  --supplier "Northwind Hydration" \
  --priced-on 2026-09-12
```

Five rows become five drafts. Then:

```
npm run inventory -- list
npm run inventory -- show preview-northwind-hydration-berry-sparkling-energy-12-cans
npm run inventory -- approve preview-northwind-hydration-berry-sparkling-energy-12-cans
npm run build && npm start
```

`hide`, `unhide`, `remove` and `clear` do what they say. `--replace` is needed
to re-stage a record that already exists, because re-staging throws away edits
and resets an approved record to a draft.

Try the second sample to see the refusals:

```
npm run inventory -- stage \
  --file docs/import-demo/samples/supplier-b-contoso-SYNTHETIC.csv \
  --supplier "Contoso Beverages" --priced-on 2026-09-12
```

Every row is refused and nothing is written. The reasons name the cell: a price
in EUR against a catalogue that stores USD, a category this site does not
compare, a cell that starts like a spreadsheet formula, a sugar figure in
ounces, a pack of sticks that nobody has said is a pack of servings.

## Where the records live

`catalog-preview/`, beside `catalog/` and with the same shape. It is not
committed. It is your working directory, and reviewing a draft means opening
the JSON and reading it.

The preview catalogue only ever **adds**. A record may not take an id or a slug
the real catalogue already holds, and every preview id starts with `preview-`.
There is no path through this tool that edits, shadows or contradicts anything
in `catalog/`.

If anything in the preview catalogue is wrong, the whole overlay is refused, the
reasons are printed, and the site serves the real catalogue unchanged. Nothing
is dropped quietly and nothing breaks the storefront.

## What an approved sample is worth

Every figure staged from the file is recorded as demo data, sourced to the file
and the row. An empty cell in a mapped column is recorded as not stated.

So an approved sample appears in the category, has a product page, can be
compared, and carries the link from its row, and **it answers no filter, ranks
last, and never reaches the assistant**. Press "Energy" and the invented energy
drink disappears.

That is not a gap in the import. It is what a figure out of an invented file is
worth, and the same rule already governs the rest of the catalogue: `isUsable`
in `src/domain/provenance.ts` withholds a demo value from matching, scoring and
the assistant. A figure becomes a fact here when a reviewer records where it
came from, and no importer can do that.

The other things the import demonstration lists as still open are still open.
`STANDING_REVIEW` in `src/domain/import/draft.ts` names them: which product this
is, which variant, who is actually speaking, and what date the figures carry.

## Identity, and what is kept apart from what

- The supplier's code goes to `identifiers.merchantSkus` and to the offer. It is
  never the product id. The product id is derived from the brand and the name.
- The price becomes an offer at a named merchant, dated with the date you stated
  on `--priced-on`. It is never the product's own price.
- The brand and the supplier become their own `preview-` records, so no existing
  brand gains an invented product.
- The image is a placeholder. No right to any image is claimed.

## What it will not do

- Publish anywhere. "Published" here means visible in the storefront running on
  this machine, and nothing else.
- Load anywhere but a local machine. The flag is not enough: `VERCEL`,
  `VERCEL_ENV`, `CONTEXT`, `CF_PAGES_BRANCH`, `NETLIFY`, `RENDER`,
  `FLY_APP_NAME`, `DYNO`, `RAILWAY_ENVIRONMENT`, `AWS_LAMBDA_FUNCTION_NAME`,
  `KUBERNETES_SERVICE_HOST`, `CI` or a public `NEXT_PUBLIC_SITE_URL` each refuse
  it. The check runs inside `getCatalog()`, so no caller can skip it.
- Add an HTTP route. There is no endpoint, so there is nothing to leave
  unauthenticated. What a production admin page would need is in
  "Still missing" below.
- Write outside `catalog-preview/`. Every path is built from a derived id that
  matched `^preview-[a-z0-9-]+$`, and every path is checked to resolve inside
  that directory.
- Write anything before the merged catalogue validates.
- Reach the network, open an address from a file, run a formula, or call a model.

## Still missing, and deliberately

**A production admin page.** This is a command line on the machine the catalogue
lives on. Making it a page means answering who may sign in, how that is stored,
how a session ends and what an audit trail looks like. `src/domain/admin-auth.ts`
holds a single shared key for one read-only endpoint and is not an answer to any
of that. None of it is needed for this workflow, which is why none of it was
guessed at.

**Editing in a browser.** A draft is a JSON file and editing it is editing it.

**Writing to the real catalogue.** Nothing here does. Moving a preview record
into `catalog/` is a person deciding a record is real, and it needs the evidence
questions answered first.

## Checks

```
npx vitest run src/__tests__/inventory-stage.test.ts            # rows to records, and the rows refused
npx vitest run src/__tests__/inventory-preview-catalog.test.ts  # the storefront, over the real catalogue
npm run build                                                   # unchanged without the flag
```

The second suite is not stubbed. Its base is the real `catalog/` directory, its
overlay is a real directory on disk written by the same code the tool writes
with, and it reads through `src/lib/queries.ts`, which is what every page uses.
