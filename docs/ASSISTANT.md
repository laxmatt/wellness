# The shopping assistant

Optional throughout. Browsing, filtering, product pages and comparison never call it and never wait on it. With no API key configured the whole site works; only the chat panel changes behaviour, and it says so on screen.

## Where to put the API key

Never paste a key into a chat, an issue, a commit or a screenshot.

There are two ways for the application to authenticate, set by `ASSISTANT_CREDENTIAL_MODE`. The default is unchanged from before this option existed.

### `api_key` mode (default)

This application reads `OPENAI_API_KEY` and sends it as a bearer token. Put the key in one of these places, all outside the repository:

**Local development.** Create `.env.local` in the project root, which `.gitignore` already excludes:

```
OPENAI_API_KEY=sk-...
```

Copy `.env.example` for the full list of optional settings. Restart `npm run dev` afterwards; Next.js reads env files at boot.

**Vercel.** Project → Settings → Environment Variables → Add. Name `OPENAI_API_KEY`, value the key, scope Production and Preview. Mark it sensitive so it is write-only afterwards. Redeploy for it to take effect.

**Anywhere else** (Fly, Render, a container): set it as a process environment variable through that platform's secret store. Never in a Dockerfile, never in `next.config.ts`, never in a `NEXT_PUBLIC_` variable.

### `proxy` mode

For running inside a Claude Code cloud environment on a Pro or Max plan. The key is stored as an **API credential** on the environment, and Anthropic's agent proxy attaches it to requests bound for `api.openai.com` after they leave the session. Per Anthropic's documentation the key never reaches the session's environment variables, its files, or the agent working in it.

Set `ASSISTANT_CREDENTIAL_MODE=proxy` and leave `OPENAI_API_KEY` unset. The application then sends no authorization header of its own and lets the proxy supply one.

**Start the server with `NODE_USE_ENV_PROXY=1`.** The proxy attaches the
credential only to requests that go through it by `CONNECT`, and Node's built-in
`fetch` ignores `HTTPS_PROXY` unless this is set. Without it the request is
intercepted and refused with a `403` before it reaches OpenAI, which this
application cannot tell apart from a refusal by OpenAI itself, so it holds the
reservation as an uncertain charge. Two live-test runs failed this way before
the cause was found; see `docs/live-test-results/2026-09-08T19-20.md`.

Set it on the process that starts the server, not in `.env.local`: Node reads it
at startup, before any file the application loads. Confirm the running server
actually has it, rather than the shell you typed it in:

```
tr '\0' '\n' < /proc/$(pgrep -f next-server | head -1)/environ | grep NODE_USE_ENV_PROXY
```

**Verifying that the credential is attached.** Both failure modes answer `403`,
so a status code alone tells you nothing. Print the headers and the body:

```
NODE_USE_ENV_PROXY=1 node -e "
fetch('https://api.openai.com/v1/models').then(async r => {
  console.log('status', r.status);
  for (const h of ['openai-processing-ms','x-request-id','x-proxy-error','content-type'])
    if (r.headers.get(h)) console.log(h + ':', r.headers.get(h));
  console.log('body:', (await r.text()).slice(0, 200));
});"
```

Three specific pieces of evidence, in order of what each one proves:

1. **`openai-processing-ms` and `x-request-id`.** OpenAI's edge sets these. Their
   presence means the request left the proxy and OpenAI produced the response.
   Without them, whatever answered was not OpenAI.
2. **`x-proxy-error: upstream denied the request: connection "<name>", host
   "api.openai.com"`.** The agent proxy writes this when it relayed a request
   that the upstream refused, and it names the credential connection it used.
   That is the direct statement that a credential was attached, and which one.
3. **A body that answers about a specific credential**, such as a message naming
   the key's missing scopes or the account's billing state. A response evaluated
   against a key is a response to an authenticated request.

A JSON body on its own proves nothing: any intermediary can return JSON, with an
`error` field of any shape. The headers, not the body's format, are what
separate an answer from OpenAI from an answer from something in front of it.

The failure to look for is `content-type: text/plain` with a body beginning
`Host not in allowlist: api.openai.com`, and none of the headers above. That is
the interceptor refusing the request before it ever left, with no credential
attached.

Three refusals, all deliberate:

- **A host other than `https://api.openai.com`** is rejected. The proxy attaches credentials by hostname, so any other host would receive an unauthenticated request, or an authenticated one the operator did not intend. The provider re-checks this before every send and fails as `not_billed`.
- **Both a key and proxy mode** is rejected. Which credential paid for a request is not a question to answer by preference.
- **An unrecognised mode** is rejected rather than falling back to something that might work.

Everything else is unchanged in proxy mode: the shared ledger, the monthly cap, reservations, the session turn limit, the per-connection hourly limit, the trusted client address, the medical boundary and the request bounds all apply exactly as they do with a key. There are route-level tests for each of those under proxy mode.

`GET /api/admin/assistant-usage` reports the active mode and base URL, never the credential.

### In either mode

The key is read only inside `src/app/api/assistant/route.ts`, which runs on the server. It is never sent to the browser and never logged. The provider's error bodies are discarded rather than truncated: a failed call produces only a status code and a fixed sentence, so a key echoed back in an error body has nowhere to go.

Restrict the key at the provider: give it access to the one model you intend to use, and set a hard billing limit on the account as a second line of defence behind the application cap below.

## Spend control

A shared Postgres ledger, required before a live model will run at all.

| Limit | Default | Setting |
| --- | --- | --- |
| Monthly spend | $25 | `ASSISTANT_MONTHLY_CAP_USD` |
| Replies per session | 20 | `ASSISTANT_SESSION_TURN_LIMIT` |
| Requests per connection per hour | 30 | `ASSISTANT_CLIENT_HOURLY_LIMIT` |
| Prompt size | 6000 tokens | `ASSISTANT_MAX_INPUT_TOKENS` |
| Reply size | 500 tokens | `ASSISTANT_MAX_OUTPUT_TOKENS` |
| Reservation margin | 1.3x | `ASSISTANT_ESTIMATE_SAFETY_FACTOR` |
| Model | `gpt-4o-mini` | `OPENAI_MODEL` |

Reading a total, deciding there is room, then spending is not safe: two requests arriving together both read the same total and both proceed. So the budget is **reserved** instead. Before each call the request reserves the most it could possibly cost in one conditional `UPDATE` that refuses when the cap would be exceeded. After the call the reservation is released and the outcome recorded. Concurrency cannot spend past the cap; the worst case is that a request is refused while other reservations are outstanding. Settlement is keyed on a unique reservation id, so a retry cannot double-count.

### Never point the tests at the application's database

`src/__tests__/postgres-ledger.test.ts` drops every ledger table after each test, because it tests the migration path against a real Postgres. Pointed at a database an application instance is using, it destroys that instance's accounting. That happened on 2026-09-08 and cost this project its only real spend record; see `docs/live-test-results/LEDGER-HISTORY.md`.

Comparing `TEST_DATABASE_URL` to `DATABASE_URL` as text does not prevent it, because two different strings reach the same database through a host alias, a different user, an added option, or a socket instead of TCP. So there are two barriers, of different kinds.

**Permissions, which Postgres enforces.** Give the tests a role that cannot reach the application's database at all:

```
CREATE ROLE wellness_tester LOGIN PASSWORD '<a local password>';
REVOKE ALL ON DATABASE <application database> FROM PUBLIC;
CREATE DATABASE wellness_ledger_test OWNER <application role>;
GRANT ALL ON DATABASE wellness_ledger_test TO wellness_tester;
\connect wellness_ledger_test
GRANT ALL ON SCHEMA public TO wellness_tester;
```

A misaimed connection string is then refused before any statement runs:
`FATAL: permission denied for database ... User does not have CONNECT privilege`.

**A marker inside the database, which the suite checks itself.** In the throwaway database only:

```
CREATE TABLE disposable_test_database (note TEXT);
```

The suite refuses to run without it, naming the database it reached. Identity is established from inside the database, so no connection-string trick gets past it, and the application's database will never carry the marker.

Set `TEST_DATABASE_URL` to the restricted role on the disposable database. Without it the Postgres tests skip.

Set `DATABASE_URL` to a Postgres instance. The tables are created on first use. Without it the meter falls back to an in-process store, which is marked not shared, and **the route refuses to run a live model against it** rather than enforcing a private cap per instance. For local development on one machine you may set `ASSISTANT_ALLOW_UNSHARED_LEDGER=1`; never set it in a deployed environment.

Cost is computed from `ASSISTANT_INPUT_USD_PER_MTOK` and `ASSISTANT_OUTPUT_USD_PER_MTOK`, dollars per million tokens. **These defaults are a planning assumption, not a quote.** Set them from the provider's current price list, then set `ASSISTANT_PRICES_VERIFIED=1` so the admin endpoint reports that they were checked.

#### Price verification record

| Checked | Model | Input, USD per Mtok | Output, USD per Mtok | Source |
| --- | --- | --- | --- | --- |
| 2026-09-08 | `gpt-4o-mini` | 0.15 | 0.60 | OpenAI's official model pricing page |

Checked by the operator against OpenAI's own page, not by anything in this repository. A Claude Code cloud container has no egress to `openai.com`, so a run inside one cannot confirm these numbers and must not claim to. `ASSISTANT_PRICES_VERIFIED=1` records that a person checked, on the date above, and nothing more.

It goes stale the moment OpenAI changes a price. Re-check before any run whose cost figure you intend to rely on, and update the row.

### What the reservation is, and is not

Two different things, and the difference matters:

**The output side is a real cap.** Every call sends `max_tokens: ASSISTANT_MAX_OUTPUT_TOKENS`. The provider will not generate past it. That number is enforced by them, not by us.

**The input side is an estimate.** Before reserving, the route measures the whole prompt, system text and catalogue included, not just the shopper's message. It drops the oldest turns until the estimate fits `ASSISTANT_MAX_INPUT_TOKENS`, and refuses the request outright if a single message still does not fit. But the measurement is `characters / 3.5`. That is not OpenAI's tokenizer and it will disagree with it. `ASSISTANT_ESTIMATE_SAFETY_FACTOR` reserves 30 percent more than the estimate to leave room for the difference.

So the reservation is a conservative estimate that fails in the safe direction. **It is not a guaranteed ceiling on your bill.** A prompt that tokenizes worse than 3.5 characters per token, by more than 30 percent, costs more than was reserved for it. That is unlikely with ordinary English and possible with unusual input.

The only enforceable ceiling is the hard spend limit set at OpenAI. Set one. The application cap exists to stop the bill long before that, and to stop it per session and per connection, which the provider limit cannot do.

### Where the cap can still underestimate

Stated plainly, because none of these are fixed by the code:

1. **Token estimation.** Our count is characters divided by 3.5, not a tokenizer. Text that tokenizes badly (long identifiers, unusual scripts, dense punctuation) uses more tokens per character than the estimate assumes. The safety factor covers a wide margin, not an unbounded one, and nothing in this application closes the gap.
2. **Price drift.** The cap converts tokens to dollars using two numbers you set by hand. If OpenAI changes prices, or the configured model is unavailable and a costlier one serves the request, the ledger under-reports. It is only as accurate as those two numbers.
3. **Charges we cannot see.** The provider bills for things the ledger has no view of: retries inside their infrastructure, cached-prompt accounting, usage attributed after the fact. A reply that arrives without token counts is caught and held as uncertain. A charge that never surfaces in any response is not.
4. **Reconciliation lag.** Uncertain charges are held at the reservation estimate until an operator closes them out. Until then `spentUsd` is a lower bound and `uncertainUsd` is the exposure.
5. **Provider enforcement lag.** OpenAI's own hard limit is not instantaneous either. See below.

For those reasons the application cap is the first line of defence, never the only one.

### Failed calls are not assumed free

A timeout does not mean the provider did no work. Every call ends in one of three outcomes, recorded in `assistant_usage.outcome`:

| Outcome | When | Ledger effect |
| --- | --- | --- |
| `billed` | A 200 with readable usage figures | Real cost added to `spent_usd` |
| `not_billed` | The provider rejected it before inference: a 4xx, or a connection that never opened (`ENOTFOUND`, `ECONNREFUSED`) | Reservation released, zero recorded |
| `uncertain` | It was sent and then went dark: a timeout, a dropped connection, a 5xx, or a 200 whose body could not be read | Reservation released, the **estimate held** in `uncertain_usd` |

An uncertain charge keeps counting against the monthly cap. A run of timeouts therefore throttles the assistant rather than spending invisibly behind it. This is deliberately conservative: it can hold more budget than was really spent, which is the safe direction.

**Reconciling.** Only a human can close an uncertain charge, because only the provider's record says what happened.

1. `GET /api/admin/assistant-usage` with the `x-admin-key` header. Read `uncertainCharges`: each has a `reservationId`, a `sessionId`, the reason, the amount held, and a timestamp.
2. Open the provider's usage page for that timestamp and find whether the call was charged, and for how much.
3. Close it out:

```
curl -X POST https://your-host/api/admin/assistant-usage \
  -H "x-admin-key: $ADMIN_ACCESS_KEY" \
  -H "content-type: application/json" \
  -d '{"action":"reconcile","reservationId":"r_2026-09_...","actualUsd":0.0004}'
```

`actualUsd` is `0` when the provider did not charge. The held amount is removed and the real figure moves to `spent_usd`. Reconciling the same id twice returns 404 and changes nothing.

### Reservations that never settled

A request that dies between reserving budget and recording an outcome leaves an `open` row. `GET /api/admin/assistant-usage` lists these under `openReservations`, excluding anything young enough to still be in flight.

**A missing outcome is not a zero cost.** The request may have reached the provider and been charged, and nothing in this application can tell. So closing one is the same operator judgement as reconciling a timeout:

```
# You cannot tell whether it was charged: hold the estimate.
-d '{"action":"release","reservationId":"r_..."}'

# You read the provider's record and it says $0.0004, or says nothing was charged.
-d '{"action":"release","reservationId":"r_...","actualUsd":0.0004}'
```

Without `actualUsd` the estimate moves from `reserved_usd` into `uncertain_usd`, where it keeps counting against the cap until it is reconciled like any other uncertain charge. With it, the figure you confirmed is recorded as spend; zero is allowed, but only as a statement, never as an assumption.

Two refusals: a reservation younger than ten minutes returns 409, because closing a live request's accounting out from under it is how a real charge goes unrecorded, and an id that already settled returns 404.

**A late outcome corrects the books rather than vanishing.** If a settlement arrives after an operator has closed the reservation, it replaces the held estimate with the provider's own figures and the row records that it settled late. Both paths lock the row first, so a settlement and a close racing each other cannot both reach the budget.

That applies to a confirmed close as much as an unknown one. A confirmed close writes `outcome = 'billed'`, and an operator's figure is exactly the kind that a late outcome should correct, so the decision is made from the reason this code wrote, never from the outcome. An ordinary settlement carries no such reason, so duplicate settlements stay idempotent.

**A late outcome that is itself uncertain stays reconcilable.** `reconciled_at` means a charge has been settled against the provider's record, so a late outcome that resolved nothing does not get stamped with it. Stamping it dropped the charge out of `listUncertain` and out of `reconcile`'s `WHERE` clause, leaving money held against the cap that nobody could ever close.

Do this at least monthly, before reading month-to-date spend as fact. A month with a large `uncertainUsd` has not been measured; it has been bounded.

### The provider's own limit

Verified, not assumed. OpenAI offers **hard spend limits** as well as alert thresholds, at both the organization and project level. When one is reached the API returns 429 with `organization_spend_limit_exceeded` or `project_spend_limit_exceeded` and stops serving requests, rather than only emailing.

Two caveats, both from OpenAI's own documentation:

- Enforcement is not instantaneous. A small amount of extra usage can be processed while the limit state propagates. It is a hard stop with a lag, not a hard stop at the exact dollar.
- The limit is set in the provider's dashboard, not by this application. Nothing here can create or verify it at runtime.

So set a project-scoped hard limit, at or slightly above `ASSISTANT_MONTHLY_CAP_USD`, on a key restricted to the one model in use. The application cap should be reached first in normal operation; the provider limit is what catches the failure modes listed above.

Sources: [Spend limits, OpenAI API](https://developers.openai.com/api/docs/guides/spend-limits) and [Troubleshooting API usage and spend limits](https://help.openai.com/en/articles/6614457-troubleshooting-api-usage-and-spend-limits). Re-check both before launch; provider policy changes.

## Rate limits, and identifying the client

The per-session turn limit is keyed on `sessionId`, which the browser generates and sends. Anyone can clear it, edit it, or post a fresh one with every request. **It is a convenience limit.** It stops an ordinary visitor from running a conversation forever. It stops nobody who does not want to be stopped.

The limit that bounds abuse is keyed on the connection: `ASSISTANT_CLIENT_HOURLY_LIMIT` requests per client per hour, checked inside the same transaction as the budget.

### Where the client address comes from

This is the part that is easy to get wrong. `x-forwarded-for` is a header the caller sends. A proxy that *appends* to it leaves the leftmost value under the caller's control, so reading it produces a limit that a single attacker defeats by sending a different value on every request. That is worse than no limit, because it looks enforced.

So the application refuses to guess. One of these must be true before a live model runs:

| Situation | Configuration | Why it is trustworthy |
| --- | --- | --- |
| Vercel | Nothing. Detected by `VERCEL=1` | Vercel documents that it overwrites `x-forwarded-for` and does not forward an externally supplied value. Enterprise plans can opt into a verified proxy that changes this; if you do, set the header explicitly instead. |
| Cloudflare in front | `ASSISTANT_TRUSTED_IP_HEADER=cf-connecting-ip` | Cloudflare sets this at its edge and strips any inbound copy. |
| Your own nginx or similar | `ASSISTANT_TRUSTED_IP_HEADER=x-real-ip` | Only if your config *sets* it (`proxy_set_header X-Real-IP $remote_addr`) rather than passing through what arrived. Check this yourself. |
| Local run, one machine | `ASSISTANT_ALLOW_UNIDENTIFIED_CLIENTS=1` | Nothing is trustworthy, and the flag says so. Every caller shares one bucket. Never set this in a deployed environment. |
| Anything else | None of the above | **A live model will not run.** The panel says the assistant is unavailable and explains why. |

Name a header only if your edge overwrites it. If it merely forwards what arrived, you have configured a bypass, not a limit.

### The salt

The address is hashed before it reaches the ledger, so no readable IP is stored. The hash is only private if the salt is. `ASSISTANT_CLIENT_SALT` must be set and at least 16 characters, or a live model will not run; there is no built-in fallback value, because a fallback in the source code would make every stored hash reversible by anyone who can read this repository. Changing the salt resets the current hour's counts and nothing else.

### What is still needed before public launch

1. **Done: the per-connection hourly limit**, once you have configured the trusted header above and confirmed it on your actual host. Test it: send a request with a forged `x-forwarded-for` and check the limit still counts you as the same client.
2. **Add the platform's own edge rate limit** on `/api/assistant`, by IP, at a threshold slightly above the application's. Vercel WAF or a Cloudflare rule does this in one rule and rejects traffic before it reaches a function, which the application limit cannot. This is the layer that protects you from a flood large enough to cost money in compute rather than tokens.
3. **Only if abuse actually happens: a challenge** on the first assistant request per client. It costs real conversions, so do not add it pre-emptively.

Not done, deliberately: no login, no cookie the visitor must accept, no device fingerprinting. None are proportionate to protecting a $25 monthly budget.

## Watching spend

Customers never see money. The panel says only whether the assistant is available. Spend is operator information, served by `GET /api/admin/assistant-usage` with the `x-admin-key` header matching `ADMIN_ACCESS_KEY`. It reports month-to-date spend, outstanding reservations, held uncertain charges, remaining budget, the worst case per request, whether the ledger is shared, and whether prices have been verified.

**The key goes in the header, never the URL.** A key in a query string is written to server logs, proxy logs, browser history and the `Referer` header of anything the page later loads, which effectively publishes it. The endpoint refuses any request carrying a `key` query parameter, even one whose header is also correct, and says so, so an operator reaching for the old form is told to rotate the key rather than quietly succeeding. Header comparison is constant-time.

## Modes

| Mode | When | What the shopper sees |
| --- | --- | --- |
| `prototype` | No `OPENAI_API_KEY` | A banner: replies come from a scripted stand-in. It reads a budget and a few phrases and names no products. |
| `live` | Key present, within limits | Normal replies. |
| `unavailable` | Cap reached, or the request failed | A banner naming the reason, and a reminder that filters and comparison still work. |

## What the model can and cannot do

It never ranks. It reads the conversation and returns structured preferences; the site's own engine turns those into products, exactly as the filter chips do. The reply and the product list beneath it come from different systems on purpose.

It sees only a shortlist of at most six products, and only sourced facts. Placeholder values are withheld entirely rather than labelled, so demo data cannot become evidence. Every fact is marked `manufacturer_claim` or `sourced`, and unknown fields are listed as not stated.

Its output is parsed by `ModelIntent` and anything outside that shape is dropped. Constraints are checked against real filter keys before they are offered.

**Schema-constrained output is prepared and off.** `ASSISTANT_RESPONSE_FORMAT=json_schema` sends the intent's schema with `strict: true`, so the provider refuses a bad shape during generation rather than this application discarding it afterwards. It targets the one error that has now repeated twice: `{"key":"chiller_included","op":"true","value":true}`, the value written into the operator field.

Strict mode compiles the schema and rejects what it cannot, so the schema is written to its constraints: every object closed with `additionalProperties: false`, every property listed in `required`, and optional values expressed as nullable rather than omitted.

An earlier version of this file said size and length keywords are not supported, full stop. That is wrong as stated. Support is not uniform: OpenAI documents additional restrictions for fine-tuned models, so a keyword a base model compiles is not guaranteed to compile on a fine-tuned one, and the reverse claim cannot be made either from what is readable here. This schema therefore carries no `maxItems`, `minLength`, `minimum` or `maximum` by choice, not by decree, and `STRICT_UNSUPPORTED_KEYWORDS` in `src/providers/ai/OpenAIProvider.ts` is the list this schema declines to use, not a claim about what the API rejects.

**That same version said omitting them "costs nothing". It does not, and the run of 2026-09-09T01:35 measured the cost.** `ModelIntent` does enforce every count and range on every reply, whatever `response_format` was sent. But enforcement after the fact means discarding the whole reply. `suggestCompare` is capped at four and the schema expressed no bound, so strict mode generated five and six ids, the provider accepted them, and two of fifteen cases were thrown away. Both had extracted correctly. One had converted a budget exactly. The shopper saw "I could not read that reliably."

The fix is not a bound in the schema, which cannot be verified without a paid call. It is in `normalize`: an over-long `suggestCompare` is trimmed to the limit rather than failing the reply. A comparison suggestion is optional and the shopper may ignore it; the constraints in the same reply are what the call was for. That holds in `json_object` mode too, where the model was never bound by anything but the prompt.

Trimming is for that field only. A count over the limit on `hard` or `soft` still fails the reply, because those are the shopper's filters and silently dropping four of them would change what the search means. The captured oversized lists from that run are the fixtures in `src/__tests__/oversized-suggestions.test.ts`.

The nullable rule has a consequence the validator had to be taught. Strict mode cannot omit a property, so "no value here" arrives as `value: null`, while `ModelHardConstraint` and `ModelSoftPreference` accept an absent value and refuse a null one. `normalize` translates the null back to an absence before validation. Without it, switching the flag on would discard every preference that has no target value, which is most of them. What it does not do is admit a comparison with nothing to compare against: `toEngineConstraints` refuses any hard operator other than `exists` or `missing` that arrives without a value, because `evaluateCondition` reads a missing target as undefined and returns false for every product, and the shopper would be told nothing matched a request that was never made.

The counts and ranges stay in Zod, which validates every reply either way and is not relaxed by any of this. Tests walk the schema and fail if a declined keyword or an unlisted property reappears, and check that every branch the schema offers for a value is one the validator accepts: the soft branch carries no numeric array, because `ModelSoftPreference` refuses one, and offering the model a shape the validator refuses is how a reply gets discarded for following instructions.

**What could not be verified here, and what it would cost.** The official documentation is unreachable from a Claude Code container: `platform.openai.com` and `developers.openai.com` are both refused by the egress policy. The constraints above come from secondary sources and are encoded as tests, not as belief.

One question remains open and cannot be answered without a request: whether this account and `gpt-4o-mini` accept this schema. The check is cheap and asymmetric. A schema strict mode will not compile comes back as a 400 before inference, which `statusError` settles as `not_billed`, so it costs nothing. A schema it accepts costs one ordinary call, about $0.0004. Send one request with the flag set before running anything longer with it.

**A reply nothing could be read from is a failure, and it changes nothing.** The route marks it `failure: "unreadable_reply"`, keeps the shopper's existing preferences exactly as they were, and returns no proposals. The placeholder intent's empty `hard` and `soft` mean "nothing was understood", not "the shopper asked for nothing": read the second way, a malformed reply offered to clear every filter the shopper had set.

**Money crosses the boundary with its unit attached.** The engine compares money in integer minor units. The model answered "under $700" with `value: 700`, the engine read $7.00, matched nothing, and the shopper was told their budget matched nothing when it matched something. Every layer was correct on a wrong input, so nothing could notice.

The model now sends `{"amount": 700, "currency": "USD"}` in whole dollars, and `src/domain/money-contract.ts` converts it to cents through the decimal string, so 19.99 cannot become 1998. A bare number for a money key is refused, never interpreted: guessing the unit from the size of the number is how "$5" and "$500" become the same request. The refusal fails the whole reply visibly rather than dropping the budget, because a silently missing constraint is what caused the original wrong answer. The same rule covers per-serving budgets, which are money too.

**The model's prose is not displayed.** Its job is one thing: turn a sentence into preferences. Every sentence a shopper reads is composed by `src/domain/reply-composer.ts` from the catalogue and the engine's own result: what constraint was applied, how many products match, what this site does not compare, and a fixed limitation for a question the catalogue cannot answer.

This replaced two rounds of filtering the model's prose, first by instruction and then by pattern. Both were the wrong shape of answer. A filter over English catches the phrasings someone thought of, and the run of 20:57 produced a placeholder price quoted as fact, a manufacturer's figure stated as measured, an explanation of what light does to tissue, and internal evidence markers printed verbatim. Removing the thing being guarded was cheaper than a longer pattern list, and it is the only version of this that can be stated as a guarantee.

**Product facts are rendered by this site.** Each card carries a value and who says so, taken from the catalogue: "verified by this site", "reported by the maker", or "source not recorded". A placeholder price is never sent to the model and never shown as a price. It used to go with a label saying not to rely on it, and the model quoted it to a shopper as "$139"; a label is advice, withholding is not.

**The contract it is given is generated from the schema that validates it.** `CONDITION_OPS`, `SOFT_DIRECTIONS`, `SOFT_WEIGHT_RANGE` and `INTENT_LIMITS` are named once and used twice: to build the enums Zod enforces, and to write the instructions the model receives. They drifted apart once. The prompt described `{"key","op","value"}` without ever naming the ten operators or the three directions that validation requires, and a live run had seven of fifteen replies rejected whole, each one charged for and replaced with an error sentence. Validation was not the problem and was not loosened; the instructions were incomplete. A test fails if either list changes without the other.

**The model is told what it cannot see.** The `CATALOGUE` block is a shortlist of at most six products, chosen before the model replies, out of a category that holds more. It is labelled with both numbers and the model is forbidden from claiming a product does not exist, that nothing meets a constraint, or that a count is complete. Without that, it reported "there are no products listed under $500" while the engine matched one that was ranked just outside the six it was shown.

**Counts and availability are authored by this code, not by the model.** Every reply carries `matchSummary`, written from the engine's own count over every product, and the panel renders it beside the cards it describes, attributed to the site rather than to the assistant. It is true by construction, because nothing the model said goes into it. That is the guarantee.

It is drawn on every reply, including the ones with no products to show and the ones where the assistant's answer could not be read, because those are the cases where the prose above it is least trustworthy. A rendered test covers all three: returning the field without drawing it is not the same thing, and for one commit that is exactly what happened.

The model's prose is also screened against the engine, in `screenModelClaims`: an availability claim pointing the wrong way, or a stated product count that is neither the number that matched nor the size of the category, replaces the text with the authored sentence and sets a notice. **That screen is a heuristic backstop, not enforcement.** It is pattern matching over English, and a paraphrase nobody anticipated will get past it. What makes such a miss survivable is the authored summary sitting beside the prose, not the screen catching everything. Do not describe it as a guarantee.

**Three evidence tiers, not two.** `sourced` is independently verified, `manufacturer_claim` is what the maker reported and must be attributed when used, and `unattributed` covers a value the catalogue records without recording where it came from. That third tier used to be folded into `manufacturer_claim`, which invented an attribution the catalogue never made. Placeholder values are still withheld entirely.

Nothing it suggests is applied automatically. Preference changes and comparison additions arrive as proposals with an Apply and a No thanks, and the proposal states how many products would remain. Applying narrows the grid by the engine's answer for exactly those constraints, not by an approximate chip match.

The medical boundary is enforced in the route before any model call, so it holds even when the model is unavailable or wrong. It matches whole words, not substrings: a shopper asking which drink is healthiest gets an answer, and one asking what will treat, diagnose, cure or heal something gets the redirect. Any word ending in -itis is treated as a named condition, so tendonitis and bursitis are caught without listing every one. Refusing ordinary shopping language is not the safe side of that line; it just looks broken. Chat text is never persisted, never sent to analytics and never used to build a profile.

## The private live test

`npm run assistant:livetest` sends 15 realistic shopper sentences across the three categories to a running instance and reports two things the unit tests cannot.

**Extraction accuracy.** Each case names the constraints a careful person would have entered. The script counts constraints that were missed, and separately counts constraints that were *invented*, which is the worse failure because an invented constraint silently hides products. It also checks that medical questions are declined, that a vague opener produces a question rather than a guess, and that the reply, the cards and the proposal all describe the same set.

**Measured cost.** It reads the ledger before and after through the admin endpoint and divides by the number of conversations, so the figure is observed rather than estimated. A real conversation runs several turns, so multiply by expected turns per session before setting the cap.

### Running it privately

Two kinds of thing appear below and they are not interchangeable. **Commands** are typed into a terminal. **Settings** are lines you save in a file called `.env.local` in the project folder. That file is excluded from version control, so nothing in it is ever committed. Never type a secret into a chat window, an issue or a commit message.

**Step 1. Generate the two secrets this project needs, on your own machine.**

These are commands. Each prints a random string. Copy each one into the settings file in step 3.

```
openssl rand -hex 24      # use the output as ADMIN_ACCESS_KEY
openssl rand -hex 24      # run it again; use this output as ASSISTANT_CLIENT_SALT
```

The two values must be different. Nobody needs to see them, including me.

**Step 2. Get the key from OpenAI.** Create a project, create an API key scoped to that project and to the one model you will use, and set a project hard spend limit with the "Enforce a hard limit" toggle on. Copy the key when it is shown; it is not shown again.

**Step 3. Decide where the key lives.**

*Running inside a Claude Code cloud environment (Pro or Max):* add the key as an **API credential** on the environment, scoped to `api.openai.com`, and set `ASSISTANT_CREDENTIAL_MODE=proxy` in the environment variables. Leave `OPENAI_API_KEY` unset. The key stays outside the session.

*Running on your own machine:* put `OPENAI_API_KEY` in `.env.local` and leave the credential mode alone.

**Step 4. Set the remaining values.** In `.env.local` on your own machine, or in the environment variables box for a cloud environment. Settings, not commands, one per line, no quotes:

```
DATABASE_URL=postgres://...
ADMIN_ACCESS_KEY=<first openssl output>
ASSISTANT_CLIENT_SALT=<second openssl output>
ASSISTANT_ALLOW_UNIDENTIFIED_CLIENTS=1
ASSISTANT_MONTHLY_CAP_USD=5
ASSISTANT_INPUT_USD_PER_MTOK=<from OpenAI's price list today>
ASSISTANT_OUTPUT_USD_PER_MTOK=<from OpenAI's price list today>
ASSISTANT_PRICES_VERIFIED=1
```

Never put `ADMIN_ACCESS_KEY` or `ASSISTANT_CLIENT_SALT` anywhere public. On a cloud environment, anyone using that environment can read the environment variables; only an API credential is hidden from the session.

`ASSISTANT_ALLOW_UNIDENTIFIED_CLIENTS=1` is correct here and wrong anywhere else: a local run has no edge to supply a trustworthy client address. Remove it before deploying.

**Step 5. Start the site.** A command, in one terminal. A production build, not `next dev`, so the test exercises the code that will ship:

```
npm run build && npm start
```

**Step 6. Run the test.** A command, in a second terminal:

```
ASSISTANT_TEST_BASE_URL=http://localhost:3000 npm run assistant:livetest
```

**Diagnosing a rejected reply.** When `ModelIntent` refuses the model's JSON the shopper gets a fixed sentence and the payload is gone, which is right on a live site and useless when a run fails. For the private test only, start the server with a file to write to:

```
ASSISTANT_DIAGNOSTICS_FILE=./.diagnostics/rejected.jsonl NODE_USE_ENV_PROXY=1 npm start
```

Each rejection appends one JSON line: the timestamp, the model, the provider's `finish_reason`, the validator's complaints as `path`, `code` and `message`, and the model's own output truncated to 8000 characters. It records no conversation, no shortlist, no headers and no environment, so a visitor's words cannot reach it. `.diagnostics/` is gitignored; do not commit its contents.

It refuses to write on a deployed host, detected by `VERCEL=1` or an explicit `ASSISTANT_DEPLOYED=1`. It deliberately does **not** key off `NODE_ENV`: the private test runs against a production build, so `next start` sets `NODE_ENV=production` and a check on that would switch diagnostics off in the one runtime they exist for. That was the first version of this gate and it was wrong.

Both capture paths are proven against a production build rather than assumed. Point `OPENAI_BASE_URL` at a local stand-in that returns a deliberately invalid reply, run `npm start`, send one request, and read the file. A schema rejection records `hard.0.op`, `soft.0.direction` and `soft.0.weight` with the offending values; a truncated reply records `(body)` with the provider's `finish_reason`. Neither costs anything and neither leaves the machine.

It reads `ADMIN_ACCESS_KEY` from the same `.env.local`, so the secret is not retyped and never appears in your shell history.

**Step 7. Read three things.** The pass count. The measured cost per conversation, multiplied by your expected turns per session. And any uncertain charges it lists: reconcile each against OpenAI's usage page before treating the cost figure as final.

**Step 8. Commit the report.** The run writes `docs/live-test-results/<timestamp>.md` and `latest.md`, containing the per-case results, the measured cost, any unconfirmed charges and every reply verbatim. Commit it. A run inside a cloud session is on disposable infrastructure, and an uncommitted result is gone when the session ends.

Keep the deployed site without `OPENAI_API_KEY` until you have reviewed the extraction results, the reply wording and the measured cost. With no key set, visitors get the labelled scripted stand-in and every other feature works unchanged.

It aborts if the endpoint answers in anything other than `live` mode, so it cannot be mistaken for a pass against the scripted stand-in. It is a script, not a page, and nothing about it is reachable by a visitor.

Read the replies it prints, not only the score. The script measures extraction and cost; whether the assistant sounds like something you want representing the site is a judgement no script makes.

Nothing here has yet made a single paid request. The $25 cap is a budget, not a measurement.
