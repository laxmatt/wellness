import type { MetadataRoute } from "next";
import { SITE_URL, indexingAllowed } from "@/lib/site-url";

// Crawling is always allowed. Indexing is what this controls, and it is
// controlled with `noindex` on the pages themselves, set in the root layout.
//
// The two are not the same lever and the earlier version confused them. A
// `Disallow` stops a crawler fetching a page, which stops it reading the
// `noindex` on that page, which is the instruction that actually keeps the
// page out of an index. A URL blocked in robots.txt can still be indexed from
// links alone, and now cannot be told not to be.
//
// `/api/` stays disallowed: those routes serve no HTML and so can carry no
// meta tag. They answer 405 and 401 to a browser in any case.
export default function robots(): MetadataRoute.Robots {
  const indexable = indexingAllowed();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    ...(indexable ? { sitemap: `${SITE_URL}/sitemap.xml`, host: SITE_URL } : {}),
  };
}
