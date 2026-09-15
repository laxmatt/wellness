/**
 * The one transformation this project performs on a merchant's address, and
 * every address it refuses to perform it on.
 *
 * Three programmes were verified the same way: a person opened the dashboard,
 * generated a link for a real product, and compared it against the plain
 * address. All three add one query parameter and change nothing else. That is
 * why the record is a parameter and an origin rather than a template: a
 * template with a slot for an address is the shape of a redirector, and a
 * redirector that accepts any address is an open redirect whether anybody
 * intended one or not.
 *
 * The refusals below are the point of the file. Composing a link is easy; never
 * composing one that points somewhere else is the part worth testing.
 */

import { describe, expect, it } from "vitest";
import { tagUrl, type AffiliateTag } from "@/domain/affiliate/tag";

const TOPTURE: AffiliateTag = { param: "ref", value: "MATTORR", origin: "https://topture.com", verifiedOn: "2026-09-15", verifiedBy: "Matt" };
const SELECT: AffiliateTag = { param: "sca_ref", value: "12323351.NbtdIcjAoO", origin: "https://selectsaunas.com", verifiedOn: "2026-09-15", verifiedBy: "Matt" };

const tagged = (url: string, tag = TOPTURE): string => {
  const out = tagUrl(url, tag);
  if (!out.ok) throw new Error(out.reason);
  return out.url;
};

describe("adding a verified parameter", () => {
  it("reproduces exactly what each portal produced", () => {
    expect(tagged("https://topture.com/products/thermasol-vue-sauna-cabin")).toBe("https://topture.com/products/thermasol-vue-sauna-cabin?ref=MATTORR");
    expect(
      tagged("https://selectsaunas.com/products/dynamic-saunas-dyn-6106-01-barcelona-1-2-person-low-emf-far-infrared-sauna", SELECT),
    ).toBe("https://selectsaunas.com/products/dynamic-saunas-dyn-6106-01-barcelona-1-2-person-low-emf-far-infrared-sauna?sca_ref=12323351.NbtdIcjAoO");
  });

  it("keeps a query string the address already had", () => {
    expect(tagged("https://topture.com/products/x?variant=1011")).toBe("https://topture.com/products/x?variant=1011&ref=MATTORR");
    expect(tagged("https://topture.com/products/x?variant=1011&colour=cedar")).toBe("https://topture.com/products/x?variant=1011&colour=cedar&ref=MATTORR");
  });

  it("keeps a fragment, and keeps it after the query", () => {
    expect(tagged("https://topture.com/products/x#specs")).toBe("https://topture.com/products/x?ref=MATTORR#specs");
    expect(tagged("https://topture.com/products/x?variant=1#specs")).toBe("https://topture.com/products/x?variant=1&ref=MATTORR#specs");
  });

  it("leaves the path, the port and an empty query alone", () => {
    expect(tagged("https://topture.com/products/a%20b/c")).toBe("https://topture.com/products/a%20b/c?ref=MATTORR");
    expect(tagged("https://topture.com/")).toBe("https://topture.com/?ref=MATTORR");
  });

  it("does nothing the second time", () => {
    const once = tagged("https://topture.com/products/x?variant=1");
    expect(tagged(once)).toBe(once);
  });

  it("escapes a value rather than trusting it to be safe in a query", () => {
    const awkward: AffiliateTag = { ...TOPTURE, value: "a b&c=d" };
    const url = new URL(tagged("https://topture.com/products/x", awkward));
    expect(url.searchParams.get("ref")).toBe("a b&c=d");
    expect(url.searchParams.getAll("ref")).toHaveLength(1);
  });
});

describe("addresses it refuses", () => {
  const refusal = (url: string, tag = TOPTURE): string => {
    const out = tagUrl(url, tag);
    expect(out.ok, url).toBe(false);
    return out.ok ? "" : out.reason;
  };

  it("refuses another site, however the address is dressed up", () => {
    for (const elsewhere of [
      "https://evil.example/products/x",
      // A suffix, not the host.
      "https://topture.com.evil.example/products/x",
      // The merchant's address as a parameter of somebody else's.
      "https://evil.example/go?u=https%3A%2F%2Ftopture.com%2Fproducts%2Fx",
      // A different origin, even though it is the same registrable domain.
      "https://shop.topture.com/products/x",
      "https://topture.com:8443/products/x",
    ]) {
      expect(refusal(elsewhere)).toContain("never put on somebody else's address");
    }
  });

  it("refuses an address wearing the merchant's name as userinfo", () => {
    // The host is evil.example in both. Refused for the credentials before the
    // origin is even reached, which is the more useful sentence to read.
    for (const disguised of ["https://topture.com@evil.example/products/x", "https://topture.com:pass@evil.example/products/x"]) {
      expect(refusal(disguised)).toContain("credentials");
    }
  });

  it("refuses credentials in an address of the merchant's own", () => {
    expect(refusal("https://user:secret@topture.com/products/x")).toContain("credentials");
  });

  it("refuses anything that is not https", () => {
    expect(refusal("http://topture.com/products/x")).toContain("https");
    for (const scheme of ["javascript:alert(1)", "data:text/html,<p>x", "file:///etc/passwd", "ftp://topture.com/x"]) {
      expect(refusal(scheme)).not.toBe("");
    }
  });

  it("refuses what is not an address at all", () => {
    for (const bad of ["", "not an address", "//topture.com/products/x", "/products/x", "topture.com/products/x"]) {
      expect(refusal(bad)).not.toBe("");
    }
  });

  it("refuses to take a referral off whoever already has it", () => {
    expect(refusal("https://topture.com/products/x?ref=SOMEBODYELSE")).toContain("already carries ref");
    // Two of them is somebody else's mess and not ours to tidy.
    expect(refusal("https://topture.com/products/x?ref=MATTORR&ref=OTHER")).toContain("already carries ref");
  });

  it("never returns a url whose origin is not the recorded one", () => {
    // The property the whole module exists for, stated once directly.
    const attempts = [
      "https://topture.com/products/x",
      "https://topture.com/products/x?u=https://evil.example",
      "https://topture.com/products/x#https://evil.example",
      "https://evil.example/x",
      "https://topture.com@evil.example/x",
    ];
    for (const attempt of attempts) {
      const out = tagUrl(attempt, TOPTURE);
      if (out.ok) expect(new URL(out.url).origin, attempt).toBe(TOPTURE.origin);
    }
  });
});
