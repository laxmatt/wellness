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

/**
 * What the record says about a relationship with one merchant, in a shopper's
 * words.
 *
 * Three answers, and the third is the one that matters. "Unknown" is not "no
 * commission": it is what the catalogue says when nobody recorded the
 * relationship, and every offer on this site says it today. Reading it as a
 * denial would be as wrong as reading it as a claim.
 */
export const RELATIONSHIP_COPY: Record<AffiliateStatus, string> = {
  affiliate: "Affiliate link. We may earn a commission.",
  non_affiliate: "Ordinary link. No commission.",
  unknown: "Affiliate status not recorded for this offer.",
};

/**
 * One line for a set of outbound links, saying only what their records say.
 *
 * A card carries one link and a winners row carries several, and both used to
 * carry no statement at all: a shopper who never opened a product page saw an
 * outbound button with nothing beside it. The product page has said this per
 * offer for a long time, so the wording is the same wording, and the whole set
 * is described rather than each button annotated.
 *
 * Nothing here counts as a denial that a mixed set contains a paid link, and
 * nothing infers a commission from silence.
 */
export function relationshipNote(statuses: AffiliateStatus[]): string | undefined {
  if (statuses.length === 0) return undefined;
  const kinds = new Set(statuses);
  const many = statuses.length > 1;

  if (kinds.size === 1) {
    const [only] = kinds;
    if (only === "affiliate") return many ? "Affiliate links. We may earn a commission." : RELATIONSHIP_COPY.affiliate;
    if (only === "non_affiliate") return many ? "Ordinary links. No commission." : RELATIONSHIP_COPY.non_affiliate;
    return many ? "Affiliate status not recorded for these offers." : RELATIONSHIP_COPY.unknown;
  }

  // A mixed set is described by the part a shopper needs: that some of it pays.
  if (kinds.has("affiliate")) return "Some of these are affiliate links. We may earn a commission on those.";
  // Ordinary links and unrecorded ones. Saying "no commission" would turn the
  // unrecorded ones into a denial nobody has evidence for.
  return "Some of these have no affiliate status recorded.";
}
