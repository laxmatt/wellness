export const SITE_NAME = "Wellness Fit Check";
export const SITE_TAGLINE = "Compare the details. Find your fit.";
// The site is hosted at an origin, not below a path. Use one normalized base
// for canonical, social and sitemap URLs so a trailing slash cannot double it.
export function siteOrigin(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.trim());
    if (!['https:', 'http:'].includes(url.protocol)) return undefined;
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}
export const SITE_URL = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3000";

export const MAX_COMPARE = 4;
