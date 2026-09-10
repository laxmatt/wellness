# Product images: what is established, for six representative products

Two products per category, all six from brands that already carry a source
check. Compiled 2026-09-10.

**Nothing in this file is permission.** A public image is not a licence, and an
absence of terms is not consent. Where a column reads "not established", that
is the finding, not a gap to be filled by assumption.

## The block, recorded rather than worked around

This repository's container cannot reach any of these sites. Every brand host
was tried on 2026-09-10 and every one was refused at the proxy:

```
curl: (56) CONNECT tunnel failed, response 403
```

`hoogahealth.com`, `mitoredlight.com`, `www.renutherapy.com`, `icebarrel.com`,
`drinklmnt.com`, `drinkag1.com`: six attempts, six identical refusals. The
proxy's own status endpoint reports `connect_rejected`, "gateway answered 403
to CONNECT (policy denial or upstream failure)".

So **no press, media or affiliate resource page was read for this file**, and
none is claimed to exist. Whether a given brand publishes one is an open
question below, not a negative finding. The one set of terms recorded here was
read by Codex, on a date, and is attributed.

## The matrix

| Product | Asset today | Asset identity risk | Reuse terms | Source for those terms |
| --- | --- | --- | --- | --- |
| Hooga PRO1500 (`hooga-pro1500`) | `hooga-pro1500-primary`, procedural placeholder, no licence field | **Known problem.** The product gallery carries images labelled PRO4500 on the PRO1500 listing | **No reuse licence.** Terms carry no affirmative licence; section 2 requires express written permission before copying | `hoogahealth.com/policies/terms-of-service`, read by Codex 2026-09-09 ~12:40 Pacific, recorded in `docs/source-checks/2026-09-09-hooga-pro1500.md` |
| Mito MitoPRO 1500+ (`mito-mitopro-1500-plus`) | placeholder, no licence field | Series page sells 300+, 1500+, 1500X and bundles; an asset would have to be tied to the `?variant=32084839432292` column | Not established | None read |
| Renu Cold Stoic 2.0 (`renu-cold-stoic-2`) | two placeholders (primary and lifestyle), no licence field | Single product page; configuration options (Redwood/Cedar, light) change appearance | Not established | None read |
| Ice Barrel 500 (`ice-barrel-500`) | placeholder, no licence field | Product page read 2026-09-09; the sibling 400's URL redirects, so asset provenance must be per-model | Not established | None read |
| LMNT Citrus Salt 30 (`lmnt-citrus-salt-30`) | placeholder, no licence field | Product page carries photographs; flavour and pack size must match the record | Not established. The source check states plainly that no right was established and none was taken | `docs/source-checks/2026-09-09-lmnt-citrus-salt-30.md` |
| AG1 Next Gen Original 30 (`ag1-pouch-30`) | placeholder, no licence field | Page is explicitly Next Gen Original; Citrus and Berry are separate products with their own packaging | Not established | None read |

Every one of the six carries `kind: demo_placeholder` and no `license` field.
The catalogue has a place to record a licence and not one product uses it.

## What each source check already says

Five of the six say some version of "images: not verified". Two say more:

- **Hooga PRO1500** is the only product in this catalogue where reuse terms
  have actually been read, and the answer was no: express written permission
  required. It is also the only one with a documented asset-identity fault,
  PRO4500 images on a PRO1500 page, which means that even with permission the
  assets on that page could not be used without checking which product each
  one depicts.
- **LMNT** records that the page has photographs, that no right was
  established, and that none was taken.

## Open questions, six products, one shape

For each brand, the same four questions, none answered here:

1. Does the brand publish a press, media or affiliate asset page at all?
2. If so, what does it permit: editorial use, comparison use, resale contexts?
3. What does it require: attribution, unmodified assets, prior approval, an
   affiliate relationship?
4. Which asset depicts the exact product on our record, given that four of the
   six sit on pages selling several variants?

Question 4 is the one that survives even a permissive answer to 1 through 3,
and it is the one this repository is already equipped to be strict about: the
same rule that keeps a 1500X figure off a 1500+ record applies to a photograph
of it.

## Next steps, in order

1. **Read the six brands' terms and any asset page**, the way every product
   reading has been done: by somebody whose environment can reach them, with
   the URL, the date and the exact wording recorded. Hooga is done and the
   answer was no. Five remain.
2. **Record the finding per brand in the catalogue**, not just in a document.
   The `license` field on an image exists and is unused; a brand-level note of
   "terms read on this date, reuse not permitted" is worth as much as a
   permissive one.
3. **Where terms permit reuse, tie the asset to the product** before using it:
   file name, page, variant, and what the page says it depicts. Four of these
   six sit on multi-variant pages.
4. **Where terms require permission**, that is an approach to a company, which
   is the owner's to make. Nothing here proposes or prepares one.
5. **Consider the alternative that needs no permission**: photographs of
   products somebody owns. That is the only path in this list with no legal
   dependency on a third party, and it does not scale to 20 products.

## What this file does not do

No account was created, no form submitted, no message sent, no asset
downloaded, and no page fetched. Six connection attempts were made and all six
were refused; that refusal is the evidence recorded above.
