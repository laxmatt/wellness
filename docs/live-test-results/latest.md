# Live assistant test, 2026-09-08T18:51:10Z

Model: `gpt-4o-mini`. Credential mode: `proxy`. Ledger: `postgres`, shared.
Commit: `53697fc`. Application cap: $1.00.

**The run aborted on the first case. No conversation completed and no
extraction was measured.** The script writes this report itself on a completed
run; this one was written by hand from the ledger and the run log, because the
script exits before its report step when the endpoint is not in `live` mode.

## Result

| | |
| --- | --- |
| Cases attempted | 1 of 15 |
| Cases completed | 0 |
| Exit code | 2 (`mode` was `unavailable`, not `live`) |
| Model calls that returned a reply | 0 |

The first request reached OpenAI and came back `403`. The route recorded the
outcome, released the reservation and replied in `unavailable` mode. The script
aborts on any mode other than `live`, by design, so it cannot be mistaken for a
pass against the scripted stand-in. It stopped there and was not repeated.

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

The held amount is the reservation estimate, not a measured charge. A `403`
arrives before inference runs, so the true cost of this call is almost certainly
$0.00. It is held rather than released because of the classification detail in
the finding below. Close it out against OpenAI's usage record:

```
curl -X POST http://localhost:3000/api/admin/assistant-usage \
  -H "x-admin-key: $ADMIN_ACCESS_KEY" \
  -H "content-type: application/json" \
  -d '{"action":"reconcile","reservationId":"r_2026-09_1788893470513_izs521g0","actualUsd":0}'
```

## Credential injection: confirmed working

The proxy attached a credential and OpenAI recognised it. The `403` is an
authorization failure at OpenAI, not a missing or rejected credential.

Evidence, from a zero-cost `GET https://api.openai.com/v1/models` made from this
container with no key in the environment and no authorization header of our own:

```
http_status=403
{"error":"You have insufficient permissions for this operation. Missing scopes:
api.model.read. Check that you have the correct role in your organization
(Reader, Writer, Owner) and project (Viewer, Member, Owner), and if you're using
a restricted API key, that it has the necessary scopes."}
```

The response describes the scopes and roles of a specific key. OpenAI can only
answer that way about a credential it has identified, so a credential was
attached to a request this application sent with no authorization header of its
own. That is the proxy doing its job, and the key never enters this session.

The same reading applies to the `403` on `POST /v1/chat/completions`: the key is
a restricted key whose scopes do not include model inference. Fix it at the
provider, on the key, not in this repository:

- Give the key the `model.request` scope, or issue an unrestricted project key
- Confirm the key's project has access to `gpt-4o-mini`
- Confirm the role on the organization and the project is at least Member

## Finding: a real OpenAI refusal was recorded as uncertain

`statusError` in `src/providers/ai/OpenAIProvider.ts` settles a 4xx as
`not_billed` only when the body parses as JSON whose `error` field is an
**object**. The reasoning is sound: an error object is OpenAI's shape, and a 4xx
from an intermediary in front of it carries no such evidence.

OpenAI's scope errors break that assumption. They return `error` as a **string**,
as the body above shows. So a refusal that provably ran no inference was
classified `uncertain` and held $0.00156 against the cap.

This fails in the safe direction, holding budget rather than spending it, and it
is wrong. A run of these would throttle the assistant against charges that never
happened. Accept a string `error` as provider evidence alongside an object, and
keep the intermediary case as it is.

## Extraction

Not measured. No case completed.

## Replies, verbatim

None. The assistant never produced a reply during this run.
