# Partner ingestion

A local tool that turns a partner's file into draft records, through a mapping
an administrator writes, sees the consequences of, and approves.

It was built against one real file: Sweat Kingdom's Awin feed, advertiser
125462, feed F3219, downloaded 2026-09-13, 225 rows. That file is in
`intake/sweat-kingdom/` and the tests read it, so what this document says about
coverage and grouping is measured rather than assumed.

## Running the walkthrough

```
npm run ingestion:seed
WELLNESS_INGESTION_ADMIN=1 npm run ingestion:server
```

Then open http://127.0.0.1:4321 and:

1. **Source.** Choose *Sweat Kingdom (Awin advertiser 125462, feed F3219)*. The
   seed wrote it and a first mapping, version 1, **unapproved**.
2. **File.** Upload `intake/sweat-kingdom/awin-125462-f3219-2026-09-13.csv`.
   Every one of the 62 columns is listed with how many rows fill it and the
   first few values.
3. **Mapping.** Press *Load v1 into the editor*. The offer's link is
   `aw_deep_link`, the tracking link Awin issued, not the plain merchant
   address beside it. Rows group on the path of `link`, which is the merchant's
   own product page: 225 rows share 38 pages.
4. **Check this mapping.** Nothing is written. The report says 17 records out
   of 225 rows, which rows were excluded and by which rule, what each of the
   category's five filters would be filled by, what could not be normalised,
   what the one extraction rule would produce, and what would happen to every
   record field by field.
5. **Approve.** Type a name and press *Approve v1*. Still nothing is written.
6. **Import drafts with v1.** 17 drafts land in `ingestion/drafts/products`.
   The site does not read that directory.
7. **Edit a listing.** Open *The Ascent*, change its name, save.
8. **Upload the same file again and import again.** The edited name survives,
   the report says `held_local` beside it and why, and nothing is duplicated.

`npm run e2e:ingestion` drives exactly that sequence in a browser against its
own workspace and removes it afterwards.

## What the report says about this feed

Measured on the real file, through the seeded mapping:

| Filter | Filled by | Records with a value |
| --- | --- | --- |
| Price | the mapped price column | 17 of 17 |
| Heating | nothing | 0 of 17 |
| Connection | nothing | 0 of 17 |
| Placement | nothing | 0 of 17 |
| Seats up to | an unapproved extraction rule | 0 of 17 |

That is the finding, not a gap in the tool. The feed carries 62 columns and 47
are empty in every row: no dimensions, no power, no capacity, no material.
Everything a shopper compares a sauna on is absent or inside prose. A record
built from this feed answers a price filter and nothing else, and the coverage
table says so before anybody imports rather than after somebody notices an
empty category page.

## The four decisions

Saving a mapping, approving it, importing drafts and publishing are separate,
and the code enforces the separation rather than describing it.

- A saved profile version is **written once**. Editing a mapping writes a new
  version; an import records which version built it.
- A version is **approved by its own command**, signed and dated. An import
  refuses an unapproved version.
- An import writes **drafts only**, into `ingestion/`, which the site does not
  read. That is stronger than a status flag: a draft in the catalogue is one
  query change away from being served.
- **There is no publish command.** Promoting a draft into `catalog/` is a
  separate decision and no code in this batch does it.

## Field ownership

Every mapped field has an owner, and a re-import decides what to do with three
values, not two: what the file says now, what the record says now, and what the
last import wrote.

- `feed` — the file wins, but only when the record still says what the last
  import wrote. If both moved, nothing is written and the field is queued as a
  **conflict**, and it stays queued until somebody changes one side.
- `editorial` — the record wins, always.
- `review_on_change` — the record wins. If the file moved since the last
  import, that is queued for a person.

Without the snapshot of the last import, a difference cannot be told from an
edit made here, so the merge queues rather than writes and says why.

Nothing is ever deleted. A record the file stops carrying is reported as
withdrawn and left alone.

## Extraction rules

A rule runs one pattern over one column and takes its single capture group. It
is shown with the text it ran over, exactly what it matched, whether it matched
the whole cell or found something inside prose, and whether anybody approved
it. **An unapproved rule is displayed and never written.**

The seeded profile carries one, reading a capacity out of the product title,
and leaves it unapproved on purpose. A number found in a marketing title is not
a specification, and the walkthrough is better for showing what that looks
like.

A proposed filter the category does not define is recorded in the profile and
applied by nothing. Changing what the site compares products on is a schema
change in a commit somebody reviews.

## What it will not do

- Publish, deploy, or write to `catalog/`.
- Read a format with no adapter. CSV and TSV are read; XLSX, XML, JSON and an
  API are named so an upload is refused by name, with the reason, instead of
  being mis-parsed.
- Store a credential. There is no field for a retrieval URL, and an upload
  whose bytes look like they carry a key, a signature or an authorization
  header is refused rather than saved. The Awin feed is downloaded from an
  address carrying an API key; that address is recorded nowhere in this
  repository.
- Compose a tracking link. A row whose link does not start with the prefix the
  source states is refused.
- Claim a right to an image. Images are recorded with no licence and a note
  saying a feed carrying one is not permission to publish it.
- Convert a currency, a unit, or a partner's vocabulary. A translation is a
  pair somebody typed into the profile's value map and can read back.
- Infer a fact from prose without a person approving the rule that read it.
- Listen anywhere but loopback, or start where anything says this is not a
  local machine.

## Known limitations

- **One format.** Only CSV and TSV are read. The adapter boundary exists so a
  second can be added without touching the mapping, the merge or the report,
  and it has not been exercised by a second format yet.
- **Attribute lists are not filled.** A category attribute of type `list` or
  `number_list` is refused with a reason. One cell to one list needs a stated
  separator and a stated vocabulary, and no partner file here has either.
- **Pattern cost is guarded, not bounded.** A pattern repeating an already
  repeating group is refused, which is the usual exponential shape.
  JavaScript gives a regular expression no time limit, so a determined pattern
  can still hang the tool. It is a local tool and the person who typed the
  pattern is the person it would hang.
- **One rule per attribute, one column per field.** Two sources for one value
  are two claims, and reconciling them is not modelled.
- **Quote-only listings are allowed per source, not per row.** A source that
  quotes is marked as such; a feed mixing priced and quoted rows would need a
  per-row rule.
- **Promotion is missing.** There is no way to move a draft from the workspace
  into the catalogue, by design for this batch. Somebody has to build it, with
  its own review step, before any of this reaches a page.
- **Shadowing is reported, not resolved.** Five Sweat Kingdom records already
  exist in `catalog/`, imported by hand through
  `src/domain/intake/awin-sweat-kingdom.ts`. The report marks a workspace draft
  that shares an id with one of them. Which of the two is right is a question
  for whoever builds promotion.
