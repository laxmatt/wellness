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

The three repetitions exist for one question only, stated below, and even they
answer it weakly.

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

A second call happens only where the site asks a clarifying question and the
plan says to answer it. No conversation runs past two turns.

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
| R1 | I need a full-body panel under $700 that won't take over my apartment. | hard `price` admitting at most 69999, or 70000; soft `coverage`, `footprint` | at least `hooga-pro1500` |
| R2 | Nothing over $1,200, and I want to be able to hang it on a door. | hard `price` admitting at most 120000; hard `mounting includes door_hang` | exactly `bon-charge-max`, `hooga-pro1500` |
| R3 | Something small for my face. | soft `coverage`; `footprint` reasonable. **No budget invented.** | `hooga-hg300`, `mito-mitomin-2` ranked first |
| R4 | Will red light heal my tendonitis? | none; `medicalRedirect` true | the clinician line, no model call |

R2 is the first live test of `includes` with a published value since the
engine fix. R4 costs nothing and confirms the detector still runs first.

### Cold plunge, 6 products

| # | The shopper types | Expected constraints | Expected result |
| --- | --- | --- | --- |
| C1 | A tub with a chiller, up to $5,000. | hard `price` admitting at most 500000; hard `chiller_included eq true` | no match, and the reply names a constraint to relax rather than claiming nothing exists |
| C2 | I don't want to deal with an electrician. | hard or soft `plumbing` at `none` | `ice-barrel-400`, `ice-barrel-500`, `the-cold-pod-88` |
| C3 | Something I can pack away when guests come. | `tub_type` at `inflatable` | `edge-tub-elite`, `the-cold-pod-88` |
| C4 | The cheapest one that still has a chiller. | hard `chiller_included eq true`; soft `price` `prefer_low`. **No invented budget.** | the three chiller tubs, `edge-tub-elite` first |

C2 also shows whether the enum sentence reads properly now: it should render
`Power and plumbing set to "None. Fill with a hose."`, not the fragments the
run of 01:35 produced.

### Wellness drinks, 6 products

| # | The shopper types | Expected constraints | Expected result |
| --- | --- | --- | --- |
| D1 | No caffeine, I drink it at night. | hard `caffeine_mg` at 0, **not** `neq 0` | all but `celsius-sparkling-orange-12` |
| D2 | A greens powder I can subscribe to. | hard `function includes greens`; hard `subscription_available eq true` | exactly `ag1-pouch-30` |
| D3 | Which one is healthiest? | nothing applied; `medicalRedirect` **false** | the fixed shopping clarification, not the clinician line |
| D4 | Something under $1.60 a serving that isn't a can. | hard `price_per_serving_minor` admitting at most 159; hard `format neq rtd_can` | exactly `liquid-iv-hydration-multiplier-16`, `lmnt-citrus-salt-30` |

D3 is the case the model itself flagged as medical at 21:37. D4 tests a
decimal per-serving budget and a negated enum in one sentence.

**Clarifications.** Where the site asks, answer once with the option matching
the shopper's own words, then judge the reply that follows. Do not answer a
question the site did not ask. Only D2 is likely to trigger one, and only if
`function` goes missing.

## The three repetitions

The same sentence, three times, in three separate sessions, single turn each,
no clarification answered:

> Zero sugar electrolytes under $2 a serving

The question is narrow: **is the omission of `sugar_g` systematic or
variance?** It was extracted at 01:50 and not at 02:12, from the same sentence
and the same prompt.

| Requirement | Expected |
| --- | --- |
| Zero sugar | hard `sugar_g` at 0 |
| Under $2 a serving | hard `price_per_serving_minor` admitting at most 199 |
| Electrolytes | hard `function includes electrolytes` |

Read as: 3 of 3 is weak evidence the corrections held. 0 of 3 is good evidence
the omission is systematic. Anything between is variance, and says the
sentence needs a different fix from a prompt line. With the two existing
samples this makes five, which is still a small number and will be reported as
one.

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
- The missing-value safeguard sees only published enum and list values on a
  whole-word match. It cannot notice a dropped budget or a dropped nutrition
  limit, so silence from it is not evidence a sentence was understood.
