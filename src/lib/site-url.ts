import { SITE_URL } from "./site";

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
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  if (url.search || url.hash) return false;
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
  const vercel = (env.NEXT_PUBLIC_VERCEL_ENV ?? env.VERCEL_ENV ?? "").toLowerCase();
  if (vercel === "preview" || vercel === "development") return true;
  // Netlify: "production", "deploy-preview", "branch-deploy", "dev".
  const netlify = (env.CONTEXT ?? "").toLowerCase();
  if (netlify && netlify !== "production") return true;
  // Cloudflare Pages names the branch; a preview also gets a *.pages.dev URL.
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
