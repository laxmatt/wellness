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
discards provider error bodies, so nothing recorded what it said. The report
separates what was observed from what was inferred, and lists one claim an
earlier revision got wrong.
