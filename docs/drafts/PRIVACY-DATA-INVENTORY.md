# Privacy: what the code actually does with visitor data

**Not a privacy notice, and not legal advice.** This is an inventory of what
this repository's code collects, where it sends it, and where it keeps it, so
that whoever writes the notice is writing from the code rather than from a
template. Every claim names the file behind it.

Three facts a notice needs are **not** in this repository and are not guessed
below: who the controller is, how to reach them, and how long anything is kept.

Compiled 2026-09-10 by reading the source, then re-audited the same day after
review found three claims that the code does not support. Corrections are
marked. Nothing below was tested against a live deployment, because no
deployment configuration exists in this repository.

Updated 2026-09-11: section 2 now describes a reporting command that did not
exist when this was compiled, and separates what that command does from the
deletion it does not do.

**What this inventory cannot tell you.** It is a reading of application code in
this repository and nothing else. It says nothing about what a hosting platform
logs before this code runs, what a merchant does when a visitor follows an
outbound link, or what a model provider retains after a request reaches it.
Those are three separate questions for whoever writes the notice, and each is
answered by that party's documentation, not by this repository.

## 1. Personal data the site processes

### The visitor's IP address, salted and hashed

`src/domain/client-identity.ts`

The assistant endpoint reads the caller's IP from a proxy header, joins it to a
server-side salt (`ASSISTANT_CLIENT_SALT`, minimum length enforced) and takes
the first 32 hex characters of a SHA-256 digest:

```
createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32)
```

That hash is the key for an hourly rate limit. The raw IP is not written to the
database.

**A salted hash of an IP is still personal data** under UK and EU law: it
singles out a device, and the salt makes it stable rather than anonymous. A
notice has to cover it. It is not a cookie, so cookie-consent rules are a
separate question from this one.

The address is only read at all where it can be trusted: an operator-named
header the edge overwrites (`ASSISTANT_TRUSTED_IP_HEADER`), or
`x-forwarded-for` when `VERCEL=1`. There is no fallback, on purpose: reading an
unverified header would be a limit a single caller defeats.

**Corrected after audit.** An earlier version of this file said that with
`ASSISTANT_ALLOW_UNIDENTIFIED_CLIENTS=1` "no IP is processed". That is not what
the code does. Reading `resolveClientIdentity` in full:

- salt configured, address resolvable: the address is read and hashed, and the
  hash is stored. **The unidentified flag does not change this.** It only
  decides what happens when one of the two is missing.
- address not resolvable: every caller shares one bucket, `local-unidentified`,
  and no address is read.
- salt missing but address resolvable: the same shared bucket, but the address
  was still read from the request headers before that was decided.

So the flag is not an off switch for IP processing. It is a fallback for when
identification is impossible, and in the middle case above an address is read
and then discarded, which is still processing.

### What the visitor types into the assistant

`src/app/api/assistant/route.ts`, `src/domain/assistant.ts`

A request may carry up to 40 messages, each at most 2,000 characters
(`AssistantMessage` in `src/domain/assistant.ts`). Free text a person types is
exactly the kind of field where someone volunteers a health condition, and this
site is about wellness products, so a notice should assume it happens.

**Corrected after audit.** An earlier version said 40 messages are "forwarded".
What is forwarded is smaller and bounded. `boundInput` in
`src/domain/request-bounds.ts` drops messages from the oldest end until the
provider's own token estimate fits `maxInputTokens`, and if a single remaining
message still does not fit, the request is refused before any budget is taken.
So the count sent is whatever tail fits the configured budget, not 40, and the
oldest turns of a long conversation are dropped rather than sent.

The messages are **not** written to the database. Only token counts and cost
are (see section 2). They do leave the server: see section 3.

### A session identifier the browser generates

`src/components/assistant/AssistantProvider.tsx`

A random id in `sessionStorage` under `wc.assistant.session`, cleared when the
tab closes. It goes to the server with each assistant request and is stored.

### A compare selection, in the browser and in URLs

`src/components/compare/CompareProvider.tsx`, `src/components/compare/CompareTray.tsx`

Product ids are held in `localStorage`. The provider's own comment says the
selection never leaves the browser.

**Corrected after audit.** That comment describes the store, not the feature.
`CompareTray` builds `/compare?ids=<id>,<id>` and `CompareView` builds the same
shape for its remove links, so opening a comparison puts the selected product
ids in the URL. A URL is not private: it reaches the hosting platform's request
logs, browser history, and any `Referer` header the browser sends when the
visitor follows an outbound link from that page.

The ids are catalogue slugs, not identifiers of a person, and no id is stored
server-side against a session. But "never leaves the browser" was wrong, and a
notice describing what the hosting logs contain should say that comparison URLs
name products.

Two limits on that, so the next edit does not overstate it either. Request logs
and browser history do receive the full URL, query string included. A `Referer`
sent on an outbound click is a weaker claim: what it carries depends on the
browser and on the referrer policy in force, and several common policies send
only the origin or nothing at all. This site sets no referrer policy of its
own, so the browser's default applies and the query string may or may not
travel. Treat the outbound case as possible rather than established.

## 2. What is written to the database

`src/providers/usage/PostgresUsageStore.ts`

| table | columns | what it is |
| --- | --- | --- |
| `assistant_client` | `client_key`, `hour_bucket`, `requests` | the salted IP hash and how many requests it made in an hour |
| `assistant_session` | `session_id`, `turns`, `first_seen` | the browser's session id, a turn count, a first-seen timestamp |
| `assistant_usage` | `reservation_id`, `month`, `session_id`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `settled_at`, `outcome`, `reason` | one row per model call: cost accounting, tied to a session id |
| `assistant_budget` | `month`, `reserved_usd`, `spent_usd`, `uncertain_usd` | monthly spend totals, no personal data |

No message content is stored in these tables. No name, email or account exists
anywhere in the schema: the site has no accounts.

### Two other paths that write text to disk, neither in the ledger

**Corrected after audit.** An earlier version of this file described only the
database. Two operator-controlled paths also persist text, and a notice should
not be written as though they do not exist.

**Rejection diagnostics.** `src/providers/ai/diagnostics.ts` appends to a file
when `ASSISTANT_DIAGNOSTICS_FILE` names a path. It is off by default, and it
refuses to write on a deployed host. It records the model's rejected output,
the validator's complaint and the provider's finish reason. Its own contract
says it never records the conversation, the shortlist, request headers,
environment variables or credentials, and reading the module confirms that is
what it writes.

One qualification that matters more than the contract. The rejected output is
the model's text, and a model's text can quote, paraphrase or restate what the
visitor just said. So excluding the conversation object does not guarantee that
no visitor content lands in the file: it guarantees the conversation is not
copied there deliberately. Anyone enabling this anywhere a visitor can reach
should treat the file as potentially containing visitor content. It is a developer tool on a developer's machine, not a
production log, and a notice should say so only if it is ever enabled anywhere
a visitor can reach.

**Live test reports.** `scripts/assistant-batch.ts` and
`scripts/assistant-evaluation.ts` write Markdown into `docs/live-test-results/`
through `src/domain/livetest-report.ts`, and those reports **do** retain
conversation text: each case's prompt and the model's reply, verbatim. There
are 12 dated reports committed to this repository today, plus a `latest.md`
copy of the most recent.

Every one of those prompts is a scripted test case written in this repository
and run deliberately by an operator. None of them is a visitor's. The path is
worth naming in an inventory because it is a text-retaining path that exists;
it is not a route by which public traffic is recorded, and nothing wires it to
the live endpoint.

### Nothing is deleted, and a command that counts what deleting would reach

**No row is ever removed.** There is no `DELETE`, no expiry, no anonymisation
step and no scheduled job anywhere in the store. Rows accumulate from the first
write. Whoever writes the notice has to either state a retention period and have
somebody implement it, or describe what actually happens, which today is "kept
indefinitely".

One piece of that gap was closed on 2026-09-11, and it is worth being exact
about which piece. What now exists is a dry run:

```
npm run retention:report -- --retain-days=90
npm run retention:report -- --before=2026-06-30
```

`scripts/retention-report.ts` counts how many rows a stated cutoff would reach
and prints the figures. `src/domain/retention.ts` holds the categories and the
predicates, and refuses to send any statement that is not a `SELECT count(*)`.
`src/__tests__/retention.test.ts` holds that refusal to it, and
`src/__tests__/retention-postgres.test.ts` runs the predicates against a real
throwaway Postgres and checks that every row count, and every accounting row's
id, session, outcome and cost, is the same after the report as before it.

Three things the command deliberately does not do:

- **It assumes no retention period.** Run with neither `--before` nor
  `--retain-days` it exits with an error rather than a default. The period is
  the owner's decision, and a number invented in code would reach a published
  notice looking like a decision somebody made.
- **It prints counts and nothing else.** No session id, no client key, no
  amount, no row. The statements it sends return a single integer each.
- **It deletes nothing, and there is nothing to switch on.** No scheduler, no
  flag that turns counting into deleting, and no deletion code behind either.

What it classifies, so a period can be argued about against real figures:

| category | what a job would do | why |
| --- | --- | --- |
| `assistant_client` rows older than the cutoff | prune | the row enforces a limit for an hour that has already passed, and this is the only table holding anything derived from an IP address |
| `assistant_session` rows older than the cutoff | prune | a per-session turn limit that the session will not reach again |
| `assistant_usage.session_id` on settled, reconciled rows | keep the row, drop the link | the row is the ledger and deleting it would change what the site has spent; the session id is the only part of it pointing at a visitor |
| open reservations, unreconciled uncertain charges, `assistant_budget` | nothing, at any age | an operator still has to close each one against the provider's record, and the monthly totals are the financial history |
| rows carrying an outcome this code does not recognise | nothing, and reported separately | nothing here can say whether such a row is finished |

Two things still do not exist: a chosen period, and any code that would act on
one. The report exists so the first can be decided with the shape of the second
already visible, not as a substitute for either.

## 3. Where data goes outside this system

Each of these is outside this repository's code. What that code does is
observable here; what the other party does with it is not, and the entries
below say which is which.

1. **The model provider.** Conversation text, bounded as described above, is
   sent to whichever provider is configured. **What this repository shows:**
   the request is built and sent. **What it cannot show:** whether the provider
   retains the text, for how long, or whether it is used for training. That is
   the provider's contract and a notice must state it from that contract, not
   from this file. The provider must be named as a processor.
2. **The hosting platform.** A host receives the request before this code does
   and typically logs the raw IP, the URL and the user agent. **Nothing about
   that is visible from here**, including retention. Comparison URLs name
   products (section 1), so those logs are not contentless.
3. **The database host.** Wherever `DATABASE_URL` points. Same limit: this
   repository shows what is written, not what the host does with backups or
   logs.
4. **Outbound merchant links.** Ordinary links to makers and retailers,
   carrying `rel="sponsored nofollow noopener"` and no tracking parameter
   appended by this site, which is observable here. **What happens next is
   the merchant's**: they see a normal inbound visit, and browsers may send a
   `Referer` naming the page the visitor came from, which for a comparison
   page names the compared products. There is no affiliate programme, so no
   affiliate network receives anything from this site.

## 4. What the site does not do

Verified by reading the code in this repository, and worth stating because each
one shortens a notice. Each is a claim about this application, not about a host
or a provider:

- **No cookies are set.** No `document.cookie` write anywhere in `src/`, and no
  `Set-Cookie` in any route.
- **No analytics, tag manager or pixel.** No third-party script tag in
  `src/app/layout.tsx` or any component.
- **No accounts, logins, or email collection.** No auth code, no forms that
  submit personal details.
- **No advertising code, and nothing in this application sells or shares data
  for advertising.**
- **Web fonts are self-hosted through `next/font`** rather than fetched from a
  third party at page load.

## 5. What the owner has to supply

1. **Controller identity.** Who is responsible. A person or a company.
2. **A contact route** for privacy requests, which is the same address the
   about page needs.
3. **A retention period**, and a decision about the missing deletion code.
4. **The named subprocessors**: model provider, application host, database
   host.
5. **Which jurisdictions** the notice has to satisfy, which follows from where
   the site is offered and where visitors come from.

## 6. Still open, and not answered by reading code

These need the owner or a document this repository does not hold:

- What the hosting platform logs, and for how long.
- What the model provider retains, and whether it trains on it.
- Whether `ASSISTANT_DIAGNOSTICS_FILE` is ever set anywhere reachable by
  visitors. In this repository it is not.

## 7. What could be done here first, without the owner

- **Done, and only this:** a dry run that counts what a stated cutoff would
  reach (section 2). It requires the cutoff as an argument, prints counts alone,
  deletes nothing and runs on no schedule.
- **Not started: the deletion itself.** Three separate pieces of work, none
  written: a prune of `assistant_client`, a prune of `assistant_session`, and an
  update that clears `session_id` on settled, reconciled `assistant_usage` rows.
  Each needs the window first, which is the owner's to choose.
- Whether `assistant_usage` needs `session_id` at all after reconciliation is
  now answered in code as a proposal rather than a question: the report counts
  the link as droppable once the row is settled and reconciled, and keeps the
  row. That is a classification somebody can disagree with, not a decision, and
  nothing drops the link today.
