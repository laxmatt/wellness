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
