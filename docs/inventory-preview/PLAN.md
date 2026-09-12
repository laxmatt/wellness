# Admin inventory: the plan

Written before the code, from what the repository already does.

## What the architecture already provides

Five things were found by reading, and they decide most of the design.

1. **The approval gate exists.** `ProductStatus` in `src/domain/product.ts` is
   already `draft | published | hidden | discontinued`, and every shopper read in
   `src/lib/queries.ts` already filters `status: ["published"]`: the category
   page, the product page and the compare list. A draft is a product with
   `status: "draft"`. Approving is `status: "published"`. Hiding is
   `status: "hidden"`. No second product model, and no new gate.
2. **One composition root.** `getCatalog()` in `src/providers/index.ts` is the
   only place the catalogue is built. Everything the storefront renders comes
   through it, so that is the one place a preview overlay can be added.
3. **Loading already validates.** `loadLocalCatalog` Zod-parses every file and
   then runs `validateCatalog`, which checks ids, slugs, brand and category
   references, attribute typing against the category definition, and a primary
   image. Validation failures surface by themselves.
4. **`demo` and `not_stated` values never answer a question.** `isUsable` is
   read by `toProductView`, so a figure marked either way is displayed and
   labelled and is withheld from filters, from ranking and from the assistant.
5. **The catalogue stores USD only.** `Currency` is `z.enum(["USD"])`, while the
   importer reads seven currencies. A staged row priced in anything else cannot
   become a record here.

## The slice

Supplier CSV -> drafts -> files on disk -> review and edit -> approve -> the
storefront. Six steps, one operator, no server.

### 1. An isolated preview catalogue

A second directory, `catalog-preview/`, with the same `products/ brands/
merchants/` shape as `catalog/`. It is **additive only**: an overlay record may
not reuse an id or a slug that `catalog/` already holds, and every overlay id
must start with `preview-`. The real catalogue cannot be edited, shadowed or
contradicted through this path, so every existing catalogue fact is preserved by
construction.

`catalog-preview/` is not committed. It is an operator's working directory.

### 2. A flag, enforced on the server side

The overlay loads only when `WELLNESS_PREVIEW_INVENTORY=1`, and it refuses even
then if the process looks like a deployment: `VERCEL`, `VERCEL_ENV`, `CONTEXT`,
`CF_PAGES_BRANCH`, `NETLIFY`, `RENDER`, `FLY_APP_NAME`, `DYNO`,
`RAILWAY_ENVIRONMENT`, `AWS_LAMBDA_FUNCTION_NAME`, `KUBERNETES_SERVICE_HOST`,
`CI`, or a configured public `NEXT_PUBLIC_SITE_URL`. Any one of those and the
overlay does not load, whatever the flag says. The check runs inside
`getCatalog()`, so it cannot be bypassed by a caller.

### 3. A CLI, not a route

`npm run inventory -- <command>`. No HTTP endpoint is added, so there is nothing
to leave unauthenticated. The existing `src/domain/admin-auth.ts` guards the one
admin route this project has; adding a second admin surface would mean deciding
how it is authenticated in production, and that decision is not needed to build
this slice.

Commands: `stage`, `list`, `show`, `approve`, `hide`, `unhide`, `remove`.

Writes are confined to `catalog-preview/`. The filename comes from the record
id, the id is checked against `^preview-[a-z0-9-]+$`, and the resolved path is
asserted to sit inside the preview directory before anything is written. Nothing
in a supplier file reaches a path.

### 4. Reviewing and editing

A staged draft is a JSON file. Reviewing it is reading it; editing it is editing
it. `approve` re-reads the file, re-parses it against `Product`, and refuses if
the merged catalogue would not validate. No editing UI is built, because the
file is already the editable thing.

### 5. What a staged figure is worth

Every figure read out of the sample file is recorded `verification: "demo"` with
`source.kind: "demo"`, naming the file and the row. That is what the value is:
the file is invented, so the figure is invented. The consequence is deliberate
and visible. An approved sample product appears in the category, has a product
page, can be compared and carries a store link, and every figure on it reads
"Demo data" and answers no filter.

A mapped column whose cell is empty is recorded with no value and
`verification: "not_stated"`, which says the file was read and states nothing.
An unmapped field is not recorded at all.

Importing a feed does not produce facts. A reviewer establishing where a figure
came from is what produces facts, and no CLI can do it for them.

### 6. Identity

- The product id is derived from the brand and the name, prefixed `preview-`.
  Two rows deriving the same id is a refusal, not a silent suffix.
- The supplier's code goes to `identifiers.merchantSkus[<supplier>]` and to
  `offers[].merchantSku`. It never becomes the product id.
- The price becomes an offer on a merchant record for the supplier, with
  `lastChecked` set to the date the operator states the prices were current. It
  never becomes the product's own price.
- The brand and the supplier become their own `preview-` records, so no existing
  brand gains an invented product.

## Failure modes, and what each one does

- A row the importer blocks is refused, with the importer's own reasons.
- A row priced in anything but USD is refused, naming the catalogue's limit.
- A row whose source reference is not an http(s) URL is refused: an offer needs
  a URL.
- A preview file that does not parse, collides with the real catalogue, or makes
  the merged catalogue invalid causes **the whole overlay** to be refused, with
  the reasons on stderr, and the storefront serves the real catalogue unchanged.
  A partial overlay would be a silent edit; a thrown error would take the site
  down over an operator's scratch file.

## What this does not do

No deployment, no publication, no external account, no network call, no paid
model call, no change to ranking weights, no change to any existing category,
and no change to `catalog/`.
