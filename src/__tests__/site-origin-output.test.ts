import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("emits the normalized origin in real robots and social metadata", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://EXAMPLE.com/");
  vi.stubEnv("NEXT_PUBLIC_ALLOW_INDEXING", "1");
  for (const key of ["VERCEL_ENV", "NEXT_PUBLIC_VERCEL_ENV", "CONTEXT", "CF_PAGES_BRANCH", "CF_PAGES_URL"]) vi.stubEnv(key, "");
  vi.resetModules();
  const { default: robots } = await import("@/app/robots");
  const { social } = await import("@/lib/metadata");
  expect(robots().sitemap).toBe("https://example.com/sitemap.xml");
  expect(robots().host).toBe("https://example.com");
  expect(social({ title: "Disclosure", description: "Test", path: "/disclosure" }).openGraph).toMatchObject({ url: "https://example.com/disclosure" });
});

it("does not advertise a sitemap for a configured subpath", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com/subpath");
  vi.stubEnv("NEXT_PUBLIC_ALLOW_INDEXING", "1");
  vi.resetModules();
  const { default: robots } = await import("@/app/robots");
  expect(robots().sitemap).toBeUndefined();
});
