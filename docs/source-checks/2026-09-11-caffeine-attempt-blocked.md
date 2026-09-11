# Wellness drinks caffeine: reading attempted from this repository, and blocked

| | |
| --- | --- |
| Attempted on | 2026-09-11 |
| Attempted by | This repository's container, under explicit authorisation to read primary sources for this batch |
| Result | Every manufacturer domain refused at the network egress proxy. No page was read. |
| Catalogue changes | None. No caffeine figure was added, changed or removed. |

## What was tried, and what came back

Two independent paths, both refused at the domain level.

`curl` through the container's proxy returns a refused tunnel before any
request is sent:

```
> CONNECT drinkolipop.com:443 HTTP/1.1
< HTTP/1.1 403 Forbidden
* CONNECT tunnel failed, response 403
```

The fetch tool returns the same refusal as a typed error:

```
{"error_type":"EGRESS_BLOCKED","domain":"drinkolipop.com",
 "message":"Access to drinkolipop.com is blocked by the network egress proxy."}
```

Refused: `drinkolipop.com`, `drinklmnt.com`, `www.curehydration.com`,
`www.liquid-iv.com`, `drinkag1.com`. The block is per domain, not per path: a
second path on an already-refused domain is refused identically.

Web search does work from here. It is not a reading and nothing from it has
been recorded. Search summaries are the evidence class this catalogue already
holds for AG1, Celsius and LMNT, and promoting one would be moving backwards.
Its only use here was finding the exact URLs below.

## What search found that changes where to look

The product pages are not where these brands state caffeine. Three of the five
publish a page about caffeine specifically, and none of them has been read.

Two summaries are worth naming precisely because they are traps, and both are
the cross-formula transfer this batch is meant to avoid:

- A Cure summary gives 100 mg. It belongs to Cure's **Energy** line, not to the
  Lemonade stick pack on our record.
- An AG1 summary gives 100 mg. It belongs to **AG1 Energy+**, a different
  product from the greens powder pouch on our record.

Neither figure may go anywhere near these records. They are listed here so the
next reading does not rediscover them and mistake them for the answer.

## Exact URLs to read, and the exact question for each

The question is the same every time, and it is narrow: **what does this page
literally state about caffeine, for this exact product or flavour?** A page that
does not mention caffeine still answers nothing. Silence is not a zero.

### 1. OLIPOP Classic Root Beer (`olipop-root-beer-12`)

- https://drinkolipop.com/blogs/digest/does-olipop-have-caffeine
- https://drinkolipop.com/pages/faq
- https://drinkolipop.com/products/classic-root-beer (read 2026-09-09; no
  caffeine figure reached, which is not the same as the page stating none)

The first is a brand-published page whose whole subject is caffeine, and it has
never been read. It is the most likely to settle this record. The needed detail
is whether it names **Classic Root Beer** specifically, by name, rather than
listing which flavours do contain caffeine and leaving the rest implied.

### 2. Cure Hydration Lemonade, 14 pack (`cure-hydration-lemonade-14`)

- https://www.curehydration.com/pages/faq
- https://www.curehydration.com/products/lemonade (read 2026-09-09; states no
  caffeine figure)

The FAQ has not been read. Needed: whether it states anything about caffeine in
the hydration line as distinct from the Energy line, naming the line or flavour.

### 3. Liquid I.V. Hydration Multiplier, Lemon Lime, 16 pack (`liquid-iv-hydration-multiplier-16`)

- https://www.liquid-iv.com/pages/faq
- https://www.liquid-iv.com/products/lemon-lime-hydration-multiplier (read
  2026-09-09; the nutrition and ingredient table was not exposed in the page as
  retrieved)

This is the weakest of the four. Its caffeine field cites `kind: "editorial"`
with no manufacturer URL at all, so there is nothing to re-read: a first
manufacturer citation is needed, not a better one. The product page's nutrition
table has never been reached; the FAQ has never been read.

Liquid I.V. now sells an **Energy Multiplier** line that does contain caffeine.
Any figure found must be tied to Hydration Multiplier, Lemon Lime, or it is the
wrong product.

### 4. AG1 greens powder pouch, 30 servings (`ag1-pouch-30`)

- https://drinkag1.com/about-ag1/faq
- https://drinkag1.com/ingredients/ag1-nextgen-formula
- https://drinkag1.com/products/greens-powder-pouch (never fetched directly;
  the record is a 2026-09-08 search summary)

The record already holds the brand's own position: no added caffeine, trace
caffeine from green tea extract, no amount on the label. If the FAQ or the
ingredient page states an amount, or states plainly that there is none, this
closes. If it repeats "trace, no amount", the field stays `not_stated` and that
is the correct outcome, permanently.

**AG1 Energy+ is a different product and its 100 mg is not this record's.**

### 5. LMNT Citrus Salt, 30 stick packs (`lmnt-citrus-salt-30`) — not one of the four, and the most urgent

- https://drinklmnt.com/pages/ingredients
- https://drinklmnt.com/pages/faq
- https://drinklmnt.com/products/lmnt-recharge-electrolyte-drink (read
  2026-09-09)

See the finding below. This record is not unknown; it is a zero resting on a
search summary, and it is the only product the caffeine-free filter admits.

## Two defects found without reading anything

### The only caffeine-free answer rests on a search summary

`lmnt-citrus-salt-30` carries `caffeine_mg: 0`, `manufacturer_reported`, cited
to `drinklmnt.com` with `method: "secondhand"` and the note "Relayed via search
summary; manufacturer page not fetched directly." It dates from 2026-09-08.

That page **was** read directly on 2026-09-09. The reading deliberately did not
touch caffeine, and said why: the only caffeine figure on the page is 50 mg and
belongs to Lemonade Iced Tea, a different flavour. So the one direct reading of
the one cited page found no caffeine figure for this flavour, and the record's
zero still stands on the summary that preceded it.

This is the site's single positive caffeine answer. Every "Caffeine free" match
a shopper sees is this record. It is the weakest evidence class the site
otherwise refuses, and it has been contradicted by nothing and confirmed by
nothing.

Not changed here. Withdrawing a zero is as much a data decision as adding one,
and this one is Codex's to take with the ingredients page in hand.

### The only caffeinated answer cites a retail listing as the maker

`celsius-sparkling-orange-12` carries `caffeine_mg: 200`, `manufacturer_reported`,
`kind: "manufacturer"`, cited to `https://www.amazon.com/dp/B007R8XGJA`.

An Amazon listing is not the manufacturer speaking. This engagement has already
made that correction once, for an Edge claim that came from a Shop listing.

It is not confined to caffeine. Five fields on this product do the same thing:
`serving_size`, `sugar_g`, `calories`, `caffeine_mg` and `dietary` all declare
`kind: "manufacturer"` against that one Amazon URL, all `method: "secondhand"`.
Celsius has no source-check file at all; it is the only wellness drink that has
never been read.

Not changed here. Correcting the kind would likely move the verification too,
which would withhold five fields and change what the site shows, including the
one product the caffeine filter rules out. That is a product decision on a whole
record, not a caffeine fix, and it needs the reading Celsius has never had:
https://www.celsius.com/ product page for Sparkling Orange, 12 pack.

## What this batch changed

Nothing in the catalogue. Four records stay `not_stated`, which is the correct
state until a page is read, and the two records that are not unknown are
reported above rather than adjusted on a guess.

`src/__tests__/caffeine-evidence.test.ts` holds the rules rather than the
current values: a `not_stated` field may never carry a number, every unusable
record must say why in words that cannot be read as a finding of zero, no two
products may cite one page for caffeine, the filter admits exactly the drinks
whose own record states a usable zero, and a drink with no usable figure is
neither cleared nor convicted. Closing a gap strengthens these; it does not
break them.
