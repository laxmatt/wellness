# Publication readiness

What stands between this repository and a first public partner showcase, split
by who can do it. Every line names the file or the observation behind it.
Inspected on 2026-09-10 against locally served production builds.

This is about publishing. `docs/LAUNCH-READINESS.md` covers the catalogue and
the evidence in it; `docs/PARTNER-SHOWCASE-CHECKLIST.md` covers each product.

## Indexing

**Indexing is off, and turning it on takes three separate yeses.** A public URL
is not permission to index the deployment serving it: a preview commonly
inherits production's environment, that variable included.

`indexingAllowed()` in `src/lib/site-url.ts` requires all of:

1. `NEXT_PUBLIC_ALLOW_INDEXING=1`, an explicit switch that defaults to off;
2. a public `NEXT_PUBLIC_SITE_URL`, so canonicals resolve somewhere real;
3. no known preview signal.

**The preview signals, and what each is worth.** `VERCEL_ENV` and
`NEXT_PUBLIC_VERCEL_ENV` are both read and either one saying `preview` or
`development` is enough; an earlier version read one with `??` as a fallback
for the other, so a production value in the public variable would have masked a
preview value in the private one. Netlify's `CONTEXT` is documented as
`production`, `deploy-preview`, `branch-deploy` or `dev`, and anything set and
not `production` counts as a preview.

The Cloudflare check is **a fail-closed guess, not Cloudflare support**. It
treats any Pages deployment serving a `*.pages.dev` URL as a preview. Nobody
here has checked Cloudflare's documented variable semantics, so it may well
call a production Pages deployment a preview, which costs indexing rather than
leaking it. A Pages deployment on a custom domain does not match this check at
all, and whether that is right is unknown. Before relying on Cloudflare, read
their docs and replace the guess.

**Crawling is always allowed, and that is deliberate.** `Disallow` is crawl
control, not removal from an index: a blocked URL can still be indexed from
links alone, and blocking it stops a crawler reading the `noindex` that would
actually keep it out. So robots.txt allows everything except `/api/`, which
serves no HTML and can carry no meta tag, and the root layout emits
`noindex, nofollow` on every page unless indexing is permitted.

`/compare` keeps its own `noindex, follow` and is no longer disallowed in
robots.txt, for the same reason: the tag has to be readable to work.

### Verified against built HTML, four states

| environment | robots.txt | sitemap URLs | meta robots on pages |
| --- | --- | --- | --- |
| Nothing configured | `Allow: /`, `Disallow: /api/`, no sitemap line | 0 | `noindex, nofollow` |
| Public URL, switch off | same | 0 | `noindex, nofollow` |
| Public URL + switch + `VERCEL_ENV=preview` | same | 0 | `noindex, nofollow` |
| Public URL + switch, no preview signal | adds `Host:` and `Sitemap:` | 57 | none, so indexable |

Each row is a real build served locally and queried over HTTP, not a helper
test. The configured URL was a throwaway value that is not a real domain.
`/compare` returned `noindex, follow` in all four.

## Also fixed in this pass

**No robots.txt or sitemap existed.** Both returned 404.

**Five public pages had no canonical.** `/`, `/explore`, `/brands`,
`/how-we-choose` and `/disclosure` emitted none, while every dynamic route did.
All five now do.

**The configured origin is checked for shape.** `hasPublicSiteUrl` rejects an
unset value, the localhost fallback, `127.0.0.1`, `0.0.0.0`, `.local` hosts, a
bare domain with no scheme, a non-HTTP scheme, and an origin carrying
credentials, a query or a fragment. That last group is not a security
judgement: appending a path to any of them produces a canonical nobody can
follow. It guesses nothing. Tested in
`src/__tests__/publication-readiness.test.ts`.

## Needs the owner, and nothing here should invent it

1. **The domain.** `NEXT_PUBLIC_SITE_URL` is unset, so `SITE_URL` in
   `src/lib/site.ts` falls back to `http://localhost:3000`. Every canonical,
   the sitemap and the robots host all read from it. Until it is set, the site
   refuses indexing by design. One environment variable unblocks all of it.

2. **A privacy notice.** The site processes personal data today: a salted hash
   of the visitor's IP as a rate-limit key, a browser session id, and whatever
   a visitor types into the assistant, which is forwarded to a model provider.
   `docs/drafts/PRIVACY-DATA-INVENTORY.md` is a source-grounded inventory of
   exactly what is collected, stored and sent, with the file behind each claim.
   Four things it deliberately does not state, because this repository does not
   know them: the controller, a contact route, a retention period and the named
   subprocessors. It also records that **no deletion or retention code exists**,
   which is a decision to make before any notice can be truthful.

3. **A contact route.** There is no contact page and nothing links to one, so
   nothing is broken, but a partner reading the site has no way to reach
   anybody. Needs an address or a form endpoint.

4. **The identity half of an about page.** Who runs the site, and how to reach
   them. The rest of an about page is not owner information: what the site is
   for and how it ranks are documented here and in `/how-we-choose`, and a
   draft built only from those is in `docs/drafts/ABOUT-DRAFT.md`.

5. **Hosting.** No deployment configuration was found in this repository: no
   host config file, no CI, no deployment manifest. That is a statement about
   what is on disk here and not about whether anything is deployed anywhere,
   which this repository cannot see. The deployment-shaped inputs in the code
   are `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_ALLOW_INDEXING`; the database
   URL and the assistant's credentials are already environment-driven.

6. **Product images: the permission, not the research.** 24 of 24 are
   procedural placeholders and reading a page grants no right to its pictures.
   What needs the owner is the act of asking and the agreement that follows.
   The research half is started: `docs/drafts/IMAGE-RIGHTS-MATRIX.md` covers
   six representative products, two per category. Three brands' published terms
   have been read and none permits the reuse this site would need; two reads
   failed and one is unattempted. No brand has been asked for anything, so none
   of this is a refusal.

## Work that can be finished here, without the owner

1. **Source readings.** Eight products still have no price read from the
   merchant, and Infraredi Flex Max has no amount on record at all. The URLs
   are on file. This is the cheapest large improvement available.

2. **The Edge and Plunge records**, which are why Best Premium in Cold Plunges
   currently sits on the category's weakest entry. Logged in
   `docs/LAUNCH-READINESS.md`.

3. **The Cold Pod identity**, open at
   `docs/source-checks/2026-09-09-the-cold-pod-usa.md`.

4. ~~**Open graph and social cards.**~~ Copy done on 2026-09-10. Every route
   that has a title and a description now sets `openGraph` and `twitter` from
   the same copy, through `social()` in `src/lib/metadata.ts`, with `og:url`
   matching the page's canonical. Verified in built HTML on the home page, a
   category, a facet, a product, a brand, `/compare` and `/disclosure`, and the
   browser harness checks all 20 product pages.

   **No image, deliberately.** Every image in this catalogue is a procedural
   placeholder, so `og:image` would present a generated pattern as a photograph
   of a product. The card is `summary` rather than `summary_large_image` for
   the same reason. That stays true until the image rights question in item 6
   above is answered.

5. **No CI.** Every check in this repository is run by hand.
   `.github/workflows` does not exist.

## Checked and found sound

- **Internal links.** Every `href` in `src/**` resolves: the hardcoded set is
  `/`, `/explore`, `/brands`, `/compare`, `/disclosure`, `/how-we-choose`,
  `/red-light` and `/red-light/under-1000`, and the last is a real facet. The
  templated ones are built from catalogue slugs, and the browser harness walks
  every category, facet, brand and product page and fails on any non-200.
- **404 handling.** `src/app/not-found.tsx` renders a real page with category
  links. An unknown path returns 404 rather than a soft 200.
- **Comparison pages are not indexable.** `src/app/compare/page.tsx` sets
  `robots: { index: false, follow: true }`, verified in the served HTML, and
  robots.txt disallows the path as well.
- **API routes are not browsable.** `/api/assistant` returns 405 to a GET and
  `/api/admin/assistant-usage` returns 401.
- **Titles and descriptions.** Every route sets a title through the root
  template, and the category, product and brand pages set their own
  descriptions.
- **No shopping page quotes an amount its own record does not support.** The
  harness checks this on all 20 products: a placeholder amount is never shown,
  a withheld one is never shown, and a product with no usable amount says the
  price is unavailable.

  That is a narrower claim than "every price is verified", and the difference
  matters for a partner conversation. 17 of the 20 products show a real amount.
  13 of those have it read from the merchant's own page; the other 4 are
  relayed from search summaries and have never been re-checked. Recorded is not
  verified, and `docs/PARTNER-SHOWCASE-CHECKLIST.md` reports which is which,
  per product.
