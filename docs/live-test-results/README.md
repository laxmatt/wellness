# Live test results

`npm run assistant:livetest` writes a dated report here, plus `latest.md`.

Each report records the model and credential mode, per-case extraction results,
measured spend per conversation read from the ledger, any charges that ended
without a confirmed cost, and every reply verbatim.

Commit them. A run inside a cloud session happens on disposable infrastructure,
so an uncommitted report does not survive the session that produced it. These
files are also the record of what the assistant sounded like at a given commit,
which no test asserts.

The first run against a live model is `2026-09-08T18-51.md`. It aborted on its
first case with a 403, so no conversation ran, nothing was billed and no
extraction was measured. The cause of that 403 is not established: the route
discards provider error bodies, so nothing recorded what it said. A second run after credits were
purchased, `2026-09-08T19-20.md`, aborted the same way and established the
cause: the server's requests never leave for OpenAI, because Node's built-in
fetch does not use HTTPS_PROXY and the credential is only attached on the
proxied path. The third run, `2026-09-08T19-29.md`, completed all 15 cases for
$0.0038 with no new uncertain charges. It scored 8 of 15, but seven of the
failures returned the schema-parse fallback rather than a model reply, so the
assistant produced usable constraints on one of the eight cases that called for
them. The fourth run, `2026-09-08T20-57.md`, is the first to complete with
diagnostics on. It scored 10 of 15 for $0.0053 with no new uncertain charges,
captured the exact field of the one rejected reply, and surfaced a price unit
defect that the older key-only assertions would have scored as a pass. The
reports separate what was observed from what was inferred, and list the claims
earlier revisions got wrong.

The fifth run, `2026-09-08T21-37.md`, scored 12 of 15 for $0.0055 with no new
uncertain charges. Every budget case passed, so the money contract is followed.
Its generated tables are incomplete: a defect in the report writer, explained
and fixed in the same commit, and the file says so.

The sixth report, `2026-09-09T01-28.md`, is not a suite run. It is one request,
sent to answer the one question the non-paid tests cannot: whether this account
and `gpt-4o-mini` compile the strict JSON schema. They do. The request cost
$0.000416, returned `price lte 500000` and `chiller_included eq true`, and
recorded no uncertain charge. That is the extraction that failed twice before,
once with the value written into the operator field. `npm run
assistant:strictcheck` sends it; `ASSISTANT_RESPONSE_FORMAT=json_schema` is
still off by default.

The seventh run, `2026-09-09T01-35.md`, is the 15-case suite with strict
structured outputs on. It scored 12 of 15 for $0.0062 with no new uncertain
charges. Two of the three failures were schema-valid replies with correct
extraction, discarded because `suggestCompare` carried more ids than
`ModelIntent` allows and the schema does not express that bound. Interpretation
was right on 14 of 15. The single real extraction failure dropped "zero sugar"
and read "under $2" as `lte 200`, which admits exactly $2.00.

The eighth report, `2026-09-09T01-50.md`, is one request re-running the drinks
sentence that failed at 01:35, scored against the same unchanged expectation.
It met two of three requirements for $0.000538: `sugar_g eq 0` and
`price_per_serving_minor lt 200`, the strict reading of "under $2 a serving".
The electrolyte preference was still not extracted, so an energy drink sits in
the results with nothing marking it as the wrong kind of product. The prompt
corrections that preceded it are recorded as plausible causes, not established
ones: two single samples do not separate an improvement from variation.

The ninth report, `2026-09-09T02-12.md`, is one two-turn conversation for
$0.001022. The site asked for the function it did not get, the shopper answered
with the option offered, and the budget from turn 1 survived into turn 2. Two
findings against it: "zero sugar" was extracted at 01:50 and not here, from the
same sentence and the same prompt, so no single request settles extraction; and
the model answered with `function includes ["electrolytes"]`, an array, which
the engine's `includes` never matches, so the shopper was told nothing matched
when one product did.

The tenth report, `2026-09-09T03-31.md`, is one pass of the evaluation plan:
12 varied conversations and 3 repetitions, 15 model calls for $0.007263
against a $0.05 allowance, no retries and no new uncertain charges. 11 of 16
turns passed. Two new extraction defects: a superlative became a hard budget
priced to the cent from the catalogue, and "$1.60 a serving" was read as $160.
The missing-value safeguard ran live for the first time, firing four times and
producing one false positive on the word "tub". Both clarification paths went
unexercised because the site had nothing to ask on the cases that would have
answered them.

The eleventh report, `2026-09-09T05-37-batch.md`, is the ten-case verification
batch: 10 calls for $0.004260 against a $0.03 allowance, 7 of 10 passing.
Neither defect from 03:31 recurred, and the drinks repetition extracted all
three requirements both times, `function` included, having never once done so
before. The three failures are new and different: a size word mapped onto a
filter that does not mean size with nothing said about it, "nothing above 90
cents" read as exclusive when it is inclusive, and "greens powder" read as a
format rather than a function. One of the three also exposed an expectation
that was too narrow, recorded rather than corrected.
