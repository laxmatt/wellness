# Being findable: what the code does, and what only the owner can do

Two lists. The first is verified by reading this repository and is held by tests.
The second cannot be verified from here at all: it depends on a domain, a host
and accounts that do not exist yet. Nothing below has been submitted anywhere,
no account has been created, and indexing is still switched off.

Compiled 2026-09-11.

## 1. Verified in this repository

| What | Where | State |
| --- | --- | --- |
| Crawling allowed, `/api/` disallowed | `src/app/robots.ts` | One `*` group. No per-bot groups, on purpose: see below. |
| Indexing off unless switched on | `src/app/layout.tsx`, `src/lib/site-url.ts` | `noindex, nofollow` on every page unless `NEXT_PUBLIC_ALLOW_INDEXING=1`, a real public `NEXT_PUBLIC_SITE_URL`, and not a known preview. |
| `X-Robots-Tag` for what a meta tag cannot reach | `next.config.ts` | Same policy, same function, sent for every path when indexing is off. Nothing is sent when it is on. |
| Sitemap empty unless indexable | `src/app/sitemap.ts` | Otherwise every public route: home, explore, brands, each brand, how-we-choose, disclosure, each category, each facet, each product. |
| A canonical on every route | each `page.tsx` | Including the home page and every facet page. |
| Comparison pages kept out | `src/app/compare/page.tsx` | `index: false, follow: true`. A comparison URL is one shopper's selection. |
| Filters produce no URLs to canonicalise | `src/components/category/FilterContext.tsx` | Filter state lives in React, not in the query string, so there is no duplicate URL to point anywhere. |
| Titles and descriptions per route | each `page.tsx` | Written from the page's own content. |
| OpenGraph and Twitter cards | `src/lib/metadata.ts` | `summary`, not `summary_large_image`, and no `og:image`: every image here is a procedural placeholder. |
| Product structured data | `src/app/products/[slug]/page.tsx` | `Product` with `Offer` only where a real amount and a live listing exist. |
| Category structured data | `src/app/[category]/page.tsx` | `ItemList` of the products the page renders, in the order it renders them. |
| Breadcrumb structured data | product, category, facet pages | Mirrors the breadcrumb the page already draws. |
| Publisher structured data | `src/app/page.tsx` | `Organization` and `WebSite`, name and URL only. |
| JSON embedded safely | `src/lib/structured-data.ts` | `<`, `>`, `&`, U+2028 and U+2029 escaped. |

### What the structured data deliberately does not say

Each of these is a field a search engine would quote back to somebody who never
opens the page, and this site cannot support any of them today:

- **No rating or review count.** Nothing here is rated. There is no ratings
  data in the catalogue to publish, and inventing one is the single most common
  way a comparison site makes itself untrustworthy.
- **No image.** Every product image is a generated placeholder. Publishing one
  as `og:image` or as `Product.image` presents a pattern as a photograph.
- **No price where the amount is prototype data,** and none for an offer that is
  disputed or discontinued. The page says "Check current price" in those cases
  and the markup now agrees with it.
- **No `SearchAction`.** That markup tells a search engine it may send queries
  to a search URL. This site has no such URL.
- **No `sameAs` and no `logo`.** No account and no logo exist to point at.

### Why `robots.txt` has one group and not seven

The `*` group already allows every crawler that obeys robots.txt to fetch every
public page, and disallows `/api/`. Adding a named group per bot would not grant
anything it does not already have, and a named group **replaces** the wildcard
for that bot rather than adding to it, so a per-bot `Allow: /` written without
repeating `Disallow: /api/` would quietly hand that bot the API routes. The
cost is real and the benefit is zero, so the file stays as it is.

What the named crawlers do is worth knowing anyway, because search access and
training access are different questions and the answer here is different for
each. **The following were read by Codex on 2026-09-11 and supplied to this
repository; this container has no outbound access to those domains and did not
fetch them.**

| Crawler | What it is for | Current state here |
| --- | --- | --- |
| `OAI-SearchBot` | OpenAI, search and citation | Allowed by `*` |
| `GPTBot` | OpenAI, training | Allowed by `*` |
| `ChatGPT-User` | OpenAI, fetching a page a user asked about | Allowed by `*` |
| `Claude-SearchBot` | Anthropic, search | Allowed by `*` |
| `Claude-User` | Anthropic, fetching a page a user asked about | Allowed by `*` |
| `ClaudeBot` | Anthropic, training | Allowed by `*` |
| `Googlebot` | Google Search, which also feeds AI features in Search | Allowed by `*` |
| `Google-Extended` | Gemini grounding **and** Gemini training, together | Allowed by `*` |
| `PerplexityBot` | Perplexity, indexing | Allowed by `*` |
| `Perplexity-User` | Perplexity, fetching a page a user asked about | Allowed by `*` |
| `bingbot` | Bing, which also serves Copilot | Allowed by `*` |

Two of those deserve a plain statement rather than a row in a table.

**Google-Extended is not a search switch.** It controls Gemini grounding and
Gemini model training as one setting. There is no way to allow one and refuse
the other, and anybody who tells the owner otherwise is describing a control
that does not exist. Refusing `Google-Extended` does not affect Google Search
ranking, and allowing it permits training. Sources documented above.

**Training is a separate decision from being findable.** Every crawler above is
allowed today because the wildcard allows everything, which is the state this
repository was already in. Nothing in this batch changed it. If the owner wants
to be searchable but not trained on, the controls are `GPTBot`, `ClaudeBot` and
`Google-Extended`, and refusing `Google-Extended` costs Gemini grounding as
well. That is the owner's call and no default has been chosen for them.

### What this repository will not do

- **No `llms.txt`.** It is not read by any of the services above as a ranking
  input, and writing one implies otherwise.
- **No keyword stuffing, no hidden text, no instructions addressed to a model in
  the page.** A page that says something different to a crawler than to a person
  is lying to one of them.
- **No generated pages.** Thin pages built to catch queries are the oldest bad
  idea in this field and the easiest thing for a review to spot.

## 2. Cannot be verified from here

None of this is a code change. Every item needs the owner, a real domain, or an
account, and none of it should be done before the site is meant to be public.

1. **A domain.** `NEXT_PUBLIC_SITE_URL` has no value in this repository, and
   nothing guesses one. Every canonical, every sitemap entry and every
   structured-data URL is built from it.
2. **Switching indexing on.** `NEXT_PUBLIC_ALLOW_INDEXING=1` on production only.
   Check afterwards that a production page carries no `noindex` and that a
   preview still does. Both are one `curl -I` each.
3. **Response headers from the host.** A platform can add its own
   `X-Robots-Tag`, and a header beats a meta tag. Check what production actually
   sends rather than what this code sends.
4. **Whether a firewall lets the crawlers in.** A WAF or bot-management rule
   that blocks unknown agents will block every crawler in the table above, and
   robots.txt has nothing to say about it. This is the single most common reason
   a correctly built site is not indexed, and it cannot be seen from the code.
5. **Search Console and Bing Webmaster Tools.** Verification, then submitting
   the sitemap. Not done, no account exists.
6. **That the sitemap is reachable and non-empty in production.** It is empty by
   design until indexing is switched on, so an early check will show an empty
   file and that is correct.
7. **A real `og:image`, if ever.** It needs a real photograph first.
8. **Product identifiers.** GTIN and MPN are in the catalogue records but not in
   the product view, so the structured data does not publish them. Plumbing them
   through is a small change and worth doing when there is a reason to.

## 3. What would be measured, and is not

Nothing in this repository measures whether any of this worked. There is no
analytics store, and no traffic data exists. Any claim about rankings,
impressions or referrals would have to come from Search Console or Bing, which
means item 5 above first.
