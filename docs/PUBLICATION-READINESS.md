# Publication readiness

What stands between this repository and a first public partner showcase, split
by who can do it. Every line names the file or the observation behind it.
Inspected on 2026-09-10 against build `LlVOjJLgfhmiDxlMqKgQD`, served locally.

This is about publishing. `docs/LAUNCH-READINESS.md` covers the catalogue and
the evidence in it; `docs/PARTNER-SHOWCASE-CHECKLIST.md` covers each product.

## Fixed in this pass

**No robots.txt existed.** `/robots.txt` returned 404, so any deployment,
preview included, invited crawling as loudly as production would, while serving
canonicals that pointed at `http://localhost:3000`. `src/app/robots.ts` now
refuses crawling outright until a public address is configured, and allows it
with a sitemap reference once one is. Verified both ways against a running
build.

**No sitemap existed.** `/sitemap.xml` returned 404. `src/app/sitemap.ts` emits
nothing without a configured address, and 57 URLs with one: 5 static pages, 3
categories, 12 facets, 17 brands and 20 products, with product entries carrying
`lastUpdated`.

**Five public pages had no canonical.** `/`, `/explore`, `/brands`,
`/how-we-choose` and `/disclosure` emitted none, while every dynamic route did.
All five now do.

The gate is `hasPublicSiteUrl` in `src/lib/site-url.ts`, tested in
`src/__tests__/publication-readiness.test.ts`. It rejects an unset value, the
localhost fallback, `127.0.0.1`, `0.0.0.0`, `.local` hosts, a bare domain with
no scheme, and a non-HTTP scheme. It guesses nothing.

## Needs the owner, and nothing here should invent it

1. **The domain.** `NEXT_PUBLIC_SITE_URL` is unset, so `SITE_URL` in
   `src/lib/site.ts` falls back to `http://localhost:3000`. Every canonical,
   the sitemap and the robots host all read from it. Until it is set, the site
   refuses indexing by design. One environment variable unblocks all of it.

2. **A privacy notice, and the facts it has to state.** The site processes
   personal data today. `src/domain/client-identity.ts` takes the visitor's IP
   from a proxy header and stores a salted hash of it as a rate-limit key in
   the `assistant_client` table; `src/providers/usage/PostgresUsageStore.ts`
   also stores session identifiers and per-request token counts. A hashed IP is
   still personal data. The page needs a controller name, a contact address, a
   retention period and the hosting and model subprocessors, none of which this
   repository knows. The code is ready to be described; the facts are not here.

3. **A contact route.** There is no contact page and nothing links to one, so
   nothing is broken, but a partner reading the site has no way to reach
   anybody. Needs an address or a form endpoint.

4. **An about page**, if the showcase is meant to say who is behind it. Same
   reason: the content is entirely owner information.

5. **Hosting.** No host is configured and no deployment exists. The one
   deployment-shaped requirement in the code is `NEXT_PUBLIC_SITE_URL`; the
   database URL and the assistant's credentials are already environment-driven.

6. **Product images.** 24 of 24 are procedural placeholders, and reading a page
   grants no right to its pictures. This needs permission from makers or
   photographs of products somebody owns. It is the largest remaining gap and
   the first thing a partner sees.

## Work that can be finished here, without the owner

1. **Source readings.** Eight products still have no price read from the
   merchant, and Infraredi Flex Max has no amount on record at all. The URLs
   are on file. This is the cheapest large improvement available.

2. **The Edge and Plunge records**, which are why Best Premium in Cold Plunges
   currently sits on the category's weakest entry. Logged in
   `docs/LAUNCH-READINESS.md`.

3. **The Cold Pod identity**, open at
   `docs/source-checks/2026-09-09-the-cold-pod-usa.md`.

4. **Open graph and social cards.** No `openGraph` or `twitter` metadata
   anywhere in `src/app`, and no `opengraph-image`. A link to this site pasted
   into a message renders as a bare URL. The copy can be written here; only the
   image needs a design decision.

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
- **Nothing on the shopping pages quotes an amount nobody confirmed**, which
  the browser harness checks on all 20 products.
