import { describe, expect, it } from "vitest";
import { hasPublicSiteUrl } from "@/lib/site-url";

// One gate decides whether this deployment invites indexing. Before it existed
// there was no robots.txt at all, so a preview stood up without a site URL was
// as crawlable as production and served canonicals pointing at localhost.
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

  it("says yes only for a real public address", () => {
    expect(check("https://example.com")).toBe(true);
    expect(check("https://staging.example.com")).toBe(true);
  });
});
