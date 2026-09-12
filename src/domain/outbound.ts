/**
 * How an outbound link to a merchant is marked up, in one place.
 *
 * `rel="sponsored"` is not decoration. It is Google's declaration that a link
 * was paid for: an advertisement, a paid placement, or an affiliate link. Every
 * outbound link on this site carried it, and this site has no affiliate
 * programme: all 26 offers in the catalogue record `affiliate.status:
 * "unknown"`, not one names a programme reference, and `/disclosure` tells a
 * reader in as many words that every link is an ordinary link with no network
 * in the middle and no commission on anything.
 *
 * So the page said one thing and its own markup said another. The markup now
 * follows the record: a link says it is sponsored when, and only when, the
 * offer says it pays. Today that is none of them, and when a programme is
 * joined the data changes and the markup changes with it, which is exactly what
 * the disclosure page promises.
 *
 * `nofollow` stays on every outbound merchant link either way. It withholds
 * ranking credit, which is a different statement from "somebody paid for this",
 * and it is the right one for a commercial link whose relationship is
 * unrecorded. `noopener` stays because the link opens a new tab.
 */

import type { AffiliateStatus } from "./product";

export function outboundRel(affiliateStatus: AffiliateStatus): string {
  // "unknown" is not "probably paid". It is what the catalogue says when
  // nobody has recorded the relationship, and asserting a paid one from it
  // would be the same mistake as reading an empty cell as a zero.
  return affiliateStatus === "affiliate" ? "sponsored nofollow noopener" : "nofollow noopener";
}

/**
 * Everything an anchor to a merchant needs, so no call site writes its own.
 *
 * `data-shop-link` marks the anchors that offer a way to buy. Checks used to
 * find them by `rel*="sponsored"`, which stopped identifying anything the
 * moment the rel started telling the truth, and would have quietly passed
 * every "nothing links to the withheld listing" assertion by finding no links
 * at all.
 */
export function outboundLinkProps(affiliateStatus: AffiliateStatus): {
  target: "_blank";
  rel: string;
  "data-shop-link": string;
} {
  return { target: "_blank", rel: outboundRel(affiliateStatus), "data-shop-link": "" };
}
