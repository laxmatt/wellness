# Live assistant test, 2026-09-08T21:37:12.118Z

Model: `gpt-4o-mini`. Credential mode: `proxy`. Ledger: `postgres`.

## Extraction

12 of 1 cases matched the constraints a careful person would have entered.

| Category | Case | Result | Products shown |
| --- | --- | --- | --- |
| cold-plunge | boolean plus placement | unreadable reply (unreadable_reply) | 6 |

## Cost

Measured spend for 1 single-turn conversations: **$0.0055**.

Observed cost per conversation: **$0.00552**.

A real conversation runs several turns. Multiply by expected turns per session before setting the cap.

## Replies, verbatim

Read these. No script judges whether the wording is right for the site.

**cold-plunge** | "A tub with a chiller for my garage, up to $5,000"

> I could not read that reliably. Could you say it another way?

---

## Added after the run

The tables above are incomplete, and the reason is a defect in the script
rather than anything about the run. See "A defect in this report" below. What
follows was written by hand from the run's console output, the diagnostics file
and the ledger.

## Result

Commit `2f6da9f`. Proxy credential mode, `NODE_USE_ENV_PROXY=1` and
`ASSISTANT_DIAGNOSTICS_FILE` both confirmed in the running server's environment.
Credential injection confirmed before spending by `openai-processing-ms`,
`x-request-id` and the proxy's `x-proxy-error` naming connection
`"OpenAI wellness test"`.

**12 of 15**, up from 10 of 15 at `4119c27`.

| Case | Result |
| --- | --- |
| red-light, budget plus two preferences | ok |
| red-light, vague budget clear coverage | ok |
| red-light, factual question | ok |
| red-light, superlative | ok |
| red-light, medical must decline | ok |
| red-light, bare number and engine count | ok |
| red-light, must ask not guess | ok |
| cold-plunge, boolean plus placement | FAIL, unreadable reply |
| cold-plunge, implied portability | ok |
| cold-plunge, implied setup | ok |
| cold-plunge, factual | ok |
| wellness-drinks, two hard constraints | FAIL, value and a missing soft key |
| wellness-drinks, negation | ok |
| wellness-drinks, healthiest | FAIL, declined as medical |
| wellness-drinks, tastes good | ok |

### The money contract: followed in four cases, broken in one

Corrected after review. The original wording here was "the money contract
holds", which was too strong.

Four budgets arrived correctly as `{"amount": N, "currency": "USD"}` and reached
the engine as 70000, 50000, 199 and (in the vague-budget case) nothing at all.
The three price-unit failures from `4119c27` are gone.

The fifth carried `"value": 5000`, a bare number, in the chiller payload below.
That is a violation of the money contract, not a hypothetical one: the contract
would have refused it, and the only reason it was never refused is that schema
validation rejected the payload for a different error first. The run scored four
correct budgets out of five, not five.

## Cost

| | |
| --- | --- |
| Spent before | $0.009094 |
| Measured this run | $0.005519 |
| Spent after | $0.014613 |
| Per conversation | $0.00037 |
| New uncertain charges | **none** |
| Uncertain carried, still held | $0.003120 |
| Open reservations | none |
| Remaining against the $1 cap | $0.982267 |

Both reconstructed uncertain charges are untouched and still reconcilable.

## The rejected reply, exactly

One rejection, `finish_reason: stop`, so a complete answer that broke the
contract rather than a truncated one. The same failure as last run, from the
same sentence:

```
issue: hard.1.op | invalid_value |
  Invalid option: expected one of "lt"|"lte"|"gt"|"gte"|"eq"|"neq"|"in"|"includes"|"exists"|"missing"
```

```json
"hard": [
  {"key": "price", "op": "lte", "value": 5000},
  {"key": "chiller_included", "op": "true", "value": true},
  {"key": "placement", "op": "includes", "value": "garage"}
]
```

Two independent contract violations in one payload, both invalid:

1. `"op": "true"` puts the value in the operator field. This is a repeat: the
   identical error, on the identical sentence, was captured at `4119c27`. It is
   not a new symptom and it is not intermittent.
2. `"value": 5000` is a bare number for a money key. Invalid on its own terms.
   Validation never reached it only because it stops at the first error, and
   "was not the error reported" is not the same as "was not an error".

So this payload failed the operator enum and the money contract at once, and the
run's headline should be read accordingly.

## The two other failures, and what they are

**`$1.99` for "under $2 a serving".** Resolved after review, by checking the
operator rather than the number alone.

The composed reply for that case reads "price per serving of $1.99 or less", and
`describeConstraint` renders `lte` as "or less", so the model sent `lte 1.99`,
which converted to `lte 199`. On integer cents `lte 199` admits exactly what
`lt 200` admits, so it is a correct reading of "under $2 a serving". The
expectation was `lte 200`, which admits $2.00 itself and is the wrong reading.

The expectation is now stated as the set a constraint must admit rather than a
literal number, so both correct spellings pass and `lte 200` and `lt 199` do
not. The operator is checked with the amount, never separately.

The missing `function` soft preference stands as its own failure and is
unaffected by any of that.

**"Which one is healthiest?" declined as medical.** This is not the substring
bug fixed in `53697fc`. The route's own detector returns false for that
sentence, and there is a test asserting it. The model set `medicalIntent: true`
itself, and the route trusts that flag.

Fixed after review. The site's own detector is now the authority: it runs before
any model call, and the model's flag no longer produces a clinical refusal. A
shopper asking which drink is healthiest gets the fixed shopping clarification.

The flag is not ignored. When the model raises it and the site does not, nothing
it extracted is applied and no proposal is offered, so a sentence either of them
found troubling cannot turn into a filter. Treatment and diagnosis requests are
untouched, because they never reach that code.

## A defect in this report

The script's generated tables above show one case, and the extraction line reads
"12 of 1". When the checking logic moved into
`src/domain/livetest-expectations.ts`, the call that records each case for the
report was deleted along with the inline checks it sat beside. Only the
unreadable-reply branch still recorded anything.

The run itself is unaffected: every case ran, and the console output, the
diagnostics file and the ledger are complete and are what the sections above are
built from. What is lost is the verbatim reply text for the twelve passing
cases. Those replies are now composed deterministically from the constraints, so
they could be reconstructed, and they are not reproduced here because a
reconstruction is not an observation.

The script is fixed in the same commit as this file, and the fix is one line
that records every case rather than only the failing kind.
