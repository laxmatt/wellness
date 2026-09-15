import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCsv } from "@/domain/import/csv";
import { buildDrafts } from "@/domain/import/draft";
import { suggestMapping } from "@/domain/import/mapping";
import { applyEdit } from "@/domain/inventory/edit";
import { guardRequest, OPERATOR_HEADER, SECURITY_HEADERS } from "@/domain/inventory/local-request";
import { stageDrafts } from "@/domain/inventory/stage";
import type { Product } from "@/domain/product";

const PORT = 4319;
const good = {
  host: `127.0.0.1:${PORT}`,
  origin: `http://127.0.0.1:${PORT}`,
  "content-type": "application/json",
  [OPERATOR_HEADER]: "1",
  "sec-fetch-site": "same-origin",
};
const post = (headers: Record<string, string | undefined>) => guardRequest({ method: "POST", headers }, PORT);

describe("what the operator server answers", () => {
  it("reads and writes for its own page", () => {
    expect(post(good)).toEqual({ ok: true, kind: "write" });
    expect(guardRequest({ method: "GET", headers: { host: `localhost:${PORT}` } }, PORT)).toEqual({ ok: true, kind: "read" });
    expect(guardRequest({ method: "HEAD", headers: { host: `[::1]:${PORT}` } }, PORT)).toEqual({ ok: true, kind: "read" });
  });

  it("refuses a request addressed to any name but its own", () => {
    // A name the attacker controls, resolved to 127.0.0.1, is how a page on the
    // web reaches a tool that only listens on loopback.
    for (const host of ["inventory.attacker.example", "192.168.1.9:4319", `127.0.0.1:${PORT + 1}`, undefined]) {
      const r = guardRequest({ method: "GET", headers: { host } }, PORT);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    }
  });

  it("refuses a change from another site, however it is dressed", () => {
    expect(post({ ...good, origin: "https://shop.example" }).ok).toBe(false);
    expect(post({ ...good, origin: undefined }).ok).toBe(false);
    expect(post({ ...good, "sec-fetch-site": "cross-site" }).ok).toBe(false);
    expect(post({ ...good, "sec-fetch-site": "same-site" }).ok).toBe(false);
    expect(post({ ...good, "sec-fetch-site": "none" }).ok).toBe(false);
  });

  it("refuses a change a form could have sent", () => {
    // A cross-origin form can post these three types and cannot set a header.
    for (const type of ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain", undefined]) {
      const r = post({ ...good, "content-type": type });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(415);
    }
    expect(post({ ...good, [OPERATOR_HEADER]: undefined }).ok).toBe(false);
    expect(post({ ...good, [OPERATOR_HEADER]: "0" }).ok).toBe(false);
  });

  it("answers no preflight, so a cross-origin fetch cannot get past the browser", () => {
    for (const method of ["OPTIONS", "PUT", "DELETE", "PATCH"]) {
      const r = guardRequest({ method, headers: good }, PORT);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(405);
    }
    expect(Object.keys(SECURITY_HEADERS).some((h) => h.toLowerCase().startsWith("access-control"))).toBe(false);
  });

  it("cannot be framed and is never stored or indexed", () => {
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain("form-action 'none'");
    expect(SECURITY_HEADERS["Cache-Control"]).toBe("no-store");
    expect(SECURITY_HEADERS["X-Robots-Tag"]).toContain("noindex");
  });
});

function sample(): Product {
  const file = join(process.cwd(), "docs/import-demo/samples/supplier-a-northwind-SYNTHETIC.csv");
  const text = readFileSync(file, "utf8");
  const table = readCsv(text, Buffer.byteLength(text, "utf8"));
  if (!table.ok) throw new Error(table.reason);
  const set = stageDrafts(buildDrafts(table.headers, table.rows, suggestMapping(table.headers).mapping), {
    supplierName: "Northwind Hydration",
    sourceFile: "supplier-a-northwind-SYNTHETIC.csv",
    pricedOn: "2026-09-12",
    stagedOn: "2026-09-12",
  });
  return set.staged.find((s) => s.product.id.includes("berry-sparkling"))!.product;
}

const ON = { editedOn: "2026-09-20" };

describe("editing a staged record", () => {
  it("changes what it is asked to change and says what it changed", () => {
    const r = applyEdit(sample(), { name: "Berry Sparkling Energy, 12 cans (checked)" }, ON);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.product.name).toBe("Berry Sparkling Energy, 12 cans (checked)");
    expect(r.changes).toHaveLength(1);
    expect(r.product.id).toBe(sample().id);
    expect(r.product.status).toBe("draft");
  });

  it("reads a typed figure exactly as it reads a cell in a file", () => {
    for (const raw of ["1.5", "1e3", "-4", "twelve", "12 cases"]) {
      const r = applyEdit(sample(), { figures: [{ key: "servings_per_pack", raw }] }, ON);
      expect(r.ok, raw).toBe(false);
    }
    const good = applyEdit(sample(), { figures: [{ key: "servings_per_pack", raw: "24" }] }, ON);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.product.attributes.servings_per_pack.value).toBe(24);
  });

  it("will not call packed items servings unless the operator says one is one", () => {
    expect(applyEdit(sample(), { figures: [{ key: "servings_per_pack", raw: "12 cans" }] }, ON).ok).toBe(false);
    const stated = applyEdit(sample(), { figures: [{ key: "servings_per_pack", raw: "12 cans", servingsBasis: true }] }, ON);
    expect(stated.ok).toBe(true);
  });

  it("keeps an edited figure demo data, and records that a person changed it", () => {
    const r = applyEdit(sample(), { figures: [{ key: "caffeine_mg", raw: "160" }] }, ON);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const figure = r.product.attributes.caffeine_mg;
    expect(figure.value).toBe(160);
    expect(figure.unit).toBe("mg");
    // The whole point. Typing a different number into an invented figure does
    // not turn it into evidence, so it still answers no filter.
    expect(figure.verification).toBe("demo");
    expect(figure.source.kind).toBe("demo");
    expect(figure.source.note).toContain("Changed here by the operator on 2026-09-20");
    expect(figure.source.note).toContain("from 200 to 160");
    expect(figure.source.ref).toBe("supplier-a-northwind-SYNTHETIC.csv, row 3");
  });

  it("does not stack a note every time the same figure is edited", () => {
    const once = applyEdit(sample(), { figures: [{ key: "caffeine_mg", raw: "160" }] }, ON);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = applyEdit(once.product, { figures: [{ key: "caffeine_mg", raw: "150" }] }, ON);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    const note = twice.product.attributes.caffeine_mg.source.note ?? "";
    expect(note.match(/Changed here by the operator/g)).toHaveLength(1);
    expect(note).toContain("from 160 to 150");
  });

  it("takes a figure back out as not stated, never as a zero", () => {
    const r = applyEdit(sample(), { figures: [{ key: "sugar_g", raw: "   " }] }, ON);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.product.attributes.sugar_g.value).toBeUndefined();
    expect(r.product.attributes.sugar_g.verification).toBe("not_stated");
    expect(r.product.attributes.sugar_g.source.note).toContain("cleared");
  });

  it("reads a typed price as strictly as a price in a file", () => {
    const offer = { url: "https://example.invalid/x", lastChecked: "2026-09-12" };
    for (const price of ["", "$", "1,2.34", "-5", "12.34.5", "1e3"]) {
      expect(applyEdit(sample(), { offer: { ...offer, price } }, ON).ok, price).toBe(false);
    }
    const r = applyEdit(sample(), { offer: { ...offer, price: "17.50" } }, ON);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.product.offers[0].priceMinor).toBe(1750);
  });

  it("refuses a store link that is not an address and a date that is not on the calendar", () => {
    const base = { price: "17.50", url: "https://example.invalid/x", lastChecked: "2026-09-12" };
    expect(applyEdit(sample(), { offer: { ...base, url: "ask the rep" } }, ON).ok).toBe(false);
    expect(applyEdit(sample(), { offer: { ...base, url: "javascript:alert(1)" } }, ON).ok).toBe(false);
    expect(applyEdit(sample(), { offer: { ...base, lastChecked: "2026-02-30" } }, ON).ok).toBe(false);
    expect(applyEdit(sample(), { offer: { ...base, lastChecked: "last tuesday" } }, ON).ok).toBe(false);
  });

  it("refuses an empty name or description rather than writing one", () => {
    expect(applyEdit(sample(), { name: "   " }, ON).ok).toBe(false);
    expect(applyEdit(sample(), { description: "" }, ON).ok).toBe(false);
  });

  it("edits nothing outside the few fields it offers", () => {
    const before = sample();
    const r = applyEdit(before, { name: "Renamed", figures: [{ key: "format", raw: "rtd_can" }] }, ON);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toContain("not a figure this edits");
    // A refused edit changes nothing at all, including the parts that were fine.
    expect(before.name).toBe("Berry Sparkling Energy, 12 cans");
  });

  it("changes nothing when every value is what it already was", () => {
    const product = sample();
    const r = applyEdit(product, { name: product.name, description: product.description, figures: [{ key: "caffeine_mg", raw: "200" }] }, ON);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.changes).toEqual([]);
  });
});
