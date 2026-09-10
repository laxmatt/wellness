import { SITE_URL } from "./site";

// Whether a real public address has been configured for this deployment.
//
// `NEXT_PUBLIC_SITE_URL` is unset in development and in any preview that was
// stood up without it, and `SITE_URL` then falls back to localhost. Every
// canonical link on the site is built from it, so an unconfigured deployment
// tells a crawler that the canonical version of each page lives on a machine
// it cannot reach.
//
// Nothing here guesses a domain. It only reports whether one was given, so the
// robots and sitemap routes can refuse to invite indexing until it is.
export function hasPublicSiteUrl(env: { NEXT_PUBLIC_SITE_URL?: string } = { NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL }): boolean {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1" && host !== "0.0.0.0" && !host.endsWith(".local");
}

export { SITE_URL };
