import { SITE_URL, siteOrigin } from "./site";

// Whether a real public address has been configured for this deployment.
//
// `NEXT_PUBLIC_SITE_URL` is unset in development, and `SITE_URL` then falls
// back to localhost. Every canonical link is built from it, so an unconfigured
// deployment tells a crawler that the canonical version of each page lives on
// a machine it cannot reach.
//
// The origin has to be one a canonical can be built from: no credentials, no
// query, no fragment. Those do not make a URL dangerous, they make it the
// wrong shape for this job, and appending a path to it produces a canonical
// nobody can follow.
//
// Nothing here guesses a domain.
export function hasPublicSiteUrl(env: { NEXT_PUBLIC_SITE_URL?: string } = { NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL }): boolean {
  const origin = siteOrigin(env.NEXT_PUBLIC_SITE_URL);
  if (!origin) return false;
  const url = new URL(origin);
  const host = url.hostname.toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1" && host !== "0.0.0.0" && !host.endsWith(".local");
}

// Deployment environments that are previews whatever URL they were handed.
//
// A preview commonly inherits production's environment, `NEXT_PUBLIC_SITE_URL`
// included, so a configured public URL says nothing about which deployment is
// serving it. These are the signals the common hosts set themselves, and a
// preview stays out of the index even when indexing is switched on.
export type IndexingEnv = {
  NEXT_PUBLIC_SITE_URL?: string;
  NEXT_PUBLIC_ALLOW_INDEXING?: string;
  VERCEL_ENV?: string;
  NEXT_PUBLIC_VERCEL_ENV?: string;
  CONTEXT?: string;
  CF_PAGES_BRANCH?: string;
  CF_PAGES_URL?: string;
};

function readEnv(): IndexingEnv {
  return {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_ALLOW_INDEXING: process.env.NEXT_PUBLIC_ALLOW_INDEXING,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    CONTEXT: process.env.CONTEXT,
    CF_PAGES_BRANCH: process.env.CF_PAGES_BRANCH,
    CF_PAGES_URL: process.env.CF_PAGES_URL,
  };
}

export function isPreviewDeployment(env: IndexingEnv = readEnv()): boolean {
  // Any explicit preview signal wins. The first version read
  // `NEXT_PUBLIC_VERCEL_ENV ?? VERCEL_ENV`, so a build carrying
  // NEXT_PUBLIC_VERCEL_ENV=production alongside VERCEL_ENV=preview would have
  // been treated as production: the exact shape of a preview inheriting a
  // production environment, which is what this function exists to catch. Both
  // variables are now read, and either one saying preview is enough.
  const vercelValues = [env.NEXT_PUBLIC_VERCEL_ENV, env.VERCEL_ENV].map((v) => (v ?? "").toLowerCase());
  if (vercelValues.some((v) => v === "preview" || v === "development")) return true;

  // Netlify's CONTEXT is "production", "deploy-preview", "branch-deploy" or
  // "dev". Anything set and not "production" is not production.
  const netlify = (env.CONTEXT ?? "").toLowerCase();
  if (netlify && netlify !== "production") return true;

  // Cloudflare Pages. This is a fail-closed guess, not a supported check: it
  // treats any Pages deployment serving a *.pages.dev URL as a preview,
  // because a Pages production deployment on its own custom domain will not
  // match and one that has no custom domain yet is not somewhere to invite a
  // crawler either. Nobody here has checked Cloudflare's documented variable
  // semantics, so this must not be described as Cloudflare support. It errs
  // toward noindex and its limit is written down in
  // docs/PUBLICATION-READINESS.md.
  if (env.CF_PAGES_BRANCH !== undefined && (env.CF_PAGES_URL ?? "").includes(".pages.dev")) return true;

  return false;
}

// Indexing is off unless somebody switched it on for this deployment.
//
// A public URL is not permission to index the deployment serving it. The
// switch is explicit, it defaults to off, and a known preview overrides it:
// three separate answers, and every one of them has to be yes.
export function indexingAllowed(env: IndexingEnv = readEnv()): boolean {
  if (env.NEXT_PUBLIC_ALLOW_INDEXING?.trim() !== "1") return false;
  if (!hasPublicSiteUrl(env)) return false;
  return !isPreviewDeployment(env);
}

export { SITE_URL };
