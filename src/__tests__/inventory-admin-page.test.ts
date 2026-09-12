// @vitest-environment jsdom

/**
 * The page's own state, where it is the page's to lose.
 *
 * Two things a person types are held nowhere but the browser: what they have
 * put in the edit form and what they have said about the file in front of them.
 * The server cannot protect either. These are the tests for both.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Json = Record<string, unknown>;

const RECORD = {
  id: "preview-acme-fizz",
  slug: "preview-acme-fizz",
  name: "Fizz, 12 cans",
  description: "A staged record.",
  status: "draft",
  statusWords: "draft, not in the storefront",
  brandId: "preview-brand-acme",
  sourceRef: "a.csv, row 2",
  skus: { "preview-supplier-acme": "A-1" },
  offer: { priceMinor: 1612, currency: "USD", url: "https://example.invalid/fizz", lastChecked: "2026-09-12", merchantId: "preview-supplier-acme" },
  figures: [
    { key: "function", label: "Function", value: ["energy"], unit: null, verification: "demo", note: null },
    { key: "sugar_g", label: "Sugar", value: 0, unit: "g", verification: "demo", note: null },
    { key: "caffeine_mg", label: "Caffeine", value: 200, unit: "mg", verification: "demo", note: null },
    { key: "servings_per_pack", label: "Servings per pack", value: 12, unit: null, verification: "demo", note: null },
  ],
};

function previewReply(fileName: string, sent: Json): Json {
  return {
    ok: true,
    fileName,
    headers: ["sku", "product_name", "brand", "category", "function", "sugar", "caffeine", "price", "pack", "source_url"],
    delimiter: ",",
    notes: [],
    truncated: 0,
    mapping: { columns: { name: "product_name" }, currency: sent.currency, units: sent.units, servingsBasis: sent.servingsBasis },
    unmapped: [],
    drafts: [{ row: 2, label: "Fizz, 12 cans", fields: [], blockers: 0, checks: 0 }],
    missingRequired: [],
    totals: { rows: 1, clean: 1, withChecks: 0, withBlockers: 0 },
    // Always a clash, so the replace question is on screen for both files.
    staged: { fatal: [], refusals: [], records: [{ row: 2, id: RECORD.id, name: RECORD.name, alreadyStaged: true }], merchantId: "preview-supplier-acme" },
  };
}

/** Every request the page made, in order, so a test can read what it sent. */
let sent: Json[] = [];
let replyTo: (command: string, body: Json) => Json | Error = () => ({ ok: true });

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  sent = [];
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Json;
    sent.push(body);
    const reply = replyTo(String(body.command), body);
    if (reply instanceof Error) throw reply;
    return { json: async () => reply };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function mount(): Promise<void> {
  vi.resetModules();
  const { start } = await import("@/tools/inventory-admin/main");
  start(document);
  await flush();
}

const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field="${name}"]`);
const control = (name: string) => document.querySelector<HTMLInputElement>(`[data-control="${name}"]`);
const buttonNamed = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text);

function type(input: HTMLInputElement | HTMLTextAreaElement | null, value: string): void {
  if (!input) throw new Error("no such box on the page");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function tick(box: HTMLInputElement | null, on: boolean): void {
  if (!box) throw new Error("no such checkbox on the page");
  box.checked = on;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

function choose(select: HTMLSelectElement | null, value: string): void {
  if (!select) throw new Error("no such menu on the page");
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

async function upload(name: string, text: string): Promise<void> {
  const input = control("file");
  if (!input) throw new Error("no file box on the page");
  Object.defineProperty(input, "files", { value: [{ name, text: async () => text }], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await flush();
}

const lastSent = (command: string): Json | undefined => [...sent].reverse().find((b) => b.command === command);

// ------------------------------------------------------------ the edit form

async function openEditor(): Promise<void> {
  replyTo = (command) => (command === "state" ? { ok: true, storefront: "http://127.0.0.1:3000", standingReview: [], records: [RECORD] } : { ok: true });
  await mount();
  buttonNamed("Edit")!.click();
  await flush();
}

describe("a refused save keeps what the operator typed", () => {
  it("keeps a good name and a bad price, and saves the name once the price is fixed", async () => {
    await openEditor();

    type(field("name"), "Fizz, 12 cans (checked)");
    type(field("offer.price"), "not a price");

    replyTo = () => ({ ok: false, errors: ["That is not an amount of money."], fieldErrors: [{ field: "offer.price", message: "That is not an amount of money." }] });
    buttonNamed("Save")!.click();
    await flush();

    // The form is still open, the reason is beside the box it belongs to, and
    // neither typed value went back to what the record says.
    expect(document.querySelector('[data-editing="true"]')).not.toBeNull();
    expect(document.querySelector('[data-error="offer.price"]')?.textContent).toContain("not an amount of money");
    expect(field("name")?.value).toBe("Fizz, 12 cans (checked)");
    expect(field("offer.price")?.value).toBe("not a price");

    type(field("offer.price"), "17.50");
    const saved = { ...RECORD, name: "Fizz, 12 cans (checked)", offer: { ...RECORD.offer, priceMinor: 1750 } };
    replyTo = () => ({ ok: true, message: "Saved.", storefront: "", standingReview: [], records: [saved] });
    buttonNamed("Save")!.click();
    await flush();

    const edit = (lastSent("edit")?.edit ?? {}) as { name?: string; offer?: { price?: string } };
    expect(edit.name).toBe("Fizz, 12 cans (checked)");
    expect(edit.offer?.price).toBe("17.50");
    expect(document.querySelector('[data-editing="true"]')).toBeNull();
    expect(document.body.textContent).toContain("Fizz, 12 cans (checked)");
  });

  it("keeps them when the tool cannot be reached at all", async () => {
    await openEditor();
    type(field("name"), "Fizz, 12 cans (checked)");
    type(field("caffeine_mg"), "160");

    replyTo = () => new Error("network down");
    buttonNamed("Save")!.click();
    await flush();

    expect(document.body.textContent).toContain("network down");
    expect(document.querySelector('[data-editing="true"]')).not.toBeNull();
    expect(field("name")?.value).toBe("Fizz, 12 cans (checked)");
    expect(field("caffeine_mg")?.value).toBe("160");
  });

  it("puts the record's own values back only when the operator cancels", async () => {
    await openEditor();
    type(field("name"), "Something else");
    buttonNamed("Cancel")!.click();
    await flush();
    expect(document.querySelector('[data-editing="true"]')).toBeNull();

    buttonNamed("Edit")!.click();
    await flush();
    expect(field("name")?.value).toBe(RECORD.name);
  });
});

// --------------------------------------------------------------- a new file

describe("what the operator said about one file does not carry to the next", () => {
  async function withTwoFiles(): Promise<void> {
    replyTo = (command, body) => {
      if (command === "state") return { ok: true, storefront: "", standingReview: [], records: [] };
      if (command === "preview") return previewReply(String(body.fileName), body);
      return { ok: true };
    };
    await mount();
  }

  it("clears the unit, the currency and the servings answer", async () => {
    await withTwoFiles();
    await upload("a.csv", "sku,product_name\nA-1,Fizz\n");

    choose(document.querySelector('[data-control="currency"]'), "EUR");
    await flush();
    choose(document.querySelector('[data-control="unit.sugar_g"]'), "mg");
    await flush();
    tick(control("basis"), true);
    await flush();

    const forA = lastSent("preview")!;
    expect(forA.currency).toBe("EUR");
    expect(forA.units).toEqual({ sugar_g: "mg" });
    expect(forA.servingsBasis).toBe(true);

    await upload("b.csv", "sku,product_name\nB-1,Other\n");

    // The second supplier's bare numbers must not quietly take the first
    // supplier's unit, or its currency, or its basis.
    const forB = lastSent("preview")!;
    expect(forB.fileName).toBe("b.csv");
    expect(forB.currency).toBeUndefined();
    expect(forB.units).toEqual({});
    expect(forB.servingsBasis).toBe(false);

    expect((document.querySelector('[data-control="currency"]') as HTMLSelectElement).value).toBe("");
    expect((document.querySelector('[data-control="unit.sugar_g"]') as HTMLSelectElement).value).toBe("");
    expect(control("basis")?.checked).toBe(false);
  });

  it("clears consent to replace what is already staged", async () => {
    await withTwoFiles();
    await upload("a.csv", "sku,product_name\nA-1,Fizz\n");
    tick(control("replace"), true);
    expect(control("replace")?.checked).toBe(true);

    await upload("b.csv", "sku,product_name\nB-1,Other\n");

    // A tick that meant "replace these five" must not come to mean "replace
    // those five", so it is asked again for the new file.
    expect(control("replace")?.checked).toBe(false);

    buttonNamed("Stage 1 draft")!.click();
    await flush();
    expect(lastSent("stage")?.replace).toBe(false);
  });

  it("says which file it is reading", async () => {
    await withTwoFiles();
    await upload("a.csv", "sku,product_name\nA-1,Fizz\n");
    expect(control("fileName")?.textContent).toContain("a.csv");
    await upload("b.csv", "sku,product_name\nB-1,Other\n");
    expect(control("fileName")?.textContent).toContain("b.csv");
  });
});


describe("demo inventory without a supplier file", () => {
  it("previews fictional data without staging or approving anything", async () => {
    replyTo = (command, body) => command === "preview" ? previewReply(String(body.fileName), body) : { ok: true, records: [], standingReview: [] };
    await mount();
    buttonNamed("Try demo inventory")!.click();
    await flush();
    const request = lastSent("preview")!;
    expect(request.fileName).toContain("SYNTHETIC");
    expect(request.text).toContain("NW-1005");
    expect(request.supplierName).toContain("fictional demo");
    expect(request.pricedOn).toBe("");
    expect(sent.map(r => r.command)).toEqual(["state", "preview"]);
  });
});
