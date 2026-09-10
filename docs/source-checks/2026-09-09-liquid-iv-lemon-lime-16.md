# Liquid I.V. Hydration Multiplier, Lemon Lime, 16 pack: manufacturer page reading

| | |
| --- | --- |
| Product | `liquid-iv-hydration-multiplier-16` |
| Page | https://www.liquid-iv.com/products/lemon-lime-hydration-multiplier |
| Read on | 2026-09-09, at 16:23 Pacific |
| Read by | Codex, using its own web tool, and supplied to this repository |
| Read by this repository | No. Nothing here fetched anything. |

## What the page stated

16 sticks at $24.99 one-time, with a subscription price of $17.49 at 30% off
shown separately, and $1.56 a stick displayed beside the pack price. Gluten
free and non-GMO as label claims.

The nutrition and ingredient table was not exposed in the page as retrieved.

## What was recorded

- **Price $24.99**, read. The amount already on the record was $24.99, carried
  as a placeholder. The number has not changed; what it is worth has.
- **Subscription 30%**, read, a field this record did not have. The flag itself
  was a placeholder and is now read.
- **Price per serving 156, stated rather than derived.** The page displays
  $1.56 a stick, so the figure stands on the maker's own statement and no
  longer follows the shown price. Its full history is in the note: 156 when it
  was $24.99 divided by 16 and that $24.99 was a placeholder, then 175 when an
  Amazon amount became the shown price, and 156 again now, from the maker
  rather than from arithmetic.
- **Gluten free and non-GMO**, as the maker's label claims. Vegan stays on the
  record, still cited to the earlier search summary, because it was not part of
  this reading and this reading cannot speak to it.

## What was not recorded

**Any nutrition figure.** Sugar, calories, sodium, potassium, serving size,
sweeteners and format are unchanged and still cited to the 2026-09-08 search
summary, still marked relayed. The reading did not reach the nutrition table,
so nothing here was promoted to read.

This record does not say the page lacks a nutrition table. It says this
retrieval did not expose one. Those are different claims, and only the reader
can make the first.

**Stock, images, health claims.** None verified.

## The Amazon row, and why preferring the direct offer was not the fix

The record carried a second offer: Amazon at $27.99, marked non-prototype, with
a source note reading "Amazon price reported at $27.99 for a variety pack".

A variety pack is a different product. This record is a 16-stick Lemon Lime
box. That $27.99 was the shown price of this product, because it was the only
amount on the record not marked as prototype data, and the per-serving cost was
computed from it and shown as $1.75.

Nothing was hidden. The note said "variety pack" and the site priced on it
anyway, because no mechanism read the note.

**What was done.** The `disputed` marker, which already exists for attribute
values, now exists on offers and means the same thing: the row stays visible
with its note, and nothing prices, ranks or counts on it. The Amazon row is
marked disputed, keeps its $27.99 and its history, and renders on the page as
"Not this product" with a sentence saying the amount is not used and why.

**Why preferring the direct offer would not have been enough.** The direct
offer only happened to be the right one here. A rule that prefers it would
still price on a mismatched amount whenever the mismatched one is direct, and
would still count a mismatched retailer in "lowest of 2 retailers". The rule
has to be that a mismatched amount prices nothing, wherever it sits and
whatever it costs. Four regressions cover that, including the case where the
mismatched offer is the cheapest real amount on the record, and the case where
it loses to a placeholder because a placeholder is at least this product's
placeholder.

No Amazon page was fetched, then or now.

## What it changed in the rankings

| | before | after |
| --- | --- | --- |
| Shown price | $27.99, an amount for a variety pack | $24.99, read |
| Retailers counted | 2 | 1 |
| Price per serving | $1.75, derived | $1.56, stated |
| Label score | 1.4 | 13.9 |

The score moved because the subscription flag stopped being a placeholder and
started counting, which is that criterion's half-weight, or 12.5 points of the
weighted total. Nothing else in the product changed.

No badge moved. It is still last of the five eligible drinks: 11 g of sugar in
a category that scores sugar at double weight is the whole story, and a
corrected price does not change what is in the stick.
