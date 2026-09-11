# Supplier import: a demonstration

A small, local, offline tool that reads a supplier CSV and shows what a draft
record would look like and what is wrong with it. It exists so a conversation
about importing supplier data can happen over something real instead of a
description.

## How to open it

```
open docs/import-demo/index.html
```

Or paste the file path into a browser. There is no server, no build step and no
install. `index.html` is one file with its script inside it.

Then choose a sample:

- `samples/supplier-a-northwind-SYNTHETIC.csv` — commas, a byte-order mark, one
  description with a line break inside it, column names close to this site's own.
- `samples/supplier-b-contoso-SYNTHETIC.csv` — semicolons, European decimals,
  units inside the values, the supplier's own vocabulary, and four rows with
  something wrong in them.
- `samples/not-a-csv-SYNTHETIC.pdf` — refused, with the reason.

For supplier B, type `EUR` into the currency box to see the price column read.

**The sample files are invented.** The suppliers, the products and every figure
in them were made up for this demonstration. They are not real products and
their numbers are not facts about anything.

## What it does

- Reads CSV and TSV: quoted fields, embedded newlines, CRLF, a byte-order mark,
  and comma, semicolon or tab as the delimiter, decided by which one reads the
  file into rows of equal width.
- Suggests which column means which field, from names written down in
  `src/domain/import/fields.ts`. A heading nothing recognises is left unmapped
  and listed as unread. Nothing is matched by resemblance.
- Shows a draft per row: the raw text from the file, what was read out of it,
  and every reason it cannot be trusted yet.
- Lets you change any column mapping by hand, save it as JSON, and load it back
  for the next file from the same supplier.

## What it will not do

- Write anything. The catalogue is untouched. There is no database, no account,
  no upload and no publish button.
- Reach the network. Nothing is fetched, including any address inside a file: a
  supplier's link is shown as text and is not a link.
- Run anything from a file. A cell starting like a spreadsheet formula is kept
  as text, shown as text, and blocked.
- Guess. A format it does not read is refused with the reason. A number it could
  read two ways is refused. A price with no stated currency is refused.
- Fill a gap. An empty cell is unknown, never zero.

It is bounded at 1 MB, 500 rows and 64 columns.

## The fields it maps

Ten, for wellness drinks only: supplier SKU, product name, brand, category,
function, sugar, caffeine, pack price, servings per pack, and a source
reference. Each one shows where it would land in a record and what a reviewer
still has to settle about it.

Everything else a product record holds — serving size, format, sodium, calories,
sweeteners, images, editorial — is outside this demonstration. A draft is silent
on those rather than filling them with defaults.

## What it does not settle

The page ends with the list that no file answers, however clean it parses:

1. Which product this is.
2. Which variant this is.
3. Whether the supplier counts as evidence for a figure.
4. What date the figures carry.
5. Whether a price is an offer from one merchant on one day.
6. What the file says nothing about.

A supplier feed is a retailer speaking, not the maker. On this site that means
`merchant_feed`, `method: secondhand`, and never `manufacturer_reported` unless
somebody has read the maker's own page. Nothing in this tool matches a row to a
product in the catalogue, by name or by code, because that is a judgement.

## Rebuilding it

```
npm run import:demo
```

`index.html` is generated from `src/tools/import-demo/` and bundles
`src/domain/import/`, which is the same code the tests exercise. It is committed
so that opening it needs no tooling. Do not edit it by hand.

Checks:

```
npx vitest run src/__tests__/supplier-import.test.ts   # parsing, values, mapping, drafts
npm run import:demo && npx tsx e2e/import-demo.mts     # the page itself, in a browser
```
