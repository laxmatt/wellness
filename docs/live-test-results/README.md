# Live test results

`npm run assistant:livetest` writes a dated report here, plus `latest.md`.

Each report records the model and credential mode, per-case extraction results,
measured spend per conversation read from the ledger, any charges that ended
without a confirmed cost, and every reply verbatim.

Commit them. A run inside a cloud session happens on disposable infrastructure,
so an uncommitted report does not survive the session that produced it. These
files are also the record of what the assistant sounded like at a given commit,
which no test asserts.

The first run against a live model is `2026-09-08T18-51.md`. It aborted on
its first case: the credential the proxy attaches is a restricted key without
the scope for model inference, so OpenAI answered 403 and no conversation ran.
No cost was billed and no extraction was measured.
