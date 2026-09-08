# The shopping assistant

Optional throughout. Browsing, filtering, product pages and comparison never call it and never wait on it. With no API key configured the whole site works; only the chat panel changes behaviour, and it says so on screen.

## Where to put the API key

Never paste a key into a chat, an issue, a commit or a screenshot. Two places, both outside the repository:

**Local development.** Create `.env.local` in the project root, which `.gitignore` already excludes:

```
OPENAI_API_KEY=sk-...
```

Copy `.env.example` for the full list of optional settings. Restart `npm run dev` afterwards; Next.js reads env files at boot.

**Vercel.** Project → Settings → Environment Variables → Add. Name `OPENAI_API_KEY`, value the key, scope Production and Preview. Mark it sensitive so it is write-only afterwards. Redeploy for it to take effect.

**Anywhere else** (Fly, Render, a container): set it as a process environment variable through that platform's secret store. Never in a Dockerfile, never in `next.config.ts`, never in a `NEXT_PUBLIC_` variable.

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

Set `DATABASE_URL` to a Postgres instance. The tables are created on first use. Without it the meter falls back to an in-process store, which is marked not shared, and **the route refuses to run a live model against it** rather than enforcing a private cap per instance. For local development on one machine you may set `ASSISTANT_ALLOW_UNSHARED_LEDGER=1`; never set it in a deployed environment.

Cost is computed from `ASSISTANT_INPUT_USD_PER_MTOK` and `ASSISTANT_OUTPUT_USD_PER_MTOK`, dollars per million tokens. **These defaults are a planning assumption, not a quote.** Set them from the provider's current price list, then set `ASSISTANT_PRICES_VERIFIED=1` so the admin endpoint reports that they were checked.

### The reservation bounds the request that is actually sent

A reservation is only meaningful if the request it pays for cannot exceed it. Both sides are held:

- **Output.** Every call sends `max_tokens: ASSISTANT_MAX_OUTPUT_TOKENS`. The provider cannot generate past it.
- **Input.** Before reserving, the route estimates the whole prompt, system text and catalogue included, not just the shopper's message. It drops the oldest turns until the estimate fits `ASSISTANT_MAX_INPUT_TOKENS`. If a single message still does not fit, the request is refused and no budget is taken.

The estimate is `characters / 3.5`, which is not the provider's tokenizer. `ASSISTANT_ESTIMATE_SAFETY_FACTOR` reserves 30 percent more than the bound to absorb the difference.

### Where the cap can still underestimate

Stated plainly, because none of these are fixed by the code:

1. **Token estimation.** Our count is an approximation. Text that tokenizes badly (long identifiers, unusual scripts) uses more tokens per character than the estimate assumes. The safety factor covers a wide margin, not an unbounded one.
2. **Price drift.** The cap converts tokens to dollars with two numbers set by hand. If the provider changes prices, or the configured model falls back to a costlier one, the ledger under-reports. It is only as accurate as those two numbers.
3. **Charges we cannot see.** The provider may bill for things the ledger has no view of at all: request retries inside their infrastructure, cached-prompt accounting, or a model that returns usage figures we do not read. The `uncertain` bucket below covers the cases we can detect; it does not cover ones we cannot.
4. **Reconciliation lag.** Uncertain charges are held at the reservation estimate until an operator closes them out. Until then the ledger's `spentUsd` is a lower bound and `uncertainUsd` is the exposure.
5. **Provider enforcement lag.** OpenAI's own limit is not instantaneous either (below).

For those reasons the application cap is the first line of defence, never the only one. Set a hard limit at the provider too.

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

Do this at least monthly, before reading month-to-date spend as fact. A month with a large `uncertainUsd` has not been measured; it has been bounded.

### The provider's own limit

Verified, not assumed. OpenAI offers **hard spend limits** as well as alert thresholds, at both the organization and project level. When one is reached the API returns 429 with `organization_spend_limit_exceeded` or `project_spend_limit_exceeded` and stops serving requests, rather than only emailing.

Two caveats, both from OpenAI's own documentation:

- Enforcement is not instantaneous. A small amount of extra usage can be processed while the limit state propagates. It is a hard stop with a lag, not a hard stop at the exact dollar.
- The limit is set in the provider's dashboard, not by this application. Nothing here can create or verify it at runtime.

So set a project-scoped hard limit, at or slightly above `ASSISTANT_MONTHLY_CAP_USD`, on a key restricted to the one model in use. The application cap should be reached first in normal operation; the provider limit is what catches the failure modes listed above.

Sources: [Spend limits, OpenAI API](https://developers.openai.com/api/docs/guides/spend-limits) and [Troubleshooting API usage and spend limits](https://help.openai.com/en/articles/6614457-troubleshooting-api-usage-and-spend-limits). Re-check both before launch; provider policy changes.

## Rate limits, and what the session limit is worth

The per-session turn limit is keyed on `sessionId`, which the browser generates and sends. Anyone can clear it, edit it, or post a fresh one with every request. **It is a convenience limit.** It stops an ordinary visitor from running a conversation forever. It stops nobody who does not want to be stopped.

The limit that actually bounds abuse is keyed on the connection: `ASSISTANT_CLIENT_HOURLY_LIMIT` requests per client per hour, taken from `x-forwarded-for` (falling back to `x-real-ip` and `cf-connecting-ip`). The caller does not choose that value. It is hashed with `ASSISTANT_CLIENT_SALT` before it is stored, so the ledger holds no readable IP address.

Both limits are checked inside the same reserve transaction as the budget, so they hold under concurrency.

**Before public launch**, the simplest sufficient protection, in order of effort:

1. **Already done: the per-IP hourly limit.** Set `ASSISTANT_CLIENT_SALT` to a long random string and confirm your host forwards the client address. On Vercel and Cloudflare it is set for you; behind your own proxy, verify it, because a missing header collapses every visitor into one bucket and the limit then throttles the whole site.
2. **Add the platform's own edge rate limit** on `/api/assistant`, by IP, at a threshold slightly above the application's. Vercel WAF or Cloudflare rules do this in one rule and reject the traffic before it reaches a function, which the application limit cannot.
3. **Only if abuse actually happens: a proof-of-work or CAPTCHA challenge** on the first assistant request per client. This costs real conversions, so do not add it pre-emptively.

What is deliberately not done: no login, no cookie the visitor must accept, no device fingerprinting. The assistant is optional, and none of those are proportionate to protecting a $25 monthly budget.

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

Nothing it suggests is applied automatically. Preference changes and comparison additions arrive as proposals with an Apply and a No thanks, and the proposal states how many products would remain. Applying narrows the grid by the engine's answer for exactly those constraints, not by an approximate chip match.

The medical boundary is enforced in the route before any model call, so it holds even when the model is unavailable or wrong. Chat text is never persisted, never sent to analytics and never used to build a profile.

## The private live test

`npm run assistant:livetest` sends 15 realistic shopper sentences across the three categories to a running instance and reports two things the unit tests cannot.

**Extraction accuracy.** Each case names the constraints a careful person would have entered. The script counts constraints that were missed, and separately counts constraints that were *invented*, which is the worse failure because an invented constraint silently hides products. It also checks that medical questions are declined, that a vague opener produces a question rather than a guess, and that the reply, the cards and the proposal all describe the same set.

**Measured cost.** It reads the ledger before and after through the admin endpoint and divides by the number of conversations, so the figure is observed rather than estimated. A real conversation runs several turns, so multiply by expected turns per session before setting the cap.

To run it privately, before any public activation:

1. **At the provider.** Create a project, create a key scoped to that project and to the one model you will use, and set a project hard spend limit (say $5) plus an alert below it. Do not use an organization-wide key.
2. **Set up a Postgres database** the run can reach. Any instance will do; the tables are created on first use. Without it the endpoint answers in `unavailable` mode and the script aborts, by design.
3. **Put the secrets in the environment, not in a file you might commit.** Either `.env.local` (gitignored) or exported in the shell that starts the server:

```
OPENAI_API_KEY=sk-...                       # the project-scoped key
DATABASE_URL=postgres://...
ADMIN_ACCESS_KEY=$(openssl rand -hex 24)    # long and random
ASSISTANT_CLIENT_SALT=$(openssl rand -hex 24)
ASSISTANT_MONTHLY_CAP_USD=5                 # below the provider limit for the test
ASSISTANT_INPUT_USD_PER_MTOK=...            # from the provider's current price list
ASSISTANT_OUTPUT_USD_PER_MTOK=...
ASSISTANT_PRICES_VERIFIED=1
```

4. **Run it against a production build**, not `next dev`, so the code path is the one that will ship:

```
npm run build && npm start          # in one terminal
ASSISTANT_TEST_BASE_URL=http://localhost:3000 \
ADMIN_ACCESS_KEY=<the same value> \
npm run assistant:livetest
```

5. **Read three things afterwards.** The pass count. The measured cost per conversation, multiplied by your expected turns per session. And any uncertain charges the script lists: reconcile each one against the provider's usage page before you treat the cost figure as final.
6. **Keep it private.** Nothing about the run is reachable by a visitor, but the deployed site should stay without `OPENAI_API_KEY` until you have reviewed the extraction results, the reply wording and the measured cost. With no key set, visitors get the labelled scripted stand-in and every other feature works unchanged.

It aborts if the endpoint answers in anything other than `live` mode, so it cannot be mistaken for a pass against the scripted stand-in. It is a script, not a page, and nothing about it is reachable by a visitor.

Read the replies it prints, not only the score. The script measures extraction and cost; whether the assistant sounds like something you want representing the site is a judgement no script makes.

Nothing here has yet made a single paid request. The $25 cap is a budget, not a measurement.
