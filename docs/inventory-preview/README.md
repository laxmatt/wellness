# Admin inventory: supplier file to storefront, on one machine

Upload a supplier CSV in a browser, read what it says row by row, edit the
drafts, approve the ones you want, and watch them appear in the storefront
running on your own machine. Hide them and they leave it again. Remove them and
they are gone.

`PLAN.md` beside this file is the plan the persistence layer was built from.

## The one command

```
WELLNESS_PREVIEW_INVENTORY=1 npm run inventory:review
```

That starts two things on loopback and stops them together:

- the inventory tool at `http://127.0.0.1:4319`
- the storefront at `http://127.0.0.1:3000`

Then, in the tool: say who supplied the file, pick
`docs/import-demo/samples/supplier-a-northwind-SYNTHETIC.csv`, read the rows,
press **Stage 5 drafts**, edit one, press **Approve**, and reload the
storefront. Nothing restarts.

Try `supplier-b-contoso-SYNTHETIC.csv` to see refusals: a price in EUR against a
catalogue that stores USD, a category this site does not compare, a cell that
starts like a spreadsheet formula, sugar in ounces, a pack of sticks nobody has
said is a pack of servings. Every row is refused and nothing is written.

The same operations exist on the command line (`npm run inventory -- ...`);
`--help` is the default output. Both drive the same code.

## Refresh: what reaches a running site, and what does not

**In development mode, an approval reaches the pages the running server is
already serving.** The catalogue is built once and kept, except where the
preview catalogue is allowed: there its contents are signed on every read and
the catalogue is rebuilt when that signature changes. A development server
renders each request, so the next reload of the category page, the product page
or a comparison shows the change. `e2e/inventory-admin.mts` proves this by
reading the storefront over HTTP after each button press.

**A production build is a snapshot.** `next build` renders the category and
product pages once. A record approved afterwards does not appear on the category
page, and a record hidden afterwards is still listed there with a link that now
leads nowhere. Nothing is broken; the pages are simply from before the change.
If you want to review a production build, rebuild after you approve.

`npm run inventory:review` exists so this is not something to remember: it runs
the storefront in development mode, bound to loopback, beside the tool.

## What the tool refuses

It listens on `127.0.0.1` and the address is not configurable. That alone is not
enough, because a page you visit in the same browser can reach `127.0.0.1`, and a
name an attacker controls can be pointed at it. So, in
`src/domain/inventory/local-request.ts`:

- A request addressed to any name but `127.0.0.1:<port>`, `localhost:<port>` or
  `[::1]:<port>` is refused. That is the rebinding case.
- A change needs an `Origin` that is this server, a JSON content type, and a
  header no form can set. A cross-origin form post can set neither header; a
  cross-origin `fetch` that sets them is preflighted, and no `OPTIONS` is
  answered and no `Access-Control-*` header is ever sent.
- Nothing but GET, HEAD and POST is a method here.
- Every response carries `frame-ancestors 'none'`, `form-action 'none'`,
  `X-Frame-Options: DENY`, `no-store` and `noindex`.

**This is not authentication and is not offered as any.** Anybody with a shell on
this machine can run the same commands. It is the set of checks that makes a
local tool safe to leave running on a machine you also browse the web on. A tool
on a shared or public host needs accounts, and that work does not exist here.

It also refuses to start at all unless `WELLNESS_PREVIEW_INVENTORY=1` and nothing
about the process looks like a deployment.

## Where the records live

`catalog-preview/`, beside `catalog/` and with the same shape. It is not
committed. It is your working directory, and a record is a JSON file you can
open.

The preview catalogue only ever **adds**. A record may not take an id or a slug
the real catalogue already holds, and every preview id starts with `preview-`.
There is no path through this tool that edits, shadows or contradicts anything in
`catalog/`.

If anything in the preview catalogue is wrong, the whole overlay is refused, the
reasons are printed, and the site serves the real catalogue unchanged. Nothing
is dropped quietly and nothing breaks the storefront.

## What an approved sample is worth

Every figure staged from the file is recorded as demo data, sourced to the file
and the row. An empty cell in a mapped column is recorded as not stated. The tool
shows which of the two each figure is, on every record.

So an approved sample appears in the category, has a product page, can be
compared, and carries the link from its row, and **it answers no filter, ranks
last, and never reaches the assistant**. Press "Energy" and the invented energy
drink disappears.

**Editing a figure does not change that.** Type a different number and it is
still demo data; its note records that you changed it, from what, and when. A
figure becomes a fact when somebody records where it came from, and no importer
and no form can do that. The same rule governs the rest of the catalogue:
`isUsable` in `src/domain/provenance.ts`.

A typed figure gets the same reading as a cell in a file, by the same code. "1.5"
is not a count. A negative is not a nutrition figure. "12 cans" is twelve
servings only if you state that one can is one serving. `$` is not a currency.

The things the import demonstration lists as still open are still open.
`STANDING_REVIEW` in `src/domain/import/draft.ts` names them, and the tool prints
them at the bottom of the page: which product this is, which variant, who is
actually speaking, and what date the figures carry.

## Identity, and what is kept apart from what

- The supplier's code goes to `identifiers.merchantSkus` and to the offer. It is
  never the product id, which is derived from the brand and the name.
- The price becomes an offer at a named merchant, dated with the date you stated.
  It is never the product's own price.
- The brand and the supplier become their own `preview-` records, so no existing
  brand gains an invented product.
- The image is a placeholder. No right to any image is claimed.

## What it will not do

- Publish anywhere. "Published" means visible in the storefront running on this
  machine, and nothing else.
- Add a route to the Next app. A route exists in every build of the site and
  would need authentication this project does not have. This is a separate
  server somebody starts.
- Listen on anything but loopback, including the storefront it starts.
- Write the file you upload. It is read in memory; only records derived from it
  are written, and only under `catalog-preview/`.
- Write anything before the merged catalogue validates.
- Reach the network, open an address from a file, run a formula, or call a model.

## Still missing, and deliberately

**A production admin page.** Making this a page on the site means answering who
may sign in, how that is stored, how a session ends, and what an audit trail
looks like. `src/domain/admin-auth.ts` holds a single shared key for one
read-only endpoint and is not an answer to any of that. None of it is needed for
this workflow, which is why none of it was guessed at.

**Writing to the real catalogue.** Nothing here does. Moving a preview record
into `catalog/` is a person deciding a record is real, and it needs the evidence
questions answered first.

**Mapping files.** The command line reads a saved mapping with `--mapping`. The
page lets you change the mapping but does not save one yet.

## Checks

```
npx vitest run src/__tests__/inventory-stage.test.ts            # rows to records, and the rows refused
npx vitest run src/__tests__/inventory-admin.test.ts            # the request guards, and editing
npx vitest run src/__tests__/inventory-preview-catalog.test.ts  # the storefront, over the real catalogue
WELLNESS_PREVIEW_INVENTORY=1 npm run e2e:inventory              # the page and a running storefront, in a browser
npm run build                                                   # unchanged without the flag
```

The third suite is not stubbed: its base is the real `catalog/` directory, its
overlay is a real directory on disk written by the same code the tool writes
with, and it reads through `src/lib/queries.ts`, which is what every page uses.

The browser check starts both servers, drives the page, and reads the storefront
over HTTP after every change. It wants an empty `catalog-preview/` and empties it
again at the end, so it does not throw away work you staged.
