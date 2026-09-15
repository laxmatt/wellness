# Launch-blocking configuration conflicts, in priority order

Five open items. None is a missing figure: each is a record that cannot say
which product, configuration or price it describes. No speculative edit has been
made to any of them, and none should be.

Priority is by what a shopper would be misled about, worst first.

---

## 1. Plunge Original: the record describes two different tubs and one dead price

**Why first.** Every problem on this product is the same problem, and it touches
price, plumbing and sanitation at once. It is a Best Premium candidate in its
category, so the identity question decides a badge.

The maker sells the Original in more than one configuration, cold-only and with
a heater, and the page read on 2026-09-09 describes a reimagined Original with a
Pro Chiller Gen2. The 2026-09-08 material the record was built from named no
generation at all. So three attributes are marked disputed and withheld, and one
is deliberately blank:

| Field | State |
| --- | --- |
| `plumbing` = dedicated_circuit | disputed, withheld |
| `sanitation_system` = true | disputed, withheld |
| `sanitation_methods` = ozone | disputed, withheld |
| `heating` | `not_stated`, with a note saying the configuration was not resolved |

The offer is disputed too: $6,990 relayed, against $6,790 on the page read on
2026-09-09. The product currently shows no price at all, which is the correct
behaviour and not a fix.

**Read:** https://plunge.com/products/plunge, and the variant behind the Cold
Only option. `2026-09-11-plunge-edge-reach-attempt.md` sets out where a Shopify
store publishes that identifier and the alignment prepared against it, including
the three disputed rows a variant id does **not** settle.

**The question:** which configuration this record is, named by the maker's own
words, and what that configuration's price, plumbing, sanitation and heating
are. A generation or model name is the thing to capture; the figures follow it.

---

## 2. Edge Tub Elite: a listing says the brand is gone, and it holds a badge

**Why second.** This record holds **Best Premium in Cold Plunges at 44.4**. If
the brand is out of business, the site is recommending a product nobody can buy,
which is worse than any wrong figure on it.

A Shop listing read on 2026-09-09 states the brand is no longer in business.
That is a listing, not the maker, so the offer is neither removed nor marked
dead, and availability stays `unknown`. The $5,490 is relayed and has never been
re-checked. Four of its attributes are prototype values.

**Read:** the site root first, not the product URL, which returned an internal
error on 2026-09-11. `2026-09-11-plunge-edge-reach-attempt.md` lists the three
things that would settle closure and why one error on one page is not one of
them.

**The question:** does the maker's own site still sell this. A site that no
longer resolves, or a store with nothing purchasable, is evidence. A Shop
listing repeating a rumour is not.

**If it is gone:** the badge moves. The handoff already traces where, and the
outcome is acceptable either way. This is not a reason to delay the reading.

---

## 3. Infraredi Flex Max: the price on file belongs to a different model

**Why third.** The record prices the Flex Max at $1,249, and the note says
plainly that only the **Flex Max Plus** price was found. It is a demo value
standing in for a figure nobody has. `coverage` and `footprint` are prototype
too, and coverage is the heaviest scoring criterion in this category.

This product has **never had a source check of any kind**. Its own page returned
an internal error on 2026-09-11.

**Read:** https://infraredi.com/products/infraredi-flex-max, and the Flex Max
Plus page beside it, so the two models can be told apart rather than merged.

**The question:** which model this record is, and that model's own price,
coverage and footprint. Do not carry the Plus figure across; that is what the
current note exists to prevent.

---

## 4. The Cold Pod: two capacities, and the product name is one of them

**Why fourth.** It is a single field, but the field is in the product's name.
The record is the "88 Gallon" and its slug is `the-cold-pod-88-gallon`.

`water_capacity_gal` = 88 is relayed from an Amazon summary, and the maker's own
page for the standard USA model, read on 2026-09-09, states 85. The figure is
disputed and withheld, so the specification is blank while the product's own
name still says 88.

**Already read, twice, and it did not settle this.** The maker's primary page
was read on 2026-09-09 and again on 2026-09-11. Both times it describes the
**standard USA model at 85 gallons and $119.99**. That is a complete answer
about the model it describes and no answer at all about ours: an 85-gallon
Standard does not establish what an 88-gallon record is, whether an 88 exists,
or whether the Amazon listing renamed the same tub. Re-reading that page a third
time will return 85 again.

**Read instead:** a page that names an 88-gallon model, if the maker publishes
one, or the Amazon listing itself, `https://www.amazon.com/dp/B0CPKYNJ9Q`, which
is where the 88 came from and which has never been fetched. That listing was
tried once from this container on 2026-09-11 and the domain is refused at the
egress proxy; see `source-checks/2026-09-11-cold-pod-identity-bounded.md`, which
also assesses how the page reads today and proposes the one edit that would
close the remaining gap.

**The question:** whether 85 and 88 are two models or one figure stated two
ways. If they are two models, this record has to pick one and its name, slug and
offer follow. If one, the maker's page wins and the name is wrong.

---

## 5. Joovv Solo 3.0: which mounting the offer includes

**Why last.** It affects one filterable field and no badge, and the record
already says the right thing.

The maker's buyer guide, read on 2026-09-11, names a Boot Floor stand, a Door
mount and a Nano Wall mount as options for the Solo. It does not say which the
priced unit includes. `mounting` stays absent, with a note explaining that this
is a configuration question rather than an unpublished figure.

**Read:** https://joovv.com/products/joovv-solo-3-0, specifically its purchase
options rather than the guide.

**The question:** what a Solo 3.0 at this price ships with. Recording all three
options would claim the panel arrives with every one of them.

---

## What these five have in common

Every one is a record that cannot name its own subject: which configuration,
which model, which generation, which bundle. None of them is short of numbers,
and reading harder for numbers will not fix any of them. The thing to capture in
each reading is the identity first. Once a record knows what it is, its figures
are a matter of copying.

Three of the five currently show the correct honest behaviour on the site: the
Plunge has no price, the Cold Pod has no capacity, and the Joovv has no
mounting. The two that do not are Edge, which shows a relayed price for a
brand a listing says is gone, and Infraredi, which shows a placeholder price
borrowed from another model.
