import type { MetadataRoute } from "next";
import { SITE_URL, hasPublicSiteUrl } from "@/lib/site-url";

// There was no robots.txt at all, which meant a preview deployment invited
// indexing as loudly as production would, and every page it served carried a
// canonical pointing at localhost.
//
// Until a public address is configured, this refuses crawling outright. That
// is the honest state of an unconfigured deployment: it does not know its own
// URL, so nothing it says about its own pages can be trusted by a crawler.
export default function robots(): MetadataRoute.Robots {
  if (!hasPublicSiteUrl()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Comparison URLs are one shopper's selection, already noindex in the
        // page's own metadata, and there are more of them than products.
        disallow: ["/api/", "/compare"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
