import { describe, expect, it } from "vitest";
import { hasPublicSiteUrl, indexingAllowed, isPreviewDeployment, type IndexingEnv } from "@/lib/site-url";

// Three separate questions decide whether a deployment may be indexed, and
// every one of them has to answer yes. The first version asked only the first,
// which made a public URL stand in for permission: a preview that inherited
// production's environment would have invited crawlers in.
describe("whether a deployment knows its own public address", () => {
  const check = (value?: string) => hasPublicSiteUrl({ NEXT_PUBLIC_SITE_URL: value });

  it("says no when nothing is configured", () => {
    expect(check(undefined)).toBe(false);
    expect(check("")).toBe(false);
    expect(check("   ")).toBe(false);
  });

  it("says no for the development fallback and its neighbours", () => {
    expect(check("http://localhost:3000")).toBe(false);
    expect(check("http://127.0.0.1:3000")).toBe(false);
    expect(check("http://0.0.0.0:3000")).toBe(false);
    expect(check("http://wellness.local")).toBe(false);
  });

  it("says no for a value that is not a URL, rather than guessing one", () => {
    expect(check("wellness-compare.com")).toBe(false);
    expect(check("ftp://example.com")).toBe(false);
  });

  it("says no to an origin a canonical cannot be built from", () => {
    // Not a security judgement. Appending "/products/x" to any of these
    // produces a URL nobody can follow, so the right answer is to refuse the
    // value rather than emit a malformed canonical.
    expect(check("https://user:pass@example.com")).toBe(false);
    expect(check("https://example.com?utm_source=x")).toBe(false);
    expect(check("https://example.com#top")).toBe(false);
  });

  it("says yes only for a real public origin", () => {
    expect(check("https://example.com")).toBe(true);
    expect(check("https://staging.example.com")).toBe(true);
  });
});

describe("known preview deployments", () => {
  const preview = (env: IndexingEnv) => isPreviewDeployment(env);

  it("recognises the signals the hosts set themselves", () => {
    expect(preview({ VERCEL_ENV: "preview" })).toBe(true);
    expect(preview({ NEXT_PUBLIC_VERCEL_ENV: "preview" })).toBe(true);
    expect(preview({ VERCEL_ENV: "development" })).toBe(true);
    expect(preview({ CONTEXT: "deploy-preview" })).toBe(true);
    expect(preview({ CONTEXT: "branch-deploy" })).toBe(true);
  });

  it("lets any explicit preview signal win over a production value beside it", () => {
    // The defect: reading `NEXT_PUBLIC_VERCEL_ENV ?? VERCEL_ENV` let the
    // public variable mask the private one, so a preview carrying an
    // inherited production value would have been indexed. That is precisely
    // the case this whole gate exists for.
    expect(preview({ NEXT_PUBLIC_VERCEL_ENV: "production", VERCEL_ENV: "preview" })).toBe(true);
    expect(preview({ NEXT_PUBLIC_VERCEL_ENV: "preview", VERCEL_ENV: "production" })).toBe(true);
    expect(preview({ NEXT_PUBLIC_VERCEL_ENV: "production", VERCEL_ENV: "development" })).toBe(true);
    expect(preview({ VERCEL_ENV: "production", CONTEXT: "deploy-preview" })).toBe(true);

    // And the same conflict reaches the decision, not just the predicate.
    const site = { NEXT_PUBLIC_SITE_URL: "https://example.com", NEXT_PUBLIC_ALLOW_INDEXING: "1" };
    expect(indexingAllowed({ ...site, NEXT_PUBLIC_VERCEL_ENV: "production", VERCEL_ENV: "preview" })).toBe(false);
  });

  it("treats a pages.dev deployment as a preview, which is a guess that fails closed", () => {
    // Not Cloudflare support. Nobody here has checked Cloudflare's documented
    // variable semantics, so this errs toward noindex and says so.
    expect(preview({ CF_PAGES_BRANCH: "feature", CF_PAGES_URL: "https://abc.wellness.pages.dev" })).toBe(true);
    expect(preview({ CF_PAGES_BRANCH: "main", CF_PAGES_URL: "https://wellness.pages.dev" })).toBe(true);
    // A Pages deployment on a custom domain does not match, and nothing here
    // claims to know whether that is the right answer for Cloudflare.
    expect(preview({ CF_PAGES_BRANCH: "main", CF_PAGES_URL: "https://example.com" })).toBe(false);
  });

  it("does not call a production deployment a preview", () => {
    expect(preview({ VERCEL_ENV: "production" })).toBe(false);
    expect(preview({ CONTEXT: "production" })).toBe(false);
    expect(preview({})).toBe(false);
  });
});

describe("permission to index", () => {
  const site = "https://example.com";

  it("is off by default, even with a public address", () => {
    expect(indexingAllowed({ NEXT_PUBLIC_SITE_URL: site })).toBe(false);
  });

  it("is off without a public address, even when switched on", () => {
    expect(indexingAllowed({ NEXT_PUBLIC_ALLOW_INDEXING: "1" })).toBe(false);
  });

  it("stays off on a preview that inherited production's environment", () => {
    // The case this exists for: same URL, same switch, different deployment.
    const production = { NEXT_PUBLIC_SITE_URL: site, NEXT_PUBLIC_ALLOW_INDEXING: "1" };
    expect(indexingAllowed(production)).toBe(true);
    expect(indexingAllowed({ ...production, VERCEL_ENV: "preview" })).toBe(false);
    expect(indexingAllowed({ ...production, CONTEXT: "deploy-preview" })).toBe(false);
  });

  it("takes only an exact 1 as the switch", () => {
    for (const value of ["", "0", "true", "yes", "TRUE", " "]) {
      expect(indexingAllowed({ NEXT_PUBLIC_SITE_URL: site, NEXT_PUBLIC_ALLOW_INDEXING: value }), value).toBe(false);
    }
    expect(indexingAllowed({ NEXT_PUBLIC_SITE_URL: site, NEXT_PUBLIC_ALLOW_INDEXING: " 1 " })).toBe(true);
  });
});
