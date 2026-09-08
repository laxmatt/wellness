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

Nothing it suggests is applied automatically. Preference changes and comparison additions arrive as proposals with an Apply and a No thanks, and the proposal states how many products would remain. Applying narrows the grid by the engine's answer for exactly those constraints, not by an approximate chip match.

The medical boundary is enforced in the route before any model call, so it holds even when the model is unavailable or wrong. Chat text is never persisted, never sent to analytics and never used to build a profile.

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

**Step 2. Get the third secret from OpenAI.** Create a project, create an API key scoped to that project and to the one model you will use, and set a project hard spend limit with the "Enforce a hard limit" toggle on. Copy the key when it is shown; it is not shown again.

**Step 3. Create `.env.local` in the project folder.** These are settings, not commands. Paste the values you collected, one per line, no quotes:

```
OPENAI_API_KEY=sk-...
DATABASE_URL=postgres://...
ADMIN_ACCESS_KEY=<first openssl output>
ASSISTANT_CLIENT_SALT=<second openssl output>
ASSISTANT_ALLOW_UNIDENTIFIED_CLIENTS=1
ASSISTANT_MONTHLY_CAP_USD=5
ASSISTANT_INPUT_USD_PER_MTOK=<from OpenAI's price list today>
ASSISTANT_OUTPUT_USD_PER_MTOK=<from OpenAI's price list today>
ASSISTANT_PRICES_VERIFIED=1
```

`ASSISTANT_ALLOW_UNIDENTIFIED_CLIENTS=1` is correct here and wrong anywhere else: a local run has no edge to supply a trustworthy client address. Remove it before deploying.

**Step 4. Start the site.** A command, in one terminal. A production build, not `next dev`, so the test exercises the code that will ship:

```
npm run build && npm start
```

**Step 5. Run the test.** A command, in a second terminal:

```
ASSISTANT_TEST_BASE_URL=http://localhost:3000 npm run assistant:livetest
```

It reads `ADMIN_ACCESS_KEY` from the same `.env.local`, so the secret is not retyped and never appears in your shell history.

**Step 6. Read three things.** The pass count. The measured cost per conversation, multiplied by your expected turns per session. And any uncertain charges it lists: reconcile each against OpenAI's usage page before treating the cost figure as final.

Keep the deployed site without `OPENAI_API_KEY` until you have reviewed the extraction results, the reply wording and the measured cost. With no key set, visitors get the labelled scripted stand-in and every other feature works unchanged.

It aborts if the endpoint answers in anything other than `live` mode, so it cannot be mistaken for a pass against the scripted stand-in. It is a script, not a page, and nothing about it is reachable by a visitor.

Read the replies it prints, not only the score. The script measures extraction and cost; whether the assistant sounds like something you want representing the site is a judgement no script makes.

Nothing here has yet made a single paid request. The $25 cap is a budget, not a measurement.
