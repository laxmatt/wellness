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

Three independent limits, enforced by this application before any request is made:

| Limit | Default | Setting |
| --- | --- | --- |
| Monthly spend | $25 | `ASSISTANT_MONTHLY_CAP_USD` |
| Replies per session | 20 | `ASSISTANT_SESSION_TURN_LIMIT` |
| Model | `gpt-4o-mini` | `OPENAI_MODEL` |

`UsageMeter.check()` runs before every model call and never after. When either limit is reached the route returns a reply with `mode: "unavailable"`, the panel shows why, and filters and comparison are untouched. If the usage ledger cannot be read the meter fails closed and refuses to spend.

Cost is computed from `ASSISTANT_INPUT_USD_PER_MTOK` and `ASSISTANT_OUTPUT_USD_PER_MTOK`, dollars per million tokens. **These defaults are a planning assumption, not a quote.** Set them from the provider's current price list before enabling the key; the monthly cap is only as accurate as these two numbers.

The ledger is a JSON file at `.data/assistant-usage.json` (gitignored). That is correct for one operator on one machine and **wrong on serverless**, where the filesystem is per-instance and may reset between requests: two instances would each count their own spend and the real total could reach several times the cap. Before deploying the assistant to Vercel, replace `FileUsageStore` with a Postgres or Redis implementation of the same `UsageStore` interface. Until then, keep the provider-side billing limit set.

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

## Before public launch

Two things are not done and must not be skipped.

1. **Recommendation accuracy.** Write 20 to 30 realistic prompts per category with an expected outcome for each, run them against the live model, and record how often the extracted constraints match what a person would have entered. Failures to look for: constraints invented, constraints dropped, a budget misread, a medical question answered. `src/__tests__/assistant.test.ts` covers the deterministic guards; it does not measure whether the model understands people.
2. **Real cost per conversation.** Run those same prompts with the key connected and read `.data/assistant-usage.json`. Divide recorded spend by conversations to get an observed cost per conversation, then set the monthly cap against expected traffic. The $25 figure is a budget, not a measurement, and nothing here has yet made a single paid request.
