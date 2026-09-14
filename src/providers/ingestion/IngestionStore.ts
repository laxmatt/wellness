/**
 * Where ingestion keeps what it is given, and the only code that writes there.
 *
 * Five things live under one root: the partner sources somebody defined, every
 * version of every mapping profile, the raw uploads themselves, the fields the
 * last import wrote for each record, and the draft records the imports produce.
 *
 * **It is not the catalogue.** `catalog/` is never written here, and the drafts
 * this holds are not read by the site. That is deliberate and it is stronger
 * than a status flag: a draft in the catalogue is one query change away from
 * being served, and a record in a directory nothing loads is not. Promoting a
 * draft into the catalogue is a separate decision with separate code, and that
 * code is not in this batch.
 *
 * **No path comes out of a file.** Every filename is built from an id this
 * project validated against `Id`, and the built path is then checked to resolve
 * inside the root. Two locks, because the first one is a regular expression and
 * regular expressions are how this sort of thing goes wrong.
 *
 * **No credential is stored, and none is accepted.** The feed this was built
 * against is downloaded from an address carrying an API key. That address is
 * not recorded here: there is no field for it, and an upload whose bytes look
 * like they carry a key or a signed URL is refused rather than saved. A secret
 * committed to a repository is a secret to rotate, and the cheapest place to
 * stop it is before it is written.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { MappingProfile, PartnerSource } from "@/domain/ingestion/profile";
import type { RecordFields } from "@/domain/ingestion/record";
import { Id, type Brand, type Merchant, type Product } from "@/domain/product";
import { readCatalogRecords, type CatalogRecords } from "@/providers/catalog/LocalCatalogProvider";
import { z } from "zod";

export const SourceState = z.object({
  sourceId: Id,
  /** The day an import of this source last completed. What staleness is measured from. */
  lastSuccessfulRefresh: z.iso.date().optional(),
  lastProfileVersion: z.number().int().positive().optional(),
  lastFile: z.string().optional(),
  /** The fields the last import wrote, per record. The third value the merge needs. */
  snapshot: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});
export type SourceState = z.infer<typeof SourceState>;

/**
 * Shapes that say a file carries a credential.
 *
 * An assignment of something named like a secret to something long enough to be
 * one, and a URL with a key in its query. Not a claim to catch everything: it
 * catches the two ways a feed URL and an export actually leak, and the cost of
 * a false positive is somebody being told why their file was refused.
 */
const CREDENTIAL_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /\b(api[_-]?key|apikey|client[_-]?secret|secret|password|passwd|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{8,}/i, what: "something named like a key or a password with a value beside it" },
  { pattern: /https?:\/\/[^\s"']*[?&](api[_-]?key|apikey|key|token|secret|signature|sig|auth)=[^\s"'&]{8,}/i, what: "an address with a key or a signature in its query string" },
  { pattern: /\bauthorization\s*:\s*(bearer|basic)\s+\S{8,}/i, what: "an authorization header" },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: "a private key" },
];

export type CredentialFinding = { what: string; line: number };

/** Every credential-shaped thing in some text, with a line number and never the value. */
export function findCredentials(text: string): CredentialFinding[] {
  const found: CredentialFinding[] = [];
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    for (const { pattern, what } of CREDENTIAL_PATTERNS) {
      if (pattern.test(line)) found.push({ what, line: i + 1 });
    }
  }
  return found;
}

export const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** A name safe to put on disk, built from the upload's own name and its content hash. */
export function uploadFileName(original: string, hash: string, on: string): string {
  const cleaned = original.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-60);
  const ext = /\.([a-z0-9]{1,5})$/.exec(cleaned)?.[1] ?? "txt";
  return `${on}-${hash.slice(0, 12)}.${ext}`;
}

export type UploadRefusal = { ok: false; reason: string; findings: CredentialFinding[] };
export type UploadSaved = { ok: true; path: string; hash: string; bytes: number };

export class IngestionStore {
  constructor(readonly root: string) {}

  private inside(...parts: string[]): string {
    const path = resolve(this.root, ...parts);
    if (path !== resolve(this.root) && !path.startsWith(resolve(this.root) + sep)) {
      throw new Error(`Refusing to touch a path outside the ingestion workspace: ${path}`);
    }
    return path;
  }

  private id(id: string): string {
    if (!Id.safeParse(id).success) throw new Error(`"${id}" is not a record id, so no filename is built from it.`);
    return id;
  }

  private readJson<T>(path: string, schema: z.ZodType<T>): T | undefined {
    if (!existsSync(path)) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      throw new Error(`${path} is not readable as JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new Error(`${path} is not valid:\n${parsed.error.issues.map((i) => `  ${i.path.join(".") || "record"}: ${i.message}`).join("\n")}`);
    return parsed.data;
  }

  private writeJson(path: string, data: unknown): void {
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  // ------------------------------------------------------------------ sources

  sources(): PartnerSource[] {
    const dir = this.inside("sources");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.readJson(join(dir, f), PartnerSource)!)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  source(id: string): PartnerSource | undefined {
    return this.readJson(this.inside("sources", `${this.id(id)}.json`), PartnerSource);
  }

  saveSource(source: PartnerSource): void {
    this.writeJson(this.inside("sources", `${this.id(source.id)}.json`), source);
  }

  // ----------------------------------------------------------------- profiles

  profiles(sourceId: string): MappingProfile[] {
    const dir = this.inside("profiles", this.id(sourceId));
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => /^v\d+\.json$/.test(f))
      .map((f) => this.readJson(join(dir, f), MappingProfile)!)
      .sort((a, b) => a.version - b.version);
  }

  profile(sourceId: string, version: number): MappingProfile | undefined {
    if (!Number.isInteger(version) || version < 1) throw new Error(`"${version}" is not a profile version.`);
    return this.readJson(this.inside("profiles", this.id(sourceId), `v${version}.json`), MappingProfile);
  }

  /** The newest version, whether or not anybody approved it. */
  latestProfile(sourceId: string): MappingProfile | undefined {
    return this.profiles(sourceId).at(-1);
  }

  /**
   * Saved as a new version, never over an old one.
   *
   * An import records the version that built it, so a record that turns out
   * wrong names the decision behind it. Editing a version in place would make
   * that reference a lie the moment somebody fixed a mapping.
   */
  saveProfile(profile: MappingProfile): void {
    const path = this.inside("profiles", this.id(profile.sourceId), `v${profile.version}.json`);
    if (existsSync(path)) throw new Error(`Version ${profile.version} of ${profile.sourceId} is already saved. A profile version is written once; save a new version instead.`);
    this.writeJson(path, profile);
  }

  /** Approval is its own write, and it is the only thing that may change a saved version. */
  approveProfile(sourceId: string, version: number, by: string, on: string): MappingProfile {
    const profile = this.profile(sourceId, version);
    if (!profile) throw new Error(`No version ${version} of ${sourceId}.`);
    if (profile.approvedOn) throw new Error(`Version ${version} was already approved by ${profile.approvedBy} on ${profile.approvedOn}.`);
    const approved: MappingProfile = { ...profile, approvedOn: on, approvedBy: by };
    this.writeJson(this.inside("profiles", this.id(sourceId), `v${version}.json`), approved);
    return approved;
  }

  // ------------------------------------------------------------------ uploads

  /**
   * The file as it arrived, kept.
   *
   * Refused outright when it looks like it carries a credential. Nothing is
   * redacted: a file half-saved with the interesting parts removed is a file
   * nobody can check the import against, and the right answer is to export it
   * again without the key.
   */
  saveUpload(sourceId: string, originalName: string, text: string, on: string): UploadSaved | UploadRefusal {
    const findings = findCredentials(text);
    if (findings.length > 0) {
      return {
        ok: false,
        findings,
        reason: `This file looks like it carries a credential: ${[...new Set(findings.map((f) => f.what))].join("; ")}. It is refused rather than saved, and nothing was written. Export the feed without the key, or strip the column, and upload it again.`,
      };
    }
    const hash = sha256(text);
    const name = uploadFileName(originalName, hash, on);
    const path = this.inside("uploads", this.id(sourceId), name);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, text, "utf8");
    return { ok: true, path, hash, bytes: Buffer.byteLength(text, "utf8") };
  }

  uploads(sourceId: string): string[] {
    const dir = this.inside("uploads", this.id(sourceId));
    if (!existsSync(dir)) return [];
    return readdirSync(dir).sort();
  }

  // -------------------------------------------------------------------- state

  state(sourceId: string): SourceState {
    return this.readJson(this.inside("state", `${this.id(sourceId)}.json`), SourceState) ?? { sourceId, snapshot: {} };
  }

  saveState(state: SourceState): void {
    this.writeJson(this.inside("state", `${this.id(state.sourceId)}.json`), state);
  }

  /** What the last import wrote for each record of this source. The merge's third value. */
  snapshot(sourceId: string): Record<string, RecordFields> {
    return this.state(sourceId).snapshot as Record<string, RecordFields>;
  }

  // ------------------------------------------------------------------- drafts

  drafts(): CatalogRecords {
    const dir = this.inside("drafts");
    if (!existsSync(dir)) return { products: [], brands: [], merchants: [] };
    return readCatalogRecords(dir, true);
  }

  draftsById(): Map<string, Product> {
    return new Map(this.drafts().products.map((p) => [p.id, p]));
  }

  writeDraft(kind: "products" | "brands" | "merchants", id: string, data: Product | Brand | Merchant): void {
    this.writeJson(this.inside("drafts", kind, `${this.id(id)}.json`), data);
  }

  draft(id: string): Product | undefined {
    return this.draftsById().get(id);
  }
}
