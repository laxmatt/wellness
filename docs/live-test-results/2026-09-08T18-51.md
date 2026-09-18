# Live assistant test, 2026-09-08T18:51:10Z

Model: `gpt-4o-mini`. Credential mode: `proxy`. Ledger: `postgres`, shared.
Commit: `53697fc`. Application cap: $1.00.

**The run aborted on the first case. No conversation completed and no
extraction was measured.** The script writes this report itself on a completed
run; this one was written by hand from the ledger and the run logs, because the
script exits before its report step when the endpoint is not in `live` mode.

This file separates what was observed from what was inferred. An earlier
revision of it stated a cause for the failure that the evidence does not
support. That claim is listed under **Withdrawn** below.

## Result

| | |
| --- | --- |
| Cases attempted | 1 of 15 |
| Cases completed | 0 |
| Exit code | 2 (`mode` was `unavailable`, not `live`) |
| Model calls that returned a reply | 0 |

## Cost

| | |
| --- | --- |
| Billed | $0.000000 |
| Held as uncertain | $0.001560 |
| Outstanding reservations | none |
| Month-to-date `spentUsd` | $0.000000 |

| Reservation | Held | Recorded reason |
| --- | --- | --- |
| `r_2026-09_1788893470513_izs521g0` | $0.00156 | The provider returned 403. |

The held amount is the reservation estimate, not a measured charge. It remains
held and unreconciled on purpose: closing it out requires the provider's usage
record for this timestamp, which nothing in this container can read.

## Confirmed

1. The application sent one `POST https://api.openai.com/v1/chat/completions`
   and received HTTP **403**. The route settled the call as `uncertain`, held
   the reservation estimate, and replied in `unavailable` mode. The live test
   aborted rather than score against the scripted stand-in.
2. **The 403 response body was not retained.** `statusError` in
   `src/providers/ai/OpenAIProvider.ts` reads the body only to test its shape,
   then discards it; the stored reason is the status code and a fixed sentence.
   This is the documented behaviour: a failed call is meant to produce a status
   code and nothing else, so a credential echoed in an error body has nowhere to
   go. Searched and empty: the application's stdout, the live-test log, the
   Postgres log, `/var/log`, `/root/.ccr`, and the CLI's own debug log. The body
   is unrecoverable.
3. One property of that body survives, as an inference from the classification
   it produced: it did **not** parse as JSON whose `error` field is an object.
   That is all. It is equally consistent with a JSON body whose `error` is a
   string, a plain-text body, an HTML body, or an empty body.
4. A separate, zero-cost `GET https://api.openai.com/v1/models`, sent twice from
   this container with no key in the environment and no authorization header of
   the application's own, returned **403** both times with identical bodies:

   ```
   {"error":"You have insufficient permissions for this operation. Missing
   scopes: api.model.read. Check that you have the correct role in your
   organization (Reader, Writer, Owner) and project (Viewer, Member, Owner),
   and if you're using a restricted API key, that it has the necessary scopes."}
   ```

5. **That GET response came from OpenAI.** Its headers carry OpenAI's own
   markers, which an intermediary would not manufacture:

   ```
   Openai-Processing-Ms: 386
   Openai-Version: 2020-10-01
   X-Openai-Proxy-Wasm: v0.1
   X-Request-Id: 69df17a9-fcb5-4e32-a3be-72c4e3068839
   Cf-Ray: a380325a1c41be7d-IAD
   Server: cloudflare
   ```

6. The same response also carried a header from Anthropic's agent proxy, naming
   the credential it used and attributing the refusal upstream:

   ```
   X-Proxy-Error: upstream denied the request: connection "OpenAI wellness
   test", host "api.openai.com"
   ```

7. **Credential injection works on that request.** A credential was attached
   after the request left this session, OpenAI evaluated it, and answered about
   that specific key's scopes. The key never entered the session.

## Diagnostic POST, 2026-09-08T19:08:27Z

One authorized `POST https://api.openai.com/v1/chat/completions`, sent by `curl`
outside the application, with `gpt-4o-mini`, a one-word prompt and
`max_tokens: 1`. Not retried.

**Status 429.** Body:

```json
{
  "error": {
    "message": "You have no credits remaining. Add credits to continue using
                the API at https://platform.openai.com/settings/organization/billing/.",
    "type": "insufficient_quota",
    "param": null,
    "code": "credit_balance_exhausted"
  }
}
```

Selected response headers:

```
X-Request-Id: req_b6be4a2d4836414b8b2f9f65249f4754
X-Openai-Proxy-Wasm: v0.1
Cf-Ray: a3803de38de9d909-IAD
Server: cloudflare
Content-Type: application/json; charset=utf-8
Date: Tue, 08 Sep 2026 19:08:27 GMT
```

No `usage` object was returned, because no inference ran. **Cost: $0.00.** No
`X-Proxy-Error` header, so Anthropic's agent proxy relayed this request rather
than denying it.

This request went through `curl`, not the application. **It bypassed the ledger
entirely**: no reservation was taken, no outcome was settled, and no row was
written to `assistant_usage`. The ledger still holds exactly one row, the
uncertain charge from the aborted run.

### What the diagnostic establishes

1. **Credential injection works on `POST /v1/chat/completions`.** The request
   carried no authorization header of its own, reached OpenAI, and was answered
   about the account's billing state. That was previously untested on this path
   and method.
2. **Chat completions permission is not the current blocker.** A permission
   denial returns 403 with an authorization error. This is 429 with
   `insufficient_quota` and `credit_balance_exhausted`, which is a billing state,
   not a scope decision.
3. **The account has no credits.** No inference will run, at any cap or any
   permission setting, until credits are added. The provider's $5 hard limit is
   not the binding constraint while the balance is zero.
4. **Had the application made this call, it would have settled correctly.** The
   body is JSON whose `error` field is an object, so `statusError` classifies it
   `not_billed` and releases the reservation. No uncertain hold.

## Still not established

1. **Why the run's POST returned 403 at 18:51.** The diagnostic 17 minutes later
   returned 429, a different status with a different cause. The earlier body was
   discarded, so the two observations cannot be reconciled from evidence.
   Candidates, neither confirmed: the key lacked inference permission at 18:51
   and gained it before 19:08, or an intermediary denied that request. Nothing
   retained distinguishes them.
2. **Whether the credential was attached to the run's POST.** Injection is now
   confirmed on this path in general. It is not confirmed for that specific
   earlier request.

## Withdrawn

An earlier revision of this file claimed the POST failed because the key lacks a
model inference scope, and listed provider-side permission changes as the fix.
That was an assumption carried over from the GET, and it is withdrawn. The GET
establishes only that model listing is denied. The diagnostic POST above did not
rescue that claim either: it failed on billing, not permission.

Also withdrawn: the argument that a JSON body whose `error` field is a string is
evidence of OpenAI origin. It is not. An intermediary can return that shape. The
GET's origin is established by its headers, not by its body.

## Finding, at the confidence the evidence supports

`statusError` accepts a 4xx as `not_billed` only when the body parses as JSON
whose `error` field is an object, on the reasoning that an error object is
OpenAI's shape and an intermediary's 4xx carries no such evidence.

The GET above is a response OpenAI produced, on header evidence, whose `error`
field is a **string**. So OpenAI returns string-shaped error bodies on at least
one endpoint, and a response of that shape would be settled as `uncertain`
rather than `not_billed`.

Whether that is what happened to the POST is **unknown**, because its body was
not retained. The accounting classification is therefore unchanged, and no code
was modified in response to this run. Changing it on the strength of one
observation from a different endpoint would be the same mistake this file
withdraws above.

## What would answer the open questions

Neither is done, and neither should be done without a decision:

- **Retain evidence on failure.** Record the response status, selected headers
  (`x-request-id`, `openai-processing-ms`, `x-proxy-error`) and a bounded,
  credential-scrubbed body excerpt for non-2xx responses. This is a change to
  the rule that error bodies are discarded entirely, so it needs a deliberate
  decision about what is safe to keep.
- **One controlled POST.** Done, above. It cost nothing and named a cause, but a
  different one from the run's failure.
- **Add credits to the OpenAI account.** Nothing else can proceed first. Until
  then a re-run fails at case 1 on 429, and the ledger will record it correctly
  as `not_billed` rather than holding budget.

## Extraction

Not measured. No case completed.

## Replies, verbatim

None. The assistant never produced a reply during this run.
