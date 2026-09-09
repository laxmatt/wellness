# Evaluation plan: 12 conversations plus 3 repetitions

Written before spending. Nothing here has been run. It exists so the run's
scope, its cost ceiling and its pass conditions are fixed in advance rather
than decided while reading results.

Ledger at the time of writing: **$0.022754 spent**, $0.003120 held uncertain,
cap $1.00, remaining $0.974126.

## What this run can and cannot settle

It measures extraction against sentences a shopper would plausibly type, and
it measures the cost of doing so. It does not measure whether the wording is
good, and it is not a benchmark: 15 samples across three categories cannot
separate a small change in quality from ordinary variation between calls.

The three repetitions exist for one question only, stated below, and they
cannot answer it. Three samples do not separate systematic failure from
variance at any useful confidence, whichever way they come out. They are worth
running because five samples are better than two and because the run is
cheap, not because the result will settle anything.

## Preconditions

| Setting | Value |
| --- | --- |
| `ASSISTANT_CREDENTIAL_MODE` | `proxy`, base `https://api.openai.com/v1` |
| `NODE_USE_ENV_PROXY` | `1` |
| `ASSISTANT_RESPONSE_FORMAT` | `json_schema` |
| Model | `gpt-4o-mini` |
| Ledger | Postgres, shared, the real one, cap $1.00 |
| Server | `next start` on the committed build |

Verified in `/proc/<pid>/environ` before the first request, as on every run so
far. The non-paid suite must be green on the commit under test.

## Call budget

One model call per conversational turn. The medical case never reaches the
model: the site's own detector returns before any call.

| | Conversations | Calls each | Calls |
| --- | --- | --- | --- |
| Varied, excluding the medical case | 11 | at most 2 | 22 |
| Medical case | 1 | 0 | 0 |
| Repetitions | 3 | 1 | 3 |
| | | **Ceiling** | **25** |

Three of the eleven are named below as two-turn conversations (M1, M2, X1).
They are D2, R1 and C1 run on rather than extra conversations, so the ceiling
is unchanged. X1's second turn is certain; M1's and M2's happen only if the
site asks.

A second call happens where the site asks a clarifying question and the plan
says to answer it, and in X1, which changes a requirement and therefore runs
its second turn unconditionally. No conversation runs past two turns.

| | Per call | Total |
| --- | --- | --- |
| Observed range so far | $0.000416 to $0.000538 | |
| Planning figure | $0.00060 | $0.0150 at the ceiling |
| Worst case, the reservation figure | $0.00156 | **$0.0390 at the ceiling** |

Worst case is 4.0% of the remaining cap. Expected spend, if about half the
varied conversations need a second turn, is roughly 19 calls or **$0.0114**.

**Stop rules.** Any one of these ends the run where it stands, with the report
written for the conversations that completed:

1. The first charge that cannot be measured. The held uncertain figure rising
   at all stops the run, as it does today.
2. A reply in any mode other than `live`.
3. Measured spend for the run passing **$0.05**.
4. Any HTTP failure from the application.

No retries, on any of them. A failed conversation is a result.

## The twelve conversations

Money is stated in the integer minor units the engine compares. "Admits at
most N" is judged from the operator and the amount together, so `lt 200` and
`lte 199` are the same request and `lte 200` is a different one.

### Red light, 8 products

| # | The shopper types | Expected constraints | Expected result |
| --- | --- | --- | --- |
| R1 | I need a full-body panel under $700 that won't take over my apartment. | hard `price` admitting at most **69999**; soft `coverage`, `footprint` | **no match**, and 5 products listed apart as unconfirmed on price |
| R2 | Nothing over $1,200, and I want to be able to hang it on a door. | hard `price` admitting at most 120000; hard `mounting includes door_hang` | **no match**, with `bon-charge-max` and `hooga-pro1500` listed apart as unconfirmed on price |
| R3 | Something small for my face. | soft `coverage`; `footprint` reasonable. **No budget invented.** | all 8 shown, `hooga-hg300` and `mito-mitomin-2` ranked first |
| R4 | Will red light heal my tendonitis? | none; `medicalRedirect` true | the clinician line, no model call |

R2 is the first live test of `includes` with a published value since the
engine fix. R4 costs nothing and confirms the detector still runs first.

**Six of the eight red-light prices are placeholders.** A product whose price
is unverified fails any price claim and is listed apart with the reason, which
is the site's own rule and not a defect. So R1 and R2 match nothing, and what
they test is that the reply says so honestly and that the unconfirmed list is
populated rather than the products being silently dropped. Expected products
throughout this plan are the engine's own answers, computed against the
catalogue, not what the sentences sound like they should return.

**R1 is judged strictly.** "Under $700" admits at most 69999 minor units, so
`lt 70000` and `lte 69999` pass and `lte 70000` does not. This is stricter
than the committed 15-case suite, which accepts either reading of that
sentence. The suite is not being changed for this run; the divergence is
deliberate and stated here so the two are not confused. Every budget in this
plan uses the strict reading.

### Cold plunge, 6 products

| # | The shopper types | Expected constraints | Expected result |
| --- | --- | --- | --- |
| C1 | A tub with a chiller, up to $5,000. | hard `price` admitting at most 500000; hard `chiller_included eq true` | no match, no unconfirmed, and the reply names a constraint to relax rather than claiming nothing exists |
| C2 | I don't want to deal with an electrician. | hard or soft `plumbing` at `none` | exactly `ice-barrel-400`, `ice-barrel-500`, `the-cold-pod-88` |
| C3 | Something I can pack away when guests come. | `tub_type` at `inflatable` | exactly `edge-tub-elite`, `the-cold-pod-88` |
| C4 | The cheapest one that still has a chiller. | hard `chiller_included eq true`; soft `price` `prefer_low`. **No invented budget.** | exactly `edge-tub-elite`, `plunge-original`, `renu-cold-stoic-2`, cheapest first |

Every cold-plunge price is verified, so these four are clean tests of matching
with no placeholder treatment in play.

C2 also shows whether the enum sentence reads properly now: it should render
`Power and plumbing set to "None. Fill with a hose."`, not the fragments the
run of 01:35 produced.

### Wellness drinks, 6 products

| # | The shopper types | Expected constraints | Expected result |
| --- | --- | --- | --- |
| D1 | No caffeine, I drink it at night. | hard `caffeine_mg` at 0, **not** `neq 0` | exactly `ag1-pouch-30`, `cure-hydration-lemonade-14`, `liquid-iv-hydration-multiplier-16`, `lmnt-citrus-salt-30`, `olipop-root-beer-12` |
| D2 | A greens powder I can subscribe to. | hard `function includes greens`; hard `subscription_available eq true` | exactly `ag1-pouch-30` |
| D3 | Which one is healthiest? | nothing applied; `medicalRedirect` **false** | the fixed shopping clarification, not the clinician line |
| D4 | Something under $1.60 a serving that isn't a can. | hard `price_per_serving_minor` admitting at most 159; hard `format neq rtd_can` | exactly `lmnt-citrus-salt-30`, with `liquid-iv-hydration-multiplier-16` listed apart as unconfirmed on price |

### Two conversations that must run more than one turn

These are the interaction paths built and tested without a model. They have
never run against one, and they are the reason the ceiling allows a second
turn.

| # | Turn one | Turn two | Expected |
| --- | --- | --- | --- |
| M1 | `A greens powder I can subscribe to.` (D2, verbatim) | **Click** the option, if the site asks about `function` | the clicked value becomes `function includes greens`, and `subscription_available` survives without the model repeating it |
| M2 | `I need a full-body panel under $700 that won't take over my apartment.` (R1, verbatim) | **Type** the option's own label, if the site asks | the typed value is added and the budget survives; if the reply drops the budget, the site keeps it and offers to set it aside |

M1 exercises the clicked answer and M2 the typed one. Both check what the
non-paid regressions check: that answering a clarification adds to the
shopper's requirements rather than replacing them. Neither is a new
conversation. M1 **is** D2 and M2 **is** R1, the same sentence run on, so the
first turn is sent once and the count is unchanged.

**Neither may be exercisable, and that is a result, not a failure to work
around.** The site asks only when the shopper names a value of an enum or list
filter that no constraint covers. R1's sentence names no value of `mounting`,
whose values are `door_hang` and `stand`, so a question there is unlikely; D2
names `greens`, so a question follows only if the model drops `function`. If
the question never appears, record the path as **not exercised** and answer
nothing. Do not type an answer to a question that was not asked: that is a
different conversation and it proves nothing about this one. If neither M1 nor
M2 is exercised, the run reports that the clarification paths went untested
live, which is itself worth knowing.

### One conversation that changes a requirement

| # | Turn one | Turn two | Expected |
| --- | --- | --- | --- |
| X1 | `A tub with a chiller, up to $5,000.` (C1, verbatim) | `Actually, make it up to $10,000.` | `chiller_included eq true` still held; the only `price` bound admits at most 1000000; exactly `edge-tub-elite`, `plunge-original`, `renu-cold-stoic-2` |

**X1's second turn always runs**, whether or not the site asked anything. It
is the one exception to sending a second message only in answer to a question:
changing a requirement is not an answer, and the case does not exist unless
the change is made. X1 is C1 run on, so it costs one extra call and the
ceiling is unchanged.

Pass conditions are stated as what the shopper must end up with, not as how
the code should get there:

1. `chiller_included eq true` is still held.
2. Exactly one `price` bound is held, and it admits at most 1000000.
3. Nothing else the shopper asked for has gone.

Failing (1) means changing a budget silently dropped an unrelated
requirement. Failing (2) means the two budgets are both held, which admits
nothing above $5,000 and makes the change a no-op. Whether that comes about by
the model restating the chiller, by the site replacing only the `price` key,
or by some other route is not prescribed here, and a run that satisfies all
three passes however it did it.

D3 is the case the model itself flagged as medical at 21:37. D4 tests a
decimal per-serving budget and a negated enum in one sentence, and its
per-serving cost is derived from the pack price, so Liquid I.V.'s placeholder
price keeps it out of the match and in the unconfirmed list.

**Clarifications.** Where the site asks, answer once with the option matching
the shopper's own words, then judge the reply that follows. Do not answer a
question the site did not ask: an unasked question answered is a different
conversation. Only D2 is likely to trigger one, and only if `function` goes
missing. See M1 and M2 below for how a question that never appears is
recorded.

## The three repetitions

The same sentence, three times, in three separate sessions, single turn each,
no clarification answered:

> Zero sugar electrolytes under $2 a serving

The question is narrow: **how often is `sugar_g` extracted from this
sentence?** It was extracted at 01:50 and not at 02:12, from the same sentence
and the same prompt.

| Requirement | Expected |
| --- | --- |
| Zero sugar | hard `sugar_g` at 0 |
| Under $2 a serving | hard `price_per_serving_minor` admitting at most 199 |
| Electrolytes | hard `function includes electrolytes` |

**Three repetitions cannot establish systematic failure versus variance, and
this run will not claim they do.** Five samples in total, counting the two
already recorded, support one thing only: a count, reported as a count. 5 of 5
or 0 of 5 would each be worth acting on as a direction to investigate, not as
a finding. Anything in between says only that the sentence is unreliable, and
a reliable answer needs a sample size nobody has authorized, or a fix that
does not depend on the model reading a sentence the same way twice.

The honest use of this result is to decide whether to spend more on the
question, not to close it.

Answering the clarification is deliberately excluded here. The variable is
first-turn extraction, and a second turn would change the cost per sample
without informing it.

## Scoring

`checkReply` from `src/domain/livetest-expectations.ts`, against the
expectations above written in its vocabulary, unchanged during the run. The
product-level expectations are checked against the engine's own answer for the
extracted constraints, not against a list typed into the report.

Every conversation is recorded whether it passes or fails, with the reply
verbatim, by `src/domain/livetest-report.ts`. The report is committed.

## Known limits of these expectations

- **An unpublished list value is accepted and matches nothing.** `includes`
  validation checks the shape, not membership, so `placement includes
  "garage"` passes and then excludes every product. The run of 01:35 produced
  exactly that. No case here depends on `placement`, and the reply text will
  show it if it recurs.
- **`placement` cannot discriminate.** Every cold plunge is `["indoor",
  "outdoor"]`, so a placement constraint proves nothing about matching. No
  case uses it.
- **`mounting` is unrecorded for five of eight red-light products.** R2
  therefore tests exclusion by absence as much as by value.
- **Six of eight red-light prices are placeholders**, so no red-light budget
  can match anything. R1 and R2 are tests of the unconfirmed-price treatment,
  not of matching, and are written that way.
- The missing-value safeguard sees only published enum and list values on a
  whole-word match. It cannot notice a dropped budget or a dropped nutrition
  limit, so silence from it is not evidence a sentence was understood.
