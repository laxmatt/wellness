/**
 * Putting a programme's parameter on a merchant's own product address, and
 * every reason not to.
 *
 * All three verified programmes do the same simple thing: the plain product
 * address with one query parameter added. Nothing is wrapped, nothing is
 * redirected through a network, and the address a shopper lands on is the
 * merchant's own. That is why this is a parameter and not a template: a
 * template with a slot for a URL is the shape of a redirector, and a redirector
 * that takes any address is an open redirect whether or not anybody meant it
 * to be one.
 *
 * So the destination is decided before the parameter is: the address has to be
 * `https`, it has to carry no credentials, and its origin has to be exactly the
 * origin recorded when a person verified the transformation in the portal. An
 * address that is not the merchant's is refused rather than tagged, which means
 * this can never produce a link pointing anywhere except the shop it belongs
 * to. `https://selectsaunas.com@evil.example/` and `https://evil.example/?x=
 * https://selectsaunas.com/` both fail the same check, because both have an
 * origin that is not the merchant's.
 *
 * What survives: the query string the address already had, and its fragment. A
 * Shopify variant address is `/products/x?variant=1011`, and losing that
 * parameter would land a shopper on the wrong configuration of the right
 * product.
 */

/** What a person read in a portal: one parameter, on one origin, on a date. */
export type AffiliateTag = {
  /** The query parameter the programme reads. */
  param: string;
  value: string;
  /** Scheme and host, exactly as `URL.origin` spells it. Nothing else is tagged. */
  origin: string;
  verifiedOn: string;
  verifiedBy: string;
};

export type TagResult = { ok: true; url: string } | { ok: false; reason: string };

export function tagUrl(productUrl: string, tag: AffiliateTag): TagResult {
  let url: URL;
  try {
    url = new URL(productUrl);
  } catch {
    return { ok: false, reason: `"${productUrl}" is not an address, so nothing was composed.` };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: `An affiliate link is only ever composed onto an https address. This one is ${url.protocol.replace(":", "")}.` };
  }
  // `https://shop.example@evil.example/` has host evil.example and would fail
  // the origin check below anyway. This refuses the shape outright, because an
  // address carrying credentials is never one of ours and the reason a reader
  // needs is that, not a mismatched origin.
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "That address carries credentials in it, which no product address of ours does. Nothing was composed." };
  }
  if (url.origin !== tag.origin) {
    return {
      ok: false,
      reason: `That address is ${url.origin} and this programme's links are ${tag.origin}. A tracking parameter is never put on somebody else's address, so nothing was composed.`,
    };
  }
  const existing = url.searchParams.getAll(tag.param);
  if (existing.length > 1 || (existing.length === 1 && existing[0] !== tag.value)) {
    return {
      ok: false,
      reason: `That address already carries ${tag.param}, set to something else. Overwriting it would take a referral off whoever it belongs to, so nothing was composed.`,
    };
  }
  if (existing.length === 1) return { ok: true, url: url.toString() };
  // Appended, so whatever the address already carried is still on it, and the
  // fragment stays where `URL` keeps it: after the query, untouched.
  url.searchParams.append(tag.param, tag.value);
  return { ok: true, url: url.toString() };
}
