# Privacy: what the code actually does with visitor data

**Not a privacy notice, and not legal advice.** This is an inventory of what
this repository's code collects, where it sends it, and where it keeps it, so
that whoever writes the notice is writing from the code rather than from a
template. Every claim names the file behind it.

Three facts a notice needs are **not** in this repository and are not guessed
below: who the controller is, how to reach them, and how long anything is kept.

Compiled 2026-09-10 by reading the source. Nothing was tested against a live
deployment, because none is configured here.

## 1. Personal data the site processes

### The visitor's IP address, salted and hashed

`src/domain/client-identity.ts`

The assistant endpoint reads the caller's IP from a proxy header, joins it to a
server-side salt (`ASSISTANT_CLIENT_SALT`, minimum length enforced) and takes
the first 32 hex characters of a SHA-256 digest:

```
createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32)
```

That hash is the key for an hourly rate limit. The raw IP is not stored.

**A salted hash of an IP is still personal data** under UK and EU law: it
singles out a device, and the salt makes it stable rather than anonymous. A
notice has to cover it. It is not a cookie, so cookie-consent rules are a
separate question from this one.

If the salt is not configured the endpoint refuses to run at all, unless
`ASSISTANT_ALLOW_UNIDENTIFIED_CLIENTS=1`, in which case every caller shares one
bucket named `local-unidentified` and no IP is processed.

### What the visitor types into the assistant

`src/app/api/assistant/route.ts`, `src/domain/assistant.ts`

Up to 40 messages of conversation are accepted in a request and forwarded to
the model provider. Free text a person types is exactly the kind of field where
someone volunteers a health condition, and this site is about wellness
products, so a notice should assume it happens.

The messages are **not** written to the database. Only token counts and cost
are (see below). They do leave the server: see section 3.

### A session identifier the browser generates

`src/components/assistant/AssistantProvider.tsx`

A random id in `sessionStorage` under `wc.assistant.session`, cleared when the
tab closes. It goes to the server with each assistant request and is stored.

### A compare selection in the browser

`src/components/compare/CompareProvider.tsx`

Product ids in `localStorage`. The file's own comment says it never leaves the
browser, and nothing in the code contradicts that.

## 2. What is written to the database

`src/providers/usage/PostgresUsageStore.ts`

| table | columns | what it is |
| --- | --- | --- |
| `assistant_client` | `client_key`, `hour_bucket`, `requests` | the salted IP hash and how many requests it made in an hour |
| `assistant_session` | `session_id`, `turns`, `first_seen` | the browser's session id, a turn count, a first-seen timestamp |
| `assistant_usage` | `reservation_id`, `month`, `session_id`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `settled_at`, `outcome`, `reason` | one row per model call: cost accounting, tied to a session id |
| `assistant_budget` | `month`, `reserved_usd`, `spent_usd`, `uncertain_usd` | monthly spend totals, no personal data |

No message content is stored. No name, email or account exists anywhere in the
schema: the site has no accounts.

**There is no deletion or retention code.** No `DELETE`, no expiry, no pruning
job anywhere in the store. Rows accumulate. Whoever writes the notice has to
either state a retention period and have somebody implement it, or describe
what actually happens, which today is "kept indefinitely". This is the single
largest gap between the code and any notice that could be published.

## 3. Where data goes outside this system

1. **The model provider.** Conversation text, including anything a visitor
   typed, is sent to whichever provider is configured. In this repository the
   assistant runs against a local stub in tests and a provider is selected at
   runtime; the notice must name the real one, and it belongs in the notice as
   a processor.
2. **The host.** Any host receives request logs including raw IPs, before this
   code sees them. Not visible from here.
3. **The database host.** Wherever `DATABASE_URL` points.
4. **Outbound product links.** Ordinary links to makers and retailers, carrying
   `rel="sponsored nofollow noopener"` and no tracking parameter. Following one
   tells that retailer what a normal link would; nothing is appended by this
   site. There is no affiliate programme, so no affiliate network receives
   anything.

## 4. What the site does not do

Verified by reading the code, and worth stating because it shortens a notice:

- **No cookies are set.** No `document.cookie` write anywhere in `src/`, and no
  `Set-Cookie` in any route.
- **No analytics, tag manager or pixel.** No third-party script tag in
  `src/app/layout.tsx` or any component.
- **No accounts, logins, or email collection.** No auth code, no forms that
  submit personal details.
- **No advertising, and no data sold or shared for advertising.**
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

## 6. What could be done here first, without the owner

- Implement retention: a scheduled delete of `assistant_client` rows older than
  a chosen window is a small job, and the window is the owner's call, not the
  code's.
- Consider whether `assistant_usage` needs `session_id` at all after
  reconciliation, or whether cost accounting can keep the row and drop the link
  to a session.
