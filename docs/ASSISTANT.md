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

The key is read only inside `src/app/api/assistant/route.ts`, which runs on the server. It is never sent to the browser, never logged, and the provider's error bodies are truncated before they reach a response so a key echoed in an error cannot leak.

Restrict the key at the provider: give it access to the one model you intend to use, and set a hard billing limit on the account as a second line of defence behind the application cap below.

## Spend control

A shared Postgres ledger, required before a live model will run at all.

| Limit | Default | Setting |
| --- | --- | --- |
| Monthly spend | $25 | `ASSISTANT_MONTHLY_CAP_USD` |
| Replies per session | 20 | `ASSISTANT_SESSION_TURN_LIMIT` |
| Model | `gpt-4o-mini` | `OPENAI_MODEL` |

Reading a total, deciding there is room, then spending is not safe: two requests arriving together both read the same total and both proceed. So the budget is **reserved** instead. Before each call the request reserves the most it could possibly cost (`maxInputTokens` + `maxOutputTokens` at the configured rates) in one conditional `UPDATE` that refuses when the cap would be exceeded. After the call the reservation is released and the real cost recorded. Concurrency cannot spend past the cap; the worst case is that a request is refused while other reservations are outstanding. Settlement is keyed on a unique reservation id, so a retry cannot double-count, and a failed call settles at zero so its reservation is returned to the budget.

Set `DATABASE_URL` to a Postgres instance. The tables are created on first use. Without it the meter falls back to an in-process store, which is marked not shared, and **the route refuses to run a live model against it** rather than enforcing a private cap per instance. For local development on one machine you may set `ASSISTANT_ALLOW_UNSHARED_LEDGER=1`; never set it in a deployed environment.

Cost is computed from `ASSISTANT_INPUT_USD_PER_MTOK` and `ASSISTANT_OUTPUT_USD_PER_MTOK`, dollars per million tokens. **These defaults are a planning assumption, not a quote.** Set them from the provider's current price list, then set `ASSISTANT_PRICES_VERIFIED=1` so the admin endpoint reports that they were checked. The cap is only as accurate as these two numbers, so keep a hard billing limit at the provider as well.

## Watching spend

Customers never see money. The panel says only whether the assistant is available. Spend is operator information, served by `GET /api/admin/assistant-usage` with the `x-admin-key` header (or `?key=`) matching `ADMIN_ACCESS_KEY`. It reports month-to-date spend, outstanding reservations, remaining budget, the worst case per request, whether the ledger is shared, and whether prices have been verified.

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

```
# a throwaway key with a low hard limit at the provider
OPENAI_API_KEY=sk-...
DATABASE_URL=postgres://...
ADMIN_ACCESS_KEY=...
npm run build && npm start          # in one terminal
ASSISTANT_TEST_BASE_URL=http://localhost:3000 npm run assistant:livetest
```

It aborts if the endpoint answers in anything other than `live` mode, so it cannot be mistaken for a pass against the scripted stand-in. It is a script, not a page, and nothing about it is reachable by a visitor.

Read the replies it prints, not only the score. The script measures extraction and cost; whether the assistant sounds like something you want representing the site is a judgement no script makes.

Nothing here has yet made a single paid request. The $25 cap is a budget, not a measurement.
