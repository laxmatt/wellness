/**
 * The inventory tool, as a page, on this machine only.
 *
 *   WELLNESS_PREVIEW_INVENTORY=1 npm run inventory:server
 *
 * A separate server on the loopback interface, deliberately not a route in the
 * Next app. A route would exist in every build of the site and would have to be
 * defended in production by authentication this project does not have. This
 * cannot be deployed by accident: it is a script somebody runs, it binds to
 * 127.0.0.1, and it refuses to start anywhere that looks like a deployment.
 *
 * What it will not do:
 *   - listen on anything but loopback. The address is not configurable.
 *   - answer a request addressed to any name but its own, or change anything
 *     for a request that did not come from its own page. See
 *     `src/domain/inventory/local-request.ts`.
 *   - write anywhere but `catalog-preview/`. See `PreviewStore`.
 *   - write the file you upload. It is read in memory, and only records derived
 *     from it are written.
 *   - reach the network, open an address from a file, run a formula, call a
 *     model, or publish anything anywhere.
 *
 * It is not authentication and it is not offered as any. Anybody with a shell
 * on this machine can run the same commands directly.
 */

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { LIMITS, readCsv } from "@/domain/import/csv";
import { buildDrafts, STANDING_REVIEW } from "@/domain/import/draft";
import { DRINK_FIELDS } from "@/domain/import/fields";
import { SUPPORTED_CURRENCIES, SUPPORTED_UNITS } from "@/domain/import/values";
import { suggestMapping, type ColumnMapping } from "@/domain/import/mapping";
import { applyEdit, type RecordEdit } from "@/domain/inventory/edit";
import { guardRequest, SECURITY_HEADERS } from "@/domain/inventory/local-request";
import { stageDrafts } from "@/domain/inventory/stage";
import { STATUS_WORDS, transition, type InventoryAction } from "@/domain/inventory/status";
import { PREVIEW_INVENTORY_FLAG, previewInventoryDecision } from "@/lib/preview-inventory";
import { loadLocalCatalog, type CatalogRecords } from "@/providers/catalog/LocalCatalogProvider";
import { PreviewStore, refusalsFor } from "@/providers/catalog/PreviewStore";

const ROOT = process.cwd();
const CATALOG_DIR = join(ROOT, "catalog");
const store = new PreviewStore(join(ROOT, "catalog-preview"));
const TOOL = join(ROOT, "src", "tools", "inventory-admin");

/** The whole request body, or nothing, bounded well under what a supplier file may be. */
const MAX_BODY = LIMITS.bytes + 100_000;

const today = (): string => new Date().toISOString().slice(0, 10);

type Reply = { status: number; body: unknown };

function fail(message: string, extra: Record<string, unknown> = {}): Reply {
  return { status: 200, body: { ok: false, errors: [message], ...extra } };
}

// ------------------------------------------------------------------ commands

let storefrontUrl = "http://localhost:3000";

function state(): Reply {
  const records = store.records();
  const order = ["draft", "published", "hidden", "discontinued"];
  return {
    status: 200,
    body: {
      ok: true,
      storefront: storefrontUrl,
      standingReview: STANDING_REVIEW,
      records: [...records.products]
        .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name))
        .map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          description: p.description,
          status: p.status,
          statusWords: STATUS_WORDS[p.status],
          brandId: p.brandId,
          sourceRef: p.source.ref ?? null,
          skus: p.identifiers.merchantSkus,
          offer: p.offers[0]
            ? { priceMinor: p.offers[0].priceMinor, currency: p.offers[0].currency, url: p.offers[0].url, lastChecked: p.offers[0].lastChecked, merchantId: p.offers[0].merchantId }
            : null,
          figures: Object.entries(p.attributes).map(([key, sv]) => ({
            key,
            label: DRINK_FIELDS.find((f) => f.key === key)?.label ?? key,
            value: sv.value ?? null,
            unit: sv.unit ?? null,
            verification: sv.verification,
            note: sv.source.note ?? null,
          })),
        })),
    },
  };
}

type FileInput = { fileName?: unknown; text?: unknown; mapping?: unknown; currency?: unknown; servingsBasis?: unknown; units?: unknown };

function readFileInput(input: FileInput): { ok: true; fileName: string; table: ReturnType<typeof readCsv> & { ok: true }; mapping: ColumnMapping } | { ok: false; reply: Reply } {
  const fileName = typeof input.fileName === "string" ? input.fileName.replace(/[^\w.@ -]/g, "") : "";
  const text = typeof input.text === "string" ? input.text : "";
  if (fileName === "" || text === "") return { ok: false, reply: fail("No file was sent.") };
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > LIMITS.bytes) return { ok: false, reply: fail(`That file is ${Math.round(bytes / 1000)} kB. This reads files up to ${LIMITS.bytes / 1000} kB.`) };

  const table = readCsv(text, bytes);
  if (!table.ok) return { ok: false, reply: fail(table.reason) };

  const suggestion = suggestMapping(table.headers, fileName);
  const columns: Record<string, string> = {};
  const chosen = input.mapping;
  if (chosen && typeof chosen === "object") {
    for (const [key, header] of Object.entries(chosen as Record<string, unknown>)) {
      if (typeof header !== "string" || header === "") continue;
      if (!DRINK_FIELDS.some((f) => f.key === key)) continue;
      if (!table.headers.includes(header)) continue;
      columns[key] = header;
    }
  }
  const units: Record<string, string> = {};
  if (input.units && typeof input.units === "object") {
    for (const [key, unit] of Object.entries(input.units as Record<string, unknown>)) {
      if (typeof unit !== "string" || unit === "") continue;
      if (!DRINK_FIELDS.some((f) => f.key === key && f.kind === "measure")) continue;
      if (!(SUPPORTED_UNITS as readonly string[]).includes(unit)) continue;
      units[key] = unit;
    }
  }
  const currency = typeof input.currency === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(input.currency.toUpperCase()) ? input.currency.toUpperCase() : undefined;

  return {
    ok: true,
    fileName,
    table,
    mapping: {
      version: 1,
      name: fileName,
      columns: chosen && typeof chosen === "object" ? columns : suggestion.mapping.columns,
      currency,
      units: Object.keys(units).length > 0 ? units : undefined,
      servingsBasis: input.servingsBasis === true ? true : undefined,
    },
  };
}

function preview(input: FileInput & { supplierName?: unknown; pricedOn?: unknown }): Reply {
  const read = readFileInput(input);
  if (!read.ok) return read.reply;
  const { table, mapping, fileName } = read;

  const supplierName = typeof input.supplierName === "string" ? input.supplierName.trim() : "";
  const pricedOn = typeof input.pricedOn === "string" ? input.pricedOn.trim() : "";
  const drafts = buildDrafts(table.headers, table.rows, mapping);

  // Staging needs a supplier and a date. Without them the reading is still
  // worth showing, so the drafts come back and the records do not.
  const staged =
    supplierName !== "" && /^\d{4}-\d{2}-\d{2}$/.test(pricedOn)
      ? stageDrafts(drafts, { supplierName, sourceFile: fileName, pricedOn, stagedOn: today() })
      : undefined;

  const existing = new Set(store.records().products.map((p) => p.id));
  return {
    status: 200,
    body: {
      ok: true,
      fileName,
      headers: table.headers,
      delimiter: table.delimiter,
      notes: table.notes,
      truncated: table.truncated,
      mapping,
      unmapped: table.headers.filter((h) => !Object.values(mapping.columns).includes(h)),
      drafts: drafts.drafts,
      missingRequired: drafts.missingRequired.map((f) => f.label),
      totals: drafts.totals,
      staged: staged
        ? {
            fatal: staged.fatal,
            refusals: staged.refusals,
            records: staged.staged.map((s) => ({ row: s.row, id: s.product.id, name: s.product.name, alreadyStaged: existing.has(s.product.id) })),
            merchantId: staged.merchant?.id ?? null,
          }
        : null,
    },
  };
}

function stage(input: FileInput & { supplierName?: unknown; pricedOn?: unknown; replace?: unknown }): Reply {
  const read = readFileInput(input);
  if (!read.ok) return read.reply;
  const supplierName = typeof input.supplierName === "string" ? input.supplierName.trim() : "";
  if (supplierName === "") return fail("Say who supplied this file. A price belongs to a named merchant, and the file rarely says which.");
  const pricedOn = typeof input.pricedOn === "string" ? input.pricedOn.trim() : "";
  if (!isCalendarDate(pricedOn)) return fail("Give the date you state these prices were current, written YYYY-MM-DD. The date you downloaded the file is not that date.");

  const drafts = buildDrafts(read.table.headers, read.table.rows, read.mapping);
  const result = stageDrafts(drafts, { supplierName, sourceFile: read.fileName, pricedOn, stagedOn: today() });
  if (result.fatal.length > 0) return fail(result.fatal.join(" "));
  if (result.staged.length === 0) return fail("No row in this file can be staged, so nothing was written.", { refusals: result.refusals });

  const existing = store.records();
  const clashes = result.staged.filter((s) => existing.products.some((p) => p.id === s.product.id));
  if (clashes.length > 0 && input.replace !== true) {
    return fail(
      `${clashes.length} of these are already staged. Re-staging throws away any edits made to them and resets an approved record to a draft. Tick "replace what is already staged" if that is what you want.`,
      { clashes: clashes.map((c) => c.product.id) },
    );
  }

  const stagedIds = new Set(result.staged.map((s) => s.product.id));
  const merged: CatalogRecords = {
    products: [...existing.products.filter((p) => !stagedIds.has(p.id)), ...result.staged.map((s) => s.product)],
    brands: [...existing.brands.filter((b) => !result.brands.some((x) => x.id === b.id)), ...result.brands],
    merchants: [...existing.merchants.filter((m) => m.id !== result.merchant?.id), ...(result.merchant ? [result.merchant] : [])],
  };
  const refusals = refusalsFor(loadLocalCatalog(CATALOG_DIR), merged);
  if (refusals.length > 0) return fail("The catalogue would not be valid with these records in it, so nothing was written.", { refusals });

  if (result.merchant) store.write("merchants", result.merchant.id, result.merchant);
  for (const brand of result.brands) store.write("brands", brand.id, brand);
  for (const s of result.staged) store.write("products", s.product.id, s.product);

  return {
    status: 200,
    body: {
      ok: true,
      message: `Staged ${result.staged.length} of ${drafts.totals.rows} rows as drafts. Nothing is in the storefront until you approve it.`,
      refusals: result.refusals,
      ...(state().body as object),
    },
  };
}

const isCalendarDate = (text: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
};

function changeStatus(input: { id?: unknown; action?: unknown }): Reply {
  const id = typeof input.id === "string" ? input.id : "";
  const action = input.action;
  if (action !== "approve" && action !== "hide" && action !== "unhide") return fail("That is not something this does to a record.");
  return withRecord(id, (product) => {
    const next = transition(product.status, action as InventoryAction);
    if (!next.ok) return fail(next.error);
    return commit(id, { ...product, status: next.to }, `${product.name} is now ${STATUS_WORDS[next.to]}.`);
  });
}

function edit(input: { id?: unknown; edit?: unknown }): Reply {
  const id = typeof input.id === "string" ? input.id : "";
  const patch = (input.edit ?? {}) as RecordEdit;
  return withRecord(id, (product) => {
    const result = applyEdit(product, patch, { editedOn: today() });
    if (!result.ok) return { status: 200, body: { ok: false, errors: result.errors.map((e) => e.message), fieldErrors: result.errors } };
    if (result.changes.length === 0) return { status: 200, body: { ok: true, message: "Nothing changed.", ...(state().body as object) } };
    return commit(id, result.product, `Saved: ${result.changes.join("; ")}.`);
  });
}

function remove(input: { id?: unknown }): Reply {
  const id = typeof input.id === "string" ? input.id : "";
  return withRecord(id, (product) => {
    store.remove(id);
    return { status: 200, body: { ok: true, message: `${product.name} is gone from the preview catalogue. Nothing in catalog/ was touched.`, ...(state().body as object) } };
  });
}

function withRecord(id: string, fn: (product: import("@/domain/product").Product) => Reply): Reply {
  try {
    return fn(store.product(id));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** Write only when the whole catalogue still validates with the change in it. */
function commit(id: string, updated: import("@/domain/product").Product, message: string): Reply {
  const records = store.records();
  const merged = { ...records, products: records.products.map((p) => (p.id === id ? updated : p)) };
  const refusals = refusalsFor(loadLocalCatalog(CATALOG_DIR), merged);
  if (refusals.length > 0) return fail("The catalogue would not be valid with that change in it, so nothing was written.", { refusals });
  store.write("products", id, updated);
  return { status: 200, body: { ok: true, message, ...(state().body as object) } };
}

function run(body: Record<string, unknown>): Reply {
  switch (body.command) {
    case "state":
      return state();
    case "preview":
      return preview(body);
    case "stage":
      return stage(body);
    case "status":
      return changeStatus(body);
    case "edit":
      return edit(body);
    case "remove":
      return remove(body);
    default:
      return fail(`"${String(body.command)}" is not a command this answers.`);
  }
}

// ------------------------------------------------------------------- serving

function send(res: ServerResponse, status: number, type: string, payload: string | Buffer): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type });
  res.end(payload);
}

async function main(): Promise<void> {
  const decision = previewInventoryDecision(process.env);
  if (!decision.allowed) {
    console.error(`Refused.\n  ${decision.reason}\n\nThis tool edits invented products in a local preview catalogue. Start it with:\n\n  ${PREVIEW_INVENTORY_FLAG}=1 npm run inventory:server`);
    process.exit(1);
  }

  const port = Number(process.env.INVENTORY_PORT ?? 4319);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error(`INVENTORY_PORT has to be a port between 1024 and 65535. It says "${process.env.INVENTORY_PORT}".`);
    process.exit(1);
  }
  storefrontUrl = process.env.STOREFRONT_URL ?? "http://localhost:3000";

  // Built here rather than committed, so the page cannot drift from the domain
  // code the tests exercise.
  const bundle = await build({
    entryPoints: [join(TOOL, "entry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    platform: "browser",
    minify: false,
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const js = bundle.outputFiles[0].text;
  const html = readFileSync(join(TOOL, "shell.html"), "utf8");

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const guard = guardRequest({ method: req.method ?? "", headers: req.headers }, port);
    if (!guard.ok) {
      send(res, guard.status, "application/json", JSON.stringify({ ok: false, errors: [guard.error] }));
      return;
    }

    const path = (req.url ?? "/").split("?")[0];
    if (guard.kind === "read") {
      if (path === "/") return send(res, 200, "text/html; charset=utf-8", html);
      if (path === "/app.js") return send(res, 200, "text/javascript; charset=utf-8", js);
      if (path === "/favicon.ico") return send(res, 204, "image/x-icon", "");
      return send(res, 404, "text/plain; charset=utf-8", "Not here.");
    }

    if (path !== "/api") return send(res, 404, "application/json", JSON.stringify({ ok: false, errors: ["Not here."] }));

    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        send(res, 413, "application/json", JSON.stringify({ ok: false, errors: [`That is more than ${Math.round(MAX_BODY / 1000)} kB, which is more than this reads.`] }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return send(res, 400, "application/json", JSON.stringify({ ok: false, errors: ["That is not JSON."] }));
      }
      if (typeof body !== "object" || body === null) return send(res, 400, "application/json", JSON.stringify({ ok: false, errors: ["A command is a JSON object."] }));
      try {
        const reply = run(body as Record<string, unknown>);
        send(res, reply.status, "application/json", JSON.stringify(reply.body));
      } catch (e) {
        // A message, never a stack: a stack names paths on this machine.
        send(res, 500, "application/json", JSON.stringify({ ok: false, errors: [e instanceof Error ? e.message : "Something went wrong."] }));
      }
    });
  });

  // Loopback, and not configurable. There is no flag here that opens this to a
  // network, because there is no version of this that should be on one.
  server.listen(port, "127.0.0.1", () => {
    console.log(`Inventory tool: http://127.0.0.1:${port}`);
    console.log(`Storefront it links to: ${storefrontUrl}`);
    console.log(`\nTo start this and the storefront together, so an approval shows up with nothing restarted:\n  ${PREVIEW_INVENTORY_FLAG}=1 npm run inventory:review`);
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") console.error(`Port ${port} is already in use. Set INVENTORY_PORT to another one.`);
    else console.error(e.message);
    process.exit(1);
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
