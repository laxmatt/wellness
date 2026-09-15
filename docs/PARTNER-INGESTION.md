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

| Filter | Filled by | Models with a value |
| --- | --- | --- |
| Price | the mapped price column | 15 of 15 |
| Style | an approved rule over the retailer's model name | 9 of 15 |
| Seats up to | an approved rule over the retailer's model name | 15 of 15 |
| Heating | nothing | 0 of 15 |
| Connection | nothing | 0 of 15 |
| Placement | nothing | 0 of 15 |

That is the finding, not a gap in the tool. The feed carries 62 columns and 47
are empty in every row: no dimensions, no power, no capacity, no material. Not
one field states a specification.

Two things are readable anyway, and only because the retailer puts them in its
own model names as tokens: "The Sweat Cabin (4 Person)" names a shape and a
capacity. Approved rules read those, and every value they write keeps the
pattern, the profile version that approved it, the whole title it read, exactly
what matched, and who approved it. `validateCatalog` refuses a published record
carrying a derivation nobody approved, or one claiming a match its own source
text does not contain.

Heating type, connection and placement are read from nothing. Neither
"infrared" nor "traditional" appears in any title; "traditional" appears in
prose in 24 descriptions and prose is not read. Neither "indoor" nor "outdoor"
appears anywhere in the feed at all. Those three stay Not stated on every
record, and the chip bar draws no row for them.

## What this became

Saunas went live on 2026-09-14. Seventeen source records from this feed are
published, presented as fifteen models, under signed plan
`plan-4fd9b3d35fddbff4` (`docs/promotion-plans/`). The launch was made with
three things unresolved and recorded as unresolved: the feed images carry no
permission, the feed states no sauna specification, and five records already in
the catalogue were merged. The merge was exact: every mapped field of all five
agreed to the byte, and `scripts/promote-saunas.ts` stops rather than guessing
if that ever stops being true.

## Source records and comparable models

They are two numbers and the report shows both. This feed's 17 sauna pages
become 17 records and 15 things a shopper chooses between.

| | |
| --- | --- |
| Source records | 17 |
| Comparison families | 15 |

Sweat Kingdom sells The Sweat Cabin on one page and the same cabin in a
blackout finish on another, and the same for The Sweat Pod. Both pages are
real, both are kept, and each keeps its own price (the blackout cabin is
$9,245 against $7,445), its own stock, its own pictures, its own issued Awin
link and its own provenance. What changes is what a comparison table offers: a
shopper choosing a four-person cabin is not choosing between it and its own
paint.

The relationship is a pair of record ids and a sentence, written by a person in
the mapping profile, versioned with it and approved with it:

```
member:  sweat-kingdom-the-sweat-cabin-blackout-edition
family:  sweat-kingdom-the-sweat-cabin
because: "The Sweat Cabin (4 Person) - Blackout Edition" is the same cabin in a
         blackout finish. A shopper choosing a four-person cabin is not
         choosing between it and its own paint.
```

**No title matching, and no global rule.** A pattern catching "Blackout
Edition" would fold two genuinely different saunas together the day their names
happened to agree, and nothing would show that it had. Two lines of
configuration are cheaper than a rule nobody can audit.

Four things are refused, three of them without the file:

- a record given as a configuration of itself
- one record in two families
- a chain, where a representative is itself a configuration of something else
- a rule naming a record this file does not produce

Refusing chains is what refuses cycles: a cycle is a chain that closes, so a
rule set with no chain cannot hold one, and there is no graph to walk looking
for something a walk might miss. `validateCatalog` applies the same four checks
to any catalogue, whatever path put the records there.

A grouping added by a later approved profile version reaches the records on the
next import, because it is merged like any other field: the record still says
what the last import wrote, so the newer value is written.

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

## Promotion review (dry run)

The last step in the tool, and it promotes nothing. It works out what moving
some drafts into `catalog/` would do, shows it, and lets a reviewer sign the
decision. No file in `catalog/` is written by any of it, and there is no
command in this project that carries a signed plan out. The button that would
is present and disabled, because a button quietly missing reads as an
oversight.

**Families are the unit of selection.** The picker offers the 15 comparison
families. A configuration has no checkbox of its own: promoting "The Sweat
Cabin in blackout" without the cabin it is a finish of would put a record on
the site whose own family is not there, which reads as a model in its own
right. Passing a member's id to the planner directly is refused by name, and
the refusal says which family to select instead.

For every record in a selected family the review shows its price and the date
that price was checked, its availability, its image and what is known about the
right to publish it, the issued affiliate link, its provenance, anything
changed here since the last import, any open conflict, and which of the
category's high-level comparison fields it fills. On this feed that last line
reads: price present, heating, connection, placement, capacity and capacity
label missing.

**A picture needs a permission.** The default is unresolved and unresolved
blocks signing. A feed carrying an image is not a grant: nothing in the file
says who owns the photograph or what an affiliate may do with it. The only
thing that clears it is somebody recording what they read, what it rests on,
and which picture it covers. A partner replacing the photograph behind the URL
supersedes the permission and the blocker comes back.

**A collision needs an answer.** Five Sweat Kingdom ids are in `catalog/`
already, built by hand through the partner adapter before this flow existed.
Each selected one has to be answered: keep the catalogue record, replace it
with the draft, or merge field by field. The default is unresolved, nothing is
chosen for anybody, and the exact field-by-field difference is shown behind
each choice with what that choice gives up. A merge has to name every field the
two disagree on; a merge with unnamed fields is a replace wearing a merge's
name. A field the mapping profile calls editorial is locked to the workspace
and is never offered to a merge.

**The whole hypothetical catalogue is validated.** The catalogue that would
exist afterwards, with the resolutions applied and the brands and merchants
that travel with the records, is run through `validateCatalog` and the family
integrity rules before a plan can be signed.

Signing writes one file into `ingestion/plans`, recording the reviewer, the
date, the source, the mapping version, the exact bytes of the upload by content
hash, the selected families and records, every shadow resolution and what it
gave up, the empty blocker list, and a plan identifier that is a hash of all of
it. The same decisions produce the same identifier; a plan edited on disk stops
naming itself and the tool says so. A signed plan is written once and nothing,
including the next import of the same feed, edits it. A later import can make a
plan out of date and the history says which plans still match the current file.
That is a thing a reader is told, not a thing done to the file.

### One action at a time

The tool runs one request at a time. Two in flight at once is not a race the
answers settle: each one ends by folding a reply into the page's state and
redrawing, so the second to arrive wins whatever the first was about, and a
redraw landing while somebody is filling in a form replaces the form under
them. Sends are chained, and every control is disabled while a request is
running.

The page says what it is doing in its own markup. An element carries
`data-state` (`busy` or `idle`), the command in flight, and `data-completed`, a
count of finished requests that only goes up and is incremented after the
answer is in the page's state and before the redraw. That is what a person
watching, or a check driving the page, should wait on. Waiting for an element
to appear proves nothing here: almost every element on this page exists before
an action and still exists after it.

## More than one partner

Four programmes are approved and three of them publish their own Shopify
catalogue at `/products.json`: the store's own product and variant ids, SKUs,
titles, product types, tags, prices, availability, images, handles and
timestamps. A Shopify adapter reads a snapshot of one into rows, one row per
variant, and everything downstream is the machinery the Awin feed already uses:
the profile groups variants on the product handle, the cheapest represents the
model, and ownership decides what a refresh may change.

**Fetching is a separate command, run by a person.** `npm run fetch:shopify --
<source>` pages through the store, writes one snapshot into `intake/shopify/`,
and is the only thing in this project that requests anything from a partner.
The admin tool cannot fetch: a loopback server that could be asked for an
arbitrary address is a proxy into whatever else that machine can see. A failed
run leaves the last good snapshot untouched, because pages land in a temporary
file and move into place only when every page has arrived.

**Inclusion is two-sided, and the first version was not.** The first real
Select Saunas preflight returned 786 rows, 737 product records and zero
exclusions. The rules leaned on `product_type not_contains "sauna"`, which
assumes a store files its non-saunas somewhere else. Select Saunas is a sauna
shop: a rain jacket, a floor kit and a tiki bar all sit under a sauna product
type, so nothing was excluded and the candidate set was the whole catalogue. A
store's own classification is evidence of which aisle a thing is in. It is not
evidence that the thing is a sauna.

So every rule now reads `classified_as`, the store's own title, product type
and tags joined into one field, and there are two sides:

1. **A blocklist of what a thing is**, in whole words: cold plunges, hot tubs,
   showers, red-light panels, buildings and outdoor furniture, heaters, parts,
   stones, accessories. Each class carries one reason and the classes are
   ordered most specific first, so the sentence a reviewer reads is the useful
   one.
2. **A requirement that something says sauna**, applied last. It is why the
   blocklist does not have to be exhaustive: the air tunnel, the tiki bar and
   the outdoor shower are all caught by it even with no rule naming them.

Words, not substrings. `contains_word` matches whole words, because a
substring rule for the tiki bar excludes every barrel sauna and a substring
rule for a floor kit loses every sauna sold as a kit. Nothing is stemmed: a
rule for "tubs" is written for "tubs", and the list writes both forms.

Some words are deliberately absent. "door", "window", "bench", "roof", "wall"
and "band" are each a part a store sells alone and a feature a complete sauna's
title brags about, and "Barrel Sauna with Glass Door" is a sauna. A word that
appears in both is not evidence, so it is not a rule.

Both sides fail in the same direction: they drop a real sauna before they keep
a bucket. A sauna wrongly excluded appears in the excluded table with the rule
that dropped it, where a person sees it. A bucket wrongly kept becomes a
product page.

No rule reads `body_text`, and no profile may: a merchant's marketing paragraph
mentions saunas on the page for a sauna cover.

**Filters come from the same evidence.** Heating, capacity, style, placement,
connection and voltage are read from the title and the classification, each by
one named pattern with a value map a person wrote, and each arrives unapproved
so the tool shows what it actually extracted first. Dimensions, amperage and
heater output are not mapped at all: a Shopify catalogue does not state them,
and a number read out of a marketing paragraph is how a cabin ends up filed as
240V because the page mentioned a 240V heater as an upgrade.

**Cross-partner matching reports and never merges.** A shared GTIN, or one
maker's part number under one brand, settles a match. A brand and a model that
agree exactly after lowercasing and dropping punctuation is a proposal for a
person. A name under two brands, or identifiers that contradict each other, is
a question. Nothing is matched on a title alone, nothing is scored for
similarity, and a merge keeps the incumbent record's name, description and
specifications while each partner contributes only its own offer.

**A link that is not tracked says so.** Three of the five programmes now have a
verified per-product transformation and their offers carry it. The other two do
not, and their offers say the arrangement exists and this link earns nothing.

## Six programmes, and what each one issued

`src/domain/affiliate/programmes.ts` holds every fact a person read in a
dashboard: the network, the rate, the referral link, the coupon, the referral
window, and any condition the partner's terms place on using them. Nothing
else in the repository restates an arrangement, and a source with no programme
behind it throws rather than defaults.

| Partner | Network | Rate | Issued | Catalogue |
| --- | --- | --- | --- | --- |
| Topture | GoAffPro | 2% | store link, `ref=MATTORR` | `/products.json` |
| Select Saunas | UpPromote | not read | store link, `sca_ref` | `/products.json` |
| Hooga | GoAffPro | 8% | store link, `ref=MATTORR` | `/products.json` |
| Therasage | Refersion | 10%, 30-day window | link with coupon `WELLNESSFITCHECK` | none |
| SAUNABOX | direct | 5% | tracking code `MATT41058` | none |
| Lifepro | unread | unread | nothing | refuses automated requests |

**One parameter, verified, on the merchant's own address.** Three dashboards
were opened and a real link generated for a real product, then compared against
the plain address. All three do the same thing:

| Partner | Plain | Verified link |
| --- | --- | --- |
| Select Saunas | `/products/dynamic-saunas-dyn-6106-01-barcelona-...` | same, `?sca_ref=12323351.NbtdIcjAoO` |
| Topture | `/products/thermasol-vue-sauna-cabin` | same, `?ref=MATTORR` |
| Hooga | `/products/sauna-series-floor-stand` | same, `?ref=MATTORR` |

So a `verified` route records a parameter and an origin, not a template. A
template with a slot for an address is the shape of a redirector, and a
redirector that accepts any address is an open redirect whether anybody meant
one or not. `tagUrl` in `src/domain/affiliate/tag.ts` is the only thing that
composes a link, and it refuses:

- any address whose origin is not the one recorded when the transformation was
  verified, so `https://evil.example/?u=https://topture.com/...`,
  `https://topture.com.evil.example/...` and `https://shop.topture.com/...`
  are all refused rather than tagged;
- any address carrying credentials, which is how
  `https://topture.com@evil.example/...` reads to a browser;
- anything that is not `https`, and anything that is not an address;
- any address already carrying the same parameter set to something else, because
  overwriting it takes a referral off whoever it belongs to.

What survives: the query string the address already had, and the fragment. A
Shopify variant address is `/products/x?variant=1011`, and dropping that
parameter would land a shopper on the wrong configuration of the right product.
Composing twice changes nothing.

An offer's link is the tagged one. Its provenance keeps the plain address,
because that is where the facts were read, not where a shopper is sent.

**A source has to say what makes its links pay.** `affiliate.status: "affiliate"`
is refused unless the source records either a `linkPrefix`, the prefix every
link a network issues starts with, which is how Sweat Kingdom's Awin deep links
work, or a verified `tag`. Both together is refused too: an issued deep link
already carries the tracking and belongs to the network's origin, which is
exactly the address a tag will not touch.

**A partner's terms are a blocker, not a footnote.** Therasage's terms say the
code is solely for social profiles and not for websites without express written
permission. This site is a website and holds no such permission, so nothing of
Therasage's goes on it: not the link, not the coupon. A disclosure does not
clear it and a verified link would not either, which is moot anyway because the
portal logged itself out during custom-link generation and no link came back.
`productLink()` refuses Therasage even when handed a verified route, because
the blocker is permission and not mechanics.

**Three approved partners have no catalogue to read**, recorded as such rather
than left out. Lifepro answers automated requests with 403
(`blocked_pending_authorized_export`). Therasage's Refersion portal has now
been read end to end and holds no feed and no export
(`portal_review_complete_no_bulk_feed`). SAUNABOX approved with a rate and a
code and sent no inventory (`approved_no_inventory_feed`).

**What is written down and what never is.** Referral links, programme
identifiers, tracking codes, coupons, rates and windows are public by
construction: every one of them travels in a link a shopper clicks. Usernames,
passwords, session cookies, bearer tokens, API keys and one-time account links
are not recorded anywhere. A programme's complete-signup link is one of those;
SAUNABOX sent one and the repository records its existence and not its value.
`secretsIn()` checks the identifier and address fields of every programme, the
seed refuses to write when it finds anything, and it deliberately leaves prose
alone so a note can say a portal needs a login without being refused for
saying so.

## A suggested mapping has to name the required fields

The same preflight failed all 737 records on `columns.description`. That was
not the seeded profile, which maps it. It was the suggester: the list of
headings this project matches against had never been shown a Shopify
catalogue, so `body_text`, `image_src` and `available` matched nothing and a
person got a mapping with no description, no image and no stock, and one error
naming a field with no hint of which column it should have been.

Those names are in the list now. The suggester still matches exactly and never
by resemblance: `body_text` is in the list, `body_txt` is not, and a tool that
guessed the second would be right often enough that nobody would check it.

Re-running the seed also no longer says "already here" and leaves a stale
mapping in place. When the seeded rules differ from the latest version, it
writes the next version, unapproved, beside the old one. Nothing is edited and
nothing approved is touched.

## How big a file may be

Two questions, and treating them as one is what refused the first real
catalogue.

**How big a file of this format may be.** Each adapter states its own ceiling,
because the formats are not the same size of thing. A partner's CSV is a table
of prices: 1,000 kB, unchanged. A Shopify snapshot is every marketing page in a
store, and `body_html` is most of its bytes. Select Saunas' real catalogue is
737 products in 6,333 kB, which is 8.6 kB a product; `BYTES_PER_PRODUCT` is
12 kB, and every bound is derived from it. The adapter reads up to 5,000
products, so 60 MB.

**How big a file may be to travel through a browser.** A different question. An
uploaded file goes as a string inside a JSON command, and the server holds the
chunks, the joined body, the parsed text and the built table at once. That
ceiling is 12 MB: a thousand products at the measured rate, which is almost
twice the largest real partner catalogue. The transport sizes itself from the
largest format's ceiling plus 1.5x for JSON escaping, measured at 1.2x on a
quote-dense catalogue.

**Past that, the file does not travel.** `npm run fetch:shopify` has already
written it to `intake/shopify/`, atomically. The tool offers it beside the
partner it belongs to and reads it on this machine. The page sends a partner id
and the server composes the path inside one fixed directory, after checking the
id is a name rather than a route to one: `nested/secret` resolves to a real
file inside that directory and would pass a containment check alone, which is
why the id is validated before it is joined to anything. `SNAPSHOT_DIR` can
move the directory for a test and is refused if it points outside the project.

Both routes meet the same rules afterwards. The credential scan runs before a
byte is written, the upload is written beside itself and renamed into place so
a file named after its own hash is never half of one, and a failed read leaves
the last good snapshot exactly where it was.

## What it will not do

- Write to `catalog/` from the tool. The one thing that does is
  `scripts/promote-saunas.ts`, run by hand, from a signed plan, and it refuses
  a plan that does not hash to its own name or that was signed against a
  different file.
- Read a format with no adapter. CSV, TSV and a Shopify snapshot are read;
  XLSX, XML and an API are named so an upload is refused by name, with the
  reason, instead of being mis-parsed.
- Accept a path. The snapshot route takes a partner id, checks it is a name
  and not a route to one, and composes the file itself inside one fixed
  directory. There is no command anywhere that reads a path from a request.
- Store a credential. There is no field for a retrieval URL, and an upload
  whose bytes look like they carry a key, a signature or an authorization
  header is refused rather than saved. The Awin feed is downloaded from an
  address carrying an API key; that address is recorded nowhere in this
  repository.
- Compose anything but a verified parameter onto a merchant's own address. A
  row whose link does not start with the prefix the source states is refused,
  and an address whose origin is not the merchant's is never tagged, so no
  composed link can point off the merchant's site.
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
- **Carrying a plan out is a separate command.** `executePlan` reads a signed
  plan and writes the records it names into `catalog/`. It refuses a plan whose
  contents no longer hash to its identifier, a workspace that has been
  re-imported since the signature, a record the plan did not name, and any
  result that would not validate as a catalogue. It is not in the tool's UI.
- **Image rights are recorded, not verified.** The tool holds what a person
  wrote down and checks that it names the picture the record carries. It does
  not read the partner's terms and cannot tell a careful reading from a
  careless one.
- **A shadow merge is field-level, not word-level.** A reviewer takes a whole
  description from one side or the other; there is no way to take half of one.
- **Image rights can be accepted rather than resolved, and only by the owner.**
  `image_rights` is the one blocker a written, attributed acceptance can move
  out of the way. It is not deleted: it is recorded in the signed plan and
  stamped onto the provenance of every record it covers, which goes on saying
  that no permission has been established. Saunas launched on 2026-09-14 under
  such an acceptance.
- **Shadowing is reported, not resolved.** Five Sweat Kingdom records already
  exist in `catalog/`, imported by hand through
  `src/domain/intake/awin-sweat-kingdom.ts`. The report marks a workspace draft
  that shares an id with one of them. Which of the two is right is a question
  for whoever builds promotion.
