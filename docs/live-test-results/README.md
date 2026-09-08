# Live test results

`npm run assistant:livetest` writes a dated report here, plus `latest.md`.

Each report records the model and credential mode, per-case extraction results,
measured spend per conversation read from the ledger, any charges that ended
without a confirmed cost, and every reply verbatim.

Commit them. A run inside a cloud session happens on disposable infrastructure,
so an uncommitted report does not survive the session that produced it. These
files are also the record of what the assistant sounded like at a given commit,
which no test asserts.

No report is present yet. Nothing here has made a paid request.
