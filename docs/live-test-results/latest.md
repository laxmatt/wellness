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

## Not established

1. **Why the POST returned 403.** The scope the GET names, `api.model.read`,
   governs listing models. It does not govern chat completions. The operator
   reports that the chat completions permission on this key is set to Request.
   Nothing observed here contradicts that, and nothing observed here explains
   the POST.
2. **Whether the POST's 403 came from OpenAI or from an intermediary.** The
   headers and body that would answer it were discarded before anything recorded
   them.
3. **Whether a credential was attached to the POST.** Confirmed for
   `GET /v1/models`. Not tested for `POST /v1/chat/completions`, which is a
   different path and method.

## Withdrawn

An earlier revision of this file claimed the POST failed because the key lacks a
model inference scope, and listed provider-side permission changes as the fix.
That was an assumption carried over from the GET, and it is withdrawn. The GET
establishes only that model listing is denied.

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
- **One controlled POST.** A single `POST /v1/chat/completions` with a one-word
  prompt and `max_tokens: 1`, capturing headers. A 403 costs nothing and names
  the reason. A success costs roughly $0.0003 and proves the permission is live.

## Extraction

Not measured. No case completed.

## Replies, verbatim

None. The assistant never produced a reply during this run.
