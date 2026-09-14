/**
 * The partner ingestion tool, as a page, on this machine only.
 *
 *   WELLNESS_INGESTION_ADMIN=1 npm run ingestion:server
 *
 * A separate loopback server rather than a route in the Next app, for the same
 * reason the inventory tool is one: a route exists in every build of the site
 * and would have to be defended in production by authentication this project
 * does not have. This cannot be deployed by accident. It is a script somebody
 * runs, it binds to 127.0.0.1, the address is not configurable, and it refuses
 * to start anywhere that looks like a deployment.
 *
 * What it will not do:
 *   - publish anything. Every record it writes is a draft, in `ingestion/`,
 *     which the site does not read. Promotion into the catalogue is a separate
 *     decision and there is no command for it here.
 *   - write outside `ingestion/`. `catalog/` is never touched.
 *   - store a credential, or an address with a key in it. An upload that looks
 *     like it carries one is refused rather than saved.
 *   - reach the network, fetch a feed, run a formula, call a model, or compose
 *     a tracking link.
 *   - import from a mapping profile nobody approved.
 *
 * The four decisions stay four. Saving a mapping, approving it, importing
 * drafts and reviewing a listing are separate commands, and publication is not
 * a command at all.
 */

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { categoryById } from "@/domain/categories";
import { LIMITS } from "@/domain/import/csv";
import { adapterFor, formatOptions, type SourceTable } from "@/domain/ingestion/adapter";
import { applyEditorialEdit } from "@/domain/ingestion/editorial";
import type { Preflight } from "@/domain/ingestion/preflight";
import { CANONICAL_TARGETS, MappingProfile, PartnerSource, isApproved, nextVersion } from "@/domain/ingestion/profile";
import { suggestColumns } from "@/domain/ingestion/suggest";
import { guardRequest, SECURITY_HEADERS } from "@/domain/inventory/local-request";
import { INGESTION_ADMIN_FLAG, ingestionAdminDecision } from "@/lib/ingestion-admin";
import type { Product } from "@/domain/product";
import { IngestionStore } from "@/providers/ingestion/IngestionStore";
import { ingestionRoot } from "@/providers/ingestion/root";
import { buildReport, draftIssues, runIngestionImport } from "@/providers/ingestion/import";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const ROOT = process.cwd();
const CATALOG_DIR = join(ROOT, "catalog");
const store = new IngestionStore(ingestionRoot(ROOT));
const TOOL = join(ROOT, "src", "tools", "ingestion-admin");
const MAX_BODY = LIMITS.bytes + 200_000;

const today = (): string => new Date().toISOString().slice(0, 10);

type Reply = { status: number; body: unknown };
const fail = (message: string, extra: Record<string, unknown> = {}): Reply => ({ status: 200, body: { ok: false, errors: [message], ...extra } });

const text = (v: unknown): string => (typeof v === "string" ? v : "");

// ------------------------------------------------------------------ reading

type FileInput = { sourceId?: unknown; fileName?: unknown; text?: unknown };

function readTable(input: FileInput, format: PartnerSource["format"]) {
  const fileName = text(input.fileName).replace(/[^\w.@ -]/g, "");
  const body = text(input.text);
  if (fileName === "" || body === "") return { ok: false as const, reply: fail("No file was sent.") };
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > LIMITS.bytes) return { ok: false as const, reply: fail(`That file is ${Math.round(bytes / 1000)} kB. This reads files up to ${LIMITS.bytes / 1000} kB.`) };
  const adapter = adapterFor(format);
  if (!adapter.ok) return { ok: false as const, reply: fail(adapter.reason) };
  const read = adapter.adapter.read(body, bytes);
  if (!read.ok) return { ok: false as const, reply: fail(read.reason) };
  return { ok: true as const, fileName, body, table: read.table };
}

function sourceOr(id: unknown): { ok: true; source: PartnerSource } | { ok: false; reply: Reply } {
  const source = typeof id === "string" ? store.source(id) : undefined;
  if (!source) return { ok: false, reply: fail(`There is no partner source called "${String(id)}".`) };
  return { ok: true, source };
}

function categoryOr(source: PartnerSource) {
  const category = categoryById(source.categoryId);
  if (!category) throw new Error(`${source.name} names category "${source.categoryId}", which this site does not define.`);
  return category;
}

// ----------------------------------------------------------------- commands

function state(): Reply {
  const drafts = store.drafts();
  return {
    status: 200,
    body: {
      ok: true,
      today: today(),
      formats: formatOptions(),
      targets: CANONICAL_TARGETS,
      sources: store.sources().map((s) => {
        const profiles = store.profiles(s.id);
        const st = store.state(s.id);
        return {
          source: s,
          profiles: profiles.map((p) => ({ version: p.version, createdOn: p.createdOn, createdBy: p.createdBy, note: p.note, approved: isApproved(p), approvedBy: p.approvedBy, approvedOn: p.approvedOn, profile: p })),
          lastSuccessfulRefresh: st.lastSuccessfulRefresh ?? null,
          lastProfileVersion: st.lastProfileVersion ?? null,
          lastFile: st.lastFile ?? null,
          uploads: store.uploads(s.id).length,
          records: Object.keys(st.snapshot).length,
        };
      }),
      drafts: drafts.products
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status,
          brandId: p.brandId,
          categoryId: p.categoryId,
          note: p.source.note ?? null,
          price: p.offers[0]?.priceMinor ?? null,
          quoteOnly: p.offers[0]?.quoteOnly === true,
          availability: p.offers[0]?.availability ?? "unknown",
          url: p.offers[0]?.url ?? null,
          image: p.images[0]?.src ?? null,
          attributes: Object.entries(p.attributes).map(([key, v]) => ({ key, value: v.value ?? null, verification: v.verification, note: v.source.note ?? null })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

function saveSource(input: { source?: unknown }): Reply {
  const parsed = PartnerSource.safeParse(input.source);
  if (!parsed.success) return fail("That partner source is not valid.", { fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join(".") || "source", message: i.message })) });
  if (!categoryById(parsed.data.categoryId)) return fail(`"${parsed.data.categoryId}" is not a category this site defines.`);
  store.saveSource(parsed.data);
  return { status: 200, body: { ok: true, message: `Saved ${parsed.data.name}.`, ...(state().body as object) } };
}

function inspect(input: FileInput): Reply {
  const found = sourceOr(input.sourceId);
  if (!found.ok) return found.reply;
  const read = readTable(input, found.source.format);
  if (!read.ok) return read.reply;
  const category = categoryOr(found.source);
  const suggestion = suggestColumns(read.table.columns);

  return {
    status: 200,
    body: {
      ok: true,
      fileName: read.fileName,
      rows: read.table.rows.length,
      truncated: read.table.truncated,
      readerNotes: read.table.notes,
      columns: read.table.columns.map((name) => {
        const values = read.table.rows.map((r) => (r[name] ?? "").trim());
        return { name, populated: values.filter((v) => v !== "").length, samples: [...new Set(values.filter((v) => v !== ""))].slice(0, 3) };
      }),
      suggestion,
      category: {
        id: category.id,
        name: category.name,
        attributes: category.attributeDefinitions.map((d) => ({ key: d.key, label: d.label, type: d.type, unit: d.unit ?? null, options: d.enumOptions?.map((o) => o.value) ?? null, filterable: d.filterable })),
        filters: category.filters.map((f) => ({ key: f.key, label: f.label, kind: f.kind })),
      },
    },
  };
}

function profileFrom(input: { profile?: unknown }, source: PartnerSource, version: number): { ok: true; profile: MappingProfile } | { ok: false; reply: Reply } {
  const draft = { createdOn: today(), createdBy: "operator", note: "", proposedFilters: [], ...(input.profile as object), sourceId: source.id, format: source.format, version };
  const parsed = MappingProfile.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, reply: fail("That mapping is not valid.", { fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join(".") || "profile", message: i.message })) }) };
  }
  // A draft is never approved. Approval is its own command against a saved
  // version, and carrying an approval in from the client would make the whole
  // separation decorative.
  return { ok: true, profile: { ...parsed.data, approvedOn: undefined, approvedBy: undefined } };
}

function runPreflight(input: FileInput & { profile?: unknown; version?: unknown }): Reply {
  const found = sourceOr(input.sourceId);
  if (!found.ok) return found.reply;
  const read = readTable(input, found.source.format);
  if (!read.ok) return read.reply;

  let profile: MappingProfile;
  if (typeof input.version === "number") {
    const saved = store.profile(found.source.id, input.version);
    if (!saved) return fail(`There is no version ${input.version} of ${found.source.name}'s mapping.`);
    profile = saved;
  } else {
    const made = profileFrom(input, found.source, (store.latestProfile(found.source.id)?.version ?? 0) + 1);
    if (!made.ok) return made.reply;
    profile = made.profile;
  }

  const report = report_(profile, found.source, read);
  return { status: 200, body: { ok: true, preflight: report } };
}

function report_(profile: MappingProfile, source: PartnerSource, read: { fileName: string; table: SourceTable }): Preflight {
  return buildReport({ store, catalogDir: CATALOG_DIR, source, profile, table: read.table, fileName: read.fileName, today: today() });
}

function saveProfile(input: { sourceId?: unknown; profile?: unknown }): Reply {
  const found = sourceOr(input.sourceId);
  if (!found.ok) return found.reply;
  const version = nextVersion(store.profiles(found.source.id));
  const made = profileFrom(input, found.source, version);
  if (!made.ok) return made.reply;
  store.saveProfile(made.profile);
  return {
    status: 200,
    body: {
      ok: true,
      version,
      message: `Saved as version ${version}. It is a draft of a decision until somebody approves it, and an import will refuse it until then.`,
      ...(state().body as object),
    },
  };
}

function approveProfile(input: { sourceId?: unknown; version?: unknown; by?: unknown }): Reply {
  const found = sourceOr(input.sourceId);
  if (!found.ok) return found.reply;
  const by = text(input.by).trim();
  if (by === "") return fail("Say who is approving this mapping. An approval nobody signed is not one.");
  if (typeof input.version !== "number") return fail("Name the version being approved.");
  try {
    const approved = store.approveProfile(found.source.id, input.version, by, today());
    return { status: 200, body: { ok: true, message: `Version ${approved.version} approved by ${by}. Importing drafts is the next decision and it is a separate one.`, ...(state().body as object) } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function runImport(input: FileInput & { version?: unknown }): Reply {
  const found = sourceOr(input.sourceId);
  if (!found.ok) return found.reply;
  if (typeof input.version !== "number") return fail("Name the approved mapping version to import with.");
  const fileName = text(input.fileName).replace(/[^\w.@ -]/g, "");
  const body = text(input.text);
  if (fileName === "" || body === "") return fail("No file was sent.");

  const outcome = runIngestionImport({
    store,
    catalogDir: CATALOG_DIR,
    sourceId: found.source.id,
    version: input.version,
    fileName,
    text: body,
    today: today(),
  });
  if (!outcome.ok) {
    return fail(outcome.errors[0], {
      ...(outcome.blockers ? { blockers: outcome.blockers } : {}),
      ...(outcome.refusals ? { refusals: outcome.refusals } : {}),
      ...(outcome.findings ? { findings: outcome.findings } : {}),
      ...(outcome.report ? { preflight: outcome.report } : {}),
    });
  }
  const report = outcome.report;
  return {
    status: 200,
    body: {
      ok: true,
      message:
        `Imported with version ${input.version}. ${report.counts.added} added, ${report.counts.changed} changed, ${report.counts.unchanged} unchanged, ` +
        `${report.counts.conflict} in conflict, ${report.counts.review} waiting on review, ${report.counts.failed} failed. ` +
        `${report.sourceRecords} source records, ${report.comparisonFamilies.length} things a shopper chooses between. ` +
        `Nothing is published: these are drafts in ingestion/, which the site does not read.`,
      preflight: report,
      upload: { path: outcome.upload.path.replace(ROOT + "/", ""), hash: outcome.upload.hash, bytes: outcome.upload.bytes },
      ...(state().body as object),
    },
  };
}

function edit(input: { id?: unknown; name?: unknown; description?: unknown; by?: unknown }): Reply {
  const id = text(input.id);
  const draft: Product | undefined = store.draft(id);
  if (!draft) return fail(`There is no draft with id "${id}".`);
  const by = text(input.by).trim() || "operator";
  const result = applyEditorialEdit(draft, { ...(typeof input.name === "string" ? { name: input.name } : {}), ...(typeof input.description === "string" ? { description: input.description } : {}) }, { by, on: today() });
  if (!result.ok) return { status: 200, body: { ok: false, errors: result.errors.map((e) => e.message), fieldErrors: result.errors } };
  if (result.changes.length === 0) return { status: 200, body: { ok: true, message: "Nothing changed.", ...(state().body as object) } };

  const records = store.drafts();
  const issues = draftIssues(CATALOG_DIR, { ...records, products: records.products.map((p) => (p.id === id ? result.product : p)) });
  if (issues.length > 0) return fail("That change would make the catalogue invalid, so nothing was written.", { refusals: issues });
  store.writeDraft("products", id, result.product);
  return {
    status: 200,
    body: {
      ok: true,
      message: `Saved: ${result.changes.join("; ")}. Whether the next import may overwrite this depends on the field's owner in the mapping profile.`,
      ...(state().body as object),
    },
  };
}

function run(body: Record<string, unknown>): Reply {
  switch (body.command) {
    case "state":
      return state();
    case "saveSource":
      return saveSource(body);
    case "inspect":
      return inspect(body);
    case "preflight":
      return runPreflight(body);
    case "saveProfile":
      return saveProfile(body);
    case "approveProfile":
      return approveProfile(body);
    case "import":
      return runImport(body);
    case "edit":
      return edit(body);
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
  const decision = ingestionAdminDecision(process.env);
  if (!decision.allowed) {
    console.error(`Refused.\n  ${decision.reason}\n\nThis tool reads partner files into drafts on this machine. Start it with:\n\n  ${INGESTION_ADMIN_FLAG}=1 npm run ingestion:server`);
    process.exit(1);
  }

  const port = Number(process.env.INGESTION_PORT ?? 4321);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error(`INGESTION_PORT has to be a port between 1024 and 65535. It says "${process.env.INGESTION_PORT}".`);
    process.exit(1);
  }

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
        send(res, 500, "application/json", JSON.stringify({ ok: false, errors: [e instanceof Error ? e.message : "Something went wrong."] }));
      }
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Ingestion tool: http://127.0.0.1:${port}`);
    console.log(`Drafts are written to ingestion/drafts and nothing there is served by the site.`);
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") console.error(`Port ${port} is already in use. Set INGESTION_PORT to another one.`);
    else console.error(e.message);
    process.exit(1);
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
