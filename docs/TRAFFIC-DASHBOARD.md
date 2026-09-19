# Traffic dashboard

Routes: `/admin` and `/admin/traffic`. Reads require the existing `ADMIN_ACCESS_KEY` via a request header, never a URL. The UI holds the key in memory only. Responses are private/no-store and admin pages are noindex.

## Production prerequisites

- Set a strong `ADMIN_ACCESS_KEY` in the hosting environment.
- Set `TRAFFIC_DATABASE_URL` to a PostgreSQL connection string (falls back to the existing `DATABASE_URL`). Use a pooled production connection with TLS. The role must be able to create the `wfc_traffic_events` table and indexes, or have an operator create them from `src/lib/traffic/store.ts` before restricting DDL permissions.
- Deploy, mark the operator browser as test in `/admin/traffic`, then allow analytics on the public site and perform page → filter → retailer actions. Verify the same visit in the dashboard with Include test visits on, and its absence with tests off. Do not click a paid advertisement for testing.
- Configure database retention separately before extended operation. The dashboard reads up to 90 days of prior steps; this is not an automatic deletion policy.

As of implementation, the Vercel project environment list showed only NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_ALLOW_INDEXING. No production database or admin access key has been configured or verified by this change.

## Semantics and limits

New first-party events only: historical GA4 journeys and ad-platform clicks/spend are not imported. Client events require existing explicit analytics consent. We store no IP addresses, user-agent, raw URL/query, referrer URL, chat or search text. Page paths are restricted to five categories. Random sessionStorage identifiers group a browser tab's events with a 30-minute idle timeout. Browser tabs are not deduplicated into people. Sources reflect the first recorded page's tags/referrer; users consenting later may lose landing attribution.

Today/yesterday use Pacific calendar boundaries in PostgreSQL. Last 24 hours and last 7 days are rolling intervals. A visit qualifies if it has any recorded activity in the selected interval; the full preceding visit is shown. Outcome counts and retailer clicks describe those visits, including earlier steps. This is not a strict sequential conversion funnel or proof of purchase. At most 501 recently active visits are summarized and 500 displayed, with an explicit partial-data banner. Data is updated on Load report.

Tests are marked via admin browser control, localhost, or utm_content=tracking_test. Existing unmarked test visits cannot be inferred automatically. Test mode applies only to this dashboard, not third-party pixels. Event IDs deduplicate repeated submissions; server timestamps order receipt. The collector validates origin, schema and payload size, and caps each session at 300 events/day. Browser-generated events can be forged and are not billing evidence; edge-level abuse limits should be applied if ingestion volume grows. Collection failure never blocks shopping and is not retried.

Production verification remains pending until storage and admin credentials are configured. Missing storage produces an explicit unavailable response rather than an empty report.
