# Browser checks

Nothing here calls a model or spends anything. The app runs for real, the page
and the panel are the real ones, and only the model is replaced by a stub
server the check starts itself.

## Running

Start the app with the model stubbed and the ledger pointed away from the real
one, so a scripted call can never reach the spend record the paid runs are
written to:

```
ASSISTANT_CREDENTIAL_MODE=api_key \
DATABASE_URL="postgres://wellness_tester:testonly@127.0.0.1:5432/wellness_ledger_test" \
OPENAI_API_KEY=sk-e2e-stub \
OPENAI_BASE_URL=http://127.0.0.1:3999 \
ADMIN_ACCESS_KEY=... ASSISTANT_CLIENT_SALT=... \
ASSISTANT_CLIENT_HOURLY_LIMIT=500 ASSISTANT_SESSION_TURN_LIMIT=100 \
npm start
```

The rate limits are raised because they are cumulative per client and the
server outlives a single run: the fourth scenario hit the default of 30 an
hour and the assistant reported itself unavailable, which looks exactly like a
product defect and is not one.

The disposable database has no `assistant_usage` table and the check does not
create one, so the stub's calls are recorded nowhere. That is deliberate: what
matters is that they cannot reach the real ledger, and pointing `DATABASE_URL`
away from it is what guarantees that. Confirm the real ledger is unchanged
after any browser check.

`ASSISTANT_CREDENTIAL_MODE` has to be passed explicitly: `.env.local` sets it
to `proxy`, and proxy mode refuses any base URL but OpenAI's own, so the stub
would never be reached and the assistant would report itself unavailable.

Then:

```
npm run e2e:setaside
```

The container's Chromium is a different build from the one the `playwright`
package expects, so the check names it: `/opt/pw-browsers/chromium`. Override
with `CHROMIUM_PATH` elsewhere.

## What each check is for

- `set-aside-updates-page.mjs` — setting a constraint aside in the panel has
  to change what the category page shows, not only what the provider holds.
  The count, the product cards and the band naming the constraints are what a
  shopper sees. It prints all three after every action, in four orders: Apply
  then the alternative, the alternative before Apply, two successive
  alternatives, and the constraint chip's own remove control down to nothing.

  The product list is read from the filtered grid alone. The page links to
  products from the winners row and the ranking sections too, and counting
  those made a correct grid look wrong for two runs.
