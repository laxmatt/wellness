import type { NextConfig } from "next";
import { indexingAllowed } from "./src/lib/site-url";

/**
 * `X-Robots-Tag`, for the routes a meta tag cannot reach.
 *
 * Every HTML page already inherits `noindex` from the root layout when indexing
 * is off. A meta tag only exists inside HTML, so it says nothing about
 * `/sitemap.xml`, `/robots.txt` or anything else this serves that is not a
 * document. The header states the same policy, computed from the same function,
 * for everything.
 *
 * It is the same answer, not a second one. When indexing is allowed no header
 * is sent at all, because the absence of a header is what permission looks like
 * and sending `index` would be a claim rather than the lack of a refusal.
 *
 * This is evaluated when the app is built, exactly like the layout's tag. A
 * deployment that changes its mind about indexing rebuilds either way.
 */
const nextConfig: NextConfig = {
  async headers() {
    if (indexingAllowed()) return [];
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};

export default nextConfig;
