# Live assistant test, 2026-09-09T05:37:13.925Z

Model: `gpt-4o-mini`. Credential mode: `proxy`. Ledger: `postgres`.

## Extraction

7 of 10 conversations matched the constraints a careful person would have entered.

| Category | Conversation | Result | Products shown |
| --- | --- | --- | --- |
| cold-plunge | 1. B1-cheapest-chiller | ok | 3 |
| wellness-drinks | 2. B2-decimal-per-serving | ok | 1 |
| wellness-drinks | 3. B3-repetition-a | ok | 1 |
| wellness-drinks | 4. B4-repetition-b | ok | 1 |
| red-light | 5. B5-least-expensive | ok | 8 |
| cold-plunge | 6. B6-smallest-plunge | nothing was said about what could not be filtered: this category has no size filter | 6 |
| wellness-drinks | 7. B7-less-than-decimal | ok | 3 |
| wellness-drinks | 8. B8-cents-no-dollar-sign | hard price_per_serving_minor lt 90 does not fit a constraint admitting at most 90 minor units | 0 |
| wellness-drinks | 9. B9-three-requirements | ok | 1 |
| wellness-drinks | 10. B10-two-hard-one-soft | missing hard function; missing soft price; unexpected soft price_per_serving_minor: the sentence did not ask for it and the case does not allow it | 1 |

## Cost

Measured spend for 10 conversations: **$0.0043**.

Observed cost per conversation: **$0.00043**.

A real conversation runs several turns. Multiply by expected turns per session before setting the cap.

## Replies, verbatim

Read these. No script judges whether the wording is right for the site.

**cold-plunge** | "The cheapest one that still has a chiller."

> I have read that as chiller included. Ranking for lower price. 3 of the 6 products in this category match.

**wellness-drinks** | "Something under $1.60 a serving that isn't a can."

> I have read that as price per serving under $1.60, format other than Ready to drink can. 1 of the 6 products in this category matches.

**wellness-drinks** | "Zero sugar electrolytes under $2 a serving"

> I have read that as price per serving under $2, function includes Electrolytes, zero total sugar. 1 of the 6 products in this category matches.

**wellness-drinks** | "Zero sugar electrolytes under $2 a serving"

> I have read that as price per serving under $2, function includes Electrolytes, zero total sugar. 1 of the 6 products in this category matches.

**red-light** | "Whichever red light panel is least expensive."

> Ranking for lower price. All 8 products in this category match.

**cold-plunge** | "The smallest cold plunge you have."

> Ranking for lower tub_type. All 6 products in this category match.

**wellness-drinks** | "Drinks that cost less than $2.25 per serving."

> I have read that as price per serving under $2.25. 3 of the 6 products in this category match.

**wellness-drinks** | "Nothing above 90 cents a serving."

> I have read that as price per serving under $0.90. No products match. This category has 6 products, and none of them meet every constraint, so one of them would have to be relaxed.

**wellness-drinks** | "No caffeine, no sugar, under $2 a serving."

> I have read that as zero caffeine, zero total sugar, price per serving under $2. 1 of the 6 products in this category matches.

**wellness-drinks** | "A greens powder with a subscription, ideally cheap."

> I have read that as powder, scoop format, subscription. Ranking for lower price_per_serving_minor. 1 of the 6 products in this category matches. I have not filtered by function.


## Every case, as it happened

Calls: **10** of a 10 ceiling. Allowance $0.03, spent $0.004260. Single turn each, no clarification answered, no retries.

### 1. B1-cheapest-chiller

> The cheapest one that still has a chiller.

Why it is here: 03:31 returned price lte 549000, the cheapest chiller tub's own price.

**Reply.** I have read that as chiller included. Ranking for lower price. 3 of the 6 products in this category match.


| | |
| --- | --- |
| hard | `[{"key":"chiller_included","op":"eq","value":true}]` |
| soft | `[{"key":"price","direction":"prefer_low","weight":1}]` |
| matched | `edge-tub-elite`, `plunge-original`, `renu-cold-stoic-2` |
| unconfirmed on price | none |
| cost | $0.000380 |
| result | ok |

### 2. B2-decimal-per-serving

> Something under $1.60 a serving that isn't a can.

Why it is here: 03:31 returned lt 16000, reading $1.60 as $160.

**Reply.** I have read that as price per serving under $1.60, format other than Ready to drink can. 1 of the 6 products in this category matches.


| | |
| --- | --- |
| hard | `[{"key":"price_per_serving_minor","op":"lt","value":160},{"key":"format","op":"neq","value":"rtd_can"}]` |
| soft | `[]` |
| matched | `lmnt-citrus-salt-30` |
| unconfirmed on price | `liquid-iv-hydration-multiplier-16` |
| cost | $0.000453 |
| result | ok |

### 3. B3-repetition-a

> Zero sugar electrolytes under $2 a serving

Why it is here: function 0 of 5 and sugar_g 2 of 5 across earlier samples.

**Reply.** I have read that as price per serving under $2, function includes Electrolytes, zero total sugar. 1 of the 6 products in this category matches.


| | |
| --- | --- |
| hard | `[{"key":"price_per_serving_minor","op":"lt","value":200},{"key":"function","op":"includes","value":"electrolytes"},{"key":"sugar_g","op":"eq","value":0}]` |
| soft | `[]` |
| matched | `lmnt-citrus-salt-30` |
| unconfirmed on price | none |
| cost | $0.000459 |
| result | ok |

### 4. B4-repetition-b

> Zero sugar electrolytes under $2 a serving

Why it is here: the same sentence again, in a separate session.

**Reply.** I have read that as price per serving under $2, function includes Electrolytes, zero total sugar. 1 of the 6 products in this category matches.


| | |
| --- | --- |
| hard | `[{"key":"price_per_serving_minor","op":"lt","value":200},{"key":"function","op":"includes","value":"electrolytes"},{"key":"sugar_g","op":"eq","value":0}]` |
| soft | `[]` |
| matched | `lmnt-citrus-salt-30` |
| unconfirmed on price | none |
| cost | $0.000459 |
| result | ok |

### 5. B5-least-expensive

> Whichever red light panel is least expensive.

Why it is here: a superlative with no amount, in wording the fix was not written against.

**Reply.** Ranking for lower price. All 8 products in this category match.


| | |
| --- | --- |
| hard | `[]` |
| soft | `[{"key":"price","direction":"prefer_low","weight":1}]` |
| matched | `hooga-hg300`, `mito-mitomin-2`, `hooga-pro1500`, `bon-charge-max`, `infraredi-flex-max`, `joovv-solo-3`, `mito-mitopro-1500-plus`, `platinumled-biomax-900` |
| unconfirmed on price | none |
| cost | $0.000357 |
| result | ok |

### 6. B6-smallest-plunge

> The smallest cold plunge you have.

Why it is here: cold plunge holds water capacity and height, neither filterable, so size has nowhere to go.

**Reply.** Ranking for lower tub_type. All 6 products in this category match.


| | |
| --- | --- |
| hard | `[]` |
| soft | `[{"key":"tub_type","direction":"prefer_low","value":"inflatable","weight":0.5}]` |
| matched | `edge-tub-elite`, `the-cold-pod-88`, `renu-cold-stoic-2`, `plunge-original`, `ice-barrel-400`, `ice-barrel-500` |
| unconfirmed on price | none |
| cost | $0.000394 |
| result | nothing was said about what could not be filtered: this category has no size filter |

### 7. B7-less-than-decimal

> Drinks that cost less than $2.25 per serving.

Why it is here: a comparison against a stated decimal: a requirement, not a preference.

**Reply.** I have read that as price per serving under $2.25. 3 of the 6 products in this category match.


| | |
| --- | --- |
| hard | `[{"key":"price_per_serving_minor","op":"lt","value":225}]` |
| soft | `[]` |
| matched | `lmnt-citrus-salt-30`, `celsius-sparkling-orange-12`, `cure-hydration-lemonade-14` |
| unconfirmed on price | `liquid-iv-hydration-multiplier-16`, `olipop-root-beer-12` |
| cost | $0.000422 |
| result | ok |

### 8. B8-cents-no-dollar-sign

> Nothing above 90 cents a serving.

Why it is here: a sub-dollar amount written without a dollar sign; inclusive wording.

**Reply.** I have read that as price per serving under $0.90. No products match. This category has 6 products, and none of them meet every constraint, so one of them would have to be relaxed.


| | |
| --- | --- |
| hard | `[{"key":"price_per_serving_minor","op":"lt","value":90}]` |
| soft | `[]` |
| matched | none |
| unconfirmed on price | `liquid-iv-hydration-multiplier-16`, `olipop-root-beer-12` |
| cost | $0.000421 |
| result | hard price_per_serving_minor lt 90 does not fit a constraint admitting at most 90 minor units |

### 9. B9-three-requirements

> No caffeine, no sugar, under $2 a serving.

Why it is here: three requirements in one sentence, none of which may be dropped.

**Reply.** I have read that as zero caffeine, zero total sugar, price per serving under $2. 1 of the 6 products in this category matches.


| | |
| --- | --- |
| hard | `[{"key":"caffeine_mg","op":"eq","value":0},{"key":"sugar_g","op":"eq","value":0},{"key":"price_per_serving_minor","op":"lt","value":200}]` |
| soft | `[]` |
| matched | `lmnt-citrus-salt-30` |
| unconfirmed on price | none |
| cost | $0.000460 |
| result | ok |

### 10. B10-two-hard-one-soft

> A greens powder with a subscription, ideally cheap.

Why it is here: two requirements and one preference in one sentence.

**Reply.** I have read that as powder, scoop format, subscription. Ranking for lower price_per_serving_minor. 1 of the 6 products in this category matches. I have not filtered by function.

**Asked.** Which function suits you? [Electrolytes | Energy | Greens | Hydration | Prebiotic]

| | |
| --- | --- |
| hard | `[{"key":"format","op":"eq","value":"powder_scoop"},{"key":"subscription_available","op":"eq","value":true}]` |
| soft | `[{"key":"price_per_serving_minor","direction":"prefer_low","weight":0.5}]` |
| matched | `ag1-pouch-30` |
| unconfirmed on price | none |
| cost | $0.000455 |
| result | missing hard function; missing soft price; unexpected soft price_per_serving_minor: the sentence did not ask for it and the case does not allow it |

## What this batch establishes

Appended by hand. Ten single-turn conversations, ten calls, one each. No second
turns, no clarification answered, no retries. Expectations frozen at db7dc56
before the first call and unchanged since. Preconditions verified: strict
schema on the server process, proxy credential on `https://api.openai.com/v1`,
shared Postgres ledger.

**7 of 10 passed. $0.004260 of a $0.03 allowance, 24,648 input and 934 output
tokens, $0.000426 per call. No new uncertain charge, nothing rejected.**

### Both defects from 03:31 failed to recur

**The invented budget did not come back.** "The cheapest one that still has a
chiller" returned `chiller_included eq true` as a constraint and `price
prefer_low` as a preference, matching all three chiller tubs. At 03:31 the same
sentence returned `price lte 549000`, the cheapest tub's own price, and matched
one. The prompt no longer shows the model any price to take.

**The decimal held, three times.** "$1.60 a serving" became `lt 160` where it
was `lt 16000` at 03:31; "$2.25 per serving" became `lt 225`; "90 cents"
became 90 minor units. All three magnitudes correct.

**The repetitions passed, twice.** Both returned all three requirements,
`sugar_g eq 0`, `price_per_serving_minor lt 200`, `function includes
electrolytes`, and matched LMNT alone.

| Requirement | Before this batch | This batch |
| --- | --- | --- |
| `sugar_g` on that sentence | 2 of 5 | 2 of 2 |
| `function` on that sentence | 0 of 5 | 2 of 2 |

Two samples do not establish that the corrections fixed anything. What can be
said is narrower and still worth saying: the three failures these changes were
written against did not recur on the sentences that produced them, and
`function`, which had never once been extracted from that sentence, was
extracted both times.

### Three failures, of three different kinds

**6. "The smallest cold plunge you have." — a guess where the site should have
spoken.** Cold plunge holds water capacity and fits-height, and neither is
filterable, so "smallest" has nowhere to go. The reply mapped it onto
`tub_type prefer_low value "inflatable"` and said nothing about size. The case
allowed `tub_type` as a defensible reading and still required the site to say
what it could not compare, or ask. It did neither, so a shopper is silently
given a proxy for the thing they asked about.

The composed sentence is also poor: "Ranking for lower tub_type" prints the raw
key. Separate defect, recorded here, not fixed.

**8. "Nothing above 90 cents a serving." — the amount right, the boundary
wrong.** It returned `lt 90`, which excludes a product costing exactly 90
cents. "Nothing above 90" includes 90, so the constraint had to admit at most
90. The amount was correct; the boundary was not.

**A missing wording example is a hypothesis, not the cause.** The MONEY block
lists "up to", "at most", "no more than" and "or less" as `lte` and does not
list "nothing above", which is one explanation. It is untested. The model may
equally have read "above 90 cents" as the excluded region and negated it
carelessly, or defaulted to `lt` as it does for most budgets. Distinguishing
these needs sentences built to separate them, and none has been run.

**10. "A greens powder with a subscription, ideally cheap." — one real miss and
one expectation too narrow.**

The real miss: `function` never appeared. "Greens powder" was read as `format
eq powder_scoop`, the container rather than the contents, so a search for greens
matched on being a scoop of powder. The site's own safeguard caught it and
asked "Which function suits you?", which is the behaviour it exists for.

The expectation too narrow: the preference came back on
`price_per_serving_minor` rather than `price`, and the frozen case required
`price` and allowed neither. For a drinks category, cost per serving is a
defensible reading of "cheap", arguably the better one. **This is a limitation
of the expectation, not evidence the model was wrong**, and it is recorded here
rather than corrected, because the expectation was frozen before the run and
loosening it afterwards would make the score meaningless.

### Cost

| | |
| --- | --- |
| Calls | 10 of a 10 ceiling |
| Measured spend | $0.004260 |
| Allowance | $0.03, of which 14.2% used |
| Input tokens | 24,648 |
| Output tokens | 934 |
| Per call | $0.000426 |
| New uncertain charges | none |
| Rejected replies | none |

Ledger before: $0.030017 spent, $0.003120 uncertain. After: $0.034277 spent,
$0.003120 uncertain. Cap $1.00, remaining $0.962603.

Per-call cost fell from $0.000484 at 03:31 to $0.000426.

**Correction to the arithmetic in an earlier draft of this section.** It gave
the 03:31 input as "about 2,470 tokens per call". That figure was wrong:
39,324 input tokens over 15 calls is **2,622** per call, not 2,470. This batch
averaged 24,648 over 10, or **2,465**, so input fell by about 157 tokens a
call, roughly 6%.

The same draft implied the shorter prompt explains the lower output count. It
does not, and nothing here shows that it does. Output was 934 tokens over 10
calls, 93 each, against 2,274 over 15, or 152 each. The two runs asked
different questions of different lengths, and output length is the model's
choice, not a consequence of input size. The drop is recorded; it is not
attributed.

### Settings

| Setting | Value |
| --- | --- |
| Commit | db7dc56 |
| `ASSISTANT_RESPONSE_FORMAT` | `json_schema` |
| `ASSISTANT_CREDENTIAL_MODE` | `proxy`, base `https://api.openai.com/v1` |
| Model | `gpt-4o-mini` |
| Scoring | `scoreCase`, frozen before the run |
| Expectations | frozen at db7dc56, unchanged during the run |
