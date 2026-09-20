# Ledger history and a data loss

The assistant's accounting lives in Postgres, not in this repository. On
2026-09-08 the local ledger holding this project's only real spend was
destroyed. This file is the surviving record of what it held, how it was lost,
and how to put back what can honestly be put back.

It exists because the alternative was a ledger that reads `$0.00` with nothing
saying why, which is a clean history rather than a true one.

## What was lost

Destroyed by running `npx vitest run` with `TEST_DATABASE_URL` pointed at the
same database the application was using. `src/__tests__/postgres-ledger.test.ts`
drops `assistant_usage`, `assistant_budget`, `assistant_session` and
`assistant_client` after every test, by design, because it tests the migration
path. Two full-suite runs on 2026-09-08 emptied the application's ledger.

Nothing about it was subtle and no safeguard caught it. The guard in place at
the time compared the two connection strings as text, which the audit correctly
identified as insufficient even for the case it was written for.

## What the ledger held

Reconstructed from the reports committed in this directory, which were written
while the rows still existed. Every figure below appears in
`2026-09-08T18-51.md`, `2026-09-08T19-20.md` or `2026-09-08T19-29.md`.

### Recoverable exactly

| Reservation | Outcome | Amount | Settled | Reason |
| --- | --- | --- | --- | --- |
| `r_2026-09_1788893470513_izs521g0` | uncertain, unreconciled | $0.001560 held | 2026-09-08T18:51:10Z | The provider returned 403. |
| `r_2026-09_1788895256959_7woysl5a` | uncertain, unreconciled | $0.001560 held | 2026-09-08T19:20:57Z | The provider returned 403. |

Session ids: `s_livetest_1788893470404_0` for the first. The second was not
captured before the loss, so `restore/2026-09.json` records it as unknown rather
than guessing at it.

### Recoverable only in aggregate

The completed run of 2026-09-08T19:29Z billed **14 calls** totalling
**$0.003837**, over 19,851 input tokens and 1,430 output tokens, model
`gpt-4o-mini`. That total is certain; the fourteen individual `reservation_id`
values were never written into any report and are gone.

So the money is recoverable and the per-call detail is not. `restore/2026-09.json`
carries the fourteen as one aggregate row, explicitly labelled, rather than
fourteen invented ones.

### Not part of the loss

The zero-cost diagnostics sent with `curl` on 2026-09-08 (two `GET /v1/models`,
one `POST /v1/chat/completions`) never touched the ledger. They bypassed it
entirely, which the reports state. Nothing about them is missing, because
nothing about them was ever recorded.

## Restoring

```
npm run ledger:restore -- docs/live-test-results/restore/2026-09.json
```

The script refuses to guess and refuses to overwrite:

- Every row it writes carries `outcome` as recorded and a `reason` prefixed
  `RECONSTRUCTED:`, naming the report it came from. A row that was reconstructed
  says so in the ledger forever.
- The aggregate billed row uses the reservation id
  `recovered_2026-09_billed_aggregate`, which is not, and cannot be mistaken
  for, a real reservation.
- It skips any reservation id already present rather than replacing it, and
  reports what it skipped.
- It refuses to run against a database whose `assistant_budget` already shows
  spend for that month, unless `--force` is passed, so it cannot be used to
  paper over a live ledger.

Reconstruction is a statement about the past, not a correction to it. The two
uncertain charges come back **still held and still unreconciled**, because that
is what they were: closing them out requires the provider's usage record and
remains an operator's judgement.

## What now prevents a repeat

Two independent barriers, because the first one alone is what failed:

1. **Database permissions.** The test role has no `CONNECT` privilege on the
   application's database. A misaimed connection string is refused by Postgres
   before any statement runs. Setup is in `docs/ASSISTANT.md`.
2. **A marker inside the database.** `postgres-ledger.test.ts` refuses to run
   unless the database it connects to contains a table named
   `disposable_test_database`. Identity is established from inside the database,
   so a host alias, a different user, an added connection option or a socket
   instead of TCP cannot get past it. The application's database will never have
   that table.

Neither barrier is a claim that no accident is possible. They are two different
kinds of barrier so that one mistake has to be made twice.
